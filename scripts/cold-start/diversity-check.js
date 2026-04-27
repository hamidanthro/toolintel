#!/usr/bin/env node
/**
 * Cross-state diversity audit.
 *
 * Picks samples for matching (grade, subject, type) across states and reports
 * mean / max pairwise embedding similarity. Healthy band is 0.3–0.7. > 0.7
 * means the AI is producing nearly identical questions across states despite
 * differing prompts, and we should make state-specific guidance more prescriptive.
 *
 * Usage: node scripts/cold-start/diversity-check.js
 */
const { ddb, cosineSim, POOL_TABLE } = require('./lake-client');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');

const STATES = ['texas', 'california', 'florida'];
const COMPARISONS = [
  { grade: 'grade-3', subject: 'math', type: 'word-problem' },
  { grade: 'grade-3', subject: 'math', type: 'computation' },
  { grade: 'grade-5', subject: 'math', type: 'word-problem' },
  { grade: 'grade-7', subject: 'math', type: 'concept' }
];

async function loadSample(state, grade, subject, type, n = 20) {
  const result = await ddb.send(new QueryCommand({
    TableName: POOL_TABLE,
    KeyConditionExpression: 'poolKey = :pk',
    ExpressionAttributeValues: { ':pk': `${state}#${grade}#${subject}#teks-${type}` },
    Limit: n
  }));
  return (result.Items || []).filter(i => i.embedding);
}

function verdict(mean) {
  if (mean > 0.7) return '\u26a0  HIGH (AI repeats across states — fix prompts)';
  if (mean < 0.3) return '\u2713  EXCELLENT (very diverse)';
  return '\u2713  GOOD (healthy diversity)';
}

async function compareStates(c) {
  const samples = {};
  for (const s of STATES) samples[s] = await loadSample(s, c.grade, c.subject, c.type);
  console.log(`\n=== ${c.grade} / ${c.subject} / ${c.type} ===`);
  for (const s of STATES) console.log(`  ${s}: ${samples[s].length} samples`);

  for (let i = 0; i < STATES.length; i++) {
    for (let j = i + 1; j < STATES.length; j++) {
      const a = samples[STATES[i]], b = samples[STATES[j]];
      if (!a.length || !b.length) {
        console.log(`  ${STATES[i]} \u2194 ${STATES[j]}: skipped (empty)`);
        continue;
      }
      const sims = [];
      for (const x of a) for (const y of b) sims.push(cosineSim(x.embedding, y.embedding));
      const mean = sims.reduce((s, v) => s + v, 0) / sims.length;
      const max = Math.max(...sims);
      const tooSim = sims.filter(s => s > 0.85).length;
      console.log(`  ${STATES[i]} \u2194 ${STATES[j]}: mean=${mean.toFixed(3)} max=${max.toFixed(3)} too-similar=${tooSim}/${sims.length}  ${verdict(mean)}`);
    }
  }
}

async function main() {
  console.log('=== CROSS-STATE DIVERSITY AUDIT ===');
  for (const c of COMPARISONS) await compareStates(c);
  console.log('\nInterpretation:');
  console.log('  mean < 0.3 \u2192 very different (AI is finding state-flavored variations)');
  console.log('  mean 0.3-0.7 \u2192 healthy (some overlap on universal concepts)');
  console.log('  mean > 0.7 \u2192 AI is writing the same questions for each state. Differentiate prompts.');
}

main().catch(err => { console.error(err); process.exit(1); });
