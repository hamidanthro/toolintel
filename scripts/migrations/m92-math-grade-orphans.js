#!/usr/bin/env node
/**
 * §92 — Math grade-orphan migration (May 14, 2026)
 *
 * Per the May 14 schema audit (CLAUDE.md §92 / docs/knowledge-packs/
 * architecture-decisions.md §SS-USA-BROAD), 593 math rows in
 * staar-content-pool are stored with bare grade form (3, 1, 4, K)
 * instead of math's canonical prefixed form (grade-3, grade-1,
 * grade-4, grade-k). They're unreachable via lambda/tutor.js#
 * handleGenerate because math doesn't strip the 'grade-' prefix at
 * the read path (intentional — see §SCHEMA-DRIFT).
 *
 * This script rewrites their grade field + poolKey to canonical
 * form, stamping each touched row with _migration='§92' and
 * _migrationBefore={grade, poolKey} so the restore companion can
 * undo cleanly.
 *
 * ============================================================
 * KEY-SCHEMA NOTE
 * ============================================================
 * staar-content-pool primary key is COMPOSITE:
 *   HASH:  poolKey
 *   RANGE: contentId
 *
 * Since poolKey is part of the PK, UpdateItem cannot mutate it.
 * Strategy = TransactWriteItems with atomic Put(new) + Delete(old).
 * Both succeed or neither does. Restore companion reverses the
 * pair.
 *
 * ============================================================
 * USAGE
 * ============================================================
 *   node scripts/migrations/m92-math-grade-orphans.js           # dry-run (default)
 *   node scripts/migrations/m92-math-grade-orphans.js --live    # live execution
 *
 * Dry-run emits a manifest to scripts/migrations/output/
 * m92-dry-run-<ts>.jsonl. Live emits to m92-live-<ts>.jsonl.
 * The live manifest is the restore companion's input.
 *
 * ============================================================
 * EXPECTED AFFECTED ROWS (per May 14 audit, re-verified at scan time)
 * ============================================================
 *   grade='3'  → 412 rows, rewrite to 'grade-3'
 *   grade='1'  →  34 rows, rewrite to 'grade-1'
 *   grade='4'  →   3 rows, rewrite to 'grade-4'
 *   grade='K'  → 144 rows, rewrite to 'grade-k' (also lowercased)
 *   TOTAL      → 593 rows
 */

const {
  DynamoDBClient,
  ScanCommand,
  TransactWriteItemsCommand,
} = require('@aws-sdk/client-dynamodb');
const fs = require('fs');
const path = require('path');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.join(__dirname, 'output');
const MIGRATION_TAG = '§92'; // '§92' as a unicode literal
const NOW_ISO = new Date().toISOString();
const LIVE = process.argv.includes('--live');

// Bare→canonical map. Case-folded for capital-K orphans.
const GRADE_REWRITE = {
  '1': 'grade-1',
  '3': 'grade-3',
  '4': 'grade-4',
  'K': 'grade-k',
};

function newPoolKeyFor(oldPoolKey, oldGrade, newGrade) {
  // Old format: texas#<bare>#math#<rest>
  // New format: texas#<prefixed>#math#<rest>
  // Replace the FIRST occurrence between the first two `#` to avoid
  // touching anything in the suffix that happens to contain '#3#'.
  const parts = oldPoolKey.split('#');
  if (parts.length < 4) {
    throw new Error(`Unexpected poolKey shape: ${oldPoolKey}`);
  }
  if (parts[1] !== oldGrade) {
    throw new Error(`poolKey[1]=${parts[1]} mismatch oldGrade=${oldGrade} (poolKey=${oldPoolKey})`);
  }
  parts[1] = newGrade;
  return parts.join('#');
}

async function scanOrphans(client) {
  const items = [];
  let exclusiveStart;
  do {
    const out = await client.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'subject = :s AND #st = :st AND grade IN (:g1, :g2, :g3, :g4)',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: {
        ':s': { S: 'math' }, ':st': { S: 'texas' },
        ':g1': { S: '3' }, ':g2': { S: '1' }, ':g3': { S: '4' }, ':g4': { S: 'K' },
      },
      ExclusiveStartKey: exclusiveStart,
    }));
    items.push(...(out.Items || []));
    exclusiveStart = out.LastEvaluatedKey;
  } while (exclusiveStart);
  return items;
}

function planForItem(item) {
  const oldGrade = item.grade.S;
  const newGrade = GRADE_REWRITE[oldGrade];
  if (!newGrade) {
    throw new Error(`No rewrite mapping for grade=${oldGrade} contentId=${item.contentId?.S}`);
  }
  const oldPoolKey = item.poolKey.S;
  const newPoolKey = newPoolKeyFor(oldPoolKey, oldGrade, newGrade);
  return { oldGrade, newGrade, oldPoolKey, newPoolKey, contentId: item.contentId.S };
}

function buildNewItem(item, plan) {
  // Clone every field, then overwrite grade + poolKey + stamp the
  // migration metadata. The audit/restore script reads _migrationBefore
  // to know the original values.
  const next = { ...item };
  next.poolKey = { S: plan.newPoolKey };
  next.grade = { S: plan.newGrade };
  next._migration = { S: MIGRATION_TAG };
  next._migrationAt = { S: NOW_ISO };
  next._migrationBefore = {
    M: {
      grade: { S: plan.oldGrade },
      poolKey: { S: plan.oldPoolKey },
    },
  };
  return next;
}

async function applyTransaction(client, plan, newItem) {
  await client.send(new TransactWriteItemsCommand({
    TransactItems: [
      {
        Put: {
          TableName: TABLE,
          Item: newItem,
          // Belt-and-suspenders: refuse to overwrite an existing row at
          // the new poolKey+contentId (shouldn't exist, but guard anyway).
          ConditionExpression: 'attribute_not_exists(poolKey)',
        },
      },
      {
        Delete: {
          TableName: TABLE,
          Key: {
            poolKey: { S: plan.oldPoolKey },
            contentId: { S: plan.contentId },
          },
          // Only delete if the old row still has the bare grade we
          // expect — protects against concurrent edits.
          ConditionExpression: 'grade = :og',
          ExpressionAttributeValues: { ':og': { S: plan.oldGrade } },
        },
      },
    ],
  }));
}

function pickSamples(items, perBucket = 5) {
  const buckets = { '3': [], '1': [], '4': [], 'K': [] };
  for (const i of items) {
    const g = i.grade.S;
    if (buckets[g]) buckets[g].push(i);
  }
  const out = [];
  for (const k of Object.keys(buckets)) {
    // Random sample without replacement.
    const arr = buckets[k];
    const shuffled = arr.slice().sort(() => Math.random() - 0.5);
    out.push(...shuffled.slice(0, perBucket));
  }
  return out;
}

function fmtSample(item, plan) {
  const type = item.type?.S || '(missing)';
  const q = (item.question?.S || '').slice(0, 80).replace(/\n/g, ' ');
  const judge = item._judge?.S || '(missing)';
  return [
    `  Bucket: grade=${plan.oldGrade}`,
    `  ──────────────────────────────────────────────────────────────────`,
    `  contentId:     ${plan.contentId}`,
    `  oldGrade:      "${plan.oldGrade}"           newGrade:    "${plan.newGrade}"`,
    `  oldPoolKey:    "${plan.oldPoolKey}"`,
    `  newPoolKey:    "${plan.newPoolKey}"`,
    `  type:          ${type}`,
    `  question:      "${q}"`,
    `  _judge:        ${judge}`,
    '',
  ].join('\n');
}

(async () => {
  console.log('====================================================');
  console.log('§92 math grade-orphan migration');
  console.log('  Mode:    ' + (LIVE ? 'LIVE (TransactWriteItems will fire)' : 'DRY-RUN (no writes)'));
  console.log('  Table:   ' + TABLE);
  console.log('  Region:  ' + REGION);
  console.log('====================================================\n');

  const client = new DynamoDBClient({ region: REGION });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Scanning for orphans…');
  const orphans = await scanOrphans(client);
  console.log(`Found ${orphans.length} orphan rows.\n`);

  // Plan each row + count by bucket.
  const plans = [];
  const bucketCount = { '1': 0, '3': 0, '4': 0, 'K': 0 };
  for (const o of orphans) {
    const plan = planForItem(o);
    bucketCount[plan.oldGrade] = (bucketCount[plan.oldGrade] || 0) + 1;
    plans.push({ item: o, plan });
  }
  console.log('Per-bucket counts:');
  for (const g of ['1', '3', '4', 'K']) {
    console.log(`  grade='${g}'  →  '${GRADE_REWRITE[g]}'  count=${bucketCount[g]}`);
  }
  console.log(`  TOTAL: ${plans.length}\n`);

  // Type breakdown — sanity check the migration applies to whatever
  // types exist in the affected set.
  const typeCount = {};
  for (const { item } of plans) {
    const t = item.type?.S || '(missing)';
    typeCount[t] = (typeCount[t] || 0) + 1;
  }
  console.log('Type breakdown:');
  for (const [t, n] of Object.entries(typeCount)) {
    console.log(`  type=${t}  count=${n}`);
  }
  console.log(`(Migration touches grade + poolKey only — type-agnostic.)\n`);

  // Write the manifest first (dry-run or live).
  const stamp = NOW_ISO.replace(/[:.]/g, '-');
  const manifestPath = path.join(
    OUTPUT_DIR,
    `m92-${LIVE ? 'live' : 'dry-run'}-${stamp}.jsonl`
  );
  const manifestStream = fs.createWriteStream(manifestPath);
  for (const { item, plan } of plans) {
    manifestStream.write(JSON.stringify({
      contentId: plan.contentId,
      oldGrade: plan.oldGrade,
      newGrade: plan.newGrade,
      oldPoolKey: plan.oldPoolKey,
      newPoolKey: plan.newPoolKey,
      currentJudge: item._judge?.S || null,
      type: item.type?.S || null,
    }) + '\n');
  }
  manifestStream.end();
  await new Promise(res => manifestStream.on('finish', res));
  console.log(`Manifest:      ${manifestPath}\n`);

  // Print 5 random samples per bucket (20 total) for human eyeball.
  console.log('====================================================');
  console.log('20-ROW SAMPLE (5 random per bucket) — verify before live run');
  console.log('====================================================\n');
  const samplePool = plans.map(p => ({ item: p.item, plan: p.plan }));
  const samples = pickSamples(samplePool.map(p => p.item)).map(item => {
    const plan = plans.find(p => p.item === item).plan;
    return { item, plan };
  });
  for (const { item, plan } of samples) {
    process.stdout.write(fmtSample(item, plan));
  }

  if (!LIVE) {
    console.log('====================================================');
    console.log('DRY-RUN complete. No writes. To execute live:');
    console.log('  node scripts/migrations/m92-math-grade-orphans.js --live');
    console.log('====================================================');
    return;
  }

  // LIVE execution.
  console.log('====================================================');
  console.log('LIVE — executing TransactWriteItems for each plan…');
  console.log('====================================================\n');
  let done = 0;
  let failed = 0;
  const failures = [];
  for (const { item, plan } of plans) {
    try {
      const newItem = buildNewItem(item, plan);
      await applyTransaction(client, plan, newItem);
      done += 1;
      if (done % 50 === 0) {
        console.log(`  progress: ${done}/${plans.length} (${failed} failures)`);
      }
    } catch (err) {
      failed += 1;
      failures.push({ contentId: plan.contentId, error: err.message });
      console.warn(`  FAIL contentId=${plan.contentId}  err=${err.message}`);
    }
  }
  console.log(`\nDone. Updated: ${done}/${plans.length}. Failed: ${failed}.`);
  if (failures.length) {
    const failPath = manifestPath.replace('.jsonl', '-failures.jsonl');
    fs.writeFileSync(failPath, failures.map(f => JSON.stringify(f)).join('\n') + '\n');
    console.log(`Failures: ${failPath}`);
    process.exit(2);
  }
  console.log(`Restore command if needed:`);
  console.log(`  node scripts/migrations/m92-restore.js --manifest ${manifestPath} --live`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
