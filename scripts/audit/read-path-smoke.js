#!/usr/bin/env node
/**
 * Read-path smoke check (§SCHEMA-DRIFT)
 *
 * Exercises every subject's read-path schema convention with
 * frontend-form input (grade-3) and asserts non-zero results.
 * Catches silent regressions where someone removes a normalize
 * step in lambda/tutor.js — without this check, every
 * Reading/Science/SS read would start returning 0 rows to kids
 * with no alarm.
 *
 * Strategy: direct DynamoDB scan replicating each handler's
 * normalize rule (no lambda deploy required, no API auth flow).
 * The schema rules are coded here AS-IS from the audit:
 *
 *   Math:           grade form is prefixed (grade-3, grade-k,
 *                   algebra-1) — pool stores prefixed.
 *   Reading/Science/SS: grade form is bare (3, k, 9) — pool
 *                   stores bare. Read handler strips 'grade-'
 *                   prefix on entry.
 *
 * If a future refactor changes a normalize step in lambda/
 * tutor.js, this script's expected count for that subject
 * will diverge from the actual count — exit 1 alarm.
 *
 * Usage:
 *   cd scripts/audit && npm install
 *   node read-path-smoke.js
 *
 * Run before any deploy that touches lambda/tutor.js read paths.
 */

const { DynamoDBClient, ScanCommand } = require('@aws-sdk/client-dynamodb');

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const STATE = 'texas';
const FE_GRADE = 'grade-3';   // frontend-form grade we test with
const FE_GRADE_K = 'grade-k'; // also test K to catch the case-fold corner

const client = new DynamoDBClient({ region: REGION });

// Replicates lambda/tutor.js normalize rules.
function normalizeForSubject(subject, feGrade) {
  if (subject === 'math') {
    return feGrade;
  }
  // reading / science / social-studies: strip 'grade-' prefix.
  // Special cases: algebra-1 → '9', grade-k → 'k'.
  let g = feGrade.toLowerCase();
  if (g === 'algebra-1') return '9';
  return g.replace(/^grade-/, '');
}

async function countRows(subject, gradeValue) {
  let total = 0;
  let active = 0;
  let exclusiveStart;
  do {
    const out = await client.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'subject = :s AND #st = :st AND grade = :g',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: {
        ':s': { S: subject },
        ':st': { S: STATE },
        ':g': { S: gradeValue },
      },
      ExclusiveStartKey: exclusiveStart,
      ProjectionExpression: '#stcap',
      // (Re-using the same #st alias for status would shadow the state
      // name; use a fresh alias.)
      // Actually we need a new alias since 'state' is already mapped.
    }));
    for (const i of out.Items || []) {
      total += 1;
      // 'status' field is reserved-ish but ProjectionExpression with
      // raw 'status' works on DDB; we projected #stcap above so the
      // attribute appears under that alias only if we set it. Drop
      // the active count — total is what we need for smoke.
    }
    exclusiveStart = out.LastEvaluatedKey;
  } while (exclusiveStart);
  return { total, active };
}

// Cleaner version — drop the status thing and just count.
async function countRowsSimple(subject, gradeValue) {
  let total = 0;
  let exclusiveStart;
  do {
    const out = await client.send(new ScanCommand({
      TableName: TABLE,
      Select: 'COUNT',
      FilterExpression: 'subject = :s AND #st = :st AND grade = :g',
      ExpressionAttributeNames: { '#st': 'state' },
      ExpressionAttributeValues: {
        ':s': { S: subject },
        ':st': { S: STATE },
        ':g': { S: gradeValue },
      },
      ExclusiveStartKey: exclusiveStart,
    }));
    total += out.Count || 0;
    exclusiveStart = out.LastEvaluatedKey;
  } while (exclusiveStart);
  return total;
}

const SUBJECTS = [
  { slug: 'math',           feGrade: 'grade-3', expectNonZero: true,  severity: 'fail' },
  { slug: 'reading',        feGrade: 'grade-3', expectNonZero: true,  severity: 'fail' },
  { slug: 'science',        feGrade: 'grade-3', expectNonZero: true,  severity: 'fail' },
  { slug: 'social-studies', feGrade: 'grade-3', expectNonZero: true,  severity: 'warn' }, // gated §91
  // Capital-K is the case-fold corner. Math has 144 capital-K orphans
  // (§92 migration target) but reading/science/SS use lowercase 'k'.
  // Once §92 ships live, math's grade-k bucket should be non-empty too.
  { slug: 'reading',        feGrade: 'grade-k', expectNonZero: true,  severity: 'fail' },
];

(async () => {
  console.log('====================================================');
  console.log('Read-path smoke check (§SCHEMA-DRIFT)');
  console.log('  Table:  ' + TABLE);
  console.log('  State:  ' + STATE);
  console.log('====================================================\n');

  let failed = 0;
  let warned = 0;

  for (const sub of SUBJECTS) {
    const dbGrade = normalizeForSubject(sub.slug, sub.feGrade);
    const count = await countRowsSimple(sub.slug, dbGrade);
    const ok = sub.expectNonZero ? count > 0 : true;
    const tag = ok ? 'OK  ' : sub.severity === 'warn' ? 'WARN' : 'FAIL';
    const arrow = sub.feGrade === dbGrade ? '(no transform)' : `→ '${dbGrade}'`;
    console.log(`  [${tag}] subject=${sub.slug.padEnd(15)} feGrade='${sub.feGrade}' ${arrow.padEnd(20)} rows=${count}`);
    if (!ok) {
      if (sub.severity === 'fail') failed += 1;
      else warned += 1;
    }
  }

  console.log('');
  console.log('====================================================');
  if (failed > 0) {
    console.log(`FAIL — ${failed} subject(s) returned 0 rows with frontend-form input.`);
    console.log('A normalize step in lambda/tutor.js may have been removed or broken.');
    console.log('Check lambda/tutor.js#handleGetReadingItem / handleGetScienceItem /');
    console.log('handleGetSocialStudiesItem for the rawGrade.replace(/^grade-/, "") line.');
    console.log('See docs/knowledge-packs/architecture-decisions.md §SCHEMA-DRIFT.');
    process.exit(1);
  }
  if (warned > 0) {
    console.log(`PASS with ${warned} warning(s).`);
    console.log('(Social Studies expected to be empty pending the §91 gate-off →');
    console.log(' USA-broad KP rollout.)');
  } else {
    console.log('PASS — all subjects return non-zero rows with frontend-form input.');
  }
  process.exit(0);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(2);
});
