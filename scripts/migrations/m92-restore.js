#!/usr/bin/env node
/**
 * §92 — Restore companion (May 14, 2026)
 *
 * Reverses m92-math-grade-orphans.js --live. Consumes the manifest
 * (m92-live-<ts>.jsonl) produced by the migration and reverses the
 * Put(new) + Delete(old) pair to its inverse: Put(old) + Delete(new).
 *
 * Per CLAUDE.md §22+§28 destructive-script rule, this companion ships
 * in the same commit as the migration so recovery is one command away
 * if the migration went sideways.
 *
 * ============================================================
 * SAFETY
 * ============================================================
 *   - Refuses to restore unless the live row at newPoolKey has
 *     _migration === '§92'. Protects against restoring on top of an
 *     unrelated row that happens to have the same key.
 *   - Restored row drops the _migration / _migrationAt /
 *     _migrationBefore stamps via the Put-with-original-values flow.
 *
 * ============================================================
 * USAGE
 * ============================================================
 *   node scripts/migrations/m92-restore.js --manifest <path>           # dry-run
 *   node scripts/migrations/m92-restore.js --manifest <path> --live    # live restore
 */

const {
  DynamoDBClient,
  GetItemCommand,
  TransactWriteItemsCommand,
} = require('@aws-sdk/client-dynamodb');
const fs = require('fs');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const MIGRATION_TAG = '§92';
const LIVE = process.argv.includes('--live');

function readArg(name) {
  const idx = process.argv.findIndex(a => a === name);
  if (idx < 0) return null;
  return process.argv[idx + 1] || null;
}

const manifestPath = readArg('--manifest');
if (!manifestPath) {
  console.error('Missing --manifest <path>');
  process.exit(1);
}
if (!fs.existsSync(manifestPath)) {
  console.error('Manifest not found: ' + manifestPath);
  process.exit(1);
}

const lines = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean);
const entries = lines.map(l => JSON.parse(l));

console.log('====================================================');
console.log('§92 math grade-orphan RESTORE');
console.log('  Mode:     ' + (LIVE ? 'LIVE (TransactWriteItems will fire)' : 'DRY-RUN (no writes)'));
console.log('  Manifest: ' + manifestPath);
console.log('  Entries:  ' + entries.length);
console.log('====================================================\n');

const client = new DynamoDBClient({ region: REGION });

(async () => {
  let restored = 0;
  let skipped = 0;
  let failed = 0;
  for (const e of entries) {
    try {
      const live = await client.send(new GetItemCommand({
        TableName: TABLE,
        Key: {
          poolKey: { S: e.newPoolKey },
          contentId: { S: e.contentId },
        },
      }));
      if (!live.Item) {
        skipped += 1;
        console.warn(`  SKIP contentId=${e.contentId} (no row at newPoolKey)`);
        continue;
      }
      const tag = live.Item._migration?.S;
      if (tag !== MIGRATION_TAG) {
        skipped += 1;
        console.warn(`  SKIP contentId=${e.contentId} (_migration=${tag} != ${MIGRATION_TAG})`);
        continue;
      }
      if (!LIVE) {
        restored += 1; // counted as "would restore"
        continue;
      }
      // Build the old row by reverting grade/poolKey and stripping the
      // migration metadata.
      const old = { ...live.Item };
      old.poolKey = { S: e.oldPoolKey };
      old.grade = { S: e.oldGrade };
      delete old._migration;
      delete old._migrationAt;
      delete old._migrationBefore;
      await client.send(new TransactWriteItemsCommand({
        TransactItems: [
          {
            Put: {
              TableName: TABLE,
              Item: old,
              ConditionExpression: 'attribute_not_exists(poolKey)',
            },
          },
          {
            Delete: {
              TableName: TABLE,
              Key: {
                poolKey: { S: e.newPoolKey },
                contentId: { S: e.contentId },
              },
              ConditionExpression: '#m = :tag',
              ExpressionAttributeNames: { '#m': '_migration' },
              ExpressionAttributeValues: { ':tag': { S: MIGRATION_TAG } },
            },
          },
        ],
      }));
      restored += 1;
      if (restored % 50 === 0) {
        console.log(`  progress: ${restored} restored / ${skipped} skipped / ${failed} failed`);
      }
    } catch (err) {
      failed += 1;
      console.warn(`  FAIL contentId=${e.contentId}  err=${err.message}`);
    }
  }
  console.log(`\nDone. Restored: ${restored}. Skipped: ${skipped}. Failed: ${failed}.`);
  if (!LIVE) {
    console.log('(dry-run — to execute live, add --live)');
  }
  if (failed) process.exit(2);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
