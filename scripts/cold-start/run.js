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
 *   --state         single state slug (default: texas)
 *   --all-states    process every state in js/states-data.js
 *   --exclude       comma-separated state slugs to skip (only with --all-states)
 *   --resume-from   start at this state slug (only with --all-states)
 *   --cost-ceiling  halt before exceeding this projected $ spend (default: 50)
 *   --subject       math | reading | both (default: math)
 *   --types         comma-separated subset of question types
 *   --grades        comma-separated subset (e.g. grade-3,grade-4)
 *   --target        items per bucket (default 50)
 *   --concurrency   parallel API calls (default 3)
 *   --max           hard cap on total questions for this run
 */
const path = require('path');
const fs = require('fs');
const args = require('minimist')(process.argv.slice(2), {
  boolean: ['plan', 'preview', 'dry-run', 'no-save', 'all-states'],
  string: ['state', 'subject', 'types', 'grades', 'exclude', 'resume-from'],
  default: {
    state: 'texas',
    subject: 'math',
    target: 50,
    concurrency: 3,
    'cost-ceiling': 50
  }
});

const lake = require('./lake-client');
const { generateOne, QUESTION_TYPE_PROMPTS } = require('./generators');
const { gradesForState, ALL_STATE_SLUGS } = require('./states-grades');
const { validateStateSpecificity } = require('./state-guardrail');
const { verifyMath } = require('./verifier');

// approx tokens per generation (system prompt + JSON output)
const TOKENS_MATH = 700;
const TOKENS_READING = 1100;
// gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output (approx blended $0.40/1M)
const COST_PER_1K = 0.0004;
// embedding cost: $0.02/1M tokens for text-embedding-3-small
const EMBED_COST_PER_1K = 0.00002;

function buildBuckets(states, subjects, gradesFilter, typesFilter) {
  const buckets = [];
  for (const state of states) {
    for (const subject of subjects) {
      const grades = gradesForState(state, subject);
      const filteredGrades = gradesFilter ? grades.filter(g => gradesFilter.includes(g)) : grades;
      const types = Object.keys(QUESTION_TYPE_PROMPTS[subject] || {});
      const filteredTypes = typesFilter ? types.filter(t => typesFilter.includes(t)) : types;
      for (const grade of filteredGrades) {
        for (const type of filteredTypes) {
          buckets.push({ state, grade, subject, type });
        }
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
    return { bucket: pk, generated: 0, saved: 0, skipped_full: true, tokensUsed: 0 };
  }

  console.log(`\n  ${pk}  (have ${existingActive.length}, need ${need})`);
  let generated = 0, saved = 0, validationFails = 0, stateRejects = 0, verifyRejects = 0, dedupSkips = 0, errors = 0;
  let tokensUsed = 0;

  // Sequential within bucket; concurrency is across buckets (handled in main loop)
  let attempts = 0;
  // Allow more attempts since we now have an additional rejection path (state-specificity).
  const MAX_ATTEMPTS = Math.max(need * 4, 8);
  const newEmbeddings = [...existingEmbeddings];

  while (saved < need && attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const item = await generateOne(bucket);
      generated++;
      tokensUsed += (item._tokensUsed || 0);
      const errs = lake.validateQuestion(item, bucket.subject, bucket.grade);
      if (errs.length) {
        validationFails++;
        if (validationFails <= 2) console.log(`\n    [invalid ${bucket.state}] ${errs[0]}`);
        continue;
      }
      const stateErrs = validateStateSpecificity(item, bucket.state);
      if (stateErrs.length) {
        stateRejects++;
        if (stateRejects <= 2) console.log(`\n    [state-reject ${bucket.state}] ${stateErrs[0]}`);
        continue;
      }

      // Math second-pass verifier (gpt-4o solves it independently).
      if (bucket.subject === 'math') {
        const v = await verifyMath(item, bucket.grade);
        if (!v.ok) {
          verifyRejects++;
          if (verifyRejects <= 3) console.log(`\n    [verify-reject ${bucket.state}/${bucket.grade}] ${v.reason}`);
          continue;
        }
      }

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
        generatedBy: 'cold-start-v2',
        promptVersion: 'cold-v2',
        tokensUsed: item._tokensUsed || 0,
        // Forward judge verdict from generateOne for traceability
        // (pass | pass-after-regen | unknown if judge disabled).
        _judge: item._judge || 'unknown'
      };
      // Tag this run if a probe-run-id is set — lets us find/restore
      // these specific rows later. See CLAUDE.md §29.
      if (process.env.COLD_START_PROBE_RUN_ID) {
        record._probeRunId = process.env.COLD_START_PROBE_RUN_ID;
      }
      // Same stamp pattern for sweep runs — see CLAUDE.md §31.
      if (process.env.COLD_START_SWEEP_RUN_ID) {
        record._sweepRunId = process.env.COLD_START_SWEEP_RUN_ID;
      }

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
  console.log(`\n    generated=${generated} saved=${saved} dedup=${dedupSkips} invalid=${validationFails} state-reject=${stateRejects} verify-reject=${verifyRejects} errors=${errors} tokens=${tokensUsed}`);
  return { bucket: pk, state: bucket.state, generated, saved, dedupSkips, validationFails, stateRejects, verifyRejects, errors, tokensUsed };
}

async function main() {
  const subjects = args.subject === 'both' ? ['math', 'reading'] : [args.subject];
  const gradesFilter = args.grades ? args.grades.split(',').map(s => s.trim()) : null;
  const typesFilter = args.types ? args.types.split(',').map(s => s.trim()) : null;
  const target = Number(args.target);
  const concurrency = Math.max(1, Number(args.concurrency));
  const costCeiling = parseFloat(args['cost-ceiling']);

  // Resolve state list
  const exclude = args.exclude ? String(args.exclude).split(',').map(s => s.trim()).filter(Boolean) : [];
  let statesToProcess;
  if (args['all-states']) {
    statesToProcess = ALL_STATE_SLUGS.filter(s => !exclude.includes(s));
    if (args['resume-from']) {
      const idx = statesToProcess.indexOf(args['resume-from']);
      if (idx === -1) {
        console.error(`--resume-from "${args['resume-from']}" not in remaining state list`);
        process.exit(1);
      }
      statesToProcess = statesToProcess.slice(idx);
    }
  } else {
    statesToProcess = [args.state];
  }
  if (!statesToProcess.length) {
    console.error('No states to process. Check --exclude / --resume-from.');
    process.exit(1);
  }

  const buckets = buildBuckets(statesToProcess, subjects, gradesFilter, typesFilter);

  console.log(`\nStates:        ${statesToProcess.length}${args['all-states'] ? ' (all-states mode)' : ''}`);
  if (statesToProcess.length <= 10) {
    console.log(`               ${statesToProcess.join(', ')}`);
  }
  console.log(`Subjects:      ${subjects.join(', ')}`);
  console.log(`Buckets:       ${buckets.length}`);
  console.log(`Target/bucket: ${target}`);
  console.log(`Total questions: ${buckets.length * target}`);
  console.log(`Concurrency:   ${concurrency}`);
  console.log(`Cost ceiling:  $${costCeiling.toFixed(2)}`);

  for (const subject of subjects) {
    const sb = buckets.filter(b => b.subject === subject);
    if (!sb.length) continue;
    const proj = projectedSpend(sb.length, target, subject);
    console.log(`\n  ${subject}: ${sb.length} buckets × ${target} = ${proj.totalGen} questions`);
    console.log(`    projected gen cost:   $${proj.genCost.toFixed(3)}`);
    console.log(`    projected embed cost: $${proj.embedCost.toFixed(4)}`);
    console.log(`    total approx:         $${proj.total.toFixed(3)}`);
  }

  // Total projected spend across subjects
  const totalProjected = subjects.reduce((acc, subj) => {
    const sb = buckets.filter(b => b.subject === subj);
    return acc + projectedSpend(sb.length, target, subj).total;
  }, 0);
  console.log(`\nTOTAL projected spend: $${totalProjected.toFixed(3)}`);
  if (totalProjected > costCeiling) {
    console.log(`⚠ Projected spend exceeds --cost-ceiling $${costCeiling.toFixed(2)}.`);
  }

  if (args.plan) {
    console.log('\n--plan only. No work done. Add --preview or remove --plan to run.');
    console.log('\nSample buckets:');
    buckets.slice(0, 8).forEach(b => console.log('  ' + poolKeyOf(b)));
    if (buckets.length > 8) console.log(`  ... and ${buckets.length - 8} more`);
    return;
  }

  if (totalProjected > costCeiling) {
    console.error(`\n❌ Aborting: projected $${totalProjected.toFixed(2)} exceeds --cost-ceiling $${costCeiling.toFixed(2)}. Raise --cost-ceiling or shrink scope.`);
    process.exit(1);
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
  let totalTokens = 0;
  // Blended chat-completion price (gpt-4o-mini): $0.15 input + $0.60 output / 1M tokens.
  // Approx 0.40/1M blended for our 700-1100 token responses.
  const COST_PER_TOKEN = 0.40 / 1_000_000;
  let halted = false;
  let resumeState = null;

  // Simple concurrency: process N buckets at a time
  for (let i = 0; i < buckets.length; i += concurrency) {
    const slice = buckets.slice(i, i + concurrency);
    const sliceResults = await Promise.all(slice.map(b => fillBucket(b, effectiveTarget, opts)));
    sliceResults.forEach(r => {
      results.push(r);
      totalSaved += (r.saved || 0);
      totalTokens += (r.tokensUsed || 0);
    });

    const currentCost = totalTokens * COST_PER_TOKEN;
    if (currentCost >= costCeiling) {
      const nextIdx = i + concurrency;
      const nextBucket = buckets[nextIdx];
      resumeState = nextBucket ? nextBucket.state : null;
      console.log(`\n⚠  COST CEILING REACHED: $${currentCost.toFixed(2)} ≥ $${costCeiling.toFixed(2)} (${totalTokens.toLocaleString()} tokens). Halting.`);
      if (resumeState) {
        const sameStateAhead = buckets.slice(nextIdx).filter(b => b.state === resumeState).length;
        console.log(`   To resume the remaining work, raise --cost-ceiling and re-run with: --resume-from ${resumeState}`);
        console.log(`   (${buckets.length - nextIdx} buckets remain across ${new Set(buckets.slice(nextIdx).map(b=>b.state)).size} state(s); ${sameStateAhead} in ${resumeState}.)`);
      } else {
        console.log('   All buckets processed; ceiling reached on the final slice.');
      }
      halted = true;
      break;
    }

    if (totalSaved >= max) {
      console.log(`\nReached --max ${max}. Stopping early.`);
      break;
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Buckets processed: ${results.length}${halted ? ' (HALTED early)' : ''}`);
  console.log(`Total saved:       ${results.reduce((a, r) => a + (r.saved || 0), 0)}`);
  console.log(`Total dedup skip:  ${results.reduce((a, r) => a + (r.dedupSkips || 0), 0)}`);
  console.log(`Total invalid:     ${results.reduce((a, r) => a + (r.validationFails || 0), 0)}`);
  console.log(`Total errors:      ${results.reduce((a, r) => a + (r.errors || 0), 0)}`);
  console.log(`Total tokens:      ${totalTokens.toLocaleString()}`);
  console.log(`Approx spend:      $${(totalTokens * COST_PER_TOKEN).toFixed(3)}`);
  if (halted && resumeState) {
    console.log(`Resume hint:       --resume-from ${resumeState}`);
  }

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
