#!/usr/bin/env node
/**
 * §110 phase 11 — area-model multiplication stimulus probe (TEKS 4.4D).
 *
 *   OPENAI_API_KEY=... node scripts/cold-start/probe-widgets-areamodel.js \
 *     --count 20 --teks 4.4D --grade grade-4
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['teks'],
  default: { count: 20, teks: '4.4D', grade: 'grade-4' }
});

const lake = require('./lake-client');
const { generateOne } = require('./generators');

const STATE = 'texas';
const SUBJECT = 'math';
const GRADE = String(args.grade);
const TEKS = String(args.teks);
const TARGET_COUNT = parseInt(args.count, 10) || 20;
const RUN_ID = process.env.COLD_START_PROBE_RUN_ID || ('widget-am-' + new Date().toISOString().replace(/[:.]/g, '-'));
const QUESTION_TYPE = 'computation';
const WIDGET_MODE = 'area-model-stimulus';

function poolKey() {
  return `${STATE}#${GRADE}#${SUBJECT}#teks-${QUESTION_TYPE}`;
}

async function main() {
  console.log('[probe-am] target=' + TARGET_COUNT + ' state=' + STATE + ' grade=' + GRADE + ' teks=' + TEKS);
  console.log('[probe-am] runId=' + RUN_ID);

  const startedAt = Date.now();
  const results = [];
  let saved = 0, judgeRejTwice = 0, otherErr = 0;
  let attempts = 0;

  while (saved < TARGET_COUNT) {
    attempts++;
    if (attempts > TARGET_COUNT * 4) {
      console.warn('[probe-am] hit 4x attempt ceiling — stopping');
      break;
    }
    try {
      const q = await generateOne({
        state: STATE, grade: GRADE, subject: SUBJECT,
        type: QUESTION_TYPE, teksOverride: TEKS, widgetMode: WIDGET_MODE
      });
      if (!q.stimulus || q.stimulus.type !== 'area-model') {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'stimulus not area-model' });
        continue;
      }
      if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'choices not 4' });
        continue;
      }
      // Sanity check the math: sum(rows) * sum(cols) must equal the
      // marked-correct choice (as parsed integer).
      const sumRows = (q.stimulus.rows || []).reduce((a,b) => a + b, 0);
      const sumCols = (q.stimulus.cols || []).reduce((a,b) => a + b, 0);
      const expectedProduct = sumRows * sumCols;
      const markedChoice = parseInt(String(q.choices[q.correctIndex]).replace(/[^0-9-]/g, ''), 10);
      if (!Number.isFinite(markedChoice) || markedChoice !== expectedProduct) {
        otherErr++;
        results.push({ status: 'math-mismatch', sumRows, sumCols, expectedProduct, markedChoice, q });
        continue;
      }

      const contentId = lake.generateId('q');
      const record = {
        poolKey: poolKey(), contentId,
        state: STATE, grade: GRADE, subject: SUBJECT,
        questionType: 'teks-' + QUESTION_TYPE,
        question: q.question, stimulus: q.stimulus, choices: q.choices,
        correctIndex: q.correctIndex, explanation: q.explanation, passage: null,
        embedding: [], qualityScore: 0.6,
        timesServed: 0, timesCorrect: 0, timesIncorrect: 0, reportedCount: 0,
        reviewStatus: 'unreviewed', status: 'active',
        generatedAt: Date.now(), generatedBy: 'cold-start-widget',
        promptVersion: q._promptVersion || 'cold-v1-widget-am',
        tokensUsed: q._tokensUsed || 0,
        _judge: q._judge || 'unknown', teks: q._packTeks || TEKS,
        _widgetMode: WIDGET_MODE, _probeRunId: RUN_ID
      };
      try {
        await lake.saveQuestion(record);
        saved++;
        results.push({ status: 'saved', contentId, judge: q._judge || 'unknown',
          question: q.question, stimulus: q.stimulus, choices: q.choices,
          correctIndex: q.correctIndex, explanation: q.explanation });
        console.log('[probe-am] +' + saved + '/' + TARGET_COUNT + ' contentId=' + contentId);
      } catch (saveErr) {
        otherErr++;
        results.push({ status: 'save-fail', message: (saveErr && saveErr.message || '').slice(0, 200) });
      }
    } catch (err) {
      if (err && err.name === 'JudgeRejectedTwiceError') {
        judgeRejTwice++;
        results.push({ status: 'judge-reject-twice', firstReasons: err.firstReasons, secondReasons: err.secondReasons });
      } else {
        otherErr++;
        results.push({ status: 'error', name: err.name, message: err.message });
      }
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const summary = { runId: RUN_ID, state: STATE, grade: GRADE, teks: TEKS,
    widgetMode: WIDGET_MODE, target: TARGET_COUNT, attempts, saved,
    judgeRejectedTwice: judgeRejTwice, otherErrors: otherErr, elapsedSeconds: elapsed };

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'probe-widgets-am-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log('\n[probe-am] ----- SUMMARY -----');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[probe-am] output: ' + outFile);
}

main().catch(err => { console.error('[probe-am] FATAL', err); process.exit(1); });
