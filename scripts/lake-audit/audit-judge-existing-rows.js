#!/usr/bin/env node
/**
 * audit-judge-existing-rows.js — walks every status=active row in
 * staar-content-pool through the cold-start Question Sanity Judge
 * (scripts/cold-start/judge.js) and classifies each pass / reject.
 *
 * READ-ONLY by construction:
 *   - imports DynamoDBDocumentClient with ScanCommand only
 *   - does NOT import PutCommand, UpdateCommand, DeleteCommand
 *   - never calls anything that mutates the table
 *
 * Sequential: one judge call at a time, no Promise.all parallelism.
 * Predictable cost. ~$0.0001 per row at gpt-4o-mini.
 *
 * Resumable: writes scripts/lake-audit/output/judge-audit-state.json
 * every 100 rows. On crash, re-running picks up where it left off.
 * On clean completion (no --limit), writes the timestamped final
 * output JSON and deletes the state file.
 *
 * Usage:
 *   OPENAI_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/openai-api-key \
 *       --query SecretString --output text) \
 *     node scripts/lake-audit/audit-judge-existing-rows.js [--limit N] [--fresh]
 *
 * Flags:
 *   --limit N    process only the first N active rows (smoke / spot-check)
 *   --fresh      delete the state file before starting (force restart from row 0)
 *   --help       print this help and exit
 *
 * Env:
 *   OPENAI_API_KEY                required
 *   JUDGE_AUDIT_MAX_CALLS         per-process budget (default = active count + 50)
 *   AWS_REGION                    default us-east-1
 */
'use strict';

const path = require('path');
const fs = require('fs');

// Read-only DynamoDB import: ONLY the Scan family. PutCommand /
// UpdateCommand / DeleteCommand are intentionally NOT imported, so
// the script cannot mutate the table even if a programmer accident
// tried to.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

// ---- args ----
const args = process.argv.slice(2);
let LIMIT = null;
let FRESH = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--help' || a === '-h') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 35).map(l => l.replace(/^ \*\/?/, '').replace(/^\/\*\*$/, '')).join('\n'));
    process.exit(0);
  }
  if (a === '--limit') { LIMIT = parseInt(args[++i], 10); continue; }
  if (a === '--fresh') { FRESH = true; continue; }
  console.error(`Unknown arg: ${a}`);
  process.exit(2);
}

if (!process.env.OPENAI_API_KEY) {
  console.error('FATAL: OPENAI_API_KEY env var not set.');
  console.error('Hint: OPENAI_API_KEY=$(aws secretsmanager get-secret-value --secret-id staar-tutor/openai-api-key --query SecretString --output text) node ...');
  process.exit(2);
}

// ---- output paths ----
const OUTPUT_DIR = path.join(__dirname, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const STATE_PATH = path.join(OUTPUT_DIR, 'judge-audit-state.json');
const utcStamp = () => new Date().toISOString().replace(/[:.]/g, '').replace('T', 'T').slice(0, 15) + 'Z';
const RUN_STAMP = utcStamp();
const FINAL_PATH = path.join(OUTPUT_DIR, `judge-audit-${RUN_STAMP}.json`);

if (FRESH && fs.existsSync(STATE_PATH)) {
  fs.unlinkSync(STATE_PATH);
  console.log(`[judge-audit] --fresh: removed ${STATE_PATH}`);
}

// ---- bump cold-start judge's per-process budget so it doesn't trip
// before this script's own JUDGE_AUDIT_MAX_CALLS budget does. ----
const ESTIMATED_BUDGET_HEADROOM = 200000; // generous; this script tracks its own real budget
process.env.COLD_START_JUDGE_MAX_CALLS = String(ESTIMATED_BUDGET_HEADROOM);

// Now require the cold-start judge — it reads the env var at module load.
const { judgeQuestion } = require(path.resolve(__dirname, '..', 'cold-start', 'judge.js'));

// ---- DynamoDB client ----
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1'
}));
const TABLE = 'staar-content-pool';

// ---- scan all active rows ----
async function scanAllActive() {
  const items = [];
  let last;
  let pages = 0;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#s = :a',
      ExpressionAttributeNames: {
        '#s': 'status', '#t': 'type', '#st': 'state',
        '#j': '_judge', '#jv': '_judgeVersion'
      },
      ExpressionAttributeValues: { ':a': 'active' },
      ProjectionExpression: 'contentId, poolKey, #s, #t, question, choices, correctIndex, answer, explanation, grade, subject, #st, #j, #jv',
      ExclusiveStartKey: last
    }));
    for (const it of (res.Items || [])) items.push(it);
    last = res.LastEvaluatedKey;
    pages++;
    if (pages % 5 === 0) console.log(`[judge-audit] scan progress: ${items.length} rows so far (page ${pages})`);
  } while (last);
  return items;
}

// ---- Normalize row to judge input shape. Returns null if unjudgeable. ----
function normalizeForJudge(row) {
  // Type branch, with inference for legacy rows that have type=undefined.
  let inferredType = row.type;
  if (!inferredType) {
    if (Array.isArray(row.choices) && row.choices.length >= 2) inferredType = 'multiple_choice';
    else if (typeof row.answer === 'string' && row.answer.trim()) inferredType = 'numeric';
  }

  const stateSlug = row.state || (typeof row.poolKey === 'string' ? row.poolKey.split('#')[0] : null);
  const subject = row.subject || (typeof row.poolKey === 'string' ? row.poolKey.split('#')[2] : null);
  const grade = row.grade != null ? row.grade : (typeof row.poolKey === 'string' ? row.poolKey.split('#')[1] : null);

  if (inferredType === 'multiple_choice' || inferredType === 'multi_choice') {
    if (!Array.isArray(row.choices) || row.choices.length < 2) return { skip: 'unjudgeable_mc_no_choices' };
    const correctIdx = typeof row.correctIndex === 'number' ? row.correctIndex
      : (row.answer ? row.choices.findIndex(c => String(c).toLowerCase() === String(row.answer).toLowerCase()) : -1);
    if (correctIdx < 0 || correctIdx >= row.choices.length) return { skip: 'unjudgeable_mc_no_correct' };
    return {
      type: 'multiple_choice',
      stateSlug, subject, grade,
      question: {
        question: row.question || '',
        choices: row.choices,
        correctIndex: correctIdx,
        explanation: row.explanation || ''
      }
    };
  }

  if (inferredType === 'numeric') {
    if (!row.answer) return { skip: 'unjudgeable_numeric_no_answer' };
    return {
      type: 'numeric',
      stateSlug, subject, grade,
      question: {
        question: row.question || '',
        choices: null,
        correctIndex: null,
        answer: String(row.answer),
        explanation: row.explanation || ''
      }
    };
  }

  return { skip: 'unjudgeable_unknown_type' };
}

// ---- per-row state tracker ----
function emptyState() {
  return {
    startedAt: new Date().toISOString(),
    runStamp: RUN_STAMP,
    processed: {},                // contentId → { verdict, failedChecks }  (compact)
    rejects: [],                  // detailed reject records
    counts: {
      totalJudged: 0,
      totalPass: 0,
      totalReject: 0,
      totalSkippedAlreadyPass: 0,
      totalSkippedUnknownType: 0,
      totalSkippedUnjudgeable: 0,
      rejectsByCheck: {},
      rejectsByState: {},
      rejectsByType: {}
    }
  };
}

let state = (!FRESH && fs.existsSync(STATE_PATH))
  ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'))
  : emptyState();

if (state.runStamp && state.runStamp !== RUN_STAMP) {
  console.log(`[judge-audit] resuming run ${state.runStamp} (started ${state.startedAt})`);
} else if (!state.runStamp) {
  state.runStamp = RUN_STAMP;
}

function persistState() {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function bump(obj, key) { obj[key] = (obj[key] || 0) + 1; }

function costSoFar() {
  return (state.counts.totalJudged * 0.0001).toFixed(4);
}

// ---- main ----
(async () => {
  console.log(`[judge-audit] table=${TABLE} starting scan…`);
  const allRows = await scanAllActive();
  console.log(`[judge-audit] scan complete: ${allRows.length} active rows`);

  // Sort by contentId for deterministic resume order.
  allRows.sort((a, b) => String(a.contentId || '').localeCompare(String(b.contentId || '')));

  const remaining = allRows.filter(r => !state.processed[r.contentId]);
  console.log(`[judge-audit] already processed in prior run: ${allRows.length - remaining.length}; remaining: ${remaining.length}`);

  const slice = (LIMIT != null && Number.isFinite(LIMIT) && LIMIT > 0)
    ? remaining.slice(0, LIMIT)
    : remaining;
  if (LIMIT != null) console.log(`[judge-audit] --limit ${LIMIT} → processing ${slice.length} rows this run`);

  const ENV_BUDGET = parseInt(process.env.JUDGE_AUDIT_MAX_CALLS || '', 10);
  const BUDGET = Number.isFinite(ENV_BUDGET) && ENV_BUDGET > 0 ? ENV_BUDGET : (allRows.length + 50);
  console.log(`[judge-audit] per-process budget: ${BUDGET} judge calls`);

  const t0 = Date.now();
  let callsThisRun = 0;

  for (let i = 0; i < slice.length; i++) {
    const row = slice[i];

    // Aliases inserted by Scan via ExpressionAttributeNames preserve the
    // underscore field names on the returned item, so row._judge works as-is.
    // Skip if already-judged-pass at write time.
    if (row._judge === 'pass') {
      state.counts.totalSkippedAlreadyPass++;
      state.processed[row.contentId] = { verdict: 'skip-already-pass' };
      continue;
    }

    const normalized = normalizeForJudge(row);
    if (normalized.skip) {
      console.log(`[judge-audit] SKIPPED_${normalized.skip} contentId=${row.contentId} type=${row.type || 'undef'}`);
      if (normalized.skip === 'unjudgeable_unknown_type') state.counts.totalSkippedUnknownType++;
      else state.counts.totalSkippedUnjudgeable++;
      state.processed[row.contentId] = { verdict: 'skip-' + normalized.skip };
      continue;
    }

    if (callsThisRun >= BUDGET) {
      console.warn(`[judge-audit] BUDGET EXCEEDED (${BUDGET}) — stopping; resume by re-running the script`);
      break;
    }

    let verdict;
    try {
      verdict = await judgeQuestion(normalized.question, {
        stateSlug: normalized.stateSlug,
        subject: normalized.subject,
        grade: normalized.grade
      });
    } catch (err) {
      // OpenAI hiccup or judge module error — log, count as fail-open, move on.
      console.warn(`[judge-audit] FAIL-OPEN contentId=${row.contentId} err=${(err && err.message || '').slice(0, 120)}`);
      state.processed[row.contentId] = { verdict: 'fail-open', error: String(err && err.message || err).slice(0, 200) };
      callsThisRun++;
      continue;
    }
    callsThisRun++;
    state.counts.totalJudged++;

    if (verdict.verdict === 'pass') {
      state.counts.totalPass++;
      state.processed[row.contentId] = { verdict: 'pass' };
      console.log(`[judge-audit] contentId=${row.contentId} state=${normalized.stateSlug} subject=${normalized.subject} grade=${normalized.grade} verdict=pass`);
    } else {
      state.counts.totalReject++;
      state.processed[row.contentId] = { verdict: 'reject', failedChecks: verdict.failedChecks };
      for (const c of verdict.failedChecks) bump(state.counts.rejectsByCheck, c);
      bump(state.counts.rejectsByState, normalized.stateSlug || '?');
      bump(state.counts.rejectsByType, normalized.type);
      state.rejects.push({
        contentId: row.contentId,
        poolKey: row.poolKey,
        state: normalized.stateSlug,
        subject: normalized.subject,
        grade: normalized.grade,
        type: normalized.type,
        questionExcerpt: String(row.question || '').slice(0, 200),
        choices: normalized.type === 'multiple_choice' ? row.choices : null,
        correctIndex: normalized.question.correctIndex,
        answer: row.answer != null ? String(row.answer) : null,
        failedChecks: verdict.failedChecks,
        reasons: verdict.reasons
      });
      console.log(`[judge-audit] contentId=${row.contentId} state=${normalized.stateSlug} subject=${normalized.subject} grade=${normalized.grade} verdict=reject failedChecks=${verdict.failedChecks.join(',')}`);
    }

    if ((i + 1) % 100 === 0) {
      console.log(`[judge-audit] processed ${i + 1}/${slice.length} this run — pass=${state.counts.totalPass} reject=${state.counts.totalReject} cost=$${costSoFar()}`);
      persistState();
    }
  }

  // Finalize
  persistState();
  const elapsedSec = Math.round((Date.now() - t0) / 10) / 100;
  const summary = {
    startedAt: state.startedAt,
    finishedAt: new Date().toISOString(),
    elapsedSec,
    totalActive: allRows.length,
    totalJudged: state.counts.totalJudged,
    totalPass: state.counts.totalPass,
    totalReject: state.counts.totalReject,
    totalSkippedAlreadyPass: state.counts.totalSkippedAlreadyPass,
    totalSkippedUnknownType: state.counts.totalSkippedUnknownType,
    totalSkippedUnjudgeable: state.counts.totalSkippedUnjudgeable,
    estimatedCostUSD: Number(costSoFar()),
    rejectsByCheck: state.counts.rejectsByCheck,
    rejectsByState: state.counts.rejectsByState,
    rejectsByType: state.counts.rejectsByType,
    runStamp: RUN_STAMP,
    limit: LIMIT
  };
  const out = { summary, rejects: state.rejects };
  fs.writeFileSync(FINAL_PATH, JSON.stringify(out, null, 2));
  console.log('');
  console.log(`[judge-audit] final summary written: ${FINAL_PATH}`);
  console.log(JSON.stringify(summary, null, 2));

  // If this was a complete run (no --limit and we got through everything),
  // delete the state file so the next invocation starts fresh.
  if (LIMIT == null && Object.keys(state.processed).length >= allRows.length) {
    fs.unlinkSync(STATE_PATH);
    console.log(`[judge-audit] complete run — removed ${STATE_PATH}`);
  } else {
    console.log(`[judge-audit] partial run — state file preserved at ${STATE_PATH} for resume`);
  }
})().catch(err => {
  console.error('[judge-audit] FATAL:', err && (err.stack || err.message || err));
  process.exit(1);
});
