#!/usr/bin/env node
/**
 * Tombstone legacy cold-v1 rows by setting status='deprecated'.
 *
 * - Scans the entire pool, filters where promptVersion='cold-v1' OR
 *   generatedBy='cold-start-v1' (catches the 10,149 legacy rows).
 * - Writes status='deprecated' and tombstonedAt=Date.now().
 * - Idempotent: re-running on already-deprecated rows is a no-op
 *   (ConditionExpression: status='active').
 *
 * Usage:
 *   node tombstone-legacy.js --dry-run   (count only, no writes)
 *   node tombstone-legacy.js             (apply)
 */
const {
  DynamoDBClient
} = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, ScanCommand, UpdateCommand
} = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));
const TABLE = 'staar-content-pool';
const DRY = process.argv.includes('--dry-run');

async function* scanLegacy() {
  let last;
  do {
    const r = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '(promptVersion = :v1 OR generatedBy = :g1) AND #s = :active',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':v1': 'cold-v1', ':g1': 'cold-start-v1', ':active': 'active'
      },
      ExclusiveStartKey: last
    }));
    for (const it of (r.Items || [])) yield it;
    last = r.LastEvaluatedKey;
  } while (last);
}

async function tombstoneOne(item) {
  await ddb.send(new UpdateCommand({
    TableName: TABLE,
    Key: { poolKey: item.poolKey, contentId: item.contentId },
    UpdateExpression: 'SET #s = :dep, tombstonedAt = :ts, tombstoneReason = :r',
    ConditionExpression: '#s = :active',
    ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: {
      ':dep': 'deprecated',
      ':active': 'active',
      ':ts': Date.now(),
      ':r': 'cold-v1-not-state-specific'
    }
  }));
}

(async () => {
  console.log(`Mode: ${DRY ? 'DRY-RUN' : 'APPLY'}`);
  console.log(`Target: ${TABLE} where status=active AND (promptVersion=cold-v1 OR generatedBy=cold-start-v1)`);
  console.log();

  const counts = {};
  let total = 0, ok = 0, fail = 0;
  const t0 = Date.now();

  for await (const it of scanLegacy()) {
    total++;
    counts[it.state] = (counts[it.state] || 0) + 1;
    if (DRY) continue;
    try {
      await tombstoneOne(it);
      ok++;
    } catch (e) {
      fail++;
      if (fail <= 5) console.error(`FAIL ${it.contentId}: ${e.message}`);
    }
    if (total % 200 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      process.stdout.write(`\r  scanned=${total} updated=${ok} failed=${fail} elapsed=${elapsed}s`);
    }
  }
  console.log();
  console.log();
  console.log('=== by state ===');
  for (const [st, c] of Object.entries(counts).sort(([,a],[,b]) => b-a)) {
    console.log(`  ${st.padEnd(20)} ${c}`);
  }
  console.log();
  console.log(`TOTAL: ${total}`);
  if (!DRY) console.log(`UPDATED: ${ok}   FAILED: ${fail}`);
  console.log(`Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
})();
