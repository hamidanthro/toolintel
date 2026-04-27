#!/usr/bin/env node
/**
 * Cold-start runner (I2).
 *
 *   node run.js --plan
 *       Print the bucket plan and projected token spend. No API calls.
 *   node run.js --preview
 *       Generate ~10% of the plan; do not save (or save with reviewStatus=preview).
 *   node run.js --state texas --subject math --target 50 --concurrency 3
 *       Fill every (grade × question-type) bucket up to --target items.
 *
 * Modes:
 *   --plan       no spend, prints plan
 *   --preview    small sample, optional --no-save
 *   --dry-run    generate but skip DDB save
 *
 * Filters:
 *   --state      texas | california | florida | new-york (default: texas)
 *   --subject    math | reading | both (default: math)
 *   --types      comma-separated subset of question types
 *   --grades     comma-separated subset (e.g. grade-3,grade-4)
 *   --target     items per bucket (default 50)
 *   --concurrency parallel API calls (default 3)
 *   --max        hard cap on total questions for this run
 */
const path = require('path');
const fs = require('fs');
const args = require('minimist')(process.argv.slice(2), {
  boolean: ['plan', 'preview', 'dry-run', 'no-save'],
  string: ['state', 'subject', 'types', 'grades'],
  default: {
    state: 'texas',
    subject: 'math',
    target: 50,
    concurrency: 3
  }
});

const lake = require('./lake-client');
const { generateOne, QUESTION_TYPE_PROMPTS } = require('./generators');

const STATE_GRADES = {
  texas: {
    math:    ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8','algebra-1'],
    reading: ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8']
  },
  california: {
    math:    ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8'],
    reading: ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8']
  },
  florida: {
    math:    ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5','grade-6','grade-7','grade-8','algebra-1','geometry'],
    reading: ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8']
  },
  'new-york': {
    math:    ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8','algebra-1'],
    reading: ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8']
  }
};

// approx tokens per generation (system prompt + JSON output)
const TOKENS_MATH = 700;
const TOKENS_READING = 1100;
// gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output (approx blended $0.40/1M)
const COST_PER_1K = 0.0004;
// embedding cost: $0.02/1M tokens for text-embedding-3-small
const EMBED_COST_PER_1K = 0.00002;

function buildBuckets(state, subjects, gradesFilter, typesFilter) {
  const buckets = [];
  for (const subject of subjects) {
    const grades = STATE_GRADES[state]?.[subject] || [];
    const filteredGrades = gradesFilter ? grades.filter(g => gradesFilter.includes(g)) : grades;
    const types = Object.keys(QUESTION_TYPE_PROMPTS[subject] || {});
    const filteredTypes = typesFilter ? types.filter(t => typesFilter.includes(t)) : types;
    for (const grade of filteredGrades) {
      for (const type of filteredTypes) {
        buckets.push({ state, grade, subject, type });
      }
    }
  }
  return buckets;
}

function poolKeyOf(b) {
  // Mirrors lambda/tutor.js handleGenerate: state#grade#subject#teks-{type}
  return `${b.state}#${b.grade}#${b.subject}#teks-${b.type}`;
}

function projectedSpend(bucketCount, target, subject) {
  const tokens = subject === 'reading' ? TOKENS_READING : TOKENS_MATH;
  const totalGen = bucketCount * target;
  const genCost = (totalGen * tokens / 1000) * COST_PER_1K;
  const embedCost = (totalGen * 200 / 1000) * EMBED_COST_PER_1K;
  return { totalGen, genCost, embedCost, total: genCost + embedCost };
}

async function fillBucket(bucket, target, opts) {
  const pk = poolKeyOf(bucket);
  const existing = await lake.loadExistingPool(pk);
  const existingActive = existing.filter(i => !i.status || i.status === 'active');
  const existingEmbeddings = existingActive.map(i => i.embedding).filter(Boolean);
  const need = Math.max(0, target - existingActive.length);
  if (need === 0) {
    return { bucket: pk, generated: 0, saved: 0, skipped_full: true };
  }

  console.log(`\n  ${pk}  (have ${existingActive.length}, need ${need})`);
  let generated = 0, saved = 0, validationFails = 0, dedupSkips = 0, errors = 0;

  // Sequential within bucket; concurrency is across buckets (handled in main loop)
  let attempts = 0;
  const MAX_ATTEMPTS = need * 2;
  const newEmbeddings = [...existingEmbeddings];

  while (saved < need && attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const item = await generateOne(bucket);
      generated++;
      const errs = lake.validateQuestion(item, bucket.subject, bucket.grade);
      if (errs.length) { validationFails++; continue; }

      const seedText = item.passage?.text
        ? `${item.passage.text} ${item.question}`
        : item.question;
      const embedding = await lake.computeEmbedding(seedText);

      const tooSimilar = newEmbeddings.some(e => lake.cosineSim(embedding, e) >= lake.DEDUP_THRESHOLD);
      if (tooSimilar) { dedupSkips++; continue; }

      const contentId = lake.generateId('q');
      const record = {
        poolKey: pk,
        contentId,
        state: bucket.state,
        grade: bucket.grade,
        subject: bucket.subject,
        questionType: bucket.type,
        question: item.question,
        choices: item.choices,
        correctIndex: item.correctIndex,
        explanation: item.explanation,
        passage: item.passage || null,
        embedding,
        qualityScore: 0.6,
        timesServed: 0,
        timesCorrect: 0,
        timesIncorrect: 0,
        reportedCount: 0,
        reviewStatus: opts.preview ? 'preview' : 'unreviewed',
        status: 'active',
        generatedAt: Date.now(),
        generatedBy: 'cold-start-v1',
        promptVersion: item._promptVersion || 'cold-v1',
        tokensUsed: item._tokensUsed || 0
      };

      if (opts.dryRun) {
        process.stdout.write('.');
      } else {
        await lake.saveQuestion(record);
        process.stdout.write('•');
      }
      saved++;
      newEmbeddings.push(embedding);

    } catch (err) {
      errors++;
      console.error(`\n    error: ${err.message}`);
    }
  }
  console.log(`\n    generated=${generated} saved=${saved} dedup=${dedupSkips} invalid=${validationFails} errors=${errors}`);
  return { bucket: pk, generated, saved, dedupSkips, validationFails, errors };
}

async function main() {
  const subjects = args.subject === 'both' ? ['math', 'reading'] : [args.subject];
  const gradesFilter = args.grades ? args.grades.split(',').map(s => s.trim()) : null;
  const typesFilter = args.types ? args.types.split(',').map(s => s.trim()) : null;
  const target = Number(args.target);
  const concurrency = Math.max(1, Number(args.concurrency));
  const buckets = buildBuckets(args.state, subjects, gradesFilter, typesFilter);

  console.log(`\nState:        ${args.state}`);
  console.log(`Subjects:     ${subjects.join(', ')}`);
  console.log(`Buckets:      ${buckets.length}`);
  console.log(`Target/bucket:${target}`);
  console.log(`Concurrency:  ${concurrency}`);

  for (const subject of subjects) {
    const sb = buckets.filter(b => b.subject === subject);
    if (!sb.length) continue;
    const proj = projectedSpend(sb.length, target, subject);
    console.log(`\n  ${subject}: ${sb.length} buckets × ${target} = ${proj.totalGen} questions`);
    console.log(`    projected gen cost:   $${proj.genCost.toFixed(3)}`);
    console.log(`    projected embed cost: $${proj.embedCost.toFixed(4)}`);
    console.log(`    total approx:         $${proj.total.toFixed(3)}`);
  }

  if (args.plan) {
    console.log('\n--plan only. No work done. Add --preview or remove --plan to run.');
    console.log('\nSample buckets:');
    buckets.slice(0, 8).forEach(b => console.log('  ' + poolKeyOf(b)));
    if (buckets.length > 8) console.log(`  ... and ${buckets.length - 8} more`);
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error('\n❌ OPENAI_API_KEY not set in environment. Aborting.');
    process.exit(1);
  }

  const effectiveTarget = args.preview ? Math.max(3, Math.ceil(target * 0.1)) : target;
  console.log(`\nEffective target/bucket: ${effectiveTarget}${args.preview ? '  (PREVIEW)' : ''}`);
  if (args.dryRun) console.log('DRY RUN — items generated but not saved to DynamoDB.');

  const opts = { preview: !!args.preview, dryRun: !!args['dry-run'] };
  const results = [];
  let max = args.max ? Number(args.max) : Infinity;
  let totalSaved = 0;

  // Simple concurrency: process N buckets at a time
  for (let i = 0; i < buckets.length; i += concurrency) {
    const slice = buckets.slice(i, i + concurrency);
    const sliceResults = await Promise.all(slice.map(b => fillBucket(b, effectiveTarget, opts)));
    sliceResults.forEach(r => {
      results.push(r);
      totalSaved += r.saved;
    });
    if (totalSaved >= max) {
      console.log(`\nReached --max ${max}. Stopping early.`);
      break;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Buckets processed: ${results.length}`);
  console.log(`Total saved:       ${results.reduce((a, r) => a + (r.saved || 0), 0)}`);
  console.log(`Total dedup skip:  ${results.reduce((a, r) => a + (r.dedupSkips || 0), 0)}`);
  console.log(`Total invalid:     ${results.reduce((a, r) => a + (r.validationFails || 0), 0)}`);
  console.log(`Total errors:      ${results.reduce((a, r) => a + (r.errors || 0), 0)}`);

  // Persist run log
  const logDir = path.join(__dirname, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `run-${Date.now()}.json`);
  fs.writeFileSync(logFile, JSON.stringify({ args, results }, null, 2));
  console.log(`\nLog: ${logFile}`);
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
