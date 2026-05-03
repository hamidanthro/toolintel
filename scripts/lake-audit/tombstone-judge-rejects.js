#!/usr/bin/env node
/**
 * tombstone-judge-rejects.js — flips status:active → status:broken on
 * the high-confidence rejects from a judge-audit run.
 *
 * Path 1 scope (per the 2026-05-03 Phase B gate decision in CLAUDE.md §28):
 *   only MULTIPLE_CORRECT and AMBIGUITY rejects from the audit JSON.
 *   FACTUAL and ANSWER_LANGUAGE buckets are SKIPPED — Phase B sample
 *   eyeball showed >30% false-positive rate in those buckets (gpt-4o
 *   letter-position quirk + fabricated phrasing issues). Re-classifier
 *   work is logged in §14 TODOs before those rows can be tombstoned.
 *
 * Per the §22 standing rules:
 *   - DRY-RUN by default; --apply required for any write
 *   - Per-row re-fetch via GetItem; refuses to touch unless live status
 *     is STILL 'active'
 *   - ConditionExpression on UpdateItem so a concurrent flip cannot be
 *     silently overwritten
 *   - Sequential (not parallel) — speed isn't the goal, safety is
 *   - Throttle retry with exponential backoff (3 attempts: 200/800/3200ms)
 *   - Type-branched log lines so reviewers see whether numeric content is
 *     being touched (the §22 over-tombstone class)
 *   - Restore companion ships in same commit (restore-judge-rejects.js)
 *   - PITR active on staar-content-pool — full table can be restored to
 *     any second within last 35 days (CLAUDE.md §23 + ROLLBACK.md §4)
 *
 * Usage:
 *   node scripts/lake-audit/tombstone-judge-rejects.js                # dry-run
 *   node scripts/lake-audit/tombstone-judge-rejects.js --apply        # real run
 *   node scripts/lake-audit/tombstone-judge-rejects.js --audit <path> # custom audit JSON
 *
 * Exits non-zero if any candidate fails to UPDATE (after retries) or any
 * unexpected error. SKIPPED rows (status drift) do NOT cause non-zero exit
 * — they're logged with reason and counted in the output JSON.
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
const TOMBSTONE_BUCKETS = new Set(['MULTIPLE_CORRECT', 'AMBIGUITY']);
const TOMBSTONE_REASON_PREFIX = 'judge_audit_2026-05-03';
const DEFAULT_AUDIT_PATH = path.join(__dirname, 'output', 'judge-audit-2026-05-03T0601Z.json');

// ---- args ----
const args = process.argv.slice(2);
let APPLY = false;
let AUDIT_PATH = DEFAULT_AUDIT_PATH;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--apply') APPLY = true;
  else if (a === '--audit') AUDIT_PATH = args[++i];
  else if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 38).map(l => l.replace(/^ \*\/?/, '').replace(/^\/\*\*$/, '')).join('\n'));
    process.exit(0);
  } else {
    console.error(`Unknown arg: ${a}`); process.exit(2);
  }
}

if (!fs.existsSync(AUDIT_PATH)) {
  console.error(`FATAL: audit JSON not found: ${AUDIT_PATH}`);
  process.exit(2);
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

// ---- load audit + filter to tombstone candidates ----
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8'));
const auditId = path.basename(AUDIT_PATH, '.json');

// Strict scope per Hamid's Path 1 decision: tombstone ONLY rows whose
// failedChecks are entirely within the tombstone buckets. Rows that
// COMBINE a tombstone bucket (MC / AMBIGUITY) with a parked bucket
// (FACTUAL / ANSWER_LANGUAGE) are EXCLUDED — those parked buckets
// failed the §28 Phase B gate and need classifier improvement before
// any destructive action.
const candidates = audit.rejects.filter(r => {
  const checks = r.failedChecks || [];
  if (checks.length === 0) return false;
  return checks.every(c => TOMBSTONE_BUCKETS.has(c));
});

console.log(`[tombstone] mode=${APPLY ? 'APPLY' : 'DRY-RUN'}`);
console.log(`[tombstone] audit JSON: ${AUDIT_PATH}`);
console.log(`[tombstone] total audit rejects: ${audit.rejects.length}`);
console.log(`[tombstone] tombstone-bucket candidates (MULTIPLE_CORRECT + AMBIGUITY): ${candidates.length}`);
console.log(`[tombstone] table=${TABLE} region=${REGION}`);
if (!APPLY) console.log(`[tombstone] DRY-RUN: no writes will be performed.`);

// ---- retry helper for SDK-level throttle / 5xx ----
async function withRetry(name, fn) {
  const delays = [200, 800, 3200];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof ProvisionedThroughputExceededException
        || err instanceof ThrottlingException
        || err.name === 'ProvisionedThroughputExceededException'
        || err.name === 'ThrottlingException'
        || (err.$metadata && err.$metadata.httpStatusCode >= 500);
      if (!retryable || attempt === delays.length) {
        throw err;
      }
      lastErr = err;
      const wait = delays[attempt];
      console.warn(`[tombstone] retry ${attempt + 1}/${delays.length} for ${name}: ${err.name || err.message} — waiting ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// ---- per-row processing ----
const results = [];
const counts = {
  total: candidates.length,
  updated: 0,
  dryRunWouldUpdate: 0,
  skippedNotActive: 0,
  skippedNotFound: 0,
  errors: 0
};

(async () => {
  const startedAt = new Date().toISOString();
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const key = { poolKey: c.poolKey, contentId: c.contentId };

    // 1. Fetch live row
    let live;
    try {
      const got = await withRetry('GetItem', () =>
        ddb.send(new GetCommand({ TableName: TABLE, Key: key })));
      live = got.Item;
    } catch (err) {
      counts.errors++;
      results.push({ ...key, action: 'ERROR', failedChecks: c.failedChecks, error: String(err && err.message || err).slice(0, 200) });
      console.error(`[tombstone] GET ERROR contentId=${c.contentId} err=${(err && err.message || '').slice(0, 120)}`);
      continue;
    }

    if (!live) {
      counts.skippedNotFound++;
      results.push({ ...key, action: 'SKIPPED:not_found', failedChecks: c.failedChecks });
      console.warn(`[tombstone] contentId=${c.contentId} state=${c.state} type=${c.type} action=SKIPPED:not_found failedChecks=${c.failedChecks.join(',')}`);
      continue;
    }
    if (live.status !== 'active') {
      counts.skippedNotActive++;
      results.push({ ...key, action: `SKIPPED:status_is_${live.status}`, failedChecks: c.failedChecks, liveStatus: live.status });
      console.warn(`[tombstone] contentId=${c.contentId} state=${c.state} type=${c.type} action=SKIPPED:status_is_${live.status} failedChecks=${c.failedChecks.join(',')}`);
      continue;
    }

    const reason = `${TOMBSTONE_REASON_PREFIX}_${c.failedChecks.join('+')}`;
    const tombstonedAt = Date.now();

    if (!APPLY) {
      counts.dryRunWouldUpdate++;
      results.push({ ...key, action: 'dry-run-would-update', failedChecks: c.failedChecks, type: live.type || c.type, plannedReason: reason });
      console.log(`[tombstone] contentId=${c.contentId} state=${c.state} type=${live.type || c.type || 'undef'} failedChecks=${c.failedChecks.join(',')} action=dry-run-would-update reason=${reason}`);
      continue;
    }

    // 2. Apply: status='active' → 'broken' with ConditionExpression guard
    try {
      await withRetry('UpdateItem', () =>
        ddb.send(new UpdateCommand({
          TableName: TABLE,
          Key: key,
          UpdateExpression: 'SET #st = :broken, tombstonedAt = :ts, tombstoneReason = :r, #jaid = :aid',
          ConditionExpression: '#st = :active',
          ExpressionAttributeNames: { '#st': 'status', '#jaid': '_judgeAuditId' },
          ExpressionAttributeValues: {
            ':broken': 'broken',
            ':active': 'active',
            ':ts': tombstonedAt,
            ':r': reason,
            ':aid': auditId
          }
        })));
      counts.updated++;
      results.push({ ...key, action: 'UPDATED', failedChecks: c.failedChecks, type: live.type || c.type, tombstoneReason: reason, tombstonedAt });
      console.log(`[tombstone] contentId=${c.contentId} state=${c.state} type=${live.type || c.type || 'undef'} failedChecks=${c.failedChecks.join(',')} action=UPDATED reason=${reason}`);
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        counts.skippedNotActive++;
        results.push({ ...key, action: 'SKIPPED:condition_failed_concurrent_write', failedChecks: c.failedChecks });
        console.warn(`[tombstone] contentId=${c.contentId} state=${c.state} action=SKIPPED:condition_failed_concurrent_write`);
      } else {
        counts.errors++;
        results.push({ ...key, action: 'ERROR', failedChecks: c.failedChecks, error: String(err && err.message || err).slice(0, 200) });
        console.error(`[tombstone] UPDATE ERROR contentId=${c.contentId} err=${(err && err.message || '').slice(0, 120)}`);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  console.log('');
  console.log('===== SUMMARY =====');
  console.log(`mode:                    ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`total candidates:        ${counts.total}`);
  console.log(`updated:                 ${counts.updated}`);
  console.log(`dry-run-would-update:    ${counts.dryRunWouldUpdate}`);
  console.log(`skipped (not active):    ${counts.skippedNotActive}`);
  console.log(`skipped (not found):     ${counts.skippedNotFound}`);
  console.log(`errors:                  ${counts.errors}`);

  // Output JSON
  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15) + 'Z';
  const outPath = path.join(outDir, `tombstone-judge-rejects-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    summary: { ...counts, mode: APPLY ? 'APPLY' : 'DRY-RUN', startedAt, finishedAt, auditPath: AUDIT_PATH, auditId, table: TABLE },
    results
  }, null, 2));
  console.log('');
  console.log(`Output: ${outPath}`);

  process.exit(counts.errors > 0 ? 1 : 0);
})().catch(err => {
  console.error('[tombstone] FATAL:', err && (err.stack || err.message || err));
  process.exit(1);
});
