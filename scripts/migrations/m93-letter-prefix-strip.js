#!/usr/bin/env node
/**
 * §93 — Letter-prefix sweep (May 14, 2026)
 *
 * Per CLAUDE.md §27 + Hamid's screenshots: gpt-4o-mini's
 * choice-text leak left literal "A. " / "B. " / "C. " / "D. "
 * prefixes inside choice strings. The UI then renders its own
 * letter chip → kid sees "A A. ..." until §79 hid the visible
 * letter chip. Either way the choice text is ugly and the
 * `answer` field carries the same prefix, breaking equality
 * comparisons against the cleaned-up frontend.
 *
 * Scope (read-only scan 2026-05-14): 143 rows table-wide where
 * ALL 4 choices match /^[A-D]\.\s+/. Split by subject: science 75,
 * social-studies 35, math 33.
 *
 * Strategy:
 *   - For each affected row, strip the "X. " prefix from each
 *     choice AND from `answer` (if present and prefixed).
 *   - poolKey UNCHANGED → UpdateItem works (no Put+Delete needed).
 *   - Stamp `_migration='§93'` + `_migrationBefore={choices, answer}`
 *     for restore.
 *
 * USAGE:
 *   node m93-letter-prefix-strip.js          # dry-run (default)
 *   node m93-letter-prefix-strip.js --live   # live execution
 *
 * Restore companion: m93-restore.js (shipped same commit).
 */

const {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} = require('@aws-sdk/client-dynamodb');
const fs = require('fs');
const path = require('path');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const OUTPUT_DIR = path.join(__dirname, 'output');
const MIGRATION_TAG = '§93';
const NOW_ISO = new Date().toISOString();
const LIVE = process.argv.includes('--live');
const LETTER_PREFIX_RE = /^([A-D])\.\s+(.+)$/;

// Only touch rows where ALL choices match the letter-prefix pattern
// (stricter than the scope-scan's ≥2 heuristic so we don't strip a
// single legitimate "A. Something" answer in an otherwise clean row).
function rowIsAffected(item) {
  const choices = (item.choices?.L || []).map(c => c.S || '');
  if (choices.length < 2) return false;
  return choices.every(s => LETTER_PREFIX_RE.test(s));
}

function strip(s) {
  const m = LETTER_PREFIX_RE.exec(s);
  return m ? m[2] : s;
}

async function scanAffected(client) {
  const items = [];
  let exclusiveStart;
  do {
    const out = await client.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'attribute_exists(choices)',
      ExclusiveStartKey: exclusiveStart,
    }));
    for (const item of out.Items || []) {
      if (rowIsAffected(item)) items.push(item);
    }
    exclusiveStart = out.LastEvaluatedKey;
  } while (exclusiveStart);
  return items;
}

function planRow(item) {
  const oldChoices = (item.choices.L || []).map(c => c.S || '');
  const newChoices = oldChoices.map(strip);
  const oldAnswer = item.answer?.S || null;
  const newAnswer = oldAnswer && LETTER_PREFIX_RE.test(oldAnswer)
    ? strip(oldAnswer)
    : oldAnswer;
  return {
    contentId: item.contentId.S,
    poolKey: item.poolKey.S,
    subject: item.subject?.S || '?',
    state: item.state?.S || '?',
    grade: item.grade?.S || '?',
    oldChoices,
    newChoices,
    oldAnswer,
    newAnswer,
  };
}

async function applyUpdate(client, plan, item) {
  const beforeChoices = item.choices.L.map(c => ({ S: c.S || '' }));
  const beforeAnswer = item.answer?.S ?? null;
  const exprValues = {
    ':newChoices': { L: plan.newChoices.map(s => ({ S: s })) },
    ':tag': { S: MIGRATION_TAG },
    ':at': { S: NOW_ISO },
  };
  const exprNames = { '#m': '_migration', '#ma': '_migrationAt', '#mb': '_migrationBefore' };
  let setExpr = 'choices = :newChoices, #m = :tag, #ma = :at, #mb = :before';
  if (plan.newAnswer !== plan.oldAnswer && plan.newAnswer !== null) {
    setExpr = 'choices = :newChoices, answer = :newAnswer, #m = :tag, #ma = :at, #mb = :before';
    exprValues[':newAnswer'] = { S: plan.newAnswer };
    exprValues[':before'] = {
      M: {
        choices: { L: beforeChoices },
        answer: { S: beforeAnswer || '' },
      },
    };
  } else {
    exprValues[':before'] = {
      M: {
        choices: { L: beforeChoices },
      },
    };
  }
  // Idempotency: refuse to re-write if THIS migration tag already
  // present. Allow writing when no migration OR a DIFFERENT migration
  // (e.g. §92 math-grade-orphan touched the same row first — those
  // rows still need §93's choice-strip; the §92 restore trail for
  // those rows is preserved separately in §92's manifest).
  exprValues[':selfTag'] = { S: MIGRATION_TAG };
  await client.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: {
      poolKey: { S: plan.poolKey },
      contentId: { S: plan.contentId },
    },
    UpdateExpression: `SET ${setExpr}`,
    ExpressionAttributeValues: exprValues,
    ExpressionAttributeNames: exprNames,
    ConditionExpression: 'attribute_not_exists(#m) OR #m <> :selfTag',
  }));
}

function pickSamples(planned, perSubject = 5) {
  const bySubj = {};
  for (const p of planned) {
    (bySubj[p.subject] ||= []).push(p);
  }
  const out = [];
  for (const s of Object.keys(bySubj)) {
    const arr = bySubj[s].slice().sort(() => Math.random() - 0.5).slice(0, perSubject);
    out.push(...arr);
  }
  return out;
}

function fmtSample(p) {
  const lines = [
    `  Subject: ${p.subject} · state=${p.state} · grade=${p.grade}`,
    `  ──────────────────────────────────────────────────────────────────`,
    `  contentId: ${p.contentId}`,
    `  poolKey:   ${p.poolKey}`,
  ];
  p.oldChoices.forEach((old, i) => {
    const nw = p.newChoices[i];
    lines.push(`  [${i}] OLD: "${old.slice(0, 60)}"`);
    lines.push(`      NEW: "${nw.slice(0, 60)}"`);
  });
  if (p.oldAnswer !== null) {
    lines.push(`  answer OLD: "${(p.oldAnswer || '').slice(0, 60)}"`);
    lines.push(`  answer NEW: "${(p.newAnswer || '').slice(0, 60)}"`);
  }
  lines.push('');
  return lines.join('\n');
}

(async () => {
  console.log('====================================================');
  console.log('§93 letter-prefix sweep');
  console.log('  Mode:    ' + (LIVE ? 'LIVE (UpdateItem will fire)' : 'DRY-RUN (no writes)'));
  console.log('  Table:   ' + TABLE);
  console.log('  Region:  ' + REGION);
  console.log('  Pattern: strip leading /^[A-D]\\.\\s+/ from choices + answer');
  console.log('  Filter:  ALL choices must match (stricter than scope-scan ≥2)');
  console.log('====================================================\n');

  const client = new DynamoDBClient({ region: REGION });
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log('Scanning for affected rows…');
  const affected = await scanAffected(client);
  console.log(`Found ${affected.length} rows where ALL choices have letter prefixes.\n`);

  const plans = affected.map(planRow);
  const bySubj = {};
  for (const p of plans) bySubj[p.subject] = (bySubj[p.subject] || 0) + 1;
  console.log('Per-subject counts:');
  for (const [s, n] of Object.entries(bySubj)) {
    console.log(`  ${s}: ${n}`);
  }
  console.log(`  TOTAL: ${plans.length}\n`);

  // Manifest
  const stamp = NOW_ISO.replace(/[:.]/g, '-');
  const manifestPath = path.join(
    OUTPUT_DIR,
    `m93-${LIVE ? 'live' : 'dry-run'}-${stamp}.jsonl`
  );
  const manifestStream = fs.createWriteStream(manifestPath);
  for (const p of plans) {
    manifestStream.write(JSON.stringify(p) + '\n');
  }
  manifestStream.end();
  await new Promise(res => manifestStream.on('finish', res));
  console.log(`Manifest: ${manifestPath}\n`);

  // 5 samples per subject for eyeball
  console.log('====================================================');
  console.log('SAMPLES (5 random per subject) — verify before live');
  console.log('====================================================\n');
  for (const p of pickSamples(plans, 5)) {
    process.stdout.write(fmtSample(p));
  }

  if (!LIVE) {
    console.log('====================================================');
    console.log('DRY-RUN complete. No writes. To execute live:');
    console.log('  node scripts/migrations/m93-letter-prefix-strip.js --live');
    console.log('====================================================');
    return;
  }

  // Live
  console.log('====================================================');
  console.log('LIVE — issuing UpdateItem for each plan…');
  console.log('====================================================\n');
  let done = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];
  for (const item of affected) {
    const p = planRow(item);
    try {
      await applyUpdate(client, p, item);
      done += 1;
      if (done % 25 === 0) {
        console.log(`  progress: ${done}/${plans.length} (skipped ${skipped}, failed ${failed})`);
      }
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        skipped += 1;
      } else {
        failed += 1;
        failures.push({ contentId: p.contentId, error: err.message });
        console.warn(`  FAIL contentId=${p.contentId}  err=${err.message}`);
      }
    }
  }
  console.log(`\nDone. Updated: ${done}/${plans.length}. Skipped (already migrated): ${skipped}. Failed: ${failed}.`);
  if (failures.length) {
    const failPath = manifestPath.replace('.jsonl', '-failures.jsonl');
    fs.writeFileSync(failPath, failures.map(f => JSON.stringify(f)).join('\n') + '\n');
    console.log(`Failures: ${failPath}`);
    process.exit(2);
  }
  console.log(`\nRestore command if needed:`);
  console.log(`  node scripts/migrations/m93-restore.js --manifest ${manifestPath} --live`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
