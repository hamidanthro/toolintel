/**
 * Reading question judge — single LLM pass.
 *
 * Takes a passage + a single question (4-option MC) + the claimed correct
 * index + the claimed TEKS strand. Verifies:
 *   - the question is answerable from the passage
 *   - the claimed correct answer is the only correct answer
 *   - distractors are plausible-given-misreading (not trivially eliminable)
 *   - the stem matches a §4 STAAR pattern (or recognizable variant)
 *   - the claimed TEKS strand matches the question's actual focus
 *
 * Pattern mirrors judge-passage.js. Same fail-open behavior.
 */
'use strict';

const { loadKP } = require('./lib/load-kp');

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const TIMEOUT_MS = 30000;
const MAX_TOKENS = 384;

const FAILURE_MODES = [
  'STEM_NOT_REAL_STAAR',  // stem doesn't match §4 catalog or recognizable variant
  'WRONG_TEKS_LABEL',     // claimed strand doesn't match actual question focus
  'WEAK_DISTRACTOR',      // at least one wrong answer trivially eliminable
  'OFF_TEXT',             // question can't be answered from THIS passage
  'DOUBLE_ANSWER',        // more than one option satisfies the stem
  'NO_ANSWER',            // zero options satisfy the stem
  'AMBIGUOUS',            // multiple options seem right under fair reading
  'STEM_LEAKS_ANSWER'     // stem itself contains the answer
];

function buildSystemPrompt() {
  const kp = loadKP();
  const sec = kp.sections;
  return `You evaluate single multiple-choice reading questions for a Texas STAAR grade-3 practice app. You are STRICT: a kid taking practice should never see a question that has zero, two, or unanswerable answers.

== KP §3 — TEKS strands ==
${sec.teksStrands || ''}

== KP §4 — Question types in scope (real STAAR stems) ==
${sec.questionTypes || ''}

== Your task ==

For the (passage, question) pair you are given, return STRICT JSON:

{
  "verdict": "pass" | "fail",
  "confidence": 0.0,
  "reasons": ["OFF_TEXT", "WEAK_DISTRACTOR"],
  "note": "1-2 sentence explanation"
}

== Failure-reason vocabulary ==

  STEM_NOT_REAL_STAAR  — stem doesn't match §4 catalog or a recognizable variant
  WRONG_TEKS_LABEL     — claimed TEKS strand doesn't match what the question actually asks
  WEAK_DISTRACTOR      — at least one wrong answer is trivially wrong (random, off-topic)
  OFF_TEXT             — question can't be answered from THIS passage
  DOUBLE_ANSWER        — more than one option satisfies the stem
  NO_ANSWER            — zero options satisfy the stem (the marked-correct is wrong)
  AMBIGUOUS            — under a fair reading, multiple options could be defended
  STEM_LEAKS_ANSWER    — stem contains the answer (e.g. "What is the capital of Texas, Austin?")

== Strict-pass requirements ==

- Read the passage carefully before judging the question.
- The marked-correct answer MUST be the only correct one.
- All 3 distractors should be plausible misreadings of the passage. A distractor that's trivially off-topic ("the grass was green" for a main-idea question) → WEAK_DISTRACTOR.
- The stem must match a §4 pattern: vocabulary-in-context, key idea, author's purpose, setting/character/plot, inference, etc. Reject stems that read like trivia ("How many words are in this passage?") or are not in the §4 catalog.
- The claimed TEKS strand should match the question's focus. Vocab questions are 3.x; theme is 9.Di; author's purpose is 10.A; etc.
- Pass borderline cases at confidence<0.7 so the human reviewer sees them.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function letterFor(idx) { return ['A', 'B', 'C', 'D'][idx] || '?'; }

function buildUserPrompt({ passage, question }) {
  const choicesBlock = (question.choices || []).map((c, i) => `  ${letterFor(i)}. ${c}`).join('\n');
  const correct = letterFor(question.correctIndex);
  return `Passage title: ${passage.title || '(untitled)'}
Passage genre: ${passage.genre}

Passage body (markdown):

${passage.body}

---

Question stem: ${question.stem}

Choices:
${choicesBlock}

Marked correct: ${correct} (index ${question.correctIndex})
Claimed TEKS strand: ${question.claimedTeks || question.teks || '(unspecified)'}`;
}

async function callAnthropic(systemPrompt, userMessage, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`Anthropic ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function normalizeOutput(parsed) {
  const verdict = parsed.verdict === 'fail' ? 'fail' : 'pass';
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter(r => FAILURE_MODES.includes(r)) : [];
  const confidence = typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7;
  const note = String(parsed.note || '').slice(0, 240);
  if (verdict === 'fail' && reasons.length === 0) {
    return { verdict: 'pass', source: 'llm', reasons: [], confidence: 0.4, note: 'fail-without-reason → pass' };
  }
  return { verdict, source: 'llm', reasons, confidence, note };
}

/**
 * Judge a single (passage, question) pair.
 *   args = { passage, question, apiKey }
 *     passage: { title, body, genre, ... }
 *     question: { stem, choices: [a,b,c,d], correctIndex: 0..3, claimedTeks }
 *
 * Returns: { verdict, source, reasons, confidence, note, kpVersion }
 */
async function judgeQuestion(args) {
  const { passage, question, apiKey } = args || {};

  // Minimal structural sanity (no API call yet)
  if (!passage || !passage.body) {
    return { verdict: 'fail', source: 'structural', reasons: ['OFF_TEXT'], confidence: 1.0,
      note: 'no passage body', kpVersion: loadKP().kpVersion };
  }
  if (!question || !question.stem || !Array.isArray(question.choices) || question.choices.length !== 4) {
    return { verdict: 'fail', source: 'structural', reasons: ['STEM_NOT_REAL_STAAR'], confidence: 1.0,
      note: 'malformed question shape', kpVersion: loadKP().kpVersion };
  }
  if (typeof question.correctIndex !== 'number' || question.correctIndex < 0 || question.correctIndex > 3) {
    return { verdict: 'fail', source: 'structural', reasons: ['NO_ANSWER'], confidence: 1.0,
      note: 'invalid correctIndex', kpVersion: loadKP().kpVersion };
  }

  if (!apiKey) {
    return { verdict: 'pass', source: 'no-api-key', reasons: [], confidence: 0.5,
      note: 'no-api-key fail-open', kpVersion: loadKP().kpVersion };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ passage, question });

  let raw;
  try {
    const resp = await callAnthropic(systemPrompt, userPrompt, apiKey);
    raw = resp && resp.content && resp.content[0] && resp.content[0].text;
    if (!raw) {
      return { verdict: 'pass', source: 'llm-empty', reasons: [], confidence: 0.5,
        note: 'empty-response fail-open', kpVersion: loadKP().kpVersion };
    }
  } catch (err) {
    const tag = err && err.name === 'AbortError' ? 'timeout' : 'api-error';
    console.warn(`[judge-question] WARN: ${tag} — fail-open: ${(err && err.message || '').slice(0, 200)}`);
    return { verdict: 'pass', source: `llm-${tag}`, reasons: [], confidence: 0.5,
      note: `judge-${tag}`, kpVersion: loadKP().kpVersion };
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    console.warn(`[judge-question] bad-JSON fail-open: ${err.message}`);
    return { verdict: 'pass', source: 'llm-bad-json', reasons: [], confidence: 0.5,
      note: 'bad-json fail-open', kpVersion: loadKP().kpVersion };
  }

  const out = normalizeOutput(parsed);
  return { ...out, kpVersion: loadKP().kpVersion };
}

module.exports = { judgeQuestion, FAILURE_MODES, MODEL };
