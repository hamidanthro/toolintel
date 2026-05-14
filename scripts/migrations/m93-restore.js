#!/usr/bin/env node
/**
 * §93 letter-prefix sweep — restore companion (May 14, 2026)
 *
 * Reverses m93-letter-prefix-strip.js --live. Reads the live manifest,
 * verifies _migration='§93' on the row, then restores `choices` (and
 * `answer` if it was changed) from `_migrationBefore`. Removes the
 * migration metadata.
 *
 * USAGE:
 *   node m93-restore.js --manifest <path>         # dry-run
 *   node m93-restore.js --manifest <path> --live  # live
 */

const {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const fs = require('fs');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const MIGRATION_TAG = '§93';
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
const entries = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));

console.log('====================================================');
console.log('§93 letter-prefix sweep RESTORE');
console.log('  Mode:     ' + (LIVE ? 'LIVE (UpdateItem will fire)' : 'DRY-RUN (no writes)'));
console.log('  Manifest: ' + manifestPath);
console.log('  Entries:  ' + entries.length);
console.log('====================================================\n');

const client = new DynamoDBClient({ region: REGION });

(async () => {
  let restored = 0, skipped = 0, failed = 0;
  for (const e of entries) {
    try {
      const live = await client.send(new GetItemCommand({
        TableName: TABLE,
        Key: {
          poolKey: { S: e.poolKey },
          contentId: { S: e.contentId },
        },
      }));
      if (!live.Item) {
        skipped += 1;
        continue;
      }
      if (live.Item._migration?.S !== MIGRATION_TAG) {
        skipped += 1;
        console.warn(`  SKIP contentId=${e.contentId} _migration=${live.Item._migration?.S}`);
        continue;
      }
      if (!LIVE) { restored += 1; continue; }
      const exprValues = {
        ':oldChoices': { L: e.oldChoices.map(s => ({ S: s })) },
        ':tag': { S: MIGRATION_TAG },
      };
      let setExpr = 'choices = :oldChoices';
      if (e.oldAnswer !== null && e.oldAnswer !== e.newAnswer) {
        setExpr = 'choices = :oldChoices, answer = :oldAnswer';
        exprValues[':oldAnswer'] = { S: e.oldAnswer };
      }
      await client.send(new UpdateItemCommand({
        TableName: TABLE,
        Key: {
          poolKey: { S: e.poolKey },
          contentId: { S: e.contentId },
        },
        UpdateExpression: `SET ${setExpr} REMOVE #m, #ma, #mb`,
        ExpressionAttributeValues: exprValues,
        ExpressionAttributeNames: { '#m': '_migration', '#ma': '_migrationAt', '#mb': '_migrationBefore' },
        ConditionExpression: '#m = :tag',
      }));
      restored += 1;
      if (restored % 25 === 0) console.log(`  progress: ${restored} restored / ${skipped} skipped / ${failed} failed`);
    } catch (err) {
      failed += 1;
      console.warn(`  FAIL contentId=${e.contentId}  err=${err.message}`);
    }
  }
  console.log(`\nDone. Restored: ${restored}. Skipped: ${skipped}. Failed: ${failed}.`);
  if (!LIVE) console.log('(dry-run — add --live to execute)');
  if (failed) process.exit(2);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
