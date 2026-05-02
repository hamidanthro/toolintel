/**
 * Judge regression tests.
 *
 * Run:    node --test scripts/cold-start/judge.test.js
 *
 * These tests CALL OpenAI for real (gpt-4o-mini at temp 0). They will be
 * skipped automatically if OPENAI_API_KEY is not set in the environment.
 *
 * Cost: ~5 calls × ~$0.0001 = ~$0.0005 per full run.
 *
 * Add new regression cases by dropping a JSON file into ./judge-fixtures/
 * with the shape:
 *   { name, description, question, context, expected: { verdict, failedChecks } }
 *
 * Assertions (designed to be robust to non-determinism):
 *   - verdict must match exactly
 *   - for "reject" expectations: every expected failedCheck must appear in
 *     the judge's failedChecks (the judge MAY flag additional checks — that
 *     is allowed; we only fail when an expected check is missing)
 *   - for "pass" expectations: failedChecks must be empty
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { judgeQuestion } = require('./judge');

const FIXTURE_DIR = path.join(__dirname, 'judge-fixtures');
const RUN_LIVE = !!process.env.OPENAI_API_KEY;

const fixtures = fs.readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

if (!fixtures.length) {
  throw new Error(`No fixtures found in ${FIXTURE_DIR}`);
}

for (const fname of fixtures) {
  const fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, fname), 'utf8'));
  const skipReason = RUN_LIVE
    ? false
    : 'OPENAI_API_KEY not set — skipping live judge call';

  test(`judge: ${fx.name || fname}`, { skip: skipReason }, async () => {
    const result = await judgeQuestion(fx.question, fx.context);

    assert.equal(
      result.verdict,
      fx.expected.verdict,
      `verdict mismatch for ${fname}: judge said "${result.verdict}" with checks [${result.failedChecks.join(',')}]; expected "${fx.expected.verdict}"`
    );

    if (fx.expected.verdict === 'reject') {
      for (const expectedCheck of fx.expected.failedChecks) {
        assert.ok(
          result.failedChecks.includes(expectedCheck),
          `expected failedCheck "${expectedCheck}" not in judge result [${result.failedChecks.join(',')}] for ${fname}. Reasons: ${result.reasons.join(' | ')}`
        );
      }
    } else {
      assert.equal(
        result.failedChecks.length,
        0,
        `pass verdict but failedChecks=[${result.failedChecks.join(',')}] for ${fname}. Reasons: ${result.reasons.join(' | ')}`
      );
    }
  });
}
