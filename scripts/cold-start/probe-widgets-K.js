#!/usr/bin/env node
/**
 * §110 phase 16 — Kindergarten widget probe.
 *
 * Generates K-appropriate counting items: base-10-blocks restricted
 * to ones (counting 1-10) and clock-face whole hours.
 *
 *   OPENAI_API_KEY=... node scripts/cold-start/probe-widgets-K.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const lake = require('./lake-client');
const { generateOne } = require('./generators');
const STATE = 'texas';
const SUBJECT = 'math';
const GRADE = 'grade-k';
const RUN_ID = process.env.COLD_START_PROBE_RUN_ID || ('widget-K-' + new Date().toISOString().replace(/[:.]/g, '-'));

async function probe(widgetMode, teks, questionType, target, validateFn) {
  console.log(`\n=== Probing widgetMode=${widgetMode} teks=${teks} target=${target} ===`);
  const results = [];
  let saved = 0, attempts = 0;
  const poolKey = `${STATE}#${GRADE}#${SUBJECT}#teks-${questionType}`;

  while (saved < target && attempts < target * 4) {
    attempts++;
    try {
      const q = await generateOne({
        state: STATE, grade: GRADE, subject: SUBJECT,
        type: questionType, teksOverride: teks, widgetMode
      });
      if (!validateFn(q)) {
        console.log('  [skip] failed K-appropriate filter');
        continue;
      }

      const contentId = lake.generateId('q');
      const record = {
        poolKey, contentId,
        state: STATE, grade: GRADE, subject: SUBJECT,
        questionType: 'teks-' + questionType,
        question: q.question, stimulus: q.stimulus, choices: q.choices,
        correctIndex: q.correctIndex, explanation: q.explanation, passage: null,
        embedding: [], qualityScore: 0.6,
        timesServed: 0, timesCorrect: 0, timesIncorrect: 0, reportedCount: 0,
        reviewStatus: 'unreviewed', status: 'active',
        generatedAt: Date.now(), generatedBy: 'cold-start-widget',
        promptVersion: q._promptVersion || 'cold-v1-widget-K',
        tokensUsed: q._tokensUsed || 0,
        _judge: q._judge || 'unknown', teks: q._packTeks || teks,
        _widgetMode: widgetMode, _probeRunId: RUN_ID
      };
      try {
        await lake.saveQuestion(record);
        saved++;
        results.push({ status: 'saved', contentId, stimulus: q.stimulus, choices: q.choices });
        console.log(`  +${saved}/${target} ${contentId}`);
      } catch (saveErr) {
        results.push({ status: 'save-fail', message: (saveErr && saveErr.message || '').slice(0,200) });
      }
    } catch (err) {
      if (err && err.name === 'JudgeRejectedTwiceError') {
        results.push({ status: 'judge-reject-twice', first: err.firstReasons, second: err.secondReasons });
      } else {
        results.push({ status: 'error', name: err.name, message: err.message });
      }
    }
  }
  console.log(`  done: ${saved}/${target} saved over ${attempts} attempts`);
  return { widgetMode, teks, target, saved, attempts, results };
}

async function main() {
  console.log('[probe-K] starting, runId=' + RUN_ID);

  // Base-10-blocks: K-appropriate only when h===0 && t===0 (just ones).
  // We sit in the same widgetMode, but reject anything > 9 in the stimulus.
  const b10 = await probe(
    'base-10-blocks-stimulus', 'K.2A', 'concept', 15,
    q => q.stimulus && q.stimulus.hundreds === 0 && q.stimulus.tens === 0 && q.stimulus.ones >= 1
  );

  // Clock-face: K-appropriate = whole hour only (minute=0).
  const cf = await probe(
    'clock-face-stimulus', 'K.3', 'concept', 15,
    q => q.stimulus && q.stimulus.minute === 0
  );

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'probe-widgets-K-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ b10, cf }, null, 2));
  console.log('\n[probe-K] output:', outFile);
  console.log(`[probe-K] TOTAL saved: ${b10.saved + cf.saved}`);
}

main().catch(err => { console.error(err); process.exit(1); });
