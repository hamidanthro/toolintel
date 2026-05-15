#!/usr/bin/env node
/**
 * §110 phase 9 — number-line stimulus probe.
 *
 * Generates fraction-on-a-number-line questions:
 *  - stimulus: number-line widget with one marker
 *  - choices: 4 text fractions
 *  - correctIndex points at the fraction matching the marker
 *
 * Usage:
 *   OPENAI_API_KEY=... node scripts/cold-start/probe-widgets-numberline.js \
 *     --count 25 --teks 3.3B --grade grade-3
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['teks'],
  default: { count: 25, teks: '3.3B', grade: 'grade-3' }
});

const lake = require('./lake-client');
const { generateOne } = require('./generators');

const STATE = 'texas';
const SUBJECT = 'math';
const GRADE = String(args.grade);
const TEKS = String(args.teks);
const TARGET_COUNT = parseInt(args.count, 10) || 25;
const RUN_ID = process.env.COLD_START_PROBE_RUN_ID || ('widget-probe-nl-' + new Date().toISOString().replace(/[:.]/g, '-'));
const QUESTION_TYPE = 'concept';
const WIDGET_MODE = 'number-line-stimulus';

function poolKey() {
  return `${STATE}#${GRADE}#${SUBJECT}#teks-${QUESTION_TYPE}`;
}

async function main() {
  console.log('[probe-nl] starting');
  console.log('[probe-nl] target=' + TARGET_COUNT + ' state=' + STATE + ' grade=' + GRADE + ' teks=' + TEKS + ' widgetMode=' + WIDGET_MODE);
  console.log('[probe-nl] runId=' + RUN_ID);

  const startedAt = Date.now();
  const results = [];
  let saved = 0, judgeRejTwice = 0, schemaRej = 0, otherErr = 0;
  let attempts = 0;

  while (saved < TARGET_COUNT) {
    attempts++;
    if (attempts > TARGET_COUNT * 4) {
      console.warn('[probe-nl] hit 4x attempt ceiling — stopping');
      break;
    }
    try {
      const q = await generateOne({
        state: STATE,
        grade: GRADE,
        subject: SUBJECT,
        type: QUESTION_TYPE,
        teksOverride: TEKS,
        widgetMode: WIDGET_MODE
      });

      // Sanity shape check
      if (!q.stimulus || q.stimulus.type !== 'number-line') {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'stimulus not number-line', q });
        continue;
      }
      if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'choices not 4', q });
        continue;
      }
      const allStrings = q.choices.every(c => typeof c === 'string');
      if (!allStrings) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'choices not all strings' });
        continue;
      }

      const contentId = lake.generateId('q');
      const pk = poolKey();
      const record = {
        poolKey: pk,
        contentId,
        state: STATE,
        grade: GRADE,
        subject: SUBJECT,
        questionType: 'teks-' + QUESTION_TYPE,
        question: q.question,
        stimulus: q.stimulus,
        choices: q.choices,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        passage: null,
        embedding: [],
        qualityScore: 0.6,
        timesServed: 0, timesCorrect: 0, timesIncorrect: 0, reportedCount: 0,
        reviewStatus: 'unreviewed',
        status: 'active',
        generatedAt: Date.now(),
        generatedBy: 'cold-start-widget',
        promptVersion: q._promptVersion || 'cold-v1-widget-nl',
        tokensUsed: q._tokensUsed || 0,
        _judge: q._judge || 'unknown',
        teks: q._packTeks || TEKS,
        _widgetMode: WIDGET_MODE,
        _probeRunId: RUN_ID
      };
      try {
        await lake.saveQuestion(record);
        saved++;
        results.push({
          status: 'saved',
          contentId,
          judge: q._judge || 'unknown',
          question: q.question,
          stimulus: q.stimulus,
          choices: q.choices,
          correctIndex: q.correctIndex,
          explanation: q.explanation
        });
        console.log('[probe-nl] +' + saved + '/' + TARGET_COUNT + ' contentId=' + contentId);
      } catch (saveErr) {
        if (saveErr && saveErr.name === 'DuplicateError') {
          // skip
        } else {
          otherErr++;
          results.push({ status: 'save-fail', name: saveErr && saveErr.name, message: (saveErr && saveErr.message || '').slice(0, 200) });
          console.warn('[probe-nl] save failed:', saveErr && saveErr.message);
        }
      }
    } catch (err) {
      if (err && err.name === 'JudgeRejectedTwiceError') {
        judgeRejTwice++;
        results.push({ status: 'judge-reject-twice', firstReasons: err.firstReasons, secondReasons: err.secondReasons });
      } else {
        otherErr++;
        results.push({ status: 'error', name: err.name, message: err.message });
        console.warn('[probe-nl] error:', err.name, err.message);
      }
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const summary = {
    runId: RUN_ID, state: STATE, grade: GRADE, teks: TEKS,
    widgetMode: WIDGET_MODE, target: TARGET_COUNT, attempts, saved,
    judgeRejectedTwice: judgeRejTwice, otherErrors: otherErr,
    elapsedSeconds: elapsed
  };

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'probe-widgets-nl-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log('\n[probe-nl] ----- SUMMARY -----');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[probe-nl] output: ' + outFile);
}

main().catch(err => { console.error('[probe-nl] FATAL', err); process.exit(1); });
