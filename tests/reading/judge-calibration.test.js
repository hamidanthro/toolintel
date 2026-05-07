#!/usr/bin/env node
/**
 * Calibration test for scripts/reading/judge-passage.js.
 *
 * Loads 6 hand-written fixtures (3 PASS, 3 FAIL by different rules) and
 * runs each through judgePassage with the live Anthropic key. Asserts:
 *   - PASS fixtures get verdict==='pass'
 *   - FAIL fixtures get verdict==='fail' AND every expected reason
 *     appears in result.reasons[]
 *
 * Usage:
 *   ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value \
 *     --secret-id staar-tutor/anthropic-api-key \
 *     --region us-east-1 --query SecretString --output text) \
 *     node tests/reading/judge-calibration.test.js
 *
 * Cost: ~6 Anthropic Sonnet 4.5 calls × ~$0.01-0.05 each ≈ $0.10-0.30 total.
 *
 * Exit code 0 if all 6 pass, 1 if any fail.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { judgePassage } = require('../../scripts/reading/judge-passage');

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures');
const FIXTURE_FILES = [
  'pass-1-fiction-clean.json',
  'pass-2-info-clean.json',
  'pass-3-fiction-unmarked.json',
  'fail-1-disability-deficit.json',
  'fail-2-stereotype-name.json',
  'fail-3-made-up-fact.json'
];

function loadFixture(name) {
  const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
  return JSON.parse(raw);
}

function checkFixture(fixture, result) {
  const exp = fixture.expected || {};
  const issues = [];

  if (exp.verdict === 'pass') {
    if (result.verdict !== 'pass') issues.push(`expected pass, got ${result.verdict} (reasons: ${result.reasons.join(', ')})`);
  } else if (exp.verdict === 'fail') {
    if (result.verdict !== 'fail') issues.push(`expected fail, got ${result.verdict}`);
    for (const expectedReason of (exp.reasons || [])) {
      if (!result.reasons.includes(expectedReason)) {
        issues.push(`missing expected reason: ${expectedReason} (got: ${result.reasons.join(', ')})`);
      }
    }
  }
  return issues;
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('FATAL: ANTHROPIC_API_KEY not set. Run with:');
    console.error('  ANTHROPIC_API_KEY=$(aws secretsmanager get-secret-value --secret-id staar-tutor/anthropic-api-key --region us-east-1 --query SecretString --output text) node tests/reading/judge-calibration.test.js');
    process.exit(1);
  }

  console.log(`[calibration] running ${FIXTURE_FILES.length} fixtures through judge-passage...\n`);

  const results = [];
  for (const file of FIXTURE_FILES) {
    const fix = loadFixture(file);
    process.stdout.write(`  ${file.padEnd(36)} ... `);
    const t0 = Date.now();
    const result = await judgePassage({
      title: fix.title,
      body: fix.body,
      genre: fix.genre,
      protagonistName: fix.protagonistName,
      protagonistDemographic: fix.protagonistDemographic,
      setting: fix.setting,
      topic: fix.topic,
      apiKey
    });
    const elapsed = Date.now() - t0;
    const issues = checkFixture(fix, result);
    const ok = issues.length === 0;
    console.log(`${ok ? 'PASS' : 'FAIL'}  (${elapsed}ms, source=${result.source}, verdict=${result.verdict})`);
    if (!ok) {
      for (const i of issues) console.log(`     - ${i}`);
      console.log(`     judge note: ${result.note || '(none)'}`);
    }
    if (result.factsRequireCheck) {
      console.log(`     [factsRequireCheck=true]`);
    }
    results.push({ file, expected: fix.expected, actual: result, ok, issues });
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;

  console.log('\n=== SUMMARY ===');
  console.log(`Passed: ${passed} / ${results.length}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed fixtures:');
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  ${r.file}:`);
      console.log(`    expected: ${JSON.stringify(r.expected)}`);
      console.log(`    actual verdict: ${r.actual.verdict}`);
      console.log(`    actual reasons: [${r.actual.reasons.join(', ')}]`);
      console.log(`    note: ${r.actual.note || '(none)'}`);
    }
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('FATAL:', err && err.stack || err);
  process.exit(1);
});
