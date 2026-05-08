#!/usr/bin/env node
/**
 * Texas Science Phase D2b — dry-run orchestrator.
 *
 * Generates ONE scenario + 5 candidate cluster questions, judges each
 * question via the science judge (claude-sonnet-4-5), and prints the
 * full payload (scenario + questions + verdicts + provenance stamps)
 * as a dry-run preview. NO DDB writes in D2b.
 *
 * Mirror of scripts/reading/run-seed-batch.js orchestration shape:
 *   Stage 1: scenario gen (judge-scenario.js does NOT exist yet —
 *            scenario is accepted as-generated; flag as TODO for E)
 *   Stage 2: question set gen + per-question judge (concurrency 4),
 *            regen up to QUESTION_REGEN_BUDGET=3 attempts, hold if at
 *            least MIN_QUESTIONS_TO_KEEP=4 pass
 *   Stage 3 (--write only — UNREACHABLE in D2b): persist to DDB
 *   Stage 3' (--dry-run, default): print + write JSON to output/
 *
 * CLI flags:
 *   --dry-run                default; print payload, no DDB
 *   --write                  D2b: errors immediately ("not implemented")
 *   --brief-id <id>          run a single brief (D2b smoke uses g5-circuits-lab)
 *
 * Exit code: 0 on success (scenario generated AND ≥4 questions pass).
 *            1 on any failure (scenario gen error, <4 questions pass,
 *            judge budget exceeded, etc.).
 *
 * Run:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/anthropic-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/science/run-seed-batch.js --brief-id g5-circuits-lab
 */
'use strict';

const fs = require('fs');
const path = require('path');

const { generateScenario } = require('./generate-scenario');
const { generateQuestionSet } = require('./generate-question');
const { judgeQuestion } = require('./judge-question');
const { loadKP } = require('./lib/load-kp');

const STATE = 'texas';
const QUESTION_REGEN_BUDGET = 3;
const QUESTIONS_PER_SCENARIO = 5;
const MIN_QUESTIONS_TO_KEEP = 4;
const SCENARIO_CONCURRENCY = 3;
const JUDGE_CONCURRENCY = 4;

const OUTPUT_DIR = path.resolve(__dirname, 'output');

// ---- Hand-curated briefs (D2b: ONE brief; Phase E expands to ~100) ----
const BRIEFS = [
  {
    id: 'g5-circuits-lab',
    grade: 5,
    scenarioType: 'experiment',
    topic: 'students testing what makes a complete circuit with different battery and bulb configurations',
    regionTag: null,
    targetTeks: '5.8B'
  }
];

// ---- CLI ----
function parseArgs(argv) {
  const opts = { dryRun: true, write: false, briefId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--write') opts.write = true;
    else if (a === '--brief-id') opts.briefId = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log('Usage: run-seed-batch.js [--dry-run] [--write] [--brief-id <id>]');
      process.exit(0);
    }
  }
  return opts;
}

// ---- Concurrency helper ----
async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array(Math.min(concurrency, items.length || 1)).fill(0).map(async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      try { results[myIdx] = await fn(items[myIdx], myIdx); }
      catch (err) { results[myIdx] = { __error: err && err.message || String(err) }; }
    }
  });
  await Promise.all(workers);
  return results;
}

function nowIso() { return new Date().toISOString(); }

function ensureOutputDir() { fs.mkdirSync(OUTPUT_DIR, { recursive: true }); }

// ---- Pool key composer (per architecture-decisions.md schema lock) ----
function poolKeyFor(grade, scenarioId) {
  return scenarioId
    ? `${STATE}#${grade}#science#${scenarioId}`
    : `${STATE}#${grade}#science#standalone`;
}

// ---- Process a single brief (D2b is one) ----
async function processBrief(brief, opts, apiKey) {
  const tag = `[brief ${brief.id} g${brief.grade} ${brief.scenarioType}]`;

  // ---- Stage 1: scenario generation ----
  // TODO Phase E: add scripts/science/judge-scenario.js. For D2b the
  // scenario is accepted as-generated and reviewed in the dry-run JSON.
  console.log(`${tag} Stage 1: generating scenario...`);
  let scenario;
  try {
    scenario = await generateScenario({
      grade: brief.grade,
      topic: brief.topic,
      scenarioType: brief.scenarioType,
      regionTag: brief.regionTag,
      apiKey
    });
  } catch (err) {
    console.error(`${tag} SCENARIO-GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
    return { ok: false, brief, reason: 'scenario-gen-failed', error: err.message };
  }
  const wordCount = (scenario.body.match(/\S+/g) || []).length;
  console.log(`${tag} scenario OK: scenarioId=${scenario.scenarioId} title="${scenario.title}" words=${wordCount}`);

  // ---- Stage 2: question set gen + per-question judge ----
  let savedQuestions = [];
  const questionRejects = [];

  for (let attempt = 1; attempt <= QUESTION_REGEN_BUDGET; attempt++) {
    console.log(`${tag} Stage 2 attempt ${attempt}: generating ${QUESTIONS_PER_SCENARIO} questions...`);
    let questionSet;
    try {
      questionSet = await generateQuestionSet({
        scenario,
        grade: brief.grade,
        count: QUESTIONS_PER_SCENARIO,
        targetTeks: brief.targetTeks,
        apiKey
      });
    } catch (err) {
      console.error(`${tag} Q-GEN-FAIL attempt ${attempt}: ${(err.message || '').slice(0, 200)}`);
      continue;
    }

    console.log(`${tag} attempt ${attempt}: judging ${questionSet.length} questions (concurrency=${JUDGE_CONCURRENCY})...`);
    const verdicts = await mapConcurrent(questionSet, JUDGE_CONCURRENCY, async (q) => {
      // The judge expects fields in spec shape (subj, tek_code,
      // standard_type, region_tag, prompt). Map our generator output
      // to that shape for the judge call only.
      const judgeItem = {
        type: 'multiple_choice',
        subj: 'science',
        grade: brief.grade,
        tek_code: q.claimedTeks,
        strand: q.strand,
        standard_type: q.standardType,
        region_tag: q.regionTag,
        prompt: q.stem,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        passage: scenario ? { title: scenario.title, body: scenario.body } : undefined
      };
      return judgeQuestion(judgeItem);
    });

    const passing = [];
    for (let i = 0; i < questionSet.length; i++) {
      const v = verdicts[i];
      if (v && !v.__error && v.verdict === 'pass') {
        const prefix = '[judge]';
        console.log(`${tag} ${prefix} q${i + 1}: pass conf=${v.confidence} source=${v.source}`);
        passing.push({ q: questionSet[i], v });
      } else {
        const prefix = v && v.source === 'llm-error' ? '[judge:fail-open]' : '[judge]';
        const reasons = v && Array.isArray(v.reasons) ? v.reasons.join(', ') : '(none)';
        const stem = (questionSet[i].stem || '').slice(0, 80);
        console.log(`${tag} ${prefix} q${i + 1}: ${v?.verdict || '(error)'} reasons=[${reasons}] stem="${stem}"`);
        questionRejects.push({ attempt, qIdx: i, stem, verdict: v });
      }
    }

    console.log(`${tag} attempt ${attempt}: ${passing.length}/${questionSet.length} passed`);
    if (passing.length >= MIN_QUESTIONS_TO_KEEP) {
      savedQuestions = passing.slice(0, QUESTIONS_PER_SCENARIO);
      break;
    }
  }

  if (savedQuestions.length < MIN_QUESTIONS_TO_KEEP) {
    return {
      ok: false,
      brief,
      scenario,
      reason: 'questions-below-min',
      savedCount: savedQuestions.length,
      questionRejects
    };
  }

  // ---- Stage 3: persist OR dry-run print ----
  // Provenance stamps applied to the in-memory payload here so the
  // write path (Phase E) lifts this object verbatim. Each question
  // row gets _judgedAt + _judgeVersion + verdict echo + _kpVersion.
  const judgedAt = nowIso();
  const phase = opts.dryRun ? 'd2b-dry' : 'phase-e';
  const kpVersion = loadKP().version;

  const passageRow = {
    passageId: scenario.scenarioId,
    stateGradeGenre: `${STATE}_${brief.grade}_science_scenario`,
    state: STATE,
    grade: String(brief.grade),
    genre: 'science_scenario',
    scenarioType: scenario.scenarioType,
    regionTag: scenario.regionTag,
    title: scenario.title,
    body: scenario.body,
    wordCount,
    _generatedAt: scenario._generatedAt,
    _generatedBy: scenario._generatedBy,
    _judgedAt: null,           // TODO Phase E: scenario judge
    _judgeVerdict: null,
    _judgeVersion: null,
    _kpVersion: kpVersion,
    _phase: phase
  };

  const questionRows = savedQuestions.map((entry, i) => {
    const { q, v } = entry;
    return {
      poolKey: poolKeyFor(brief.grade, scenario.scenarioId),
      // contentId placeholder — Phase E generates a real one
      contentId: `q_dryrun_${scenario.scenarioId}_${i + 1}`,
      type: 'science_mc',
      subject: 'science',
      state: STATE,
      grade: String(brief.grade),
      scenarioId: scenario.scenarioId,
      stem: q.stem,
      stemPattern: q.stemPattern,
      choices: q.choices,
      correctIndex: q.correctIndex,
      claimedTeks: q.claimedTeks,
      teks: q.claimedTeks,        // post-judge verified TEK = claimed (judge validated)
      strand: q.strand,
      standardType: q.standardType,
      regionTag: q.regionTag,
      explanation: q.explanation,
      status: 'active',
      generatedAt: Date.now(),    // Number, required for status-generatedAt-index GSI
      generatedAtIso: q._generatedAt,
      generatedBy: q._generatedBy,
      _judgedAt: judgedAt,
      _judgeVersion: v.judgeVersion,
      _judgeVerdict: v.verdict,
      _judgeConfidence: v.confidence,
      _judgeReasons: v.reasons,
      _kpVersion: kpVersion,
      _phase: phase
    };
  });

  // Stage 3 (real write) — guarded
  if (opts.write) {
    console.error('--write is NOT implemented in D2b. Use the Phase E run wrapper.');
    process.exit(1);
  }

  // Stage 3' — dry-run print
  console.log('');
  console.log(`[DRY-RUN] would write to staar-passages:`);
  console.log(JSON.stringify(passageRow, null, 2));
  console.log('');
  for (let i = 0; i < questionRows.length; i++) {
    console.log(`[DRY-RUN] would write to staar-content-pool (q${i + 1}/${questionRows.length}):`);
    console.log(JSON.stringify(questionRows[i], null, 2));
    console.log('');
  }

  return { ok: true, brief, scenario, passageRow, questionRows, questionRejects };
}

// ---- Main ----
async function main() {
  const opts = parseArgs(process.argv);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('FATAL: ANTHROPIC_API_KEY env var not set.');
    console.error('See top-of-file run command for the Secrets Manager fetch.');
    process.exit(1);
  }

  if (opts.write && !opts.briefId) {
    console.error('--write requires --brief-id (and is not implemented in D2b anyway).');
    process.exit(1);
  }

  const briefs = opts.briefId
    ? BRIEFS.filter(b => b.id === opts.briefId)
    : BRIEFS.slice();

  if (briefs.length === 0) {
    console.error(`No briefs matched --brief-id=${opts.briefId || '(unset)'}.`);
    console.error(`Available: ${BRIEFS.map(b => b.id).join(', ')}`);
    process.exit(1);
  }

  ensureOutputDir();
  const startedAt = nowIso();
  const startedMs = Date.now();
  const runId = startedAt.replace(/[:.]/g, '-');
  console.log(`[run-seed-batch] start runId=${runId} mode=${opts.write ? 'write' : 'dry-run'} briefs=${briefs.length}`);
  console.log('');

  // Outer concurrency = SCENARIO_CONCURRENCY but D2b runs at most 1 brief
  const results = await mapConcurrent(briefs, SCENARIO_CONCURRENCY, async (brief) => {
    return processBrief(brief, opts, apiKey);
  });

  const wallSec = Math.round((Date.now() - startedMs) / 1000);
  const passed = results.filter(r => r && r.ok);
  const failed = results.filter(r => r && !r.ok);

  // Write the dry-run payload (full) to output/
  const outPath = path.join(OUTPUT_DIR, `dry-run-${runId}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runId,
    startedAt,
    endedAt: nowIso(),
    wallClockSec: wallSec,
    mode: opts.write ? 'write' : 'dry-run',
    briefs,
    results
  }, null, 2));

  console.log('');
  console.log('=== RUN SUMMARY ===');
  console.log(`runId:           ${runId}`);
  console.log(`wallClockSec:    ${wallSec}`);
  console.log(`briefsAttempted: ${briefs.length}`);
  console.log(`passed:          ${passed.length}`);
  console.log(`failed:          ${failed.length}`);
  for (const r of failed) {
    console.log(`  FAILED ${r.brief?.id || '(no brief)'}: ${r.reason || r.__error || 'unknown'}`);
  }
  console.log(`Dry-run payload: ${outPath}`);

  process.exit(passed.length === briefs.length ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
