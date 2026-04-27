#!/usr/bin/env node
/**
 * Probe-print: generate 2 questions per state for a small panel and print
 * full content so a human can verify state-specificity.
 */
const { generateOne, buildPrompt } = require('./generators');
const { validateStateSpecificity } = require('./state-guardrail');
const { getStateRecord } = require('./states-grades');

const STATES = ['alabama', 'wyoming', 'hawaii', 'maine', 'texas', 'california'];
const GRADE = 'grade-5';
const SUBJECT = 'math';
const TYPE = 'concept';
const PER_STATE = 2;

(async () => {
  for (const state of STATES) {
    const r = getStateRecord(state);
    console.log(`\n${'='.repeat(72)}`);
    console.log(`STATE: ${state}  test=${r.testName}  authority=${r.testAuthorityShort}  standards="${r.standards}"`);
    console.log('='.repeat(72));
    for (let i = 1; i <= PER_STATE; i++) {
      try {
        const item = await generateOne({ state, grade: GRADE, subject: SUBJECT, type: TYPE });
        const errs = validateStateSpecificity(item, state);
        console.log(`\n--- ${state} #${i}  ${errs.length ? '⚠ STATE-REJECT: ' + errs[0] : 'OK'} ---`);
        console.log(`Q: ${item.question}`);
        item.choices.forEach((c, j) => {
          console.log(`  ${'ABCD'[j]}${j === item.correctIndex ? '*' : ' '} ${c}`);
        });
        console.log(`E: ${item.explanation}`);
      } catch (err) {
        console.log(`#${i} ERROR: ${err.message}`);
      }
    }
  }
})();
