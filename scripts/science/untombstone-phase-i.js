#!/usr/bin/env node
/**
 * Phase J — un-tombstone the 41 Phase I questions + 7 scenarios.
 *
 * Reads the Phase I pilot payload to find the canonical (poolKey,
 * contentId) and passageId list. For each row currently in
 * status='tombstoned-needs-tek-revalidation', flip back to
 * status='active' and stamp untombstone provenance.
 *
 * The ConditionExpression scopes the update to ONLY the rows tombstoned
 * by Phase E/G/G2/H/H2/I — never touches rows tombstoned for other
 * reasons.
 *
 * DRY-RUN by default. Pass --execute to actually apply.
 *
 * Recovery: PITR is enabled (35-day window) + the breadcrumb JSON has
 * the (poolKey, contentId) pair list, so a hand-rollback that re-
 * tombstones is straightforward.
 *
 * Run:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     node scripts/science/untombstone-phase-i.js          # dry-run
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     node scripts/science/untombstone-phase-i.js --execute
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const REGION = 'us-east-1';
const POOL_TABLE = 'staar-content-pool';
const PASSAGES_TABLE = 'staar-passages';

const TOMBSTONE_STATUS = 'tombstoned-needs-tek-revalidation';
const ACTIVE_STATUS = 'active';
const UNTOMBSTONE_REASON = 'phase-i-opus-shipped-2026-05-09';

const PILOT_PAYLOAD = path.resolve(__dirname, 'output', 'pilot-2026-05-09T01-32-38-699Z.json');
const OUTPUT_DIR = path.resolve(__dirname, 'output');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

function parseArgs(argv) {
  const opts = { execute: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--execute') opts.execute = true;
    else if (argv[i] === '--help' || argv[i] === '-h') {
      console.log('Usage: untombstone-phase-i.js [--execute]');
      process.exit(0);
    }
  }
  return opts;
}

function nowIso() { return new Date().toISOString(); }

function readPayloadTargets() {
  if (!fs.existsSync(PILOT_PAYLOAD)) {
    throw new Error(`Pilot payload not found at ${PILOT_PAYLOAD}`);
  }
  const d = JSON.parse(fs.readFileSync(PILOT_PAYLOAD, 'utf8'));
  const poolTargets = [];
  const passageTargets = [];
  for (const r of (d.results || [])) {
    if (!r.ok) continue;
    if (r.passageRow && r.passageRow.passageId) {
      passageTargets.push({
        passageId: r.passageRow.passageId,
        title: r.passageRow.title,
        scenarioType: r.passageRow.scenarioType,
        regionTag: r.passageRow.regionTag
      });
    }
    if (Array.isArray(r.questionRows)) {
      for (const q of r.questionRows) {
        poolTargets.push({
          poolKey: q.poolKey,
          contentId: q.contentId,
          claimedTeks: q.claimedTeks,
          strand: q.strand,
          regionTag: q.regionTag
        });
      }
    }
  }
  return { poolTargets, passageTargets };
}

async function untombstonePool(row, ts) {
  await ddb.send(new UpdateCommand({
    TableName: POOL_TABLE,
    Key: { poolKey: row.poolKey, contentId: row.contentId },
    UpdateExpression: 'SET #s = :active, #ua = :now, #ur = :why REMOVE #ta, #tr',
    ExpressionAttributeNames: {
      '#s': 'status',
      '#ua': '_untombstonedAt',
      '#ur': '_untombstoneReason',
      '#ta': '_tombstonedAt',
      '#tr': '_tombstoneReason'
    },
    ExpressionAttributeValues: {
      ':active': ACTIVE_STATUS,
      ':now': ts,
      ':why': UNTOMBSTONE_REASON,
      ':tombstoned': TOMBSTONE_STATUS
    },
    ConditionExpression: 'attribute_exists(contentId) AND #s = :tombstoned'
  }));
}

async function untombstonePassage(row, ts) {
  await ddb.send(new UpdateCommand({
    TableName: PASSAGES_TABLE,
    Key: { passageId: row.passageId },
    UpdateExpression: 'SET #s = :active, #ua = :now, #ur = :why REMOVE #ta, #tr',
    ExpressionAttributeNames: {
      '#s': 'status',
      '#ua': '_untombstonedAt',
      '#ur': '_untombstoneReason',
      '#ta': '_tombstonedAt',
      '#tr': '_tombstoneReason'
    },
    ExpressionAttributeValues: {
      ':active': ACTIVE_STATUS,
      ':now': ts,
      ':why': UNTOMBSTONE_REASON,
      ':tombstoned': TOMBSTONE_STATUS
    },
    ConditionExpression: 'attribute_exists(passageId) AND #s = :tombstoned'
  }));
}

async function main() {
  const opts = parseArgs(process.argv);
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const startedAt = nowIso();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[untombstone-phase-i] runId=${runId} mode=${opts.execute ? 'execute' : 'dry-run'}`);

  const { poolTargets, passageTargets } = readPayloadTargets();
  console.log(`pool targets: ${poolTargets.length}`);
  console.log(`passage targets: ${passageTargets.length}`);

  console.log('');
  console.log('=== POOL TARGETS (first 5) ===');
  for (const r of poolTargets.slice(0, 5)) {
    console.log(`  poolKey=${r.poolKey} contentId=${r.contentId} claimedTeks=${r.claimedTeks} strand="${r.strand}" region=${r.regionTag || 'none'}`);
  }
  if (poolTargets.length > 5) console.log(`  … ${poolTargets.length - 5} more`);
  console.log('');
  console.log('=== PASSAGE TARGETS ===');
  for (const r of passageTargets) {
    console.log(`  passageId=${r.passageId} title="${r.title}" type=${r.scenarioType} region=${r.regionTag || 'none'}`);
  }

  const breadcrumb = {
    runId,
    startedAt,
    mode: opts.execute ? 'execute' : 'dry-run',
    fromStatus: TOMBSTONE_STATUS,
    toStatus: ACTIVE_STATUS,
    untombstoneReason: UNTOMBSTONE_REASON,
    pilotPayload: path.basename(PILOT_PAYLOAD),
    poolTargets,
    passageTargets,
    updates: { poolUpdated: 0, poolFailed: 0, passageUpdated: 0, passageFailed: 0 }
  };

  if (!opts.execute) {
    console.log('');
    console.log('[DRY-RUN] no writes performed. Re-run with --execute to apply.');
    const out = path.join(OUTPUT_DIR, `untombstone-phase-i-${runId}-dryrun.json`);
    fs.writeFileSync(out, JSON.stringify(breadcrumb, null, 2));
    console.log(`Breadcrumb (dry-run): ${out}`);
    process.exit(0);
  }

  // --- Execute ---
  const ts = nowIso();
  console.log('');
  console.log(`Executing untombstones at ${ts} ...`);
  for (const r of poolTargets) {
    try {
      await untombstonePool(r, ts);
      breadcrumb.updates.poolUpdated++;
      console.log(`  [pool] active ← ${r.contentId}`);
    } catch (err) {
      breadcrumb.updates.poolFailed++;
      const reason = err && err.name === 'ConditionalCheckFailedException'
        ? 'NOT in tombstoned-needs-tek-revalidation state'
        : (err.message || String(err));
      console.error(`  [pool] FAILED ${r.contentId}: ${reason}`);
    }
  }
  for (const r of passageTargets) {
    try {
      await untombstonePassage(r, ts);
      breadcrumb.updates.passageUpdated++;
      console.log(`  [passages] active ← ${r.passageId}`);
    } catch (err) {
      breadcrumb.updates.passageFailed++;
      const reason = err && err.name === 'ConditionalCheckFailedException'
        ? 'NOT in tombstoned-needs-tek-revalidation state'
        : (err.message || String(err));
      console.error(`  [passages] FAILED ${r.passageId}: ${reason}`);
    }
  }

  breadcrumb.endedAt = nowIso();
  const out = path.join(OUTPUT_DIR, `untombstone-phase-i-${runId}.json`);
  fs.writeFileSync(out, JSON.stringify(breadcrumb, null, 2));

  console.log('');
  console.log('=== UNTOMBSTONE SUMMARY ===');
  console.log(`pool rows untombstoned:    ${breadcrumb.updates.poolUpdated}`);
  console.log(`pool rows failed:          ${breadcrumb.updates.poolFailed}`);
  console.log(`passage rows untombstoned: ${breadcrumb.updates.passageUpdated}`);
  console.log(`passage rows failed:       ${breadcrumb.updates.passageFailed}`);
  console.log(`breadcrumb:                ${out}`);

  process.exit(breadcrumb.updates.poolFailed === 0 && breadcrumb.updates.passageFailed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
