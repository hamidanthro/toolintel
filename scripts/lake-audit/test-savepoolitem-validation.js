#!/usr/bin/env node
/**
 * test-savepoolitem-validation.js — exercises the schema gate added to
 * lambda/content-lake.js#savePoolItem in the May 3 writer-bug fix.
 *
 * Loads the gate function directly (exported as _enforceSaveSchema) and
 * passes one valid + five invalid candidate shapes. Prints PASS/FAIL per
 * case. Exits non-zero if any case behaves unexpectedly.
 *
 * Run (from repo root):
 *   NODE_PATH=$(pwd)/scripts/lake-audit/node_modules node scripts/lake-audit/test-savepoolitem-validation.js
 *
 * NODE_PATH is needed because lambda/content-lake.js requires
 * @aws-sdk/client-dynamodb and there's no node_modules in lambda/.
 * The lake-audit dir already has the deps installed (npm install ran
 * for the audit script).
 *
 * No AWS calls. No network. Pure local function exercise.
 */
'use strict';

const path = require('path');
const lake = require(path.resolve(__dirname, '..', '..', 'lambda', 'content-lake.js'));

const gate = lake._enforceSaveSchema;
if (typeof gate !== 'function') {
  console.error('FATAL: _enforceSaveSchema is not exported from content-lake.js');
  process.exit(1);
}

// Each case: { name, candidate, expectErrors: boolean | [substring] }
//   expectErrors === false  → expect zero errors (valid case)
//   expectErrors === true   → expect at least one error (any reason)
//   expectErrors === [...]  → expect at least one error AND every listed
//                              substring must appear in the joined errors
const CASES = [
  {
    name: 'valid multiple_choice row',
    candidate: {
      state: 'texas',
      subject: 'math',
      grade: 'grade-3',
      type: 'multiple_choice',
      question: 'What is 7 + 5?',
      choices: ['10', '11', '12', '13'],
      correctIndex: 2,
      explanation: 'Seven plus five equals twelve.'
    },
    expectErrors: false
  },
  {
    name: 'valid numeric row (correctIndex absent by design)',
    candidate: {
      state: 'texas',
      subject: 'math',
      grade: 'grade-3',
      type: 'numeric',
      question: 'How many sides does a triangle have?',
      answer: '3',
      explanation: 'A triangle has three sides.'
    },
    expectErrors: false
  },
  {
    name: 'multiple_choice missing correctIndex (the production bug)',
    candidate: {
      state: 'florida',
      subject: 'math',
      grade: '3',
      type: 'multiple_choice',
      question: 'Which fraction is greater? 2/5 or 2/8',
      choices: ['2/5', '2/8'],
      explanation: '2/5 is greater than 2/8.'
      // correctIndex deliberately absent — exact shape of the 186 broken rows
    },
    expectErrors: ['correctIndex_invalid']
  },
  {
    name: 'multiple_choice with empty choices array',
    candidate: {
      state: 'florida',
      subject: 'math',
      grade: '3',
      type: 'multiple_choice',
      question: 'Which fraction is greater? 2/5 or 2/8',
      choices: [],
      correctIndex: 0,
      explanation: '2/5 is greater than 2/8.'
    },
    expectErrors: ['choices_missing_or_too_few']
  },
  {
    name: 'multiple_choice with only one choice',
    candidate: {
      state: 'florida',
      subject: 'math',
      grade: '3',
      type: 'multiple_choice',
      question: 'What is 1 + 1?',
      choices: ['2'],
      correctIndex: 0,
      explanation: 'One plus one is two.'
    },
    expectErrors: ['choices_missing_or_too_few']
  },
  {
    name: 'multiple_choice with correctIndex out of range',
    candidate: {
      state: 'texas',
      subject: 'math',
      grade: 'grade-3',
      type: 'multiple_choice',
      question: 'What is 7 + 5?',
      choices: ['10', '11', '12', '13'],
      correctIndex: 999,
      explanation: 'Seven plus five equals twelve.'
    },
    expectErrors: ['correctIndex_invalid']
  },
  {
    name: 'multiple_choice with correctIndex=null',
    candidate: {
      state: 'texas',
      subject: 'math',
      grade: 'grade-3',
      type: 'multiple_choice',
      question: 'What is 7 + 5?',
      choices: ['10', '11', '12', '13'],
      correctIndex: null,
      explanation: 'Seven plus five equals twelve.'
    },
    expectErrors: ['correctIndex_invalid']
  }
];

let pass = 0, fail = 0;
const failures = [];

// Suppress the gate's CloudWatch-style warning during tests (cleaner output).
const _origWarn = console.warn;
console.warn = () => {};

for (const c of CASES) {
  const errors = gate(c.candidate, { contentId: 'test', state: c.candidate.state, subject: c.candidate.subject, grade: c.candidate.grade });
  let ok = true;
  let detail = '';

  if (c.expectErrors === false) {
    if (errors.length === 0) {
      detail = '(0 errors as expected)';
    } else {
      ok = false;
      detail = `expected 0 errors, got: ${errors.join(',')}`;
    }
  } else if (c.expectErrors === true) {
    if (errors.length > 0) {
      detail = `(rejected with: ${errors.join(',')})`;
    } else {
      ok = false;
      detail = 'expected rejection, got 0 errors';
    }
  } else if (Array.isArray(c.expectErrors)) {
    if (errors.length === 0) {
      ok = false;
      detail = `expected rejection containing ${c.expectErrors.join('+')}, got 0 errors`;
    } else {
      const joined = errors.join(',');
      const missing = c.expectErrors.filter(s => !joined.includes(s));
      if (missing.length === 0) {
        detail = `(rejected with: ${joined})`;
      } else {
        ok = false;
        detail = `rejected with ${joined} but missing expected substrings: ${missing.join(',')}`;
      }
    }
  }

  if (ok) {
    pass++;
    console.log(`  ✓ ${c.name}  ${detail}`);
  } else {
    fail++;
    failures.push(c.name);
    console.log(`  ❌ ${c.name}  ${detail}`);
  }
}

console.warn = _origWarn;

console.log();
console.log(`${pass}/${CASES.length} passed`);
if (fail > 0) {
  console.log(`Failures: ${failures.join(', ')}`);
  process.exit(1);
}
