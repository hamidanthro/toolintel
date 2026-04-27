#!/usr/bin/env node
/**
 * Diagnostic: generate N grade-2 math candidates from Alabama and print
 * the validator verdict + verbatim text. No DB writes.
 */
const { generateOne } = require('./generators');
const { validateQuestion } = require('./lake-client');

const N = parseInt(process.argv[2] || '8', 10);
const TYPES = ['word-problem', 'computation', 'concept', 'data-interpretation'];

(async () => {
  const stateSlug = 'alabama';
  const grade = 'grade-2';
  const subject = 'math';
  let rejected = [];
  let accepted = 0;
  for (let i = 0; i < N * 4; i++) {
    if (rejected.length >= N) break;
    const questionType = TYPES[i % TYPES.length];
    try {
      const item = await generateOne({ stateSlug, grade, subject, questionType });
      const errs = validateQuestion(item, subject, grade);
      if (errs.length === 0) { accepted++; continue; }
      rejected.push({ idx: i, type: questionType, errs, item });
    } catch (e) {
      rejected.push({ idx: i, type: questionType, errs: ['THROW: ' + e.message], item: null });
    }
  }
  console.log(`\n=== Generated ${accepted + rejected.length}, accepted ${accepted}, rejected ${rejected.length} ===\n`);
  rejected.slice(0, N).forEach((r, n) => {
    console.log(`────── Reject #${n + 1}  (type=${r.type}) ──────`);
    console.log(`ERRORS: ${JSON.stringify(r.errs)}`);
    if (r.item) {
      console.log(`Q: ${r.item.question}`);
      console.log(`Choices: ${JSON.stringify(r.item.choices)}`);
      console.log(`correctIndex: ${r.item.correctIndex}`);
      console.log(`Explanation: ${r.item.explanation}`);
    }
    console.log('');
  });
})().catch(e => { console.error(e); process.exit(1); });
