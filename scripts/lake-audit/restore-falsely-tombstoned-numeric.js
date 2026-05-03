#!/usr/bin/env node
/**
 * restore-falsely-tombstoned-numeric.js — undo the May 3 over-tombstone.
 *
 * INCIDENT: tombstone-active-broken.js (commit XX) was driven by the
 * audit-texas-fallback.js MISSING_REQUIRED_FIELDS heuristic, which
 * incorrectly flagged numeric questions as broken. Numeric questions
 * legitimately have correctIndex=null and choices=null — the audit
 * heuristic didn't branch on `type` and treated them as malformed
 * multiple-choice rows. 89 of the 186 tombstoned rows were valid
 * numeric content that should never have been touched.
 *
 * This script flips status back to 'active' and removes the
 * tombstonedAt + tombstoneReason fields for the 89 numeric rows.
 *
 * Safety:
 *   - Default DRY-RUN. Requires --apply.
 *   - Re-fetches every row to confirm current state matches expected
 *     (status='broken', tombstoneReason matches the May 3 reason).
 *   - ConditionExpression on UpdateItem refuses to overwrite if state
 *     drifted since the GetItem.
 *   - Sequential processing.
 *   - NEVER hard-deletes or re-broken-tombs anything.
 *
 * Input list: /tmp/touched-numeric.json (produced by /tmp/classify.js
 * during the incident triage).
 *
 * Usage:
 *   node scripts/lake-audit/restore-falsely-tombstoned-numeric.js
 *   node scripts/lake-audit/restore-falsely-tombstoned-numeric.js --apply
 *   node scripts/lake-audit/restore-falsely-tombstoned-numeric.js --apply --input <path>
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const EXPECTED_TOMBSTONE_REASON = 'active_missing_correctIndex_fixed_by_writer_2026-05-03';
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
let inputPath = '/tmp/touched-numeric.json';
const inputFlagIdx = args.indexOf('--input');
if (inputFlagIdx !== -1 && args[inputFlagIdx + 1]) {
  inputPath = args[inputFlagIdx + 1];
}

async function withRetry(fn, label) {
  const delays = [100, 400, 1600];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const transient =
        err.name === 'ProvisionedThroughputExceededException' ||
        err.name === 'ThrottlingException' ||
        err.name === 'InternalServerError' ||
        (err.$metadata && err.$metadata.httpStatusCode >= 500);
      if (!transient || attempt === delays.length) throw err;
      console.warn(`[restore] retry ${label} attempt ${attempt + 1} after ${delays[attempt]}ms — ${err.name}`);
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw lastErr;
}

async function processRow(target) {
  const logBase = `[restore] contentId=${target.contentId}`;

  let live;
  try {
    const resp = await withRetry(
      () => ddb.send(new GetCommand({
        TableName: TABLE,
        Key: { poolKey: target.poolKey, contentId: target.contentId },
        ProjectionExpression: '#st, tombstoneReason, #t',
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
    console.log(`${logBase} action=SKIPPED:row_not_found`);
    return { action: 'SKIPPED', reason: 'row_not_found' };
  }

  // Safety: row must currently be 'broken' AND tombstoneReason must match.
  if (live.status !== 'broken') {
    console.log(`${logBase} action=SKIPPED:status_not_broken:${live.status}`);
    return { action: 'SKIPPED', reason: `status_not_broken:${live.status}` };
  }
  if (live.tombstoneReason !== EXPECTED_TOMBSTONE_REASON) {
    console.log(`${logBase} action=SKIPPED:wrong_tombstone_reason:${live.tombstoneReason}`);
    return { action: 'SKIPPED', reason: `wrong_tombstone_reason:${live.tombstoneReason}` };
  }
  // Safety: row must actually be type=numeric (we're scoped to numeric only).
  if (live.type !== 'numeric') {
    console.log(`${logBase} action=SKIPPED:type_not_numeric:${live.type}`);
    return { action: 'SKIPPED', reason: `type_not_numeric:${live.type}` };
  }

  if (!APPLY) {
    console.log(`${logBase} action=dry-run-would-restore`);
    return { action: 'dry-run-would-restore' };
  }

  try {
    await withRetry(
      () => ddb.send(new UpdateCommand({
        TableName: TABLE,
        Key: { poolKey: target.poolKey, contentId: target.contentId },
        UpdateExpression: 'SET #st = :active REMOVE tombstonedAt, tombstoneReason',
        ConditionExpression: '#st = :broken AND tombstoneReason = :reason',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':active': 'active',
          ':broken': 'broken',
          ':reason': EXPECTED_TOMBSTONE_REASON
        }
      })),
      `UpdateItem ${target.contentId}`
    );
    console.log(`${logBase} action=RESTORED`);
    return { action: 'RESTORED' };
  } catch (err) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`${logBase} action=SKIPPED:condition_failed_concurrent_write`);
      return { action: 'SKIPPED', reason: 'condition_failed_concurrent_write' };
    }
    console.log(`${logBase} action=SKIPPED:update_failed:${err.name || err.message}`);
    return { action: 'SKIPPED', reason: `update_failed:${err.name || err.message}` };
  }
}

async function main() {
  const startedAt = Date.now();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `restore-${stamp}.json`);

  console.log(`[restore] table=${TABLE} region=${REGION}`);
  console.log(`[restore] mode=${APPLY ? 'APPLY (will write to DynamoDB)' : 'DRY-RUN (no writes)'}`);
  console.log(`[restore] input=${inputPath}`);
  console.log(`[restore] expected tombstone reason=${EXPECTED_TOMBSTONE_REASON}`);
  console.log();

  const targets = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  console.log(`[restore] target count: ${targets.length}`);
  console.log();

  const counts = { RESTORED: 0, 'dry-run-would-restore': 0, SKIPPED: 0 };
  const skipReasons = {};
  const results = [];

  for (const t of targets) {
    let r;
    try { r = await processRow(t); }
    catch (err) {
      console.log(`[restore] contentId=${t.contentId} action=ERROR:${err.name || err.message}`);
      r = { action: 'ERROR', reason: err.name || err.message };
    }
    results.push({ contentId: t.contentId, poolKey: t.poolKey, ...r });
    counts[r.action] = (counts[r.action] || 0) + 1;
    if (r.action === 'SKIPPED' && r.reason) {
      skipReasons[r.reason] = (skipReasons[r.reason] || 0) + 1;
    }
  }

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    inputPath,
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
  console.log(`[restore] wrote ${outFile}`);

  const errored = (counts.ERROR || 0);
  if (errored > 0) {
    console.error(`[restore] FAILED: ${errored} unhandled errors`);
    process.exit(1);
  }
  console.log(`[restore] DONE`);
}

main().catch((err) => {
  console.error(`[restore] FATAL: ${err && (err.stack || err.message || err)}`);
  process.exit(1);
});
