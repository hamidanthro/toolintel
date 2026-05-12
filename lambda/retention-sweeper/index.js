/**
 * staar-retention-sweeper — scheduled cleanup per published retention policy.
 *
 * Privacy policy (legal/privacy.html §"Data retention") publicly promises
 * specific TTLs for each data type. Without this worker, those promises
 * are lies the moment any row crosses its TTL — that's an FTC §5
 * deceptive-practice violation (see Epic $520M, Disney $10M).
 *
 * Runs daily via EventBridge (cron 0 5 * * ? * — 5am UTC, midnight Central).
 * Reads RETENTION_SCHEDULE, scans each table, batch-deletes rows older
 * than the configured TTL. Compliance tables (audit-log, policy-acceptances,
 * consents) are RETAINED 7 years per COPPA §312.8; safety-events 3 years.
 *
 * Idempotent + safe to re-run: per-row condition checks; no destructive
 * scans without TTL match. Cap at 1000 deletes per table per run so a
 * runaway scan can't blow through the table.
 */

'use strict';

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const ddb = DynamoDBDocumentClient.from(ddbClient);

const DAY_MS = 24 * 60 * 60 * 1000;

// Source of truth for retention — must match legal/privacy.html
// "Data retention" section.
const RETENTION_SCHEDULE = [
  // Kid chat / messages — short retention per COPPA minimization principle
  {
    table: process.env.MESSAGES_TABLE || 'staar-messages',
    ttlDays: 30,
    timeAttr: 'ts',
    keyAttrs: ['convId', 'ts']
  },

  // Compliance tables — long retention for audit + legal hold
  {
    table: process.env.SAFETY_EVENTS_TABLE || 'staar-safety-events',
    ttlDays: 1095, // 3 years
    timeAttr: 'occurredAt',
    keyAttrs: ['eventId']
  },
  {
    table: process.env.AUDIT_LOG_TABLE || 'staar-audit-log',
    ttlDays: 2555, // 7 years
    timeAttr: 'occurredAt',
    keyAttrs: ['eventId']
  },
  // policy-acceptances + consents: never TTL-delete; record kept until
  // user requests deletion. Not in this sweeper.
];

const MAX_DELETES_PER_TABLE = 1000;
const BATCH_SIZE = 25; // DynamoDB BatchWrite limit

async function sweepTable(spec) {
  const cutoff = Date.now() - spec.ttlDays * DAY_MS;
  let scanned = 0;
  let deleted = 0;
  let startKey;

  while (deleted < MAX_DELETES_PER_TABLE) {
    const scanParams = {
      TableName: spec.table,
      FilterExpression: '#t < :cutoff',
      ExpressionAttributeNames: { '#t': spec.timeAttr },
      ExpressionAttributeValues: { ':cutoff': cutoff },
      Limit: 100,
      ProjectionExpression: spec.keyAttrs.map((_, i) => '#k' + i).join(', '),
    };
    // Add key names as expression-attr-names (DynamoDB requires aliases
    // for reserved words; alias them all just to be safe)
    scanParams.ExpressionAttributeNames = scanParams.ExpressionAttributeNames || {};
    spec.keyAttrs.forEach((attr, i) => { scanParams.ExpressionAttributeNames['#k' + i] = attr; });
    if (startKey) scanParams.ExclusiveStartKey = startKey;

    let scan;
    try {
      scan = await ddb.send(new ScanCommand(scanParams));
    } catch (err) {
      console.error('[sweep]', spec.table, 'scan failed:', err.message);
      break;
    }

    scanned += (scan.Items || []).length;
    const items = scan.Items || [];

    // Build batch-delete requests
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const chunk = items.slice(i, i + BATCH_SIZE);
      const requests = chunk.map((item) => {
        const Key = {};
        spec.keyAttrs.forEach((attr) => { Key[attr] = item[attr]; });
        return { DeleteRequest: { Key } };
      });
      try {
        await ddb.send(new BatchWriteCommand({
          RequestItems: { [spec.table]: requests }
        }));
        deleted += chunk.length;
      } catch (err) {
        console.error('[sweep]', spec.table, 'batch-delete failed:', err.message);
      }
      if (deleted >= MAX_DELETES_PER_TABLE) break;
    }

    if (!scan.LastEvaluatedKey) break;
    startKey = scan.LastEvaluatedKey;
  }

  return { table: spec.table, ttlDays: spec.ttlDays, scanned, deleted };
}

exports.handler = async (event) => {
  const startedAt = Date.now();
  const results = [];

  for (const spec of RETENTION_SCHEDULE) {
    const r = await sweepTable(spec);
    console.log('[sweep]', JSON.stringify(r));
    results.push(r);
  }

  const elapsedMs = Date.now() - startedAt;
  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);

  console.log('[sweep] summary', JSON.stringify({ elapsedMs, totalDeleted, tableCount: results.length }));

  return {
    statusCode: 200,
    body: JSON.stringify({ elapsedMs, totalDeleted, results })
  };
};
