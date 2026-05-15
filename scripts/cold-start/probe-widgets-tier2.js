#!/usr/bin/env node
/**
 * §110 phase 14 — generic Tier-2 widget probe runner.
 *
 * Works for any stimulus-widget mode (tape-diagram, base-10-blocks,
 * shape-2d, clock-face). Drives the right widgetMode + poolKey based
 * on --kind.
 *
 *   OPENAI_API_KEY=... node scripts/cold-start/probe-widgets-tier2.js \
 *     --kind tape-diagram --count 15 --teks 3.5B --grade grade-3
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['kind', 'teks'],
  default: { count: 15, kind: 'tape-diagram' }
});

const lake = require('./lake-client');
const { generateOne } = require('./generators');
const { check: correctnessCheck } = require('./widget-correctness-check');

const KIND_CONFIG = {
  'tape-diagram': {
    widgetMode: 'tape-diagram-stimulus',
    questionType: 'word-problem',
    expectedStimulusType: 'tape-diagram',
    teksDefault: '3.5B',
    gradeDefault: 'grade-3'
  },
  'base-10-blocks': {
    widgetMode: 'base-10-blocks-stimulus',
    questionType: 'concept',
    expectedStimulusType: 'base-10-blocks',
    teksDefault: '3.4A',
    gradeDefault: 'grade-3'
  },
  'shape-2d': {
    widgetMode: 'shape-2d-stimulus',
    questionType: 'computation',
    expectedStimulusType: 'shape-2d',
    teksDefault: '4.5D',
    gradeDefault: 'grade-4'
  },
  'clock-face': {
    widgetMode: 'clock-face-stimulus',
    questionType: 'concept',
    expectedStimulusType: 'clock-face',
    teksDefault: '2.9G',
    gradeDefault: 'grade-2'
  }
};

const KIND = args.kind;
if (!KIND_CONFIG[KIND]) {
  console.error('Unknown --kind. Valid: ' + Object.keys(KIND_CONFIG).join(', '));
  process.exit(1);
}
const cfg = KIND_CONFIG[KIND];

const STATE = 'texas';
const SUBJECT = 'math';
const GRADE = String(args.grade || cfg.gradeDefault);
const TEKS = String(args.teks || cfg.teksDefault);
const QUESTION_TYPE = cfg.questionType;
const WIDGET_MODE = cfg.widgetMode;
const TARGET_COUNT = parseInt(args.count, 10) || 15;
const RUN_ID = process.env.COLD_START_PROBE_RUN_ID || ('widget-' + KIND + '-' + new Date().toISOString().replace(/[:.]/g, '-'));

function poolKey() {
  return `${STATE}#${GRADE}#${SUBJECT}#teks-${QUESTION_TYPE}`;
}

async function main() {
  console.log(`[probe-${KIND}] target=${TARGET_COUNT} state=${STATE} grade=${GRADE} teks=${TEKS} widgetMode=${WIDGET_MODE}`);
  const startedAt = Date.now();
  const results = [];
  let saved = 0, judgeRejTwice = 0, otherErr = 0;
  let attempts = 0;

  while (saved < TARGET_COUNT) {
    attempts++;
    if (attempts > TARGET_COUNT * 4) break;
    try {
      const q = await generateOne({
        state: STATE, grade: GRADE, subject: SUBJECT,
        type: QUESTION_TYPE, teksOverride: TEKS, widgetMode: WIDGET_MODE
      });
      if (!q.stimulus || q.stimulus.type !== cfg.expectedStimulusType) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'stimulus not ' + cfg.expectedStimulusType });
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
        console.warn(`[probe-${KIND}] correctness-fail ${ccVerdict.bug}: ${ccVerdict.reason}`);
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
        promptVersion: q._promptVersion || 'cold-v1-widget-' + KIND,
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
        console.log(`[probe-${KIND}] +${saved}/${TARGET_COUNT} contentId=${contentId}`);
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
  const summary = { runId: RUN_ID, kind: KIND, state: STATE, grade: GRADE, teks: TEKS,
    widgetMode: WIDGET_MODE, target: TARGET_COUNT, attempts, saved,
    judgeRejectedTwice: judgeRejTwice, otherErrors: otherErr, elapsedSeconds: elapsed };

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `probe-widgets-${KIND}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log(`\n[probe-${KIND}] ----- SUMMARY -----`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`[probe-${KIND}] output: ${outFile}`);
}

main().catch(err => { console.error('FATAL', err); process.exit(1); });
