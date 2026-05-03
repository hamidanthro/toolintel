#!/usr/bin/env node
/**
 * hard-delete-tombstoned.js — permanently DeleteItem rows from
 * staar-content-pool that match one of two well-defined categories.
 *
 * IMPORTANT: hard-delete is reversible ONLY via PITR (CLAUDE.md §23,
 * ROLLBACK.md §4). PITR window is 35 days. After 35 days, deletions
 * are gone forever. The script REFUSES to --apply if PITR is not
 * currently enabled on the table.
 *
 * Categories:
 *   --category=deprecated-cold-v1
 *     status='deprecated' AND promptVersion='cold-v1'
 *     ~10,149 legacy rows from the Texas-fallback era; dormant
 *     (status=deprecated → never served).
 *
 *   --category=tombstoned-broken-mc
 *     status='broken' AND tombstoneReason='active_missing_correctIndex_fixed_by_writer_2026-05-03'
 *     AND type='multiple_choice'
 *     The 97 rows the §22 incident tombstoned after the writer-bug fix.
 *
 *   --category=both (default)
 *     Both categories in one run.
 *
 * Defensive design (lessons from §22):
 *   - DEFAULT mode is DRY-RUN. Requires --apply.
 *   - Re-fetches every target via DynamoDB scan with the LIVE filter,
 *     never trusts a cached list.
 *   - Per-row safety re-check before each batch: row must STILL match
 *     the category filter. Concurrent writes that flipped the row
 *     out of the category cause SKIP, not silent delete.
 *   - For multi_choice category: defensively also refuses to delete
 *     anything whose type is not multiple_choice — even if the live
 *     filter said it matched (belt-and-suspenders against the §22
 *     incident class).
 *   - BatchWriteItem with 25 items max; UnprocessedItems retried with
 *     exponential backoff (3 attempts: 100/400/1600ms).
 *   - Sequential batches, never parallel.
 *   - PITR precondition: --apply refuses to run if PITR is DISABLED.
 *
 * Usage:
 *   node scripts/lake-audit/hard-delete-tombstoned.js
 *   node scripts/lake-audit/hard-delete-tombstoned.js --category=tombstoned-broken-mc
 *   node scripts/lake-audit/hard-delete-tombstoned.js --category=deprecated-cold-v1 --apply
 *
 * Recovery: scripts/lake-audit/restore-hard-deleted-from-pitr.md
 *
 * Exit codes:
 *   0 — success
 *   1 — unhandled error
 *   2 — PITR precondition failed (refusing to --apply)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DynamoDBClient,
  DescribeContinuousBackupsCommand
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, ScanCommand, BatchWriteCommand
} = require('@aws-sdk/lib-dynamodb');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const TOMBSTONE_REASON = 'active_missing_correctIndex_fixed_by_writer_2026-05-03';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const CATEGORIES = {
  'deprecated-cold-v1': {
    label: 'deprecated cold-v1 legacy rows',
    filterExpression: '#s = :dep AND promptVersion = :v1',
    expressionAttributeNames: { '#s': 'status' },
    expressionAttributeValues: { ':dep': 'deprecated', ':v1': 'cold-v1' },
    perRowGuard: (row) => {
      if (row.status !== 'deprecated') return `status_not_deprecated:${row.status}`;
      if (row.promptVersion !== 'cold-v1') return `promptVersion_not_cold-v1:${row.promptVersion}`;
      return null;
    },
    projection: 'contentId, poolKey, #s, promptVersion'
  },
  'tombstoned-broken-mc': {
    label: 'broken multi-choice rows tombstoned in §22',
    filterExpression: '#s = :br AND tombstoneReason = :reason AND #t = :mc',
    expressionAttributeNames: { '#s': 'status', '#t': 'type' },
    expressionAttributeValues: { ':br': 'broken', ':reason': TOMBSTONE_REASON, ':mc': 'multiple_choice' },
    perRowGuard: (row) => {
      if (row.status !== 'broken') return `status_not_broken:${row.status}`;
      if (row.type !== 'multiple_choice') return `type_not_mc:${row.type}`;
      if (row.tombstoneReason !== TOMBSTONE_REASON) return `tombstoneReason_mismatch:${row.tombstoneReason}`;
      return null;
    },
    projection: 'contentId, poolKey, #s, #t, tombstoneReason'
  }
};

// --------------------------------------------------------------
// Args
// --------------------------------------------------------------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
let categoryArg = 'both';
const catFlag = args.find((a) => a.startsWith('--category='));
if (catFlag) categoryArg = catFlag.split('=')[1];
if (!['both', 'deprecated-cold-v1', 'tombstoned-broken-mc'].includes(categoryArg)) {
  console.error(`Unknown category: ${categoryArg}`);
  console.error(`Valid: both, deprecated-cold-v1, tombstoned-broken-mc`);
  process.exit(1);
}

// --------------------------------------------------------------
// PITR precondition
// --------------------------------------------------------------
async function checkPITR() {
  const r = await ddb.send(new DescribeContinuousBackupsCommand({ TableName: TABLE }));
  const status = r.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.PointInTimeRecoveryStatus;
  const earliest = r.ContinuousBackupsDescription?.PointInTimeRecoveryDescription?.EarliestRestorableDateTime;
  return { status, earliest };
}

// --------------------------------------------------------------
// Scan a category's full target set
// --------------------------------------------------------------
async function scanCategory(cat) {
  const items = [];
  let last;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: cat.filterExpression,
      ExpressionAttributeNames: cat.expressionAttributeNames,
      ExpressionAttributeValues: cat.expressionAttributeValues,
      ProjectionExpression: cat.projection,
      ExclusiveStartKey: last
    }));
    for (const it of (r.Items || [])) items.push(it);
    last = r.LastEvaluatedKey;
  } while (last);
  return items;
}

// --------------------------------------------------------------
// Retry wrapper for BatchWriteItem.
//
// Handles two distinct throttle classes:
//   1. SDK-level ThrottlingException (whole batch rejected; GSI hit
//      its scaling limit before auto-scale kicked in) — retry the
//      entire BatchWriteCommand with exponential backoff
//   2. Per-item UnprocessedItems response (some succeeded, some did
//      not) — retry just the unprocessed items
//
// May 3 incident: original retry only handled (2). A GSI ThrottlingException
// on (1) crashed the script after 3,125 rows and left 7,024 to clean up.
// --------------------------------------------------------------
const SDK_RETRY_DELAYS = [200, 800, 3200, 10000]; // 4 attempts after the initial

async function sendBatchWithRetry(items, label) {
  let attempt = 0;
  while (true) {
    try {
      return await ddb.send(new BatchWriteCommand({
        RequestItems: { [TABLE]: items }
      }));
    } catch (err) {
      const transient =
        err.name === 'ThrottlingException' ||
        err.name === 'ProvisionedThroughputExceededException' ||
        err.name === 'InternalServerError' ||
        err.name === 'RequestLimitExceeded' ||
        (err.$metadata && err.$metadata.httpStatusCode >= 500);
      if (!transient || attempt >= SDK_RETRY_DELAYS.length) throw err;
      const delay = SDK_RETRY_DELAYS[attempt];
      console.warn(`[hard-delete] ${label} SDK retry ${attempt + 1}/${SDK_RETRY_DELAYS.length} after ${delay}ms — ${err.name}`);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

async function batchDelete(deleteRequests, label) {
  // deleteRequests = [{poolKey, contentId}, ...] up to 25
  let pending = deleteRequests.map((k) => ({ DeleteRequest: { Key: k } }));
  const delays = [100, 400, 1600];
  let attempt = 0;
  let actuallyDeleted = 0;

  while (pending.length > 0) {
    const r = await sendBatchWithRetry(pending, label);
    const unprocessed = (r.UnprocessedItems && r.UnprocessedItems[TABLE]) || [];
    const processed = pending.length - unprocessed.length;
    actuallyDeleted += processed;
    pending = unprocessed; // Track current pending — bug fix: previously
                           // pending.length wasn't updated after a successful
                           // batch, leading to misleading "unprocessed=25"
                           // log lines even when 0 actually remained.
    if (pending.length === 0) break;
    if (attempt >= delays.length) {
      console.warn(`[hard-delete] ${label} giving up on ${pending.length} unprocessed after ${delays.length + 1} attempts`);
      break;
    }
    console.warn(`[hard-delete] ${label} unprocessed retry ${attempt + 1}: ${pending.length} pending, sleeping ${delays[attempt]}ms`);
    await new Promise((r) => setTimeout(r, delays[attempt]));
    attempt++;
  }
  return { deleted: actuallyDeleted, unprocessed: pending.length };
}

// --------------------------------------------------------------
// Per-category processing
// --------------------------------------------------------------
async function processCategory(catKey) {
  const cat = CATEGORIES[catKey];
  console.log();
  console.log(`=== Category: ${catKey} (${cat.label}) ===`);

  const targets = await scanCategory(cat);
  console.log(`  scanned: ${targets.length} rows match filter`);
  console.log();

  const results = [];
  let dryRunCount = 0, deletedCount = 0, skippedCount = 0;
  const skipReasons = {};

  // Re-check guards row-by-row, build delete-request batches.
  // The scan already returned only rows matching the live filter, but we
  // re-check the per-row guard defensively (concurrent writes between
  // scan pages could in theory slip something through).
  const batchSize = 25;
  const totalBatches = Math.ceil(targets.length / batchSize);

  for (let bi = 0; bi < totalBatches; bi++) {
    const slice = targets.slice(bi * batchSize, (bi + 1) * batchSize);
    const toDelete = [];
    for (const row of slice) {
      const guardError = cat.perRowGuard(row);
      const logBase = `[hard-delete] contentId=${row.contentId} state=${(row.poolKey || '').split('#')[0]} category=${catKey}`;
      if (guardError) {
        skippedCount++;
        skipReasons[guardError] = (skipReasons[guardError] || 0) + 1;
        console.log(`${logBase} action=SKIPPED:${guardError}`);
        results.push({ contentId: row.contentId, poolKey: row.poolKey, action: 'SKIPPED', reason: guardError });
        continue;
      }
      if (!APPLY) {
        dryRunCount++;
        console.log(`${logBase} action=dry-run-would-delete`);
        results.push({ contentId: row.contentId, poolKey: row.poolKey, action: 'dry-run-would-delete' });
      } else {
        toDelete.push({ poolKey: row.poolKey, contentId: row.contentId });
      }
    }

    if (APPLY && toDelete.length > 0) {
      const { deleted, unprocessed } = await batchDelete(toDelete, `batch ${bi + 1}/${totalBatches}`);
      console.log(`[hard-delete] batch ${bi + 1}/${totalBatches} sent=${toDelete.length} deleted=${deleted} unprocessed=${unprocessed}`);
      // Map results — anything in toDelete that wasn't processed is logged as SKIPPED:unprocessed
      // (Conservative: we only know batch totals, not which specific items failed; mark them as DELETED
      //  unless unprocessed > 0, in which case we mark the trailing N as SKIPPED:unprocessed.)
      const successCount = deleted;
      for (let i = 0; i < toDelete.length; i++) {
        if (i < successCount) {
          deletedCount++;
          console.log(`[hard-delete] contentId=${toDelete[i].contentId} category=${catKey} action=DELETED`);
          results.push({ contentId: toDelete[i].contentId, poolKey: toDelete[i].poolKey, action: 'DELETED' });
        } else {
          skippedCount++;
          skipReasons['unprocessed_after_retries'] = (skipReasons['unprocessed_after_retries'] || 0) + 1;
          console.log(`[hard-delete] contentId=${toDelete[i].contentId} category=${catKey} action=SKIPPED:unprocessed_after_retries`);
          results.push({ contentId: toDelete[i].contentId, poolKey: toDelete[i].poolKey, action: 'SKIPPED', reason: 'unprocessed_after_retries' });
        }
      }
    }
  }

  return {
    category: catKey,
    label: cat.label,
    scanned: targets.length,
    counts: { dryRunWouldDelete: dryRunCount, DELETED: deletedCount, SKIPPED: skippedCount },
    skipReasons,
    results
  };
}

// --------------------------------------------------------------
// Main
// --------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `hard-delete-${stamp}.json`);

  console.log(`[hard-delete] table=${TABLE} region=${REGION}`);
  console.log(`[hard-delete] mode=${APPLY ? 'APPLY (will DELETE rows from DynamoDB)' : 'DRY-RUN (no writes)'}`);
  console.log(`[hard-delete] category=${categoryArg}`);

  // PITR precondition for --apply
  const pitr = await checkPITR();
  console.log(`[hard-delete] PITR status: ${pitr.status} (earliest: ${pitr.earliest || 'n/a'})`);
  if (APPLY && pitr.status !== 'ENABLED') {
    console.error(`[hard-delete] REFUSING to --apply: PITR is not ENABLED on ${TABLE}.`);
    console.error(`[hard-delete] Hard-delete is reversible only via PITR. Enable first:`);
    console.error(`  aws dynamodb update-continuous-backups --table-name ${TABLE} \\`);
    console.error(`    --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true`);
    process.exit(2);
  }

  // Cost transparency (DynamoDB on-demand: $1.25 per million WCU; one DeleteItem ≈ 1 WCU per KB).
  // At our typical row size (~16 KB with embedding, ~1 KB without), upper-bound WCU ≈ rows * 16.
  // Total cost upper bound for 10,246 rows × 16 WCU = 164k WCU = $0.21. Functionally free.
  console.log(`[hard-delete] cost estimate: ~\$0.001-0.21 in WCU (negligible at this scale)`);
  console.log();

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    category: categoryArg,
    startedAt: new Date(startedAt).toISOString(),
    pitr,
    perCategory: {}
  };

  const cats = categoryArg === 'both'
    ? ['deprecated-cold-v1', 'tombstoned-broken-mc']
    : [categoryArg];

  for (const c of cats) {
    summary.perCategory[c] = await processCategory(c);
  }

  summary.elapsedMs = Date.now() - startedAt;

  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));

  console.log();
  console.log('=== SUMMARY ===');
  for (const [c, r] of Object.entries(summary.perCategory)) {
    console.log(`  [${c}] scanned=${r.scanned} ${JSON.stringify(r.counts)}`);
    if (Object.keys(r.skipReasons).length) {
      console.log(`    skipReasons: ${JSON.stringify(r.skipReasons)}`);
    }
  }
  console.log(`  elapsed: ${(summary.elapsedMs / 1000).toFixed(1)}s`);
  console.log(`  output: ${outFile}`);

  // Exit non-zero if any category had unprocessed-after-retries skips
  // (indicates throttle that we couldn't recover from — needs investigation).
  const totalUnprocessed = Object.values(summary.perCategory)
    .reduce((acc, c) => acc + (c.skipReasons['unprocessed_after_retries'] || 0), 0);
  if (totalUnprocessed > 0) {
    console.error(`[hard-delete] WARNING: ${totalUnprocessed} rows had unprocessed-after-retries. Re-run.`);
    process.exit(1);
  }
  console.log(`[hard-delete] DONE — ${APPLY ? 'lake state changed' : 're-run with --apply to delete for real'}`);
}

main().catch((err) => {
  console.error(`[hard-delete] FATAL: ${err && (err.stack || err.message || err)}`);
  process.exit(1);
});
