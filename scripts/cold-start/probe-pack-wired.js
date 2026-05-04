#!/usr/bin/env node
/**
 * Pack-wired probe runner (CLAUDE.md §35).
 *
 * Reads the §35 coverage-audit `probe-target-teks.json`, generates exactly
 * `--per-teks` (default 4) questions per TEKS using the existing
 * generators.generateOne pipeline (judge + verifier active), and saves to
 * the lake with a `_probeRunId` stamp for selective rollback.
 *
 * Pins the TEKS via the new `teksOverride` arg on generateOne, so the
 * probe exercises the specific buckets the gap report flagged — not the
 * default random pick.
 *
 * Usage:
 *   COLD_START_PROBE_RUN_ID=pack-wired-coverage-fill-grade-mix-<UTC> \
 *   node probe-pack-wired.js --target-list output/probe-target-teks.json
 *
 * Prints per-question logs + a final summary. Output JSON saved to
 * `output/pack-wired-probe-<UTC>.json` with the per-row classification.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['target-list'],
  default: { 'target-list': 'output/probe-target-teks.json', 'per-teks': 4 }
});

const lake = require('./lake-client');
const { generateOne, QUESTION_TYPE_PROMPTS } = require('./generators');
const { validateStateSpecificity } = require('./state-guardrail');
const { verifyMath } = require('./verifier');

const STATE = 'texas';
const SUBJECT = 'math';

function poolKeyOf(grade, type) {
  return `${STATE}#${grade}#${SUBJECT}#teks-${type}`;
}

async function generateForTeks(target, runId) {
  const { grade, teks, type } = target;
  const perTeks = Number(args['per-teks']);
  console.log(`\n=== ${grade} / ${teks} / ${type} (${target.tier}, gap=${target.gap}) — generating ${perTeks} questions ===`);

  const out = [];
  let attempts = 0;
  const MAX_ATTEMPTS = perTeks * 5;
  while (out.length < perTeks && attempts < MAX_ATTEMPTS) {
    attempts++;
    try {
      const item = await generateOne({
        state: STATE, grade, subject: SUBJECT, type, teksOverride: teks
      });
      const errs = lake.validateQuestion(item, SUBJECT, grade);
      if (errs.length) {
        console.log(`  [invalid] ${errs[0]}`);
        continue;
      }
      const stateErrs = validateStateSpecificity(item, STATE);
      if (stateErrs.length) {
        console.log(`  [state-reject] ${stateErrs[0]}`);
        continue;
      }
      const v = await verifyMath(item, grade);
      if (!v.ok) {
        console.log(`  [verify-reject] ${v.reason}`);
        continue;
      }
      const seedText = item.passage?.text ? `${item.passage.text} ${item.question}` : item.question;
      const embedding = await lake.computeEmbedding(seedText);
      const contentId = lake.generateId('q');
      const pk = poolKeyOf(grade, type);
      const record = {
        poolKey: pk,
        contentId,
        state: STATE,
        grade,
        subject: SUBJECT,
        questionType: type,
        question: item.question,
        choices: item.choices,
        correctIndex: item.correctIndex,
        explanation: item.explanation,
        passage: null,
        embedding,
        qualityScore: 0.6,
        timesServed: 0, timesCorrect: 0, timesIncorrect: 0, reportedCount: 0,
        reviewStatus: 'unreviewed',
        status: 'active',
        generatedAt: Date.now(),
        generatedBy: 'cold-start-v2',
        promptVersion: 'cold-v2',
        tokensUsed: item._tokensUsed || 0,
        _judge: item._judge || 'unknown',
        teks: item._packTeks || teks,
        _probeRunId: runId
      };
      try {
        await lake.saveQuestion(record);
        process.stdout.write('•');
        out.push(record);
      } catch (saveErr) {
        if (saveErr.name === 'DuplicateError') {
          console.log(`\n  [dedup] ${saveErr.message}`);
          continue;
        }
        throw saveErr;
      }
    } catch (e) {
      console.log(`\n  [error] ${e.message}`);
    }
  }
  console.log(`\n  saved=${out.length}/${perTeks} (attempts=${attempts})`);
  return out;
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set'); process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[probe] ANTHROPIC_API_KEY not set — Claude verifier will fail-open');
  }
  const runId = process.env.COLD_START_PROBE_RUN_ID
    || `pack-wired-coverage-fill-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}`;
  console.log(`probe-run-id: ${runId}`);

  const targets = JSON.parse(fs.readFileSync(args['target-list'], 'utf8'));
  console.log(`targets: ${targets.length}`);
  for (const t of targets) console.log(`  ${t.grade} / ${t.teks} / ${t.type} (${t.tier})`);

  const allRows = [];
  const t0 = Date.now();
  for (const target of targets) {
    const rows = await generateForTeks(target, runId);
    allRows.push(...rows);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z');
  const outPath = path.join(__dirname, 'output', `pack-wired-probe-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify({
    runId, targets, count: allRows.length, items: allRows
  }, null, 2));
  console.log(`\n=== SUMMARY ===`);
  console.log(`probe-run-id:  ${runId}`);
  console.log(`elapsed:       ${elapsed}s`);
  console.log(`targets:       ${targets.length}`);
  console.log(`total saved:   ${allRows.length}`);
  console.log(`output:        ${outPath}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
