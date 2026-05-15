#!/usr/bin/env node
/**
 * §110 phase 20d restore companion — undo widget-audit tombstones.
 *
 * Reads a manifest JSONL emitted by tombstone-widget-buggy-rows.js
 * and flips each row back to status='active', removing tombstonedAt
 * + tombstoneReason. Defensive: only acts on rows whose status is
 * currently 'broken' AND whose tombstoneReason matches the manifest's
 * audit-id prefix ('widget_audit_BUG_').
 *
 *   AWS_REGION=us-east-1 node scripts/lake-audit/restore-widget-tombstones.js \
 *     --manifest output/tombstone-widget-<UTC>.jsonl [--apply]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['manifest'],
  boolean: ['apply'],
  default: { apply: false }
});

if (!args.manifest) {
  console.error('Required: --manifest <path-to-tombstone-jsonl>');
  process.exit(2);
}

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

async function main() {
  const manifestPath = path.resolve(args.manifest);
  if (!fs.existsSync(manifestPath)) { console.error('Manifest not found: ' + manifestPath); process.exit(2); }
  const lines = fs.readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean);
  const rows = lines.map(l => JSON.parse(l));
  console.log('[restore] rows in manifest: ' + rows.length);
  console.log('[restore] mode: ' + (args.apply ? 'APPLY' : 'DRY-RUN'));

  if (!args.apply) {
    console.log('[restore] DRY-RUN — first 5 candidates:');
    for (const r of rows.slice(0, 5)) {
      console.log('  ' + r.contentId + '  pk=' + r.poolKey);
    }
    console.log('[restore] would restore ' + rows.length + ' rows. Re-run with --apply.');
    return;
  }

  let restored = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: 'staar-content-pool',
        Key: { poolKey: r.poolKey, contentId: r.contentId },
        UpdateExpression: 'SET #s = :active REMOVE tombstonedAt, tombstoneReason, #waid',
        ConditionExpression: '#s = :broken AND begins_with(tombstoneReason, :reasonPrefix)',
        ExpressionAttributeNames: { '#s': 'status', '#waid': '_widgetAuditId' },
        ExpressionAttributeValues: {
          ':active': 'active',
          ':broken': 'broken',
          ':reasonPrefix': 'widget_audit_'
        }
      }));
      restored++;
      process.stdout.write('•');
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') {
        skipped++;
      } else {
        errors++;
        console.error('\n[restore] FAIL ' + r.contentId + ': ' + e.message);
      }
    }
  }
  console.log('\n[restore] DONE: ' + restored + ' restored, ' + skipped + ' skipped, ' + errors + ' errors');
}

main().catch(err => { console.error(err); process.exit(1); });
