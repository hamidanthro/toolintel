#!/usr/bin/env node
/**
 * Offline pipeline smoke for §110 widget integration.
 *
 * Verifies WITHOUT calling OpenAI:
 *   1. buildWidgetModePrompt() returns a valid prompt for
 *      ('texas', 'grade-3', 'math', 'concept', 'fraction-bar-choices').
 *   2. The lambda content-lake _validateWidgetSpec correctly accepts
 *      schema-valid fraction-bar specs and rejects malformed ones.
 *   3. The save-schema gate accepts a candidate with widget-spec
 *      choices and rejects malformed ones.
 *
 * Stubs:
 *   - getOpenAI() is NEVER called (we don't run _callGenerator here).
 *   - No DynamoDB / no AWS SDK loaded.
 *
 * Usage:
 *   node scripts/cold-start/test-widget-pipeline-offline.js
 *
 * Exits 0 on success, 1 on any test failure.
 */
'use strict';

const assert = require('assert');
const path = require('path');

let fails = 0;
function check(label, fn) {
  try {
    fn();
    console.log('  ✓ ' + label);
  } catch (err) {
    fails++;
    console.error('  ✗ ' + label);
    console.error('    ' + (err && err.message));
  }
}

console.log('[test-widgets] Phase 2 offline pipeline check\n');

// ---- 1. buildWidgetModePrompt returns a non-empty fraction-bar prompt
console.log('[1/3] buildWidgetModePrompt');
const { buildWidgetModePrompt } = require('./generators');
check('returns null for unknown widgetMode', () => {
  const p = buildWidgetModePrompt({
    stateSlug: 'texas', grade: 'grade-3', subject: 'math',
    questionType: 'concept', packEnrichment: null, widgetMode: 'unknown-mode'
  });
  assert.strictEqual(p, null);
});
check('returns null when subject is not math', () => {
  const p = buildWidgetModePrompt({
    stateSlug: 'texas', grade: 'grade-3', subject: 'reading',
    questionType: 'concept', packEnrichment: null, widgetMode: 'fraction-bar-choices'
  });
  assert.strictEqual(p, null);
});
check('returns a real prompt for fraction-bar-choices on math', () => {
  const p = buildWidgetModePrompt({
    stateSlug: 'texas', grade: 'grade-3', subject: 'math',
    questionType: 'concept', packEnrichment: null, widgetMode: 'fraction-bar-choices'
  });
  assert.ok(typeof p === 'string' && p.length > 200, 'expected long prompt');
  assert.ok(p.includes('fraction-bar'), 'mentions widget type');
  assert.ok(p.includes('"parts"'), 'mentions parts field');
  assert.ok(p.includes('"filled"'), 'mentions filled field');
  assert.ok(p.includes('grade 3'), 'mentions grade');
});

// ---- 2. Lambda _validateWidgetSpec (server-side schema gate)
console.log('\n[2/3] lambda _validateWidgetSpec');
// Use the extracted widget-validators module (no AWS SDK dependency)
// so this test runs without lambda's dynamodb requires resolving.
const { validateSaveSchema: _enforceSaveSchema } = require('../../lambda/widget-validators');

check('valid fraction-bar candidate passes _enforceSaveSchema', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-3',
    question: 'Which model represents 1/3?',
    explanation: 'One of three parts is shaded.',
    choices: [
      { type: 'fraction-bar', parts: 3, filled: 1 },
      { type: 'fraction-bar', parts: 6, filled: 1 },
      { type: 'fraction-bar', parts: 3, filled: 2 },
      { type: 'fraction-bar', parts: 4, filled: 1 }
    ],
    correctIndex: 0
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.deepStrictEqual(errs, [], 'expected no errors, got ' + errs.join(','));
});

check('malformed widget (filled > parts) is rejected', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-3',
    question: 'Which model represents 2/5?',
    explanation: 'Two of five parts.',
    choices: [
      { type: 'fraction-bar', parts: 5, filled: 2 },
      { type: 'fraction-bar', parts: 5, filled: 7 },
      { type: 'fraction-bar', parts: 5, filled: 1 },
      { type: 'fraction-bar', parts: 4, filled: 2 }
    ],
    correctIndex: 0
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.ok(errs.length > 0, 'expected rejection');
  assert.ok(errs.some(e => /choice_1_widget/.test(e)), 'expected choice_1_widget error, got ' + errs.join(','));
});

check('unknown widget type is rejected', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-3',
    question: 'q',
    explanation: 'e',
    choices: [
      { type: 'pie-chart', slices: 4 },
      { type: 'fraction-bar', parts: 4, filled: 1 },
      { type: 'fraction-bar', parts: 3, filled: 1 },
      { type: 'fraction-bar', parts: 5, filled: 1 }
    ],
    correctIndex: 1
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.ok(errs.length > 0, 'expected rejection');
  assert.ok(errs.some(e => /unknown_type:pie-chart/.test(e)), 'expected unknown_type error, got ' + errs.join(','));
});

check('mixed string + widget choices accepted', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-3',
    question: 'How many?',
    explanation: 'Counting',
    choices: [
      '1/3',
      { type: 'fraction-bar', parts: 3, filled: 1 },
      '2/3',
      '1/4'
    ],
    correctIndex: 0
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.deepStrictEqual(errs, [], 'expected mixed types accepted, got ' + errs.join(','));
});

check('stimulus widget validated', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-3',
    question: 'What fraction is shown?',
    explanation: 'Look at the bar.',
    stimulus: { type: 'fraction-bar', parts: 4, filled: 3 },
    choices: ['1/4', '2/4', '3/4', '4/4'],
    correctIndex: 2
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.deepStrictEqual(errs, [], 'expected stimulus accepted, got ' + errs.join(','));
});

check('malformed stimulus widget rejected', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-3',
    question: 'What fraction is shown?',
    explanation: 'Look at the bar.',
    stimulus: { type: 'fraction-bar', parts: 0, filled: 1 },
    choices: ['1/4', '2/4', '3/4', '4/4'],
    correctIndex: 2
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.ok(errs.some(e => /stimulus_widget/.test(e)), 'expected stimulus rejection, got ' + errs.join(','));
});

// ---- 3. number-line spec gating
console.log('\n[3/3] number-line spec gating');

check('valid number-line stimulus passes', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-4',
    question: 'What number is marked?',
    explanation: 'It is between 3 and 4.',
    stimulus: { type: 'number-line', range: [0, 10], step: 1, marks: [{ at: 3.5 }] },
    choices: ['3', '3.5', '4', '7'],
    correctIndex: 1
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.deepStrictEqual(errs, [], 'expected accepted, got ' + errs.join(','));
});

check('number-line with out-of-range mark rejected', () => {
  const candidate = {
    type: 'multiple_choice',
    state: 'texas',
    subject: 'math',
    grade: 'grade-4',
    question: 'q',
    explanation: 'e',
    stimulus: { type: 'number-line', range: [0, 10], marks: [{ at: 15 }] },
    choices: ['1', '2', '3', '4'],
    correctIndex: 0
  };
  const errs = _enforceSaveSchema(candidate, { state: 'texas' });
  assert.ok(errs.some(e => /marks_out_of_range/.test(e)), 'expected marks_out_of_range, got ' + errs.join(','));
});

console.log('\n----------------------');
if (fails === 0) {
  console.log('✓ ALL TESTS PASSED');
  process.exit(0);
} else {
  console.error('✗ ' + fails + ' TEST(S) FAILED');
  process.exit(1);
}
