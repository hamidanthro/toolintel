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
const crypto = require('crypto');

const { generateScenario } = require('./generate-scenario');
const { generateQuestionSet } = require('./generate-question');
const { judgeQuestion } = require('./judge-question');
const { judgeScenario } = require('./judge-scenario');
const { loadKP } = require('./lib/load-kp');

const STATE = 'texas';
const SCENARIO_REGEN_BUDGET = 3;
const QUESTION_REGEN_BUDGET = 3;
const QUESTIONS_PER_SCENARIO = 5;
const MIN_QUESTIONS_TO_KEEP = 4;
const SCENARIO_CONCURRENCY = 3;
const JUDGE_CONCURRENCY = 4;

const OUTPUT_DIR = path.resolve(__dirname, 'output');

// ---- AWS SDK lazy-require (only when --write) ----
// Borrows from scripts/cold-start/node_modules via NODE_PATH; avoids a
// new package.json per the locked decisions.
let _ddbClient = null;
let _PutCommand = null;
let _DocClient = null;
let _ConditionalCheckFailedException = null;
function getDdb() {
  if (_ddbClient) return { ddb: _ddbClient, PutCommand: _PutCommand };
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const lib = require('@aws-sdk/lib-dynamodb');
  _DocClient = lib.DynamoDBDocumentClient;
  _PutCommand = lib.PutCommand;
  _ddbClient = _DocClient.from(new DynamoDBClient({ region: 'us-east-1' }));
  return { ddb: _ddbClient, PutCommand: _PutCommand };
}

const PASSAGES_TABLE = 'staar-passages';
const POOL_TABLE = 'staar-content-pool';

// ---- Hand-curated briefs — Phase E pilot, 20 Grade 5 across 4 strands ----
//
// Distribution target:
//   - 5 Matter & Energy        (5.6A/B/C)
//   - 5 Force, Motion & Energy (5.7A/B, 5.8B/C)
//   - 5 Earth & Space          (5.9A, 5.10A/B/C)
//   - 5 Organisms & Environments (5.12A, 5.13A)
// Mix scenarioTypes (~10 experiment / ~7 data_analysis / ~3 described_diagram).
// 6 briefs carry a Texas regionTag; 14 region-neutral.
const BRIEFS = [
  // ----- Matter & Energy (5) -----
  { id: 'g5-density-relative-water', grade: 5, scenarioType: 'experiment',
    topic: 'students testing whether different objects sink or float in water and inferring relative density',
    regionTag: null, targetTeks: '5.6A' },
  { id: 'g5-mixture-iron-sand', grade: 5, scenarioType: 'experiment',
    topic: 'students separating an iron-filings + sand mixture using a magnet and observing that each material kept its physical properties',
    regionTag: null, targetTeks: '5.6B' },
  { id: 'g5-solution-conserve-mass', grade: 5, scenarioType: 'data_analysis',
    topic: 'students massing salt and water separately, then massing the saltwater solution, recording numbers in a table to test conservation of matter',
    regionTag: null, targetTeks: '5.6C' },
  { id: 'g5-thermal-conductors-galveston', grade: 5, scenarioType: 'experiment',
    topic: 'a Galveston classroom comparing how quickly heat moves through metal vs plastic spoons placed in hot water',
    regionTag: 'gulf_coast', targetTeks: '5.6A' },
  { id: 'g5-magnetic-classify', grade: 5, scenarioType: 'data_analysis',
    topic: 'students sorting a tray of objects (paperclip, penny, plastic button, aluminum foil, iron nail) by whether a magnet picked them up, recording results in a table',
    regionTag: null, targetTeks: '5.6A' },

  // ----- Force, Motion & Energy (5) -----
  { id: 'g5-circuit-complete', grade: 5, scenarioType: 'experiment',
    topic: 'students testing four different battery + bulb + wire setups, observing which complete circuits light the bulb',
    regionTag: null, targetTeks: '5.8B' },
  { id: 'g5-light-reflect-mirror', grade: 5, scenarioType: 'described_diagram',
    topic: 'a setup where a flashlight beam hits a mirror at an angle and reflects onto a wall, with the angles described in words',
    regionTag: null, targetTeks: '5.8C' },
  { id: 'g5-force-ramp-balloon', grade: 5, scenarioType: 'experiment',
    topic: 'students designing investigations: a toy car on ramps of different heights, and a balloon rocket on a string with different inflation amounts',
    regionTag: null, targetTeks: '5.7B' },
  { id: 'g5-electric-circuit-houston', grade: 5, scenarioType: 'data_analysis',
    topic: 'a Houston elementary class measuring how brightly a bulb lights with one, two, or three batteries connected in series, recording brightness rankings',
    regionTag: 'gulf_coast', targetTeks: '5.8B' },
  { id: 'g5-balanced-unbalanced', grade: 5, scenarioType: 'experiment',
    topic: 'students playing tug-of-war: equal teams (no motion) vs unequal teams (motion toward stronger side), explaining force balance',
    regionTag: null, targetTeks: '5.7A' },

  // ----- Earth & Space (5) -----
  { id: 'g5-earth-rotation-shadow', grade: 5, scenarioType: 'data_analysis',
    topic: 'students measuring the length of a shadow from a stick at 9am, 12pm, and 3pm, recording inches in a table to investigate Earth rotation',
    regionTag: null, targetTeks: '5.9A' },
  { id: 'g5-sedimentary-rock-formation', grade: 5, scenarioType: 'described_diagram',
    topic: 'a textbook description of layers of sand, mud, and shells settling at the bottom of an ocean over thousands of years, eventually compressing into sedimentary rock',
    regionTag: null, targetTeks: '5.10B' },
  { id: 'g5-water-cycle-sun', grade: 5, scenarioType: 'data_analysis',
    topic: 'a class tracking water evaporation from an open pan in sunlight vs in shade over 5 days, with measurements in milliliters',
    regionTag: null, targetTeks: '5.10A' },
  { id: 'g5-canyon-erosion-bigbend', grade: 5, scenarioType: 'experiment',
    topic: 'a Big Bend field-trip class pouring water down a hillside model of sand and clay to observe how moving water carves channels and forms small canyon-like features',
    regionTag: 'big_bend', targetTeks: '5.10C' },
  { id: 'g5-shadow-pattern-piney-woods', grade: 5, scenarioType: 'data_analysis',
    topic: 'an East Texas Piney Woods class recording where the morning Sun shines on the schoolyard each week for a month and noticing the shifting position',
    regionTag: 'piney_woods', targetTeks: '5.9A' },

  // ----- Organisms & Environments (5) -----
  { id: 'g5-pond-ecosystem-biotic-abiotic', grade: 5, scenarioType: 'described_diagram',
    topic: 'a description of a pond ecosystem listing biotic factors (frogs, water striders, algae, lily pads) and abiotic factors (water temperature, sunlight, rocks, dissolved oxygen)',
    regionTag: null, targetTeks: '5.12A' },
  { id: 'g5-prairie-survival-dfw', grade: 5, scenarioType: 'experiment',
    topic: 'a DFW classroom planting two trays of grass — one watered daily, one watered weekly — and recording which trays grew taller and greener over 3 weeks',
    regionTag: 'dfw', targetTeks: '5.13A' },
  { id: 'g5-bird-beak-adapt', grade: 5, scenarioType: 'experiment',
    topic: 'students using different tools (tweezers, chopsticks, spoons) to pick up rice, sunflower seeds, and water, modeling how beak shape suits different foods',
    regionTag: null, targetTeks: '5.13A' },
  { id: 'g5-food-web-hill-country-bats', grade: 5, scenarioType: 'data_analysis',
    topic: 'a Hill Country class recording how many insects a Mexican free-tailed bat eats per night and discussing what would happen to the local insect population if the bat colony disappeared',
    regionTag: 'hill_country', targetTeks: '5.12A' },
  { id: 'g5-decomposers-leaves-panhandle', grade: 5, scenarioType: 'experiment',
    topic: 'a Panhandle class burying fallen leaves in soil and checking after 4 weeks vs after 8 weeks to observe decomposers breaking material down',
    regionTag: 'panhandle', targetTeks: '5.12A' }
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

  // ---- Stage 1: scenario generation + judge ----
  // Regen up to SCENARIO_REGEN_BUDGET=3 attempts. On each rejection,
  // log the reason codes; if all 3 fail, give up on this brief.
  console.log(`${tag} Stage 1: generating scenario...`);
  let scenario = null;
  let scenarioVerdict = null;
  const scenarioRejects = [];
  for (let attempt = 1; attempt <= SCENARIO_REGEN_BUDGET; attempt++) {
    let candidate;
    try {
      candidate = await generateScenario({
        grade: brief.grade,
        topic: brief.topic,
        scenarioType: brief.scenarioType,
        regionTag: brief.regionTag,
        apiKey
      });
    } catch (err) {
      console.warn(`${tag} attempt ${attempt} SCENARIO-GEN-FAIL: ${(err.message || '').slice(0, 200)}`);
      scenarioRejects.push({ attempt, error: err.message });
      continue;
    }
    const verdict = await judgeScenario(candidate);
    if (verdict.verdict === 'pass') {
      scenario = candidate;
      scenarioVerdict = verdict;
      const wc = (candidate.body.match(/\S+/g) || []).length;
      console.log(`${tag} [scenario-judge] pass conf=${verdict.confidence} source=${verdict.source} (attempt ${attempt}, words=${wc})`);
      break;
    }
    const prefix = verdict.source === 'llm-error' ? '[scenario-judge:fail-open]' : '[scenario-judge]';
    const reasons = Array.isArray(verdict.reasons) ? verdict.reasons.join(', ') : '';
    console.log(`${tag} ${prefix} reject attempt ${attempt}: reasons=[${reasons}] note="${(verdict.note || '').slice(0, 120)}"`);
    scenarioRejects.push({ attempt, title: candidate.title, verdict });
  }

  if (!scenario) {
    return { ok: false, brief, reason: 'scenario-rejected-3x', scenarioRejects };
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
  // Phase tag derives from --write (write path) vs default (dry-run).
  // BUG-fixed in Phase F: parseArgs defaults dryRun=true and --write
  // doesn't flip it, so the original `opts.dryRun ? ... : ...` ternary
  // tagged real-write rows as 'd2b-dry'. Now keys on opts.write.
  const phase = opts.write ? 'phase-e' : 'd2b-dry';
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
    _judgedAt: judgedAt,
    _judgeVerdict: scenarioVerdict.verdict,
    _judgeConfidence: scenarioVerdict.confidence,
    _judgeReasons: scenarioVerdict.reasons || [],
    _judgeVersion: scenarioVerdict.judgeVersion,
    _kpVersion: kpVersion,
    _phase: phase
  };

  // Deterministic contentId per question — sha256(scenarioId+stem)
  // truncated to 12 chars. Re-runs of the same content are no-ops via
  // the ConditionExpression on PutCommand, NOT silent overwrites.
  function contentIdFor(scenarioId, stem) {
    const h = crypto.createHash('sha256').update(`${scenarioId}|${stem}`).digest('hex').slice(0, 12);
    return `q_${h}`;
  }

  const questionRows = savedQuestions.map((entry, i) => {
    const { q, v } = entry;
    return {
      poolKey: poolKeyFor(brief.grade, scenario.scenarioId),
      contentId: contentIdFor(scenario.scenarioId, q.stem),
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

  // Stage 3 — real write (--write) OR dry-run print (default)
  if (opts.write) {
    const { ddb, PutCommand } = getDdb();
    const writeStats = { passageWritten: false, passageSkippedDup: false, questionsWritten: 0, questionsSkippedDup: 0 };
    // Passage row first. attribute_not_exists(passageId) makes re-runs
    // of the same brief idempotent (deterministic scenarioId).
    try {
      await ddb.send(new PutCommand({
        TableName: PASSAGES_TABLE,
        Item: passageRow,
        ConditionExpression: 'attribute_not_exists(passageId)'
      }));
      writeStats.passageWritten = true;
      console.log(`${tag} [write] staar-passages: ${scenario.scenarioId} (NEW)`);
    } catch (err) {
      if (err && err.name === 'ConditionalCheckFailedException') {
        writeStats.passageSkippedDup = true;
        console.log(`[skip-dup] passageId=${scenario.scenarioId}`);
      } else {
        throw err; // any other DDB error aborts the brief
      }
    }
    // Then each question. Same idempotency contract.
    for (const row of questionRows) {
      try {
        await ddb.send(new PutCommand({
          TableName: POOL_TABLE,
          Item: row,
          ConditionExpression: 'attribute_not_exists(contentId)'
        }));
        writeStats.questionsWritten++;
        console.log(`${tag} [write] staar-content-pool: ${row.contentId} (NEW)`);
      } catch (err) {
        if (err && err.name === 'ConditionalCheckFailedException') {
          writeStats.questionsSkippedDup++;
          console.log(`[skip-dup] contentId=${row.contentId}`);
        } else {
          throw err;
        }
      }
    }
    return { ok: true, brief, scenario, scenarioVerdict, passageRow, questionRows, questionRejects, writeStats };
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

  return { ok: true, brief, scenario, scenarioVerdict, passageRow, questionRows, questionRejects };
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

  // E.1: --write may target ALL briefs (full pilot) OR --brief-id <id>
  // (single-brief retry). Either is valid.

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

  // Write the run payload (full) to output/. Filename varies by mode.
  const outName = opts.write ? `pilot-${runId}.json` : `dry-run-${runId}.json`;
  const outPath = path.join(OUTPUT_DIR, outName);
  fs.writeFileSync(outPath, JSON.stringify({
    runId,
    startedAt,
    endedAt: nowIso(),
    wallClockSec: wallSec,
    mode: opts.write ? 'write' : 'dry-run',
    briefs,
    results
  }, null, 2));

  // Aggregate persisted-row counts (--write only)
  let totalQuestionsWritten = 0;
  let totalQuestionsSkippedDup = 0;
  let totalPassagesWritten = 0;
  let totalPassagesSkippedDup = 0;
  for (const r of passed) {
    if (r.writeStats) {
      totalQuestionsWritten += r.writeStats.questionsWritten || 0;
      totalQuestionsSkippedDup += r.writeStats.questionsSkippedDup || 0;
      if (r.writeStats.passageWritten) totalPassagesWritten++;
      if (r.writeStats.passageSkippedDup) totalPassagesSkippedDup++;
    }
  }

  // Sample-10 review file — only for --write runs with persisted rows
  let samplePath = null;
  if (opts.write && passed.length > 0) {
    samplePath = path.join(OUTPUT_DIR, 'pilot-sample-10.md');
    try {
      writeSample10(samplePath, passed);
      console.log(`Sample-10 review: ${samplePath}`);
    } catch (err) {
      console.warn(`[sample-10] failed to write: ${err.message}`);
    }
  }

  console.log('');
  console.log('=== RUN SUMMARY ===');
  console.log(`runId:                 ${runId}`);
  console.log(`mode:                  ${opts.write ? 'write' : 'dry-run'}`);
  console.log(`wallClockSec:          ${wallSec}`);
  console.log(`briefsAttempted:       ${briefs.length}`);
  console.log(`briefsPassed:          ${passed.length}`);
  console.log(`briefsFailed:          ${failed.length}`);
  if (opts.write) {
    console.log(`passagesWritten:       ${totalPassagesWritten}`);
    console.log(`passagesSkippedDup:    ${totalPassagesSkippedDup}`);
    console.log(`questionsWritten:      ${totalQuestionsWritten}`);
    console.log(`questionsSkippedDup:   ${totalQuestionsSkippedDup}`);
  }
  for (const r of failed) {
    console.log(`  FAILED ${r.brief?.id || '(no brief)'}: ${r.reason || r.__error || 'unknown'}`);
  }
  console.log(`Run payload:           ${outPath}`);

  process.exit(passed.length === briefs.length ? 0 : 1);
}

// Stratified sample-10 picker. Spec:
//   - 1 from each of the 4 Grade 5 strands (4 picks)
//   - 3 from STAAR Readiness standards (3 different teks)
//   - 2 with regionTag set
//   - 1 with the lowest _judgeConfidence (closest call)
// Picks de-dup by contentId so the same row isn't repeated.
function writeSample10(outPath, passedResults) {
  const allRows = [];
  for (const r of passedResults) {
    if (!Array.isArray(r.questionRows)) continue;
    for (const q of r.questionRows) {
      allRows.push({ q, scenario: r.scenario });
    }
  }
  if (allRows.length === 0) {
    fs.writeFileSync(outPath, '# Sample-10 review\n\n_(no questions persisted)_\n');
    return;
  }

  const picked = new Map();   // contentId → { q, scenario, why }
  function pick(row, why) {
    if (!row) return;
    if (picked.has(row.q.contentId)) return;
    picked.set(row.q.contentId, { ...row, why });
  }

  const STRANDS_G5 = [
    'Matter & Energy',
    'Force, Motion & Energy',
    'Earth & Space',
    'Organisms & Environments'
  ];
  // 1 from each strand
  for (const strand of STRANDS_G5) {
    const cand = allRows.find(r => r.q.strand === strand && !picked.has(r.q.contentId));
    if (cand) pick(cand, `strand: ${strand}`);
  }
  // 3 from Readiness, distinct teks (skip teks already in the picked set)
  const readinessTargets = ['5.6A', '5.8B', '5.9A', '5.10B', '5.10C', '5.12A', '5.13A'];
  let readinessPicked = 0;
  const seenTeks = new Set(Array.from(picked.values()).map(p => p.q.claimedTeks));
  for (const tek of readinessTargets) {
    if (readinessPicked >= 3) break;
    if (seenTeks.has(tek)) continue;
    const cand = allRows.find(r =>
      r.q.claimedTeks === tek &&
      r.q.standardType === 'Readiness' &&
      !picked.has(r.q.contentId)
    );
    if (cand) {
      pick(cand, `readiness: ${tek}`);
      seenTeks.add(tek);
      readinessPicked++;
    }
  }
  // 2 with regionTag set
  const regionRows = allRows.filter(r => r.q.regionTag && !picked.has(r.q.contentId));
  for (let i = 0; i < Math.min(2, regionRows.length); i++) {
    pick(regionRows[i], `regionTag: ${regionRows[i].q.regionTag}`);
  }
  // 1 with lowest _judgeConfidence
  const remaining = allRows.filter(r => !picked.has(r.q.contentId));
  if (remaining.length > 0) {
    remaining.sort((a, b) => (a.q._judgeConfidence || 0) - (b.q._judgeConfidence || 0));
    pick(remaining[0], `lowest-confidence: ${remaining[0].q._judgeConfidence}`);
  }

  // Backfill if we landed under 10 (small batches won't hit every bucket)
  if (picked.size < 10) {
    for (const r of allRows) {
      if (picked.size >= 10) break;
      if (!picked.has(r.q.contentId)) pick(r, 'backfill');
    }
  }

  const lines = [];
  lines.push(`# Pilot sample-10 review`);
  lines.push('');
  lines.push(`Sampled ${picked.size} questions from ${allRows.length} persisted across ${passedResults.length} scenarios.`);
  lines.push('');
  let i = 0;
  for (const entry of picked.values()) {
    i++;
    const q = entry.q;
    const sc = entry.scenario;
    const letters = ['A', 'B', 'C', 'D'];
    const correctLetter = letters[q.correctIndex] || '?';
    lines.push(`## Question ${i} — ${q.claimedTeks} — ${q.strand}`);
    lines.push(`*pick reason: ${entry.why}*`);
    lines.push('');
    lines.push(`**Stem:** ${q.stem}`);
    lines.push('');
    lines.push(`**Choices:**`);
    for (let j = 0; j < q.choices.length; j++) {
      lines.push(`  - ${letters[j]}. ${q.choices[j]}`);
    }
    lines.push('');
    lines.push(`**Correct:** ${correctLetter}`);
    lines.push('');
    lines.push(`**Explanation:** ${q.explanation || '(none)'}`);
    lines.push('');
    lines.push(`**Region:** ${q.regionTag || 'none'}`);
    lines.push('');
    lines.push(`**Judge:** ${q._judgeVerdict} (confidence ${q._judgeConfidence}) reasons=[${(q._judgeReasons || []).join(', ')}]`);
    lines.push('');
    if (sc && sc.body) {
      const truncated = sc.body.length > 200 ? sc.body.slice(0, 200) + '…' : sc.body;
      lines.push(`**Scenario context (truncated):** ${truncated}`);
      lines.push('');
    }
    lines.push(`---`);
    lines.push('');
  }
  fs.writeFileSync(outPath, lines.join('\n'));
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
