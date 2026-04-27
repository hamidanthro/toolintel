#!/usr/bin/env node
/**
 * Probe: generate N candidates for a (state, grade, subject, types[]) and
 * report pass-rate + 3 saved samples. No DB writes.
 */
const { generateOne } = require('./generators');
const { validateQuestion } = require('./lake-client');

async function probe({ state, grade, subject, types, n }) {
  console.log(`\n========== PROBE: ${state} ${grade} ${subject} (n=${n}) ==========`);
  let accepted = [];
  let rejected = [];
  for (let i = 0; i < n; i++) {
    const type = types[i % types.length];
    try {
      const item = await generateOne({ state, grade, subject, type });
      const errs = validateQuestion(item, subject, grade);
      if (errs.length === 0) accepted.push({ type, item });
      else rejected.push({ type, errs, item });
    } catch (e) {
      rejected.push({ type, errs: ['THROW: ' + e.message], item: null });
    }
    process.stdout.write(accepted.length > rejected.length ? '.' : 'x');
  }
  console.log(`\nAccepted: ${accepted.length}/${n}  (${((accepted.length / n) * 100).toFixed(0)}%)`);
  console.log(`Rejected: ${rejected.length}/${n}`);
  if (rejected.length) {
    const tally = {};
    rejected.forEach(r => r.errs.forEach(e => { tally[e] = (tally[e] || 0) + 1; }));
    console.log(`Reject reasons: ${JSON.stringify(tally)}`);
  }
  console.log(`\n--- 3 accepted samples ---`);
  accepted.slice(0, 3).forEach((r, i) => {
    console.log(`\n[${i + 1}] type=${r.type}`);
    console.log(`Q: ${r.item.question}`);
    console.log(`Choices: ${JSON.stringify(r.item.choices)}`);
    console.log(`correctIndex: ${r.item.correctIndex} (=> ${r.item.choices[r.item.correctIndex]})`);
    console.log(`Explanation: ${r.item.explanation}`);
  });
  return { accepted: accepted.length, rejected: rejected.length };
}

(async () => {
  await probe({
    state: 'alabama', grade: 'grade-2', subject: 'math',
    types: ['word-problem', 'computation', 'concept', 'data-interpretation'],
    n: 20
  });
  await probe({
    state: 'california', grade: 'grade-3', subject: 'math',
    types: ['word-problem', 'computation', 'concept', 'data-interpretation'],
    n: 20
  });
})().catch(e => { console.error(e); process.exit(1); });
