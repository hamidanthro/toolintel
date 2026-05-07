/**
 * Reading question generator — Claude Sonnet 4.5.
 *
 * NOT RUN IN PHASE 1.
 *
 * Takes a passage object + generates `count` multiple-choice questions
 * across diverse TEKS strands. Diversity rule: among the question set,
 * span at least 3 different strand families.
 *
 * Returns array of:
 *   { stem, choices: [A,B,C,D], correctIndex, claimedTeks, type, rationale }
 */
'use strict';

const { loadKP } = require('./lib/load-kp');

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const TIMEOUT_MS = 90000;
const MAX_TOKENS = 2048;

function buildSystemPrompt() {
  const kp = loadKP();
  const sec = kp.sections;
  return `You write multiple-choice reading questions for a Texas STAAR grade-3 practice app. Each question MUST match a real STAAR pattern from KP §4 and target a real TEKS strand from KP §3.

== KP §3 — TEKS strands ==
${sec.teksStrands || ''}

== KP §4 — Question types in scope (real STAAR stems) ==
${sec.questionTypes || ''}

== KP §7 — AI-generation landmines (you must avoid these) ==
${sec.landmines || ''}

== Diversity rule ==

When generating multiple questions for the same passage, span at least
three different TEKS-strand families:
  - vocabulary (3.x)
  - response / text evidence (6.x, 7.x)
  - author's craft + purpose (8.x, 10.x)
  - genre recognition / theme / setting / character (9.x)

Don't generate 5 vocabulary questions for one passage.

== Distractor design rules (KP §4 + §7) ==

Each wrong answer MUST be plausible given a misreading of the passage:
  - Plausible-but-unsupported: extrapolation that lacks textual support
  - Right-detail-wrong-question: real text quoted, answers a different question
  - Partial-truth: half right, contains one inaccurate element
  - Surface-keyword overlap: contains a passage word used in a different sense
  - Wrong-section: real heading content cited but for the wrong sub-topic

Avoid:
  - "All of the above" / "None of the above" — TEA never uses these at grade 3
  - Distractors trivially off-topic ("the grass was green" for a main idea)
  - The correct answer being the longest/shortest option (kids notice)

== Output format ==

Return STRICT JSON: an array of question objects, each:

{
  "stem": "What is the most likely reason the author wrote this passage?",
  "choices": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "claimedTeks": "10.A",
  "stemPattern": "author's purpose",
  "rationale": "1-line internal note: why correct is correct, why each distractor is plausible-misreading"
}

Choices are exactly 4 strings. correctIndex is 0..3.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildUserPrompt({ passage, count }) {
  return `Generate ${count} questions for this passage. Span at least 3 different TEKS-strand families across the set.

Passage title: ${passage.title || '(untitled)'}
Genre: ${passage.genre}
Protagonist: ${passage.protagonistName || 'unmarked'} (${passage.protagonistDemographic || 'unmarked'})

Passage body (markdown):

${passage.body}

Return strict JSON array of ${count} question objects.`;
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
        temperature: 0.6,
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

/**
 * Generate `count` questions for a passage.
 *   args = { passage, count, apiKey }
 * Returns: array of question objects (see system prompt for shape).
 */
async function generateQuestionSet(args) {
  const { passage, count, apiKey } = args || {};
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!passage || !passage.body) throw new Error('passage required');
  const n = Number.isFinite(count) ? count : 5;

  const system = buildSystemPrompt();
  const user = buildUserPrompt({ passage, count: n });

  const resp = await callAnthropic(system, user, apiKey);
  const raw = resp && resp.content && resp.content[0] && resp.content[0].text;
  if (!raw) throw new Error('Anthropic returned no text content');

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(`question generator returned non-JSON: ${err.message} — first 200: ${String(raw).slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) throw new Error('question generator did not return a JSON array');

  // Light validation; preserve all fields, fill in type='reading_mc'.
  return parsed
    .filter(q => q && typeof q === 'object' && typeof q.stem === 'string')
    .map(q => ({
      stem: String(q.stem).trim(),
      choices: Array.isArray(q.choices) ? q.choices.map(c => String(c).trim()) : [],
      correctIndex: Number.isFinite(q.correctIndex) ? q.correctIndex : -1,
      claimedTeks: String(q.claimedTeks || q.teks || '').trim(),
      stemPattern: String(q.stemPattern || '').trim(),
      rationale: String(q.rationale || '').slice(0, 240),
      type: 'reading_mc'
    }));
}

module.exports = { generateQuestionSet, MODEL };
