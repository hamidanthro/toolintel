#!/usr/bin/env node
/**
 * Read widget rows back from staar-content-pool to verify they
 * persisted correctly with widget-object choices intact (not
 * stringified to "[object Object]" or otherwise mangled by the
 * save path).
 *
 * Usage:
 *   node scripts/cold-start/test-widget-lake-readback.js
 */
'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(client);

const POOL_KEY = 'texas#grade-3#math#teks-concept';

async function main() {
  console.log('[readback] Querying staar-content-pool for poolKey=' + POOL_KEY + '\n');
  // Paginate the full partition; the §31 sweep + later writes can have
  // hundreds of rows under this key, and the widget rows we just saved
  // sort later by contentId timestamp prefix.
  const items = [];
  let lastKey;
  do {
    const res = await ddb.send(new QueryCommand({
      TableName: 'staar-content-pool',
      KeyConditionExpression: 'poolKey = :pk',
      ExpressionAttributeValues: { ':pk': POOL_KEY },
      ExclusiveStartKey: lastKey
    }));
    (res.Items || []).forEach(it => items.push(it));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  console.log('[readback] Found ' + items.length + ' rows\n');

  // Filter to widget rows
  const widgets = items.filter(it =>
    it._widgetMode || (Array.isArray(it.choices) && it.choices.some(c => typeof c === 'object'))
  );
  console.log('[readback] Of those, ' + widgets.length + ' carry widget-object choices.\n');

  let pass = 0, fail = 0;
  for (const w of widgets) {
    const sample = w.choices && w.choices[0];
    if (!sample || typeof sample !== 'object' || sample.type !== 'fraction-bar') {
      console.log('  ✗ ' + w.contentId + ' — first choice not a fraction-bar object! type=' + typeof sample + ' val=' + JSON.stringify(sample).slice(0, 100));
      fail++;
      continue;
    }
    if (!Number.isInteger(sample.parts) || !Number.isInteger(sample.filled)) {
      console.log('  ✗ ' + w.contentId + ' — parts/filled not integers');
      fail++;
      continue;
    }
    pass++;
    if (pass <= 3) {
      console.log('  ✓ ' + w.contentId + ' "' + w.question.slice(0, 60) + '..."');
      console.log('     choices[0]: ' + JSON.stringify(w.choices[0]));
      console.log('     correctIndex: ' + w.correctIndex);
    }
  }

  console.log('\n[readback] ' + pass + ' widget rows verified intact, ' + fail + ' broken');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
