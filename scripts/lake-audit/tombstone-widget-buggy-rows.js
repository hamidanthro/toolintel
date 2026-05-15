#!/usr/bin/env node
/**
 * §110 phase 20d — tombstone widget rows flagged BUG_* by the audit.
 *
 * Reads the audit JSON, builds the list of bug rows, and flips each
 * to status='broken' with tombstoneReason='widget_audit_<bug>_<UTC>'.
 *
 * SAFETY:
 *   - Dry-run by default. Pass --apply to commit.
 *   - Loads only rows whose audit verdict starts with 'BUG_'. Never
 *     touches OK / NEEDS_EYEBALL rows.
 *   - Per-row ConditionExpression: status='active' AND no existing
 *     tombstoneReason. Refuses to re-tombstone or to touch already-
 *     broken rows.
 *   - Stamps _widgetAuditId so the restore script can find the exact
 *     set even if the audit gets rerun.
 *
 *   AWS_REGION=us-east-1 node scripts/lake-audit/tombstone-widget-buggy-rows.js \
 *     --audit output/widget-audit-2026-05-15T20-31-04-270Z.json [--apply]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['audit'],
  boolean: ['apply'],
  default: { apply: false }
});

if (!args.audit) {
  console.error('Required: --audit <path-to-audit-json>');
  process.exit(2);
}

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }));

async function main() {
  const auditPath = path.resolve(args.audit);
  if (!fs.existsSync(auditPath)) { console.error('Audit file not found: ' + auditPath); process.exit(2); }
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const auditId = path.basename(auditPath, '.json');
  const ts = new Date().toISOString();

  const bugRows = audit.details.filter(r => r.bug && r.bug.startsWith('BUG_'));
  console.log('[tombstone] audit: ' + auditId);
  console.log('[tombstone] candidates: ' + bugRows.length + ' rows (BUG_* only)');
  console.log('[tombstone] mode: ' + (args.apply ? 'APPLY' : 'DRY-RUN'));
  console.log('');

  const byBug = {};
  for (const r of bugRows) byBug[r.bug] = (byBug[r.bug] || 0) + 1;
  console.log('[tombstone] by reason:');
  for (const k in byBug) console.log('  ' + k + ': ' + byBug[k]);
  console.log('');

  // Dry-run: just show what would be done.
  if (!args.apply) {
    console.log('[tombstone] DRY-RUN — first 5 sample tombstones:');
    for (const r of bugRows.slice(0, 5)) {
      console.log('  ' + r.contentId + '  pk=' + r.poolKey + '  reason=' + r.bug + ' (' + r.reason + ')');
    }
    console.log('\n[tombstone] would update ' + bugRows.length + ' rows. Re-run with --apply.');
    return;
  }

  // Apply: per-row UpdateItem.
  let updated = 0, skipped = 0, errors = 0;
  for (const r of bugRows) {
    try {
      await ddb.send(new UpdateCommand({
        TableName: 'staar-content-pool',
        Key: { poolKey: r.poolKey, contentId: r.contentId },
        UpdateExpression: 'SET #s = :broken, tombstonedAt = :ts, tombstoneReason = :reason, #waid = :waid',
        ConditionExpression: '#s = :active AND attribute_not_exists(tombstoneReason)',
        ExpressionAttributeNames: { '#s': 'status', '#waid': '_widgetAuditId' },
        ExpressionAttributeValues: {
          ':broken': 'broken',
          ':active': 'active',
          ':ts': ts,
          ':reason': 'widget_audit_' + r.bug + '_' + ts,
          ':waid': auditId
        }
      }));
      updated++;
      process.stdout.write('•');
    } catch (e) {
      if (e.name === 'ConditionalCheckFailedException') {
        skipped++;
      } else {
        errors++;
        console.error('\n[tombstone] FAIL ' + r.contentId + ': ' + e.message);
      }
    }
  }
  console.log('\n[tombstone] DONE: ' + updated + ' updated, ' + skipped + ' skipped (already-tombstoned), ' + errors + ' errors');

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'tombstone-widget-' + ts.replace(/[:.]/g, '-') + '.jsonl');
  for (const r of bugRows) {
    fs.appendFileSync(manifestPath, JSON.stringify({ contentId: r.contentId, poolKey: r.poolKey, bug: r.bug, reason: r.reason }) + '\n');
  }
  console.log('[tombstone] manifest: ' + manifestPath);
}

main().catch(err => { console.error(err); process.exit(1); });
