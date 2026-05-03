/**
 * Math verifier — second-pass quality gate.
 *
 * After a question is generated, ask Anthropic claude-sonnet-4-5 to:
 *   1. Solve the question independently from scratch (anti-anchoring:
 *      we show the choices but NOT which one is marked correct).
 *   2. Pick which choice (A/B/C/D) matches its solution.
 *   3. Judge whether the explanation correctly justifies the answer.
 *
 * If the verifier's chosen letter ≠ item.correctIndex, the question
 * is rejected.
 *
 * --- Why Claude (May 3 swap, see CLAUDE.md §33) ---
 * Pre-§33 this verifier used gpt-4o. The §32 grade-7 mini-probe
 * surfaced 2/16 questions with arithmetic errors that the entire
 * OpenAI pipeline (gpt-4o-mini gen + gpt-4o judge + gpt-4o verifier)
 * missed — same model family, correlated blind spot on fraction
 * simplification. Swapping to Claude Sonnet 4.5 (different vendor,
 * different training data) gives uncorrelated errors with the
 * OpenAI gen+judge layers.
 *
 * Cost: ~250 input + ~200 output tokens per call ≈ $0.0042 per
 * verify (Claude Sonnet 4.5 = $3/M input + $15/M output). Slightly
 * cheaper than gpt-4o ($0.005/call) and uncorrelated with the OpenAI
 * gen path.
 *
 * --- Fail-open on API error ---
 * If Anthropic returns a non-2xx or the request times out, log
 * [verifier] WARN and let the question through (`ok: true`). Same
 * principle as the lambda judge (§25): a transient API hiccup
 * shouldn't block content. If you see fail-open warnings clustering
 * in CloudWatch, investigate the API-side issue.
 */
'use strict';

const VERIFIER_MODEL = 'claude-sonnet-4-5';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const VERIFIER_TIMEOUT_MS = 30000;

function gradeReadable(grade) {
  if (grade === 'grade-k') return 'Kindergarten';
  if (grade === 'algebra-1') return 'Algebra 1';
  if (grade === 'geometry') return 'Geometry';
  const m = grade.match(/grade-(\d+)/);
  return m ? `Grade ${m[1]}` : grade;
}

const SYSTEM = `You are an expert K-12 math verifier. You will be shown a multiple-choice math question with four lettered choices (A, B, C, D). Your job:

1. Solve the problem yourself from scratch, step by step. Do NOT trust any provided answer key. Show your full reasoning.
2. Simplify all fractions to lowest terms before comparing (2/4 = 1/2; 36/92 = 9/23).
3. Round all decimals to 4 decimal places before comparing (0.5 = 0.5000; 1/3 = 0.3333).
4. After you have YOUR independent answer, identify which lettered choice (A/B/C/D) matches it. If your answer matches none of the four, set chosenLetter to null.
5. Judge whether the provided explanation correctly justifies your chosen answer.

Critical rules:
- Solve the math BEFORE looking at the explanation. Do not anchor to the explanation's reasoning.
- Catch arithmetic errors at every step, especially in fraction simplification (e.g., 36/92 simplifies to 9/23, NOT 9/14).
- For mixed-number conversions: 33/12 = 2 9/12 = 2 3/4 (NOT 2 1/12).
- If the choices contain mathematically-equivalent forms (e.g., 1/2 and 2/4 both present), flag MULTIPLE_CORRECT in issues.

Output ONLY valid JSON, no preamble, no markdown fences:
{
  "myWork": "step-by-step reasoning showing your independent solution",
  "myAnswer": "the value you computed",
  "chosenLetter": "A" | "B" | "C" | "D" | null,
  "explanationConsistent": true | false,
  "issues": ["any factual errors, contradictions, grade-inappropriate content, or multiple-correct distractors"]
}`;

function buildPrompt(item, grade) {
  const choicesBlock = item.choices.map((c, i) => `  ${'ABCD'[i]}. ${c}`).join('\n');
  return `Question (${gradeReadable(grade)}):
${item.question}

Choices:
${choicesBlock}

Tasks:
1. Solve the problem yourself, step by step.
2. State which lettered choice (A/B/C/D) your solution matches. If your answer matches none of the four choices, set chosenLetter to null.
3. Judge whether the explanation provided below correctly justifies your chosen answer.

Provided explanation:
${item.explanation || '(none)'}

Output ONLY the JSON object specified in your system instructions. No preamble, no markdown.`;
}

// ---- Anthropic call with timeout + fail-open ----
async function callAnthropic(systemPrompt, userMessage, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VERIFIER_TIMEOUT_MS);
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: VERIFIER_MODEL,
        max_tokens: 1024,
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

// Anthropic doesn't have an OpenAI-style JSON mode — strip markdown
// fences if the model wraps its JSON in them.
function extractJson(text) {
  const trimmed = String(text || '').trim();
  // Strip ```json ... ``` or ``` ... ``` fences if present
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Returns { ok: bool, reason?: string, verifier?: object }.
 *
 * ok=true → the verifier independently solved to the same letter as
 * item.correctIndex AND found no factual issues.
 *
 * On Anthropic API failure: fail-open (ok: true, reason describes
 * the failure). See CloudWatch for [verifier] WARN lines if this
 * happens repeatedly.
 */
async function verifyMath(item, grade) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[verifier] WARN: ANTHROPIC_API_KEY not set — fail-open');
    return { ok: true, reason: 'verifier-no-key', verifier: null };
  }

  const correctLetter = 'ABCD'[item.correctIndex];
  const prompt = buildPrompt(item, grade);
  let raw;
  try {
    const resp = await callAnthropic(SYSTEM, prompt, apiKey);
    raw = resp && resp.content && resp.content[0] && resp.content[0].text;
    if (!raw) {
      console.warn('[verifier] WARN: Anthropic returned no text content — fail-open');
      return { ok: true, reason: 'verifier-empty-response', verifier: null };
    }
  } catch (err) {
    const tag = err && err.name === 'AbortError' ? 'timeout' : 'api-error';
    console.warn(`[verifier] WARN: Anthropic ${tag} — fail-open: ${(err && err.message || '').slice(0, 200)}`);
    return { ok: true, reason: `verifier-${tag}`, verifier: null };
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    // Don't fail-open on bad JSON — that means the model didn't follow
    // the format, which is a real signal worth rejecting on. (Unlike a
    // network error, which is transient and shouldn't block content.)
    return { ok: false, reason: `verifier-bad-json: ${err.message}`, raw };
  }

  if (!parsed.chosenLetter) {
    return {
      ok: false,
      reason: `verifier-no-match (none of A/B/C/D matches verifier's computed answer "${parsed.myAnswer}")`,
      verifier: parsed
    };
  }
  if (parsed.chosenLetter !== correctLetter) {
    return {
      ok: false,
      reason: `verifier-answer-mismatch: marked=${correctLetter} verifier=${parsed.chosenLetter} (verifier's answer="${parsed.myAnswer}")`,
      verifier: parsed
    };
  }
  if (parsed.explanationConsistent === false) {
    return {
      ok: false,
      reason: `verifier-explanation-inconsistent: ${(parsed.issues || []).join('; ')}`,
      verifier: parsed
    };
  }
  if (Array.isArray(parsed.issues) && parsed.issues.length) {
    return {
      ok: false,
      reason: `verifier-flagged-issues: ${parsed.issues.join('; ')}`,
      verifier: parsed
    };
  }
  return { ok: true, verifier: parsed };
}

module.exports = { verifyMath, VERIFIER_MODEL };

// ============================================================
// PRIOR OPENAI VERIFIER — kept here commented for easy revert if
// the Anthropic swap regresses. To revert: replace the above
// implementation with this block. See CLAUDE.md §33 for context.
// ============================================================
//
// const { getOpenAI } = require('./lake-client');
// const VERIFIER_MODEL = 'gpt-4o';
// const SYSTEM = 'You are an expert K-12 math teacher reviewing a multiple-choice question. Your job is to solve the problem yourself from scratch — do not trust any provided answer key — and then judge which lettered choice (A/B/C/D) matches your solution. Output ONLY valid JSON.';
// async function verifyMath(item, grade) {
//   const correctLetter = 'ABCD'[item.correctIndex];
//   const prompt = buildPrompt(item, grade);
//   const resp = await getOpenAI().chat.completions.create({
//     model: VERIFIER_MODEL,
//     messages: [
//       { role: 'system', content: SYSTEM },
//       { role: 'user', content: prompt }
//     ],
//     response_format: { type: 'json_object' },
//     temperature: 0
//   });
//   const raw = resp.choices[0].message.content;
//   const parsed = JSON.parse(raw);
//   // ... same letter-matching logic
// }
