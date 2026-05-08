#!/usr/bin/env node
/**
 * Calibration test for scripts/science/judge-question.js.
 *
 * Reads every .json fixture in scripts/science/fixtures/ and runs each
 * through judgeQuestion() with the live Anthropic key. Asserts:
 *   - actual.verdict === fixture.expectedVerdict
 *   - every reason in fixture.expectedReasonsSubset is present in
 *     actual.reasons
 *
 * Prints a TAP-style report. Exits 0 if all pass, 1 if any fail,
 * 2 if ANTHROPIC_API_KEY is not set (caller's environment is wrong).
 *
 * D2a-fix: judge migrated gpt-4o -> claude-sonnet-4-5 (OpenAI account
 * was at quota; Anthropic key already in Secrets Manager for reading
 * gen + math verifier).
 *
 * Run:
 *   NODE_PATH=scripts/cold-start/node_modules \
 *     ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *       --secret-id staar-tutor/anthropic-api-key \
 *       --region us-east-1 --query SecretString --output text) \
 *     node scripts/science/judge-question.test.js
 *
 * Cost: 3 fixtures × ~$0.01-0.05/call (Sonnet 4.5) ≈ $0.03-0.15 per run.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY env var not set.');
  console.error('See top-of-file run command for the Secrets Manager fetch.');
  process.exit(2);
}

const { judgeQuestion } = require('./judge-question');

function listFixtures() {
  return fs.readdirSync(FIXTURE_DIR)
    .filter(f => f.endsWith('.json'))
    .sort();
}

function loadFixture(name) {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
  return JSON.parse(raw);
}

function reasonsSubsetMatch(expected, actual) {
  if (!Array.isArray(expected) || expected.length === 0) return true;
  if (!Array.isArray(actual)) return false;
  return expected.every(r => actual.includes(r));
}

async function runOne(name, idx) {
  const fixture = loadFixture(name);
  const { expectedVerdict, expectedReasonsSubset, ...item } = fixture;

  let result;
  try {
    result = await judgeQuestion(item);
  } catch (err) {
    return {
      ok: false,
      name,
      idx,
      detail: `threw: ${err.message}`
    };
  }

  const verdictOK = result.verdict === expectedVerdict;
  const reasonsOK = reasonsSubsetMatch(expectedReasonsSubset, result.reasons);
  const ok = verdictOK && reasonsOK;

  // Annotate fail-open paths so a failed assertion is distinguishable from
  // a real model miss. source='llm-error' means we never got a structured
  // verdict; the gate didn't actually run.
  const sourceTag = result.source === 'llm-error'
    ? ` source=llm-error reason=${result._failOpenReason || '?'}`
    : ` source=${result.source}`;

  let detail;
  if (!verdictOK) {
    detail = `verdict expected=${expectedVerdict} actual=${result.verdict} reasons=[${result.reasons.join(', ')}]${sourceTag}`;
  } else if (!reasonsOK) {
    detail = `verdict=${result.verdict} but missing expected reasons. expected_subset=[${expectedReasonsSubset.join(', ')}] actual=[${result.reasons.join(', ')}]${sourceTag}`;
  } else if (expectedReasonsSubset && expectedReasonsSubset.length > 0) {
    detail = `${expectedReasonsSubset.join(', ')} matched (verdict=${result.verdict})`;
  } else {
    detail = `verdict=${result.verdict}`;
  }
  return { ok, name, idx, detail, source: result.source };
}

async function main() {
  const fixtures = listFixtures();
  if (fixtures.length === 0) {
    console.error(`no .json fixtures found in ${FIXTURE_DIR}`);
    process.exit(1);
  }
  console.log(`1..${fixtures.length}`);

  let passed = 0;
  let failed = 0;
  for (let i = 0; i < fixtures.length; i++) {
    const res = await runOne(fixtures[i], i + 1);
    if (res.ok) {
      passed++;
      console.log(`ok ${res.idx} - ${res.name}: ${res.detail}`);
    } else {
      failed++;
      console.log(`not ok ${res.idx} - ${res.name}: ${res.detail}`);
    }
  }
  console.log(`# ${passed} ok, ${failed} not ok`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
