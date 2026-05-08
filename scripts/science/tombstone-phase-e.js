#!/usr/bin/env node
/**
 * Phase F — tombstone the Phase E pilot baseline.
 *
 * Targets every staar-content-pool row with subject='science' AND
 * _phase='phase-e', plus every staar-passages row with
 * genre='science_scenario' AND _phase='phase-e'. Updates each to:
 *   status              = 'tombstoned-needs-tek-revalidation'
 *   _tombstoneReason    = 'phase-e-tek-mismatch-baseline-2026-05-08'
 *   _tombstonedAt       = <ISO at run time>
 *
 * Why the verbose status string: a future re-judge sweep filters by
 * this exact value to find candidates for revalidation + re-promotion
 * to 'active'. 'broken' is too generic — it's the same status math
 * uses for write-bug rows (§22) and would conflate two different
 * cleanup classes.
 *
 * DRY-RUN by default. Pass --execute to actually update.
 *
 * Idempotent: re-runs over the same rows just rewrite the same fields.
 * Inline tombstones from earlier in the run that used legacy fields
 * (status='broken', bare tombstonedAt/tombstoneReason) get overwritten
 * to the canonical underscore-prefixed shape.
 *
 * Recovery: PITR is enabled on both tables (35-day window). Plus the
 * before/after JSON written to scripts/science/output/ is a per-row
 * breadcrumb: pre-state + post-state + (poolKey, contentId) pairs so
 * a hand-rollback in code is straightforward.
 *
 * Run:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     node scripts/science/tombstone-phase-e.js          # dry-run
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     node scripts/science/tombstone-phase-e.js --execute
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = 'us-east-1';
const POOL_TABLE = 'staar-content-pool';
const PASSAGES_TABLE = 'staar-passages';

const TOMBSTONE_STATUS = 'tombstoned-needs-tek-revalidation';
const TOMBSTONE_REASON = 'phase-e-tek-mismatch-baseline-2026-05-08';

const OUTPUT_DIR = path.resolve(__dirname, 'output');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function parseArgs(argv) {
  const opts = { execute: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--execute') opts.execute = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: tombstone-phase-e.js [--execute]');
      process.exit(0);
    }
  }
  return opts;
}

function nowIso() { return new Date().toISOString(); }

async function scanAllPages(params) {
  const items = [];
  let last;
  do {
    const r = await ddb.send(new ScanCommand({ ...params, ExclusiveStartKey: last }));
    for (const it of (r.Items || [])) items.push(it);
    last = r.LastEvaluatedKey;
  } while (last);
  return items;
}

// Phase F amnesty: the run-seed-batch.js bug tagged real --write rows
// as _phase='d2b-dry' (parseArgs default dryRun=true wasn't flipped by
// --write). Filter matches BOTH so the 21+5 mis-tagged pilot rows are
// caught alongside any future correctly-tagged 'phase-e' rows.
async function findPoolTargets() {
  return scanAllPages({
    TableName: POOL_TABLE,
    FilterExpression: 'subject = :s AND (#p = :phaseE OR #p = :phaseD)',
    ProjectionExpression: 'poolKey, contentId, claimedTeks, #s, #jc, #p',
    ExpressionAttributeNames: {
      '#p': '_phase',
      '#s': 'status',
      '#jc': '_judgeConfidence'
    },
    ExpressionAttributeValues: {
      ':s': 'science',
      ':phaseE': 'phase-e',
      ':phaseD': 'd2b-dry'
    }
  });
}

async function findPassageTargets() {
  return scanAllPages({
    TableName: PASSAGES_TABLE,
    FilterExpression: 'genre = :g AND (#p = :phaseE OR #p = :phaseD)',
    ProjectionExpression: 'passageId, title, #s, scenarioType, regionTag, #p',
    ExpressionAttributeNames: {
      '#p': '_phase',
      '#s': 'status'
    },
    ExpressionAttributeValues: {
      ':g': 'science_scenario',
      ':phaseE': 'phase-e',
      ':phaseD': 'd2b-dry'
    }
  });
}

async function updatePoolRow(row, ts) {
  await ddb.send(new UpdateCommand({
    TableName: POOL_TABLE,
    Key: { poolKey: row.poolKey, contentId: row.contentId },
    UpdateExpression: 'SET #s = :st, #tr = :why, #ta = :now',
    ExpressionAttributeNames: { '#s': 'status', '#tr': '_tombstoneReason', '#ta': '_tombstonedAt' },
    ExpressionAttributeValues: { ':st': TOMBSTONE_STATUS, ':why': TOMBSTONE_REASON, ':now': ts },
    ConditionExpression: 'attribute_exists(contentId)'
  }));
}

async function updatePassageRow(row, ts) {
  await ddb.send(new UpdateCommand({
    TableName: PASSAGES_TABLE,
    Key: { passageId: row.passageId },
    UpdateExpression: 'SET #s = :st, #tr = :why, #ta = :now',
    ExpressionAttributeNames: { '#s': 'status', '#tr': '_tombstoneReason', '#ta': '_tombstonedAt' },
    ExpressionAttributeValues: { ':st': TOMBSTONE_STATUS, ':why': TOMBSTONE_REASON, ':now': ts },
    ConditionExpression: 'attribute_exists(passageId)'
  }));
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const startedAt = nowIso();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[tombstone-phase-e] runId=${runId} mode=${opts.execute ? 'execute' : 'dry-run'}`);

  console.log('');
  console.log(`Scanning ${POOL_TABLE} for subject=science AND _phase=phase-e ...`);
  const poolTargets = await findPoolTargets();
  console.log(`  found ${poolTargets.length} pool rows`);

  console.log(`Scanning ${PASSAGES_TABLE} for genre=science_scenario AND _phase=phase-e ...`);
  const passageTargets = await findPassageTargets();
  console.log(`  found ${passageTargets.length} passage rows`);

  if (poolTargets.length === 0 && passageTargets.length === 0) {
    console.log('No targets — nothing to tombstone.');
    process.exit(0);
  }

  console.log('');
  console.log('=== POOL TARGETS (subject=science, _phase=phase-e) ===');
  for (const r of poolTargets) {
    console.log(`  poolKey=${r.poolKey} contentId=${r.contentId} claimedTeks=${r.claimedTeks || '?'} status=${r.status || '?'} _judgeConfidence=${r._judgeConfidence ?? '?'}`);
  }
  console.log('');
  console.log('=== PASSAGE TARGETS (genre=science_scenario, _phase=phase-e) ===');
  for (const r of passageTargets) {
    console.log(`  passageId=${r.passageId} title="${r.title || ''}" status=${r.status || '?'}`);
  }

  // Breadcrumb file — pre-state for every targeted row
  const breadcrumb = {
    runId,
    startedAt,
    mode: opts.execute ? 'execute' : 'dry-run',
    tombstoneStatus: TOMBSTONE_STATUS,
    tombstoneReason: TOMBSTONE_REASON,
    poolTargets: poolTargets.map(r => ({
      poolKey: r.poolKey,
      contentId: r.contentId,
      claimedTeks: r.claimedTeks || null,
      preState: { status: r.status || null, judgeConfidence: r._judgeConfidence ?? null }
    })),
    passageTargets: passageTargets.map(r => ({
      passageId: r.passageId,
      title: r.title || null,
      scenarioType: r.scenarioType || null,
      regionTag: r.regionTag || null,
      preState: { status: r.status || null }
    })),
    updates: { poolUpdated: 0, poolFailed: 0, passageUpdated: 0, passageFailed: 0 }
  };

  if (!opts.execute) {
    console.log('');
    console.log('[DRY-RUN] no writes performed. Re-run with --execute to apply.');
    const out = path.join(OUTPUT_DIR, `tombstone-phase-e-${runId}-dryrun.json`);
    fs.writeFileSync(out, JSON.stringify(breadcrumb, null, 2));
    console.log(`Breadcrumb (dry-run): ${out}`);
    process.exit(0);
  }

  // --- Execute mode ---
  const ts = nowIso();
  console.log('');
  console.log(`Executing tombstones at ${ts} ...`);

  for (const r of poolTargets) {
    try {
      await updatePoolRow(r, ts);
      breadcrumb.updates.poolUpdated++;
      console.log(`  [pool] tombstoned ${r.contentId}`);
    } catch (err) {
      breadcrumb.updates.poolFailed++;
      console.error(`  [pool] FAILED ${r.contentId}: ${err.message}`);
    }
  }
  for (const r of passageTargets) {
    try {
      await updatePassageRow(r, ts);
      breadcrumb.updates.passageUpdated++;
      console.log(`  [passages] tombstoned ${r.passageId}`);
    } catch (err) {
      breadcrumb.updates.passageFailed++;
      console.error(`  [passages] FAILED ${r.passageId}: ${err.message}`);
    }
  }

  breadcrumb.endedAt = nowIso();
  const out = path.join(OUTPUT_DIR, `tombstone-phase-e-${runId}.json`);
  fs.writeFileSync(out, JSON.stringify(breadcrumb, null, 2));

  console.log('');
  console.log('=== TOMBSTONE SUMMARY ===');
  console.log(`pool rows tombstoned:     ${breadcrumb.updates.poolUpdated}`);
  console.log(`pool rows failed:         ${breadcrumb.updates.poolFailed}`);
  console.log(`passage rows tombstoned:  ${breadcrumb.updates.passageUpdated}`);
  console.log(`passage rows failed:      ${breadcrumb.updates.passageFailed}`);
  console.log(`breadcrumb:               ${out}`);

  process.exit(breadcrumb.updates.poolFailed === 0 && breadcrumb.updates.passageFailed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
