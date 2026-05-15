#!/usr/bin/env node
/**
 * §110 phase 10 — plotter (bar graph) stimulus probe.
 *
 *   OPENAI_API_KEY=... node scripts/cold-start/probe-widgets-plotter.js \
 *     --count 20 --teks 3.8A --grade grade-3
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['teks'],
  default: { count: 20, teks: '3.8A', grade: 'grade-3' }
});

const lake = require('./lake-client');
const { generateOne } = require('./generators');
const { check: correctnessCheck } = require('./widget-correctness-check');

const STATE = 'texas';
const SUBJECT = 'math';
const GRADE = String(args.grade);
const TEKS = String(args.teks);
const TARGET_COUNT = parseInt(args.count, 10) || 20;
const RUN_ID = process.env.COLD_START_PROBE_RUN_ID || ('widget-plotter-' + new Date().toISOString().replace(/[:.]/g, '-'));
const QUESTION_TYPE = 'data-interpretation';
const WIDGET_MODE = 'plotter-stimulus';

function poolKey() {
  return `${STATE}#${GRADE}#${SUBJECT}#teks-${QUESTION_TYPE}`;
}

async function main() {
  console.log('[probe-plot] target=' + TARGET_COUNT + ' state=' + STATE + ' grade=' + GRADE + ' teks=' + TEKS + ' widgetMode=' + WIDGET_MODE);
  console.log('[probe-plot] runId=' + RUN_ID);

  const startedAt = Date.now();
  const results = [];
  let saved = 0, judgeRejTwice = 0, otherErr = 0;
  let attempts = 0;

  while (saved < TARGET_COUNT) {
    attempts++;
    if (attempts > TARGET_COUNT * 4) {
      console.warn('[probe-plot] hit 4x attempt ceiling — stopping');
      break;
    }
    try {
      const q = await generateOne({
        state: STATE, grade: GRADE, subject: SUBJECT,
        type: QUESTION_TYPE, teksOverride: TEKS, widgetMode: WIDGET_MODE
      });
      if (!q.stimulus || q.stimulus.type !== 'plotter') {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'stimulus not plotter', q });
        continue;
      }
      if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'choices not 4' });
        continue;
      }

      // §110 phase-20e — deterministic correctness check BEFORE save.
      const ccVerdict = correctnessCheck({ question: q.question, stimulus: q.stimulus, choices: q.choices, correctIndex: q.correctIndex });
      if (!ccVerdict.ok) {
        otherErr++;
        results.push({ status: 'correctness-fail', bug: ccVerdict.bug, reason: ccVerdict.reason, question: q.question });
        console.warn('[probe-plot] correctness-fail ' + ccVerdict.bug + ': ' + ccVerdict.reason);
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
        promptVersion: q._promptVersion || 'cold-v1-widget-plotter',
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
        console.log('[probe-plot] +' + saved + '/' + TARGET_COUNT + ' contentId=' + contentId);
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
  const outFile = path.join(outDir, 'probe-widgets-plotter-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log('\n[probe-plot] ----- SUMMARY -----');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[probe-plot] output: ' + outFile);
}

main().catch(err => { console.error('[probe-plot] FATAL', err); process.exit(1); });
