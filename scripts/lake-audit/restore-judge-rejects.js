#!/usr/bin/env node
/**
 * restore-judge-rejects.js — undo a tombstone-judge-rejects run.
 *
 * Per §22 standing rule: every destructive script ships its restore
 * companion in the same commit. This is that companion. If a sample
 * of restored rows surfaces something the tombstone got wrong (e.g.,
 * the §22 over-tombstone of valid numeric rows), this script flips
 * status='broken' → status='active' and removes the tombstone metadata
 * for every row UPDATED by a given tombstone-judge-rejects run.
 *
 * Reads scripts/lake-audit/output/tombstone-judge-rejects-<UTC>.json
 * (defaults to the most recent) and walks every row that was UPDATED
 * in that run.
 *
 * Per-row safety:
 *   - Re-fetch via GetItem; refuses to touch unless live status is
 *     STILL 'broken' AND tombstoneReason starts with 'judge_audit_'
 *   - ConditionExpression on UpdateItem so a concurrent flip cannot be
 *     silently overwritten
 *   - Sequential, not parallel
 *   - Throttle retry with exponential backoff (3 attempts)
 *
 * Usage:
 *   node scripts/lake-audit/restore-judge-rejects.js                     # dry-run, latest tombstone JSON
 *   node scripts/lake-audit/restore-judge-rejects.js --apply             # real run
 *   node scripts/lake-audit/restore-judge-rejects.js --tombstone <path>  # specific tombstone JSON
 *
 * Exits non-zero on UPDATE errors (after retries). Skipped rows with
 * status drift are logged but do NOT cause non-zero exit.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  DynamoDBClient,
  ProvisionedThroughputExceededException,
  ThrottlingException
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const TABLE = 'staar-content-pool';
const REGION = process.env.AWS_REGION || 'us-east-1';
const TOMBSTONE_REASON_PREFIX = 'judge_audit_';

// ---- args ----
const args = process.argv.slice(2);
let APPLY = false;
let TOMBSTONE_PATH = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--apply') APPLY = true;
  else if (a === '--tombstone') TOMBSTONE_PATH = args[++i];
  else if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 32).map(l => l.replace(/^ \*\/?/, '').replace(/^\/\*\*$/, '')).join('\n'));
    process.exit(0);
  } else {
    console.error(`Unknown arg: ${a}`); process.exit(2);
  }
}

// Default: most recent tombstone-judge-rejects-*.json
if (!TOMBSTONE_PATH) {
  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) {
    console.error('FATAL: scripts/lake-audit/output/ does not exist');
    process.exit(2);
  }
  const candidates = fs.readdirSync(outDir)
    .filter(f => /^tombstone-judge-rejects-.*\.json$/.test(f))
    .map(f => ({ f, path: path.join(outDir, f), m: fs.statSync(path.join(outDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!candidates.length) {
    console.error('FATAL: no tombstone-judge-rejects-*.json found in scripts/lake-audit/output/');
    console.error('Hint: pass --tombstone <path> or run tombstone-judge-rejects.js first.');
    process.exit(2);
  }
  TOMBSTONE_PATH = candidates[0].path;
}

if (!fs.existsSync(TOMBSTONE_PATH)) {
  console.error(`FATAL: tombstone JSON not found: ${TOMBSTONE_PATH}`);
  process.exit(2);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));
const tombstone = JSON.parse(fs.readFileSync(TOMBSTONE_PATH, 'utf8'));
const updatedRows = (tombstone.results || []).filter(r => r.action === 'UPDATED');

console.log(`[restore] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`[restore] tombstone JSON: ${TOMBSTONE_PATH}`);
console.log(`[restore] tombstone summary mode: ${tombstone.summary && tombstone.summary.mode}`);
console.log(`[restore] candidates to restore (rows that were UPDATED): ${updatedRows.length}`);
console.log(`[restore] table=${TABLE} region=${REGION}`);
if (!APPLY) console.log(`[restore] DRY-RUN: no writes will be performed.`);

async function withRetry(name, fn) {
  const delays = [200, 800, 3200];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof ProvisionedThroughputExceededException
        || err instanceof ThrottlingException
        || err.name === 'ProvisionedThroughputExceededException'
        || err.name === 'ThrottlingException'
        || (err.$metadata && err.$metadata.httpStatusCode >= 500);
      if (!retryable || attempt === delays.length) throw err;
      const wait = delays[attempt];
      console.warn(`[restore] retry ${attempt + 1}/${delays.length} for ${name}: ${err.name || err.message} — waiting ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

const results = [];
const counts = {
  total: updatedRows.length,
  restored: 0,
  dryRunWouldRestore: 0,
  skippedNotBroken: 0,
  skippedReasonMismatch: 0,
  skippedNotFound: 0,
  errors: 0
};

(async () => {
  const startedAt = new Date().toISOString();
  for (const r of updatedRows) {
    const key = { poolKey: r.poolKey, contentId: r.contentId };

    let live;
    try {
      const got = await withRetry('GetItem', () =>
        ddb.send(new GetCommand({ TableName: TABLE, Key: key })));
      live = got.Item;
    } catch (err) {
      counts.errors++;
      results.push({ ...key, action: 'ERROR', error: String(err && err.message || err).slice(0, 200) });
      console.error(`[restore] GET ERROR contentId=${r.contentId} err=${(err && err.message || '').slice(0, 120)}`);
      continue;
    }

    if (!live) {
      counts.skippedNotFound++;
      results.push({ ...key, action: 'SKIPPED:not_found' });
      console.warn(`[restore] contentId=${r.contentId} action=SKIPPED:not_found`);
      continue;
    }
    if (live.status !== 'broken') {
      counts.skippedNotBroken++;
      results.push({ ...key, action: `SKIPPED:status_is_${live.status}`, liveStatus: live.status });
      console.warn(`[restore] contentId=${r.contentId} action=SKIPPED:status_is_${live.status}`);
      continue;
    }
    if (!live.tombstoneReason || !String(live.tombstoneReason).startsWith(TOMBSTONE_REASON_PREFIX)) {
      counts.skippedReasonMismatch++;
      results.push({ ...key, action: 'SKIPPED:reason_mismatch', liveReason: live.tombstoneReason || null });
      console.warn(`[restore] contentId=${r.contentId} action=SKIPPED:reason_mismatch live_reason=${live.tombstoneReason}`);
      continue;
    }

    if (!APPLY) {
      counts.dryRunWouldRestore++;
      results.push({ ...key, action: 'dry-run-would-restore', liveReason: live.tombstoneReason });
      console.log(`[restore] contentId=${r.contentId} state=${r.poolKey.split('#')[0]} action=dry-run-would-restore current_reason=${live.tombstoneReason}`);
      continue;
    }

    try {
      await withRetry('UpdateItem', () =>
        ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: key,
          UpdateExpression: 'SET #st = :active REMOVE tombstonedAt, tombstoneReason, #jaid',
          ConditionExpression: '#st = :broken AND begins_with(tombstoneReason, :reasonPrefix)',
          ExpressionAttributeNames: { '#st': 'status', '#jaid': '_judgeAuditId' },
          ExpressionAttributeValues: {
            ':active': 'active',
            ':broken': 'broken',
            ':reasonPrefix': TOMBSTONE_REASON_PREFIX
          }
        })));
      counts.restored++;
      results.push({ ...key, action: 'RESTORED', priorReason: live.tombstoneReason });
      console.log(`[restore] contentId=${r.contentId} state=${r.poolKey.split('#')[0]} action=RESTORED prior_reason=${live.tombstoneReason}`);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        counts.skippedNotBroken++;
        results.push({ ...key, action: 'SKIPPED:condition_failed_concurrent_write' });
        console.warn(`[restore] contentId=${r.contentId} action=SKIPPED:condition_failed_concurrent_write`);
      } else {
        counts.errors++;
        results.push({ ...key, action: 'ERROR', error: String(err && err.message || err).slice(0, 200) });
        console.error(`[restore] UPDATE ERROR contentId=${r.contentId} err=${(err && err.message || '').slice(0, 120)}`);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  console.log('');
  console.log('===== SUMMARY =====');
  console.log(`mode:                       ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`total tombstone-UPDATED:    ${counts.total}`);
  console.log(`restored:                   ${counts.restored}`);
  console.log(`dry-run-would-restore:      ${counts.dryRunWouldRestore}`);
  console.log(`skipped (not broken):       ${counts.skippedNotBroken}`);
  console.log(`skipped (reason mismatch):  ${counts.skippedReasonMismatch}`);
  console.log(`skipped (not found):        ${counts.skippedNotFound}`);
  console.log(`errors:                     ${counts.errors}`);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
  const outPath = path.join(outDir, `restore-judge-rejects-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    summary: { ...counts, mode: APPLY ? 'APPLY' : 'DRY-RUN', startedAt, finishedAt, tombstonePath: TOMBSTONE_PATH, table: TABLE },
    results
  }, null, 2));
  console.log('');
  console.log(`Output: ${outPath}`);

  process.exit(counts.errors > 0 ? 1 : 0);
})().catch(err => {
  console.error('[restore] FATAL:', err && (err.stack || err.message || err));
  process.exit(1);
});
