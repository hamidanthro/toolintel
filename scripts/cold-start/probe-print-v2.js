#!/usr/bin/env node
/**
 * probe-print-v2: same as probe-print but runs the FULL pipeline
 * (generator + content validator + state guardrail + math verifier)
 * and only prints questions that would have been saved.
 */
const lake = require('./lake-client');
const { generateOne } = require('./generators');
const { validateStateSpecificity } = require('./state-guardrail');
const { verifyMath } = require('./verifier');
const { getStateRecord } = require('./states-grades');

const STATES = ['alabama', 'wyoming', 'maine', 'nebraska', 'texas', 'california'];
const GRADE = 'grade-5';
const SUBJECT = 'math';
const TYPE = 'concept';
const PER_STATE = 2;

(async () => {
  const totals = { gen: 0, contentReject: 0, stateReject: 0, verifyReject: 0, saved: 0 };

  for (const state of STATES) {
    const r = getStateRecord(state);
    console.log(`\n${'='.repeat(72)}`);
    console.log(`STATE: ${state}  ${r.testName}  ${r.testAuthorityShort}  "${r.standards}"`);
    console.log('='.repeat(72));
    let saved = 0, attempts = 0;
    while (saved < PER_STATE && attempts < PER_STATE * 4) {
      attempts++;
      try {
        const item = await generateOne({ state, grade: GRADE, subject: SUBJECT, type: TYPE });
        totals.gen++;
        const errs = lake.validateQuestion(item, SUBJECT, GRADE);
        if (errs.length) { totals.contentReject++; continue; }
        const stateErrs = validateStateSpecificity(item, state);
        if (stateErrs.length) { totals.stateReject++; continue; }
        const v = await verifyMath(item, GRADE);
        if (!v.ok) { totals.verifyReject++; continue; }
        saved++; totals.saved++;
        console.log(`\n--- ${state} #${saved} ✓ verifier OK (${v.verifier.myAnswer}) ---`);
        console.log(`Q: ${item.question}`);
        item.choices.forEach((c, j) => console.log(`  ${'ABCD'[j]}${j === item.correctIndex ? '*' : ' '} ${c}`));
        console.log(`E: ${item.explanation}`);
      } catch (err) {
        console.log(`ERR: ${err.message}`);
      }
    }
  }

  console.log(`\n${'='.repeat(72)}`);
  console.log(`TOTALS: generated=${totals.gen} content-reject=${totals.contentReject} state-reject=${totals.stateReject} verify-reject=${totals.verifyReject} saved=${totals.saved}`);
  console.log(`Acceptance rate: ${(totals.saved / Math.max(1, totals.gen) * 100).toFixed(1)}%`);
})();
