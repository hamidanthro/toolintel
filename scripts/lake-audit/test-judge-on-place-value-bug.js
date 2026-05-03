#!/usr/bin/env node
/**
 * test-judge-on-place-value-bug.js — proves the lambda runtime judge
 * (lambda/judge.js) catches the production failure that motivated this
 * module: the "Look at 85,759,578. What does the digit 5 represent?"
 * question that slipped past unjudged because handleGenerate had no
 * quality gate. The digit 5 appears at ten-thousands (50,000) AND
 * hundreds (500), so the question has two defensible answers.
 *
 * The test stubs global fetch so no real OpenAI call happens — the stub
 * inspects the user prompt the judge sends, asserts the question stem
 * is included, and returns a canned reject verdict. This proves:
 *   1. judge.judgeQuestion() is callable end-to-end
 *   2. The user prompt contains the question stem (so the model sees it)
 *   3. The reject path produces verdict='reject' with AMBIGUITY/MULTIPLE_CORRECT
 *   4. The pass path on a clean question produces verdict='pass'
 *   5. The fail-open path on an HTTP 500 produces verdict='fail-open'
 *      (lambda must keep generating even if judge is sick)
 *
 * Run (from repo root):
 *   node scripts/lake-audit/test-judge-on-place-value-bug.js
 *
 * No node_modules required — lambda/judge.js has zero non-stdlib deps.
 * Exits non-zero if any case fails.
 */
'use strict';

const path = require('path');

// Load the judge module directly from lambda/.
const judge = require(path.resolve(__dirname, '..', '..', 'lambda', 'judge.js'));

// ---- the production bug fixture ----
const PLACE_VALUE_85M = {
  id: 'gen-prod-85m',
  type: 'multiple_choice',
  prompt: 'Look at 85,759,578. What does the digit 5 represent?',
  choices: ['50,000', '500', '5,000,000', '5'],
  correctIndex: 0,
  answer: '50,000',
  explanation: 'The 5 in 85,759,578 is in the ten-thousands place.',
  teks: '4.2B',
  unitTitle: 'Place Value',
  lessonTitle: 'Identifying place value of digits in large numbers'
};

// ---- a clean question that should pass ----
const CLEAN_FRACTION = {
  id: 'gen-clean-1',
  type: 'multiple_choice',
  prompt: 'Maya cut a pizza into 8 equal slices and ate 3. What fraction did she eat?',
  choices: ['3/8', '1/3', '5/8', '8/3'],
  correctIndex: 0,
  answer: '3/8',
  explanation: '3 of 8 equal parts is 3/8.',
  teks: '3.3A',
  unitTitle: 'Fractions',
  lessonTitle: 'Naming a fraction from a model'
};

const CTX = { stateSlug: 'texas', subject: 'math', grade: 4, gradeLabel: 'Grade 4' };

// ---- fetch stub plumbing ----
const REAL_FETCH = global.fetch;
let lastSentBody = null;
let nextResponse = null;

function installStub() {
  global.fetch = async function (_url, init) {
    lastSentBody = JSON.parse(init.body);
    if (typeof nextResponse === 'function') return nextResponse();
    return nextResponse;
  };
}
function restoreFetch() {
  global.fetch = REAL_FETCH;
}
function makeResp(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof payload === 'string' ? payload : JSON.stringify(payload),
    json: async () => payload
  };
}
function modelReplyJson(verdictObj) {
  return makeResp(200, {
    choices: [{ message: { content: JSON.stringify(verdictObj) } }],
    usage: { prompt_tokens: 250, completion_tokens: 80 }
  });
}

let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  installStub();

  console.log('CASE 1 — judge rejects the 85M place-value question');
  nextResponse = modelReplyJson({
    verdict: 'reject',
    failedChecks: ['AMBIGUITY', 'MULTIPLE_CORRECT'],
    reasons: [
      'The digit 5 appears at the ten-thousands place (50,000) AND the hundreds place (500). Both are defensible.',
      'The distractor "500" is also a correct answer for one occurrence of the digit 5.'
    ]
  });
  const r1 = await judge.judgeQuestion(PLACE_VALUE_85M, CTX, { apiKey: 'sk-test', timeoutMs: 5000 });
  check('verdict is reject', r1.verdict === 'reject');
  check('failedChecks includes AMBIGUITY', r1.failedChecks.includes('AMBIGUITY'));
  check('failedChecks includes MULTIPLE_CORRECT', r1.failedChecks.includes('MULTIPLE_CORRECT'));
  check('reasons array is non-empty', Array.isArray(r1.reasons) && r1.reasons.length > 0);
  // The user prompt sent to OpenAI must contain the question stem.
  const userMsg = lastSentBody.messages.find(m => m.role === 'user');
  check('outbound user prompt contains the 85M stem', userMsg && userMsg.content.includes('85,759,578'));
  check('outbound model is gpt-4o-mini', lastSentBody.model === 'gpt-4o-mini');
  check('outbound temperature is 0', lastSentBody.temperature === 0);
  check('outbound response_format is json_object', lastSentBody.response_format && lastSentBody.response_format.type === 'json_object');

  console.log('');
  console.log('CASE 2 — judge passes a clean fraction question');
  nextResponse = modelReplyJson({ verdict: 'pass', failedChecks: [], reasons: [] });
  const r2 = await judge.judgeQuestion(CLEAN_FRACTION, CTX, { apiKey: 'sk-test', timeoutMs: 5000 });
  check('verdict is pass', r2.verdict === 'pass');
  check('failedChecks is empty', Array.isArray(r2.failedChecks) && r2.failedChecks.length === 0);

  console.log('');
  console.log('CASE 3 — fail-open on OpenAI 500');
  nextResponse = makeResp(500, 'Internal Server Error');
  const r3 = await judge.judgeQuestion(CLEAN_FRACTION, CTX, { apiKey: 'sk-test', timeoutMs: 5000 });
  check('verdict is fail-open', r3.verdict === 'fail-open');
  check('failedChecks empty on fail-open', r3.failedChecks.length === 0);

  console.log('');
  console.log('CASE 4 — normalizer flips reject-without-checks to pass');
  nextResponse = modelReplyJson({ verdict: 'reject', failedChecks: [], reasons: [] });
  const r4 = await judge.judgeQuestion(CLEAN_FRACTION, CTX, { apiKey: 'sk-test', timeoutMs: 5000 });
  check('normalizer recovers to pass', r4.verdict === 'pass');

  console.log('');
  console.log('CASE 5 — normalizer flips pass-with-checks to reject');
  nextResponse = modelReplyJson({ verdict: 'pass', failedChecks: ['STATE_LEAK'], reasons: ['mentions Alamo'] });
  const r5 = await judge.judgeQuestion(CLEAN_FRACTION, CTX, { apiKey: 'sk-test', timeoutMs: 5000 });
  check('normalizer flips to reject', r5.verdict === 'reject');
  check('failedChecks preserved', r5.failedChecks.includes('STATE_LEAK'));

  console.log('');
  console.log('CASE 6 — gateBatch drops 85M after regen also rejects');
  let regenCalls = 0;
  // Sequence: judge q1 → reject, regen → returns replacement, judge replacement → reject
  const responses = [
    modelReplyJson({ verdict: 'reject', failedChecks: ['AMBIGUITY'], reasons: ['ambiguous'] }),
    modelReplyJson({ verdict: 'reject', failedChecks: ['AMBIGUITY'], reasons: ['still ambiguous'] })
  ];
  let respIdx = 0;
  nextResponse = () => responses[respIdx++];
  const gated = await judge.gateBatch([PLACE_VALUE_85M], {
    apiKey: 'sk-test',
    timeoutMs: 5000,
    context: CTX,
    regenOne: async () => { regenCalls++; return { ...PLACE_VALUE_85M, id: 'regen-1' }; }
  });
  check('regenOne was called once', regenCalls === 1);
  check('kept is empty', gated.kept.length === 0);
  check('dropped has 1 entry', gated.dropped.length === 1);
  check('judgeCalls is 2', gated.judgeCalls === 2);
  check('batchEmpty is true', gated.batchEmpty === true);

  console.log('');
  console.log('CASE 7 — gateBatch keeps clean batch with no regen');
  nextResponse = modelReplyJson({ verdict: 'pass', failedChecks: [], reasons: [] });
  const gated2 = await judge.gateBatch([CLEAN_FRACTION], {
    apiKey: 'sk-test',
    timeoutMs: 5000,
    context: CTX,
    regenOne: async () => { throw new Error('should not be called'); }
  });
  check('kept has 1 entry', gated2.kept.length === 1);
  check('dropped is empty', gated2.dropped.length === 0);
  check('regenerated is 0', gated2.regenerated === 0);

  console.log('');
  console.log('CASE 8 — kill switch LAMBDA_JUDGE=off bypasses everything');
  process.env.LAMBDA_JUDGE = 'off';
  let stubCalled = false;
  nextResponse = () => { stubCalled = true; return modelReplyJson({ verdict: 'reject', failedChecks: ['AMBIGUITY'], reasons: ['x'] }); };
  const gated3 = await judge.gateBatch([PLACE_VALUE_85M], {
    apiKey: 'sk-test',
    context: CTX,
    regenOne: async () => null
  });
  check('kill switch keeps the question', gated3.kept.length === 1);
  check('kill switch made zero OpenAI calls', stubCalled === false);
  delete process.env.LAMBDA_JUDGE;

  restoreFetch();

  console.log('');
  if (failed > 0) {
    console.log(`RESULT: ${failed} check(s) failed.`);
    process.exit(1);
  }
  console.log('RESULT: all checks passed.');
})().catch(err => {
  console.error('FATAL:', err && (err.stack || err.message || err));
  restoreFetch();
  process.exit(1);
});
