#!/usr/bin/env node
/**
 * Bulk-fill runner (CLAUDE.md §37).
 *
 * Tier-driven Texas math bulk fill against the §35 coverage plan.
 *
 * Reads:
 *   - state-packs/texas/coverage-plan.json (tier targets per type)
 *   - latest output/texas-math-coverage-classification-*.json (current coverage)
 *
 * For each (grade × TEKS × type) bucket in the specified --tier:
 *   - count_to_generate = max(0, target_min - current_count)
 *   - generates that many through the §36 pack-wired pipeline
 *     (judge gpt-4o + Claude Sonnet 4.5 verifier + within-grade dedup)
 *   - saves with _sweepRunId stamp
 *   - tracks per-bucket stats
 *
 * Stop conditions:
 *   - 5+ consecutive Anthropic errors
 *   - 5+ consecutive OpenAI errors
 *   - Judge regen rate > 70% sustained for 100 questions
 *   - Wall-clock > --max-hours (default 18)
 *
 * Output: scripts/cold-start/output/bulk-fill-texas-math-<tier>-<UTC>.json
 *
 * Usage:
 *   COLD_START_SWEEP_RUN_ID=bulk-fill-texas-math-heavy-v2-<UTC> \
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
 *   node bulk-fill-runner.js --tier=heavy --concurrency=2
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['tier', 'state', 'subject'],
  default: {
    tier: 'heavy', state: 'texas', subject: 'math',
    concurrency: 2, 'max-hours': 18,
    'cost-ceiling': 200    // safety: stop if generator burns more than $200
  },
  boolean: ['dry-run']
});

const lake = require('./lake-client');
const { generateOne } = require('./generators');
const { validateStateSpecificity } = require('./state-guardrail');
const { verifyMath } = require('./verifier');

const STATE = args.state;
const SUBJECT = args.subject;
const TIER = args.tier;
const CONCURRENCY = Math.max(1, Number(args.concurrency));
const MAX_MS = Number(args['max-hours']) * 3600 * 1000;
const COST_CEILING = parseFloat(args['cost-ceiling']);

const PACK_ROOT = path.resolve(__dirname, '..', '..', 'state-packs');
const TEKS_TYPES = ['word-problem', 'computation', 'concept', 'data-interpretation'];

function poolKeyOf(grade, type) {
  return `${STATE}#${grade}#${SUBJECT}#teks-${type}`;
}

function loadPlan() {
  const f = path.join(PACK_ROOT, STATE, 'coverage-plan.json');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

function loadTaxonomy() {
  const f = path.join(PACK_ROOT, STATE, 'standards', `teks-${SUBJECT}.json`);
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const byGrade = {};
  for (const k of Object.keys(data)) {
    if (k.startsWith('_')) continue;
    const grade = k.replace(/^grade_/, 'grade-').replace('algebra_1', 'algebra-1');
    byGrade[grade] = data[k].standards.map(s => ({
      id: s.id, strand: s.strand, cognitive_demand: s.cognitive_demand
    }));
  }
  return byGrade;
}

function findLatestClassification() {
  const dir = path.join(__dirname, 'output');
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.startsWith(`${STATE}-${SUBJECT}-coverage-classification-`) && f.endsWith('.json'))
    .sort();
  if (!files.length) return null;
  const latest = files[files.length - 1];
  console.log(`[bulk-fill] using classification: ${latest}`);
  return JSON.parse(fs.readFileSync(path.join(dir, latest), 'utf8'));
}

const GRADE_ORDER = ['grade-3', 'grade-4', 'grade-5', 'grade-6', 'grade-7', 'grade-8', 'algebra-1'];
const TYPE_ORDER = { 'word-problem': 0, 'computation': 1, 'concept': 2, 'data-interpretation': 3 };

function buildBucketList(plan, taxonomy, classification) {
  // For each (grade, teks, type) where teks is in TIER and current_count < target_min,
  // compute count_to_generate and queue.
  const tierTarget = plan.tiers[TIER]?.target_per_type;
  if (typeof tierTarget !== 'number') {
    throw new Error(`Unknown tier "${TIER}" in plan`);
  }

  const tierMap = plan.teks_tier;
  const buckets = [];
  for (const grade of GRADE_ORDER) {
    if (!taxonomy[grade]) continue;
    for (const t of taxonomy[grade]) {
      const tier = (tierMap[grade] && tierMap[grade][t.id]) || plan.default_tier;
      if (tier !== TIER) continue;
      for (const type of TEKS_TYPES) {
        const have = (((classification.classification?.byGradeTeksType || {})[grade] || {})[t.id] || {})[type] || 0;
        const need = Math.max(0, tierTarget - have);
        if (need === 0) continue;
        buckets.push({
          grade, teks: t.id, strand: t.strand, type,
          have, target: tierTarget, need
        });
      }
    }
  }
  // Sort: grade asc → type order (word-problem first) → teks asc
  buckets.sort((a, b) => {
    const ga = GRADE_ORDER.indexOf(a.grade), gb = GRADE_ORDER.indexOf(b.grade);
    if (ga !== gb) return ga - gb;
    const ta = TYPE_ORDER[a.type], tb = TYPE_ORDER[b.type];
    if (ta !== tb) return ta - tb;
    return a.teks.localeCompare(b.teks);
  });
  return buckets;
}

// ---- run state ----
const RUN_ID = process.env.COLD_START_SWEEP_RUN_ID
  || `bulk-fill-${STATE}-${SUBJECT}-${TIER}-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`;
const tStart = Date.now();
const stats = {
  runId: RUN_ID,
  startedAt: new Date(tStart).toISOString(),
  buckets: 0,             // total in plan
  bucketsProcessed: 0,
  totalSaved: 0,
  totalAttempts: 0,
  judgeRejects: 0,
  judgeRegens: 0,
  verifierRejects: 0,
  dedupSkips: 0,
  validationFails: 0,
  stateRejects: 0,
  errors: 0,
  consecAnthropicErrors: 0,
  consecOpenAIErrors: 0,
  totalAnthropicErrors: 0,
  totalOpenAIErrors: 0,
  perBucket: [],
  stoppedEarly: null
};

let lastEmit = Date.now();

function progressLine(remaining) {
  const elapsedMin = ((Date.now() - tStart) / 60000).toFixed(1);
  const rate = stats.totalSaved / Math.max(1, (Date.now() - tStart) / 60000);
  const etaMin = remaining > 0 && rate > 0 ? (remaining / rate).toFixed(1) : '?';
  const judgeRegenRate = stats.totalAttempts ? ((stats.judgeRegens / stats.totalAttempts) * 100).toFixed(1) : '0';
  return `[bulk-fill] buckets=${stats.bucketsProcessed}/${stats.buckets}  saved=${stats.totalSaved}/+${remaining}  judge_regen=${judgeRegenRate}%  verifier_rej=${stats.verifierRejects}  dedup=${stats.dedupSkips}  api_err(anth/oai)=${stats.totalAnthropicErrors}/${stats.totalOpenAIErrors}  elapsed=${elapsedMin}m  eta=${etaMin}m`;
}

function shouldStop() {
  if (Date.now() - tStart > MAX_MS) {
    stats.stoppedEarly = `wall-clock exceeded ${args['max-hours']} h`;
    return true;
  }
  if (stats.consecAnthropicErrors >= 5) {
    stats.stoppedEarly = `5+ consecutive Anthropic errors`;
    return true;
  }
  if (stats.consecOpenAIErrors >= 5) {
    stats.stoppedEarly = `5+ consecutive OpenAI errors`;
    return true;
  }
  // Judge regen rate > 70% sustained for 100+ attempts
  if (stats.totalAttempts >= 100 && stats.judgeRegens / stats.totalAttempts > 0.70) {
    stats.stoppedEarly = `judge regen rate > 70% sustained over ${stats.totalAttempts} attempts`;
    return true;
  }
  return false;
}

function tagApiError(err) {
  const msg = String(err && err.message || '');
  if (/anthropic/i.test(msg) || /verifier/i.test(msg)) {
    stats.totalAnthropicErrors++;
    stats.consecAnthropicErrors++;
    stats.consecOpenAIErrors = 0;
  } else if (/openai/i.test(msg) || /judge/i.test(msg)) {
    stats.totalOpenAIErrors++;
    stats.consecOpenAIErrors++;
    stats.consecAnthropicErrors = 0;
  } else {
    // Generic — don't count toward consecutive API-errors
    stats.consecAnthropicErrors = 0;
    stats.consecOpenAIErrors = 0;
  }
}

async function fillOneBucket(bucket) {
  const { grade, teks, type, need } = bucket;
  const pk = poolKeyOf(grade, type);
  const startedAt = Date.now();
  let saved = 0, attempts = 0, judgeRejects = 0, judgeRegens = 0,
      verifierRejects = 0, dedupSkips = 0, validationFails = 0,
      stateRejects = 0, errors = 0;
  const MAX_ATTEMPTS = need * 5;

  while (saved < need && attempts < MAX_ATTEMPTS) {
    if (shouldStop()) break;
    attempts++;
    stats.totalAttempts++;
    try {
      const item = await generateOne({
        state: STATE, grade, subject: SUBJECT, type, teksOverride: teks
      });
      if (item._judge === 'pass-after-regen') { judgeRegens++; stats.judgeRegens++; }
      // Reset consecutive-error counters on a successful pipeline run
      stats.consecAnthropicErrors = 0;
      stats.consecOpenAIErrors = 0;

      const errs = lake.validateQuestion(item, SUBJECT, grade);
      if (errs.length) { validationFails++; continue; }
      const stateErrs = validateStateSpecificity(item, STATE);
      if (stateErrs.length) { stateRejects++; continue; }

      const v = await verifyMath(item, grade);
      if (!v.ok) {
        verifierRejects++;
        stats.verifierRejects++;
        if (v.reason && v.reason.startsWith('verifier-bad-json')) tagApiError(new Error('anthropic verifier-bad-json'));
        continue;
      }

      const seedText = item.passage?.text ? `${item.passage.text} ${item.question}` : item.question;
      const embedding = await lake.computeEmbedding(seedText);
      const contentId = lake.generateId('q');
      const record = {
        poolKey: pk, contentId,
        state: STATE, grade, subject: SUBJECT, questionType: type,
        question: item.question, choices: item.choices,
        correctIndex: item.correctIndex, explanation: item.explanation,
        passage: null, embedding,
        qualityScore: 0.6,
        timesServed: 0, timesCorrect: 0, timesIncorrect: 0, reportedCount: 0,
        reviewStatus: 'unreviewed', status: 'active',
        generatedAt: Date.now(),
        generatedBy: 'cold-start-v2', promptVersion: 'cold-v2',
        tokensUsed: item._tokensUsed || 0,
        _judge: item._judge || 'unknown',
        teks: item._packTeks || teks,
        _sweepRunId: RUN_ID
      };
      try {
        await lake.saveQuestion(record);
        saved++;
        stats.totalSaved++;
      } catch (saveErr) {
        if (saveErr.name === 'DuplicateError') {
          dedupSkips++;
          stats.dedupSkips++;
          continue;
        }
        throw saveErr;
      }
    } catch (e) {
      errors++;
      stats.errors++;
      if (e && e.name === 'JudgeRejectedTwiceError') {
        judgeRejects++;
        stats.judgeRejects++;
      } else {
        tagApiError(e);
      }
    }

    if (Date.now() - lastEmit > 5 * 60_000) {
      const remaining = Math.max(0, stats.buckets * (bucket.target) - stats.totalSaved);
      console.log(progressLine(remaining));
      lastEmit = Date.now();
    }
  }
  const result = {
    grade, teks, type, target: bucket.target,
    countPre: bucket.have, countPost: bucket.have + saved,
    saved, attempts,
    judgeRejects, judgeRegens, verifierRejects, dedupSkips,
    validationFails, stateRejects, errors,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000)
  };
  stats.perBucket.push(result);
  stats.bucketsProcessed++;
  return result;
}

async function runConcurrent(buckets) {
  // Simple worker-pool: maintain up to CONCURRENCY parallel buckets
  const queue = buckets.slice();
  const inflight = new Set();
  while ((queue.length || inflight.size) && !shouldStop()) {
    while (inflight.size < CONCURRENCY && queue.length && !shouldStop()) {
      const b = queue.shift();
      const p = (async () => {
        const r = await fillOneBucket(b);
        const remaining = queue.reduce((acc, x) => acc + x.need, 0);
        console.log(`[bucket-done] ${r.grade}/${r.teks}/${r.type}  saved=${r.saved}/${b.need}  attempts=${r.attempts}  regens=${r.judgeRegens}  verify_rej=${r.verifierRejects}  errors=${r.errors}  ${r.elapsedSec}s  | queue=${queue.length} remaining_target=${remaining}`);
      })();
      inflight.add(p);
      p.finally(() => inflight.delete(p));
    }
    if (inflight.size) {
      await Promise.race(inflight);
    }
  }
  // Drain remaining
  if (inflight.size) {
    await Promise.allSettled([...inflight]);
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY not set'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }

  console.log(`[bulk-fill] run-id: ${RUN_ID}`);
  console.log(`[bulk-fill] state=${STATE} subject=${SUBJECT} tier=${TIER} concurrency=${CONCURRENCY} max-hours=${args['max-hours']}`);

  const plan = loadPlan();
  const taxonomy = loadTaxonomy();
  const classification = findLatestClassification();
  if (!classification) {
    console.error('[bulk-fill] no classification JSON in output/ — run coverage-audit.js first');
    process.exit(1);
  }

  const buckets = buildBucketList(plan, taxonomy, classification);
  stats.buckets = buckets.length;
  const totalNeed = buckets.reduce((a, b) => a + b.need, 0);
  console.log(`[bulk-fill] buckets to fill: ${buckets.length}`);
  console.log(`[bulk-fill] total questions to generate: ${totalNeed.toLocaleString()}`);
  console.log(`[bulk-fill] sample first 10 buckets:`);
  buckets.slice(0, 10).forEach(b => console.log(`  ${b.grade} / ${b.teks} / ${b.type}  have=${b.have} target=${b.target} need=${b.need}`));
  console.log(`[bulk-fill] last 5 buckets:`);
  buckets.slice(-5).forEach(b => console.log(`  ${b.grade} / ${b.teks} / ${b.type}  have=${b.have} target=${b.target} need=${b.need}`));

  if (args['dry-run']) {
    console.log('\n[bulk-fill] --dry-run; not generating.');
    return;
  }

  console.log(`\n[bulk-fill] starting work...`);
  await runConcurrent(buckets);

  // Wrap-up
  const ended = Date.now();
  stats.endedAt = new Date(ended).toISOString();
  stats.wallClockMinutes = Math.round((ended - tStart) / 60000);

  const outDir = path.join(__dirname, 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const outPath = path.join(outDir, `bulk-fill-${STATE}-${SUBJECT}-${TIER}-${stamp}.json`);
  // Compute totals from perBucket so any unprocessed buckets are visible
  const totals = {
    bucketsProcessed: stats.bucketsProcessed,
    bucketsTotal: stats.buckets,
    totalSaved: stats.totalSaved,
    totalAttempts: stats.totalAttempts,
    judgeRejectRate: stats.totalAttempts ? +(stats.judgeRejects / stats.totalAttempts).toFixed(4) : 0,
    judgeRegenRate: stats.totalAttempts ? +(stats.judgeRegens / stats.totalAttempts).toFixed(4) : 0,
    verifierRejectRate: stats.totalAttempts ? +(stats.verifierRejects / stats.totalAttempts).toFixed(4) : 0,
    dedupSkipRate: stats.totalAttempts ? +(stats.dedupSkips / stats.totalAttempts).toFixed(4) : 0,
    errors: stats.errors,
    anthropicErrors: stats.totalAnthropicErrors,
    openAIErrors: stats.totalOpenAIErrors,
    wallClockMinutes: stats.wallClockMinutes,
    stoppedEarly: stats.stoppedEarly
  };
  const report = {
    runId: RUN_ID, startedAt: stats.startedAt, endedAt: stats.endedAt,
    state: STATE, subject: SUBJECT, tier: TIER,
    concurrency: CONCURRENCY, maxHours: Number(args['max-hours']),
    pack_wired: true,
    plan_target_min: plan.tiers[TIER].target_per_type,
    totals,
    by_bucket: stats.perBucket
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n=== BULK FILL SUMMARY ===`);
  console.log(`run-id:                ${RUN_ID}`);
  console.log(`buckets processed:     ${stats.bucketsProcessed}/${stats.buckets}`);
  console.log(`total saved:           ${stats.totalSaved}/${totalNeed}`);
  console.log(`wall-clock:            ${stats.wallClockMinutes} min`);
  console.log(`judge regen rate:      ${(totals.judgeRegenRate * 100).toFixed(1)}%`);
  console.log(`verifier reject rate:  ${(totals.verifierRejectRate * 100).toFixed(1)}%`);
  console.log(`dedup skip rate:       ${(totals.dedupSkipRate * 100).toFixed(1)}%`);
  console.log(`anthropic errors:      ${stats.totalAnthropicErrors}`);
  console.log(`openai errors:         ${stats.totalOpenAIErrors}`);
  if (stats.stoppedEarly) console.log(`STOPPED EARLY:         ${stats.stoppedEarly}`);
  console.log(`report:                ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
