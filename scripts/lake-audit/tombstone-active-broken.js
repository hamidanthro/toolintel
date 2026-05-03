#!/usr/bin/env node
/**
 * tombstone-active-broken.js — flip status='broken' on the 186 active rows
 * in staar-content-pool that are missing `correctIndex` (the lake audit's
 * MISSING_REQUIRED_FIELDS heuristic, status=active).
 *
 * Background: lambda/tutor.js#handleGenerate's fire-and-forget save path
 * had a writer bug (commit 756e0a4 fixes it going forward) that produced
 * 186 rows with correctIndex: null. They're currently servable to kids
 * and would render as garbage. This script stops serving them.
 *
 * Behavior:
 *   - DEFAULT mode is DRY-RUN. Logs what it WOULD do; touches nothing.
 *   - Requires --apply flag to actually write to DynamoDB.
 *   - Reads the audit JSON to determine the target set.
 *   - For each target: re-fetches the live row to confirm current state
 *     STILL matches what the audit recorded. If concurrent writes have
 *     fixed the row, SKIPS it (logged with reason).
 *   - UpdateItem uses a ConditionExpression so concurrent writes during
 *     this script's execution can't be silently overwritten.
 *   - Sequential processing (not parallel). ~200 rows × ~50ms each ≈ 10s.
 *   - Retries throttled / 5xx errors with exponential backoff (3 attempts).
 *   - NEVER hard-deletes. Only sets status='broken' + tombstone metadata.
 *
 * Reversal: this script is undo-able. To restore status='active' on the
 * touched rows, write the inverse update keyed on the same contentIds.
 * The list of touched contentIds is logged to a per-run JSON at
 * scripts/lake-audit/output/tombstone-<timestamp>.json.
 *
 * Usage:
 *   node scripts/lake-audit/tombstone-active-broken.js
 *   node scripts/lake-audit/tombstone-active-broken.js --apply
 *   node scripts/lake-audit/tombstone-active-broken.js --apply --audit path/to/audit.json
 *
 * Exit codes:
 *   0 — success (every row was either UPDATED or explicitly SKIPPED)
 *   1 — any unhandled error
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const TOMBSTONE_REASON = 'active_missing_correctIndex_fixed_by_writer_2026-05-03';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// --------------------------------------------------------------
// Args
// --------------------------------------------------------------
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
let auditPath = path.join(__dirname, 'output', 'audit-20260503T001406Z.json');
const auditFlagIdx = args.indexOf('--audit');
if (auditFlagIdx !== -1 && args[auditFlagIdx + 1]) {
  auditPath = args[auditFlagIdx + 1];
}

// --------------------------------------------------------------
// Filter audit JSON for the 186 target rows
// --------------------------------------------------------------
function loadTargets(jsonPath) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!raw.suspects) throw new Error(`Audit JSON has no .suspects array: ${jsonPath}`);
  return raw.suspects.filter((s) => {
    if (s.status !== 'active') return false;
    return Array.isArray(s.matches) && s.matches.some((m) => m.heuristic === 'MISSING_REQUIRED_FIELDS');
  });
}

// --------------------------------------------------------------
// Retry wrapper for transient throttle / 5xx errors
// --------------------------------------------------------------
async function withRetry(fn, label) {
  const delays = [100, 400, 1600]; // 3 retry attempts
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const transient =
        err.name === 'ProvisionedThroughputExceededException' ||
        err.name === 'ThrottlingException' ||
        err.name === 'InternalServerError' ||
        (err.$metadata && err.$metadata.httpStatusCode >= 500);
      if (!transient || attempt === delays.length) {
        throw err;
      }
      console.warn(`[tombstone] retry ${label} attempt ${attempt + 1} after ${delays[attempt]}ms — ${err.name}`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

// --------------------------------------------------------------
// Per-row work
// --------------------------------------------------------------
async function processRow(target) {
  const ctx = `state=${target.state} subject=${target.subject} grade=${target.grade}`;
  const logBase = `[tombstone] contentId=${target.contentId} ${ctx}`;

  // Re-fetch live row to confirm current state matches audit
  let live;
  try {
    const resp = await withRetry(
      () => ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { poolKey: target.poolKey, contentId: target.contentId },
        ProjectionExpression: '#st, correctIndex, #t',
        ExpressionAttributeNames: { '#st': 'status', '#t': 'type' }
      })),
      `GetItem ${target.contentId}`
    );
    live = resp.Item;
  } catch (err) {
    console.log(`${logBase} action=SKIPPED:get_item_failed:${err.name || err.message}`);
    return { action: 'SKIPPED', reason: `get_item_failed:${err.name || err.message}` };
  }

  if (!live) {
    console.log(`${logBase} action=SKIPPED:row_not_found_in_lake`);
    return { action: 'SKIPPED', reason: 'row_not_found_in_lake' };
  }

  // Safety: row must STILL be active. If concurrent writes changed status, skip.
  if (live.status !== 'active') {
    console.log(`${logBase} action=SKIPPED:status_no_longer_active:${live.status}`);
    return { action: 'SKIPPED', reason: `status_no_longer_active:${live.status}` };
  }

  // Safety (added 2026-05-03 incident fix): refuse to tombstone numeric
  // questions. Numeric rows legitimately have correctIndex=null; the audit
  // heuristic that drove this script's input list has been fixed too, but
  // belt-and-suspenders here so an old audit JSON can't repeat the
  // 89-row over-tombstone incident.
  if (live.type === 'numeric') {
    console.log(`${logBase} action=SKIPPED:type_numeric_correctIndex_null_is_legitimate`);
    return { action: 'SKIPPED', reason: 'type_numeric_correctIndex_null_is_legitimate' };
  }

  // Safety: correctIndex must STILL be missing or null.
  // Number 0 is a valid correctIndex (kid's first choice), so distinguish
  // explicitly: skip if it's a real number now.
  if (typeof live.correctIndex === 'number') {
    console.log(`${logBase} action=SKIPPED:correctIndex_now_present:${live.correctIndex}`);
    return { action: 'SKIPPED', reason: `correctIndex_now_present:${live.correctIndex}` };
  }

  // Dry-run: log only.
  if (!APPLY) {
    console.log(`${logBase} action=dry-run-would-update`);
    return { action: 'dry-run-would-update' };
  }

  // Apply mode: UpdateItem with ConditionExpression.
  // Condition asserts the same invariants we just re-fetched, so a concurrent
  // write between our GetItem and our UpdateItem will fail the condition
  // (ConditionalCheckFailedException) and we treat it as SKIPPED.
  try {
    await withRetry(
      () => ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { poolKey: target.poolKey, contentId: target.contentId },
        UpdateExpression: 'SET #st = :broken, tombstonedAt = :ts, tombstoneReason = :reason',
        ConditionExpression: '#st = :active AND (attribute_not_exists(correctIndex) OR correctIndex = :nullval)',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':broken': 'broken',
          ':active': 'active',
          ':ts': new Date().toISOString(),
          ':reason': TOMBSTONE_REASON,
          ':nullval': null
        }
      })),
      `UpdateItem ${target.contentId}`
    );
    console.log(`${logBase} action=UPDATED`);
    return { action: 'UPDATED' };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`${logBase} action=SKIPPED:condition_failed_concurrent_write`);
      return { action: 'SKIPPED', reason: 'condition_failed_concurrent_write' };
    }
    console.log(`${logBase} action=SKIPPED:update_failed:${err.name || err.message}`);
    return { action: 'SKIPPED', reason: `update_failed:${err.name || err.message}` };
  }
}

// --------------------------------------------------------------
// Main
// --------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `tombstone-${stamp}.json`);

  console.log(`[tombstone] table=${TABLE} region=${REGION}`);
  console.log(`[tombstone] mode=${APPLY ? 'APPLY (will write to DynamoDB)' : 'DRY-RUN (no writes)'}`);
  console.log(`[tombstone] audit=${auditPath}`);
  console.log(`[tombstone] tombstone reason=${TOMBSTONE_REASON}`);
  console.log();

  let targets;
  try {
    targets = loadTargets(auditPath);
  } catch (err) {
    console.error(`[tombstone] FATAL: failed to load targets: ${err.message}`);
    process.exit(1);
  }

  console.log(`[tombstone] target count: ${targets.length}`);
  console.log();

  const results = [];
  const counts = { UPDATED: 0, 'dry-run-would-update': 0, SKIPPED: 0 };
  const skipReasons = {};

  for (const t of targets) {
    let r;
    try {
      r = await processRow(t);
    } catch (err) {
      console.log(`[tombstone] contentId=${t.contentId} action=ERROR:${err.name || err.message}`);
      r = { action: 'ERROR', reason: err.name || err.message };
    }
    results.push({ contentId: t.contentId, poolKey: t.poolKey, state: t.state, ...r });
    counts[r.action] = (counts[r.action] || 0) + 1;
    if (r.action === 'SKIPPED' && r.reason) {
      skipReasons[r.reason] = (skipReasons[r.reason] || 0) + 1;
    }
  }

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    auditPath,
    tombstoneReason: TOMBSTONE_REASON,
    startedAt: new Date(startedAt).toISOString(),
    elapsedMs: Date.now() - startedAt,
    targetCount: targets.length,
    counts,
    skipReasons
  };

  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log();
  console.log('=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log();
  console.log(`[tombstone] wrote ${outFile}`);

  // Exit 0 only if every row was either UPDATED, dry-run-would-update, or SKIPPED.
  // ERROR action means an unhandled exception slipped through processRow.
  const errored = (counts.ERROR || 0);
  if (errored > 0) {
    console.error(`[tombstone] FAILED: ${errored} unhandled errors`);
    process.exit(1);
  }
  console.log(`[tombstone] DONE — ${APPLY ? 'lake state changed' : 'no writes; re-run with --apply to commit'}`);
}

main().catch((err) => {
  console.error(`[tombstone] FATAL: ${err && (err.stack || err.message || err)}`);
  process.exit(1);
});
