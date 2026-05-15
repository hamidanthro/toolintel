#!/usr/bin/env node
/**
 * §110 phase 2 probe — widget-enabled fraction generation.
 *
 * Generates 50 grade-3 fraction questions whose 4 multiple-choice
 * options are fraction-bar widget specs (not text strings). Each
 * question goes through the existing pipeline:
 *
 *   1. generators.generateOne with widgetMode='fraction-bar-choices'
 *      → OpenAI gpt-4o-mini draft
 *   2. cold-start judge (gpt-4o) with new DIAGRAM_INCOHERENT failure
 *      mode active → pass / reject / pass-after-regen
 *   3. NO verifier step (verifier.js solves text math; widget choices
 *      have no text solution path. Skip for widget items.)
 *   4. saveQuestion via lake-client → content-lake _enforceSaveSchema
 *      validates the widget spec server-side → PutItem
 *
 * Output: scripts/cold-start/output/probe-widgets-<UTC>.json with
 * per-row save status, judge verdict, and widget-spec summary.
 * Stamp every saved row with `_probeRunId` for selective rollback.
 *
 * Usage:
 *   COLD_START_PROBE_RUN_ID=widget-probe-<UTC> \
 *   OPENAI_API_KEY=... \
 *   node scripts/cold-start/probe-widgets.js [--count 50] [--teks 3.3A]
 *
 * Smart default: run against TEKS 3.3A (representing fractions on a
 * model) — the canonical "Which model is 1/3?" template.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['teks'],
  default: { count: 50, teks: '3.3A', grade: 'grade-3' }
});

const lake = require('./lake-client');
const { generateOne } = require('./generators');
const { check: correctnessCheck } = require('./widget-correctness-check');

const STATE = 'texas';
const SUBJECT = 'math';
const GRADE = String(args.grade);
const TEKS = String(args.teks);
const TARGET_COUNT = parseInt(args.count, 10) || 50;
const RUN_ID = process.env.COLD_START_PROBE_RUN_ID || ('widget-probe-' + new Date().toISOString().replace(/[:.]/g, '-'));

// Question type bucket: 'concept' is the canonical fraction-bar
// comparison type ("Which model represents...?"). word-problem also
// fits but produces longer stems; we want the tight comparison form.
const QUESTION_TYPE = 'concept';
const WIDGET_MODE = 'fraction-bar-choices';

function poolKey() {
  return `${STATE}#${GRADE}#${SUBJECT}#teks-${QUESTION_TYPE}`;
}

async function main() {
  console.log('[probe-widgets] starting');
  console.log('[probe-widgets] target=' + TARGET_COUNT + ' state=' + STATE + ' grade=' + GRADE + ' teks=' + TEKS + ' widgetMode=' + WIDGET_MODE);
  console.log('[probe-widgets] runId=' + RUN_ID);

  const startedAt = Date.now();
  const results = [];
  let saved = 0, judgeRejTwice = 0, schemaRej = 0, dupSkip = 0, otherErr = 0;
  let attempts = 0;

  while (saved < TARGET_COUNT) {
    attempts++;
    if (attempts > TARGET_COUNT * 4) {
      console.warn('[probe-widgets] hit 4x attempt ceiling — stopping');
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

      // Quick sanity: choices must be 4 fraction-bar objects.
      if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'choices not 4', sample: { question: q.question } });
        continue;
      }
      const allFractionBars = q.choices.every(c => c && c.type === 'fraction-bar' && Number.isInteger(c.parts) && Number.isInteger(c.filled));
      if (!allFractionBars) {
        otherErr++;
        results.push({ status: 'shape-fail', reason: 'choices not all fraction-bar specs', sample: { question: q.question, choices: q.choices } });
        continue;
      }

      // §110 phase-20e — deterministic correctness check BEFORE save.
      // This is the audit logic from scripts/lake-audit/audit-widget-rows.js
      // applied at write time so future bug rows can't sneak past.
      const ccVerdict = correctnessCheck({ question: q.question, choices: q.choices, correctIndex: q.correctIndex });
      if (!ccVerdict.ok) {
        otherErr++;
        results.push({ status: 'correctness-fail', bug: ccVerdict.bug, reason: ccVerdict.reason, question: q.question });
        console.warn('[probe-widgets] correctness-fail ' + ccVerdict.bug + ': ' + ccVerdict.reason);
        continue;
      }

      // Build the full lake row. lake.saveQuestion is a low-level put;
      // it expects the row shape already complete (matches the pattern
      // in probe-pack-wired.js#75-101). No embedding for widget items
      // (text stems are short / templatey; dedup-free is fine at probe
      // scale — full sweeps can add embeddings later).
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
        promptVersion: q._promptVersion || 'cold-v1-widget',
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
          correctIndex: q.correctIndex,
          choices: q.choices,
          explanation: q.explanation
        });
        console.log('[probe-widgets] +' + saved + '/' + TARGET_COUNT + ' contentId=' + contentId + ' judge=' + (q._judge || '?'));
      } catch (saveErr) {
        if (saveErr && saveErr.name === 'DuplicateError') {
          dupSkip++;
          results.push({ status: 'dup-skip', reason: saveErr.message });
        } else {
          otherErr++;
          results.push({ status: 'save-fail', name: saveErr && saveErr.name, message: (saveErr && saveErr.message || '').slice(0, 200) });
          console.warn('[probe-widgets] save failed:', saveErr && saveErr.message);
        }
        continue;
      }
    } catch (err) {
      if (err && err.name === 'JudgeRejectedTwiceError') {
        judgeRejTwice++;
        // The class uses firstReasons/secondReasons (failedChecks arrays).
        results.push({
          status: 'judge-reject-twice',
          firstReasons: err.firstReasons,
          secondReasons: err.secondReasons
        });
      } else {
        otherErr++;
        results.push({ status: 'error', name: err.name, message: err.message });
        console.warn('[probe-widgets] error:', err.name, err.message);
      }
    }
  }

  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const summary = {
    runId: RUN_ID,
    state: STATE,
    grade: GRADE,
    teks: TEKS,
    widgetMode: WIDGET_MODE,
    target: TARGET_COUNT,
    attempts,
    saved,
    judgeRejectedTwice: judgeRejTwice,
    schemaRejected: schemaRej,
    duplicates: dupSkip,
    otherErrors: otherErr,
    elapsedSeconds: elapsed
  };

  const outDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'probe-widgets-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(outFile, JSON.stringify({ summary, results }, null, 2));

  console.log('\n[probe-widgets] ----- SUMMARY -----');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[probe-widgets] output: ' + outFile);
  console.log('[probe-widgets] done');
}

main().catch(err => {
  console.error('[probe-widgets] FATAL', err);
  process.exit(1);
});
