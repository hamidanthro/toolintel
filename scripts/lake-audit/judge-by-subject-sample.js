#!/usr/bin/env node
/**
 * Subject-scoped judge sample (May 14, 2026)
 *
 * Per TODO LAKE-WIDE JUDGE BACKFILL: Reading + Science have low
 * judge-stamp coverage (2.5% + 10.7%); the May 3 §27 lake-wide audit
 * was subject-agnostic and mostly hit math. This script samples
 * unjudged rows from a specific subject and runs them through the
 * cold-start judge (gpt-4o), so we can gauge reject rate before
 * committing to a full sweep.
 *
 * Strategy:
 *   - Scan staar-content-pool for (subject=X, status='active',
 *     no _judge AND no _judgedAt).
 *   - Take the first N rows (or all, with --all).
 *   - Run cold-start judgeQuestion on each (same logic as the May 3
 *     §27 lake-wide audit).
 *   - Output to scripts/lake-audit/output/judge-<subject>-<ts>.json.
 *   - Print a per-bucket reject rate summary.
 *
 * USAGE:
 *   OPENAI_API_KEY=... node judge-by-subject-sample.js --subject reading [--sample 50] [--all]
 *   OPENAI_API_KEY=... node judge-by-subject-sample.js --subject science [--sample 50]
 *
 * READ-ONLY against DDB (no writes). Costs ~$0.002 per row at gpt-4o.
 */

const path = require('path');
const fs = require('fs');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { judgeQuestion, JUDGE_MODEL } = require(path.resolve(__dirname, '..', 'cold-start', 'judge.js'));

function readArg(name, fallback = null) {
  const idx = process.argv.findIndex(a => a === name);
  if (idx < 0) return fallback;
  return process.argv[idx + 1] || fallback;
}
function hasFlag(name) { return process.argv.includes(name); }

const SUBJECT = readArg('--subject');
const SAMPLE = parseInt(readArg('--sample', '50'), 10);
const ALL = hasFlag('--all');
if (!SUBJECT) { console.error('Missing --subject <reading|science|math|social-studies>'); process.exit(1); }

const REGION = 'us-east-1';
const TABLE = 'staar-content-pool';
const NOW_ISO = new Date().toISOString();
const OUTPUT_DIR = path.join(__dirname, 'output');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }));

async function scanUnjudged() {
  const items = [];
  let exclusiveStart;
  do {
    const out = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: 'subject = :s AND #st = :a AND attribute_not_exists(#j) AND attribute_not_exists(#jat)',
      ExpressionAttributeNames: {
        '#st': 'status',
        '#j': '_judge',
        '#jat': '_judgedAt',
      },
      ExpressionAttributeValues: {
        ':s': SUBJECT,
        ':a': 'active',
      },
      ExclusiveStartKey: exclusiveStart,
    }));
    items.push(...(out.Items || []));
    exclusiveStart = out.LastEvaluatedKey;
  } while (exclusiveStart);
  return items;
}

function normalizeForJudge(row) {
  let inferredType = row.type;
  if (!inferredType) {
    if (Array.isArray(row.choices) && row.choices.length >= 2) inferredType = 'multiple_choice';
    else if (typeof row.answer === 'string' && row.answer.trim()) inferredType = 'numeric';
  }
  const stateSlug = row.state || (typeof row.poolKey === 'string' ? row.poolKey.split('#')[0] : null);
  const grade = row.grade != null ? row.grade : null;
  if (inferredType === 'multiple_choice' || inferredType === 'multi_choice') {
    if (!Array.isArray(row.choices) || row.choices.length < 2) return { skip: 'mc_no_choices' };
    const correctIdx = typeof row.correctIndex === 'number'
      ? row.correctIndex
      : (row.answer ? row.choices.findIndex(c => String(c).toLowerCase() === String(row.answer).toLowerCase()) : -1);
    if (correctIdx < 0 || correctIdx >= row.choices.length) return { skip: 'mc_no_correct' };
    return {
      question: row.question,
      type: 'multiple_choice',
      choices: row.choices,
      correctIndex: correctIdx,
      explanation: row.explanation || '',
      stateSlug, subject: SUBJECT, grade,
    };
  }
  if (inferredType === 'numeric') {
    if (!row.question || !row.answer) return { skip: 'numeric_missing_q_or_a' };
    return {
      question: row.question,
      type: 'numeric',
      answer: row.answer,
      explanation: row.explanation || '',
      stateSlug, subject: SUBJECT, grade,
    };
  }
  return { skip: 'unknown_type' };
}

(async () => {
  console.log('====================================================');
  console.log(`Judge sample: subject=${SUBJECT}`);
  console.log(`  Sample:  ${ALL ? 'ALL unjudged rows' : SAMPLE}`);
  console.log(`  Model:   ${JUDGE_MODEL}`);
  console.log(`  Table:   ${TABLE}`);
  console.log('====================================================\n');

  console.log('Scanning unjudged active rows…');
  const allUnjudged = await scanUnjudged();
  console.log(`Found ${allUnjudged.length} unjudged ${SUBJECT} rows.\n`);

  const slice = ALL ? allUnjudged : allUnjudged.slice(0, SAMPLE);
  console.log(`Judging ${slice.length} rows…\n`);

  const counts = {
    judged: 0, pass: 0, reject: 0,
    skippedUnjudgeable: 0, failOpen: 0,
  };
  const rejectsByCheck = {};
  const rejectsSamples = []; // capture first 5 rejects for eyeball
  const allResults = [];

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];
    const normalized = normalizeForJudge(row);
    if (normalized.skip) {
      counts.skippedUnjudgeable++;
      allResults.push({ contentId: row.contentId, verdict: 'skip', reason: normalized.skip });
      continue;
    }
    let verdict;
    try {
      // CRITICAL: pass the FULL normalized object as first arg —
      // judgeQuestion → buildUserPrompt looks up
      // question.{question,stem,choices,correctIndex,answer,
      // explanation,passage} on this. Passing just the stem string
      // (as audit-judge-existing-rows.js#L277 does — that's a
      // pre-existing bug worth a TODO) makes the judge see an
      // empty question with no choices and reject everything.
      verdict = await judgeQuestion(normalized, {
        stateSlug: normalized.stateSlug,
        subject: normalized.subject,
        grade: normalized.grade,
      });
    } catch (err) {
      counts.failOpen++;
      console.warn(`[fail-open] ${row.contentId}: ${(err.message || '').slice(0, 100)}`);
      allResults.push({ contentId: row.contentId, verdict: 'fail-open', error: err.message });
      continue;
    }
    counts.judged++;
    if (verdict.verdict === 'pass') {
      counts.pass++;
      allResults.push({ contentId: row.contentId, verdict: 'pass' });
    } else {
      counts.reject++;
      for (const c of verdict.failedChecks || []) rejectsByCheck[c] = (rejectsByCheck[c] || 0) + 1;
      const rejRec = {
        contentId: row.contentId,
        state: normalized.stateSlug,
        grade: normalized.grade,
        type: normalized.type,
        failedChecks: verdict.failedChecks,
        reasons: verdict.reasons,
        questionExcerpt: String(row.question || '').slice(0, 120),
      };
      allResults.push({ ...rejRec, verdict: 'reject' });
      if (rejectsSamples.length < 5) rejectsSamples.push(rejRec);
    }
    if ((i + 1) % 10 === 0) {
      console.log(`  ${i + 1}/${slice.length} — pass:${counts.pass} reject:${counts.reject} skip:${counts.skippedUnjudgeable} fail-open:${counts.failOpen}`);
    }
  }

  // Output
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = NOW_ISO.replace(/[:.]/g, '-');
  const outPath = path.join(OUTPUT_DIR, `judge-${SUBJECT}-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    subject: SUBJECT,
    sample_size: slice.length,
    total_unjudged: allUnjudged.length,
    judge_model: JUDGE_MODEL,
    counts,
    rejectsByCheck,
    results: allResults,
    samplesByVerdict: { rejects: rejectsSamples },
  }, null, 2));

  // Summary
  console.log('\n====================================================');
  console.log(`SUMMARY for subject=${SUBJECT}`);
  console.log('====================================================');
  console.log(`  Total unjudged in pool: ${allUnjudged.length}`);
  console.log(`  Sample judged:          ${counts.judged}`);
  console.log(`  Pass:                   ${counts.pass} (${counts.judged ? (counts.pass / counts.judged * 100).toFixed(1) : 0}%)`);
  console.log(`  Reject:                 ${counts.reject} (${counts.judged ? (counts.reject / counts.judged * 100).toFixed(1) : 0}%)`);
  console.log(`  Skipped (unjudgeable):  ${counts.skippedUnjudgeable}`);
  console.log(`  Fail-open (API errors): ${counts.failOpen}`);
  console.log(`  Est. cost so far:       $${(counts.judged * 0.002).toFixed(4)}`);
  if (Object.keys(rejectsByCheck).length) {
    console.log(`\n  Rejects by check:`);
    for (const [c, n] of Object.entries(rejectsByCheck).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${c}: ${n}`);
    }
  }
  console.log(`\nOutput: ${outPath}`);
})().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
