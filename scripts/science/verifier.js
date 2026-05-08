/**
 * Texas Science verifier — claude-sonnet-4-5, temp 0.
 *
 * Mirror of scripts/cold-start/verifier.js (math pipeline, CLAUDE.md §33).
 * Sits between the generator and the judge: independently solves the
 * question in a fresh Anthropic context, checks TEK alignment against
 * the SE catalog, verifies science accuracy. Closes the prompt-following-
 * bias gap that capped Phase G/G2 at 12-13/100 — one model checking its
 * own work in the same prompt thread had a measurable bias toward what
 * the generator just claimed.
 *
 * Runs PER QUESTION, AFTER gen, BEFORE judge. If verifier rejects, the
 * orchestrator regenerates WITHOUT calling the judge (saves ~$0.01/call).
 * Question must pass BOTH verifier AND judge.
 *
 * Verdict shape:
 *   {
 *     verdict: 'pass' | 'reject',
 *     verifierAnswer: 0..3,                   // verifier's own pick
 *     verifierAgreesWithGenerator: bool,      // matches generator's correctIndex?
 *     tekAlignment: 'aligned' | 'misaligned' | 'unsure',
 *     scienceAccurate: bool,
 *     reasoning: string,
 *     reasons: string[],
 *     confidence: 0..1,
 *     verifierVersion: 'science-verifier-v1',
 *     source: 'llm-claude' | 'llm-error'
 *   }
 *
 * Reject codes:
 *   ANSWER_DISAGREEMENT     — verifierAnswer !== generator's correctIndex
 *   TEK_MISMATCH            — tekAlignment === 'misaligned'
 *   SCIENCE_FACTUAL_ERROR   — scienceAccurate === false
 *
 * Pass when ALL three checks pass: agreement + alignment + accuracy.
 *
 * Fail-open: any Anthropic error → 'pass' confidence=0.5 source='llm-error'.
 * Quality gate, not availability gate.
 */
'use strict';

const { loadKP } = require('./lib/load-kp');

const VERIFIER_MODEL = 'claude-sonnet-4-5';
const VERIFIER_VERSION = 'science-verifier-v1';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 45000;
// Phase H bug-fix: 600 truncated Sonnet's output mid-prose for ~39% of
// calls — the model emitted "Let me work through this..." preamble
// before getting to JSON, never reached the closing brace. 1200 leaves
// room for both the chain-of-thought (which we now prefill-suppress
// anyway) and the JSON object.
const MAX_TOKENS = 1200;

const stats = {
  calls: 0,
  passes: 0,
  rejects: 0,
  failOpens: 0,
  totalTokensIn: 0,
  totalTokensOut: 0
};

// Phase H bug-fix: 4-tier extractor.
//   Tier 0 (NEW): assistant prefill — when we send `{ role:'assistant',
//                 content: '{' }` as the last message, Anthropic
//                 returns text WITHOUT the leading `{`. Restore it
//                 before parsing.
//   Tier 1: strict ```json...``` bookends
//   Tier 2: any fenced block in the middle
//   Tier 3 (NEW, replaces single-brace tier): last balanced top-level
//                 {...} block — scans the string for matched braces
//                 (string-aware) and returns the LAST complete object,
//                 since chain-of-thought sometimes embeds {...} fragments
//                 ("the answer is { '...' }") before the real JSON.
function extractJson(text, prefilled) {
  let trimmed = String(text || '').trim();
  if (prefilled && trimmed && !trimmed.startsWith('{')) {
    trimmed = '{' + trimmed;
  }
  const strict = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (strict) return strict[1];
  const anyFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (anyFence) return anyFence[1];
  // Tier 3 — find LAST top-level balanced {...} block, string-aware
  const blocks = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let start = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        blocks.push(trimmed.slice(start, i + 1));
        start = -1;
      }
    }
  }
  if (blocks.length) return blocks[blocks.length - 1];
  return trimmed;
}

function buildSystemPrompt() {
  const kp = loadKP();
  const sec3 = kp.sections['3'] || '';
  return `You are an independent fact-checker for Texas STAAR Grade 3-8 science questions. You receive a multiple-choice question. Your job:

1. SOLVE the question yourself, fresh, without trusting any answer marked correct. Pick A, B, C, or D as YOUR answer (return as 0, 1, 2, or 3).
2. READ the SE catalog snippet below. Decide whether the question actually tests claimedTeks: 'aligned', 'misaligned', or 'unsure'.
3. Independently verify the science is correct. Return scienceAccurate true/false.

You are NOT writing or rewriting questions. You return strict JSON:

{
  "verifierAnswer": 0|1|2|3,
  "tekAlignment": "aligned" | "misaligned" | "unsure",
  "scienceAccurate": true | false,
  "reasoning": "1-2 sentences explaining your answer pick + tek call",
  "confidence": 0.0-1.0
}

Be skeptical. If you'd guess the question is testing a different SE than claimedTeks, mark misaligned. If the science is even slightly off, mark scienceAccurate=false. Better to flag a borderline case than ship a misconception.

== KP §3 — Full SE catalog by grade ==
${sec3}
== END KP §3 ==

== STRICT OUTPUT RULES ==

Your response MUST start with the literal character "{" — no preamble,
no "Let me work through this", no markdown fences. Just the JSON object.

If you need to think, do it silently. The output is the JSON object only.

Phase H learned this the hard way: 39% of calls truncated mid-prose
because the model emitted reasoning before the JSON and ran out of
tokens. Begin with "{". End with "}". Nothing before, nothing after.`;
}

function buildUserMessage(item) {
  // The verifier sees the question and the generator's claim, but it does
  // NOT see the generator's "rationale" or "explanation" — those would
  // bias the independent solve. Show only the kid-facing surface + claim.
  const letters = ['A', 'B', 'C', 'D'];
  const choicesBlock = (item.choices || []).map((c, i) => `  ${letters[i]} (index ${i}). ${c}`).join('\n');
  const passageBlock = item.passage && item.passage.body
    ? `\nScenario context (read carefully — the question may reference it):\n${item.passage.body}\n`
    : '';
  return `Grade: ${item.grade}
Generator's claimedTeks: ${item.tek_code || item.claimedTeks || '(none)'}
Generator's strand: ${item.strand || '(none)'}
${passageBlock}
Question stem: ${item.prompt || item.stem || '(missing)'}

Choices:
${choicesBlock}

Generator marked correct: index ${item.correctIndex} (${letters[item.correctIndex] || '?'})

Solve the question yourself first. Then check TEK alignment against KP §3. Then check scientific accuracy. Return strict JSON.`;
}

async function callAnthropic(systemPrompt, userMessage, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: systemPrompt,
        // Phase H bug-fix: assistant-prefill the opening "{" so the
        // model HAS to start with JSON. Anthropic continues from
        // wherever the prefill ends; "Let me work through this..." is
        // physically impossible because the previous turn already
        // committed to a JSON object. The response text will NOT
        // include the leading "{" — extractJson restores it (Tier 0).
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: '{' }
        ]
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err = new Error(`Anthropic ${res.status}: ${errText.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function failOpen(reason) {
  stats.failOpens++;
  return {
    verdict: 'pass',
    verifierAnswer: null,
    verifierAgreesWithGenerator: null,
    tekAlignment: 'unsure',
    scienceAccurate: null,
    reasoning: '',
    reasons: [],
    confidence: 0.5,
    verifierVersion: VERIFIER_VERSION,
    source: 'llm-error',
    _failOpenReason: reason
  };
}

function normalizeAndDecide(parsed, generatorCorrectIndex) {
  if (!parsed || typeof parsed !== 'object') return null;

  const verifierAnswer = (parsed.verifierAnswer === 0 || parsed.verifierAnswer === 1 || parsed.verifierAnswer === 2 || parsed.verifierAnswer === 3)
    ? parsed.verifierAnswer
    : null;
  const tekAlignment = ['aligned', 'misaligned', 'unsure'].includes(parsed.tekAlignment)
    ? parsed.tekAlignment
    : 'unsure';
  const scienceAccurate = typeof parsed.scienceAccurate === 'boolean' ? parsed.scienceAccurate : null;
  const reasoning = String(parsed.reasoning || '').slice(0, 400);
  const conf = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.7;

  const verifierAgreesWithGenerator = (verifierAnswer !== null)
    ? verifierAnswer === generatorCorrectIndex
    : null;

  // Decide verdict: pass only if all three checks survive
  const reasons = [];
  if (verifierAgreesWithGenerator === false) reasons.push('ANSWER_DISAGREEMENT');
  if (tekAlignment === 'misaligned') reasons.push('TEK_MISMATCH');
  if (scienceAccurate === false) reasons.push('SCIENCE_FACTUAL_ERROR');
  // If the verifier failed to provide an answer, treat as unsure-pass
  // (don't block on missing field) — the judge is downstream and will
  // catch real problems.
  const verdict = reasons.length === 0 ? 'pass' : 'reject';

  return {
    verdict,
    verifierAnswer,
    verifierAgreesWithGenerator,
    tekAlignment,
    scienceAccurate,
    reasoning,
    reasons,
    confidence: conf,
    verifierVersion: VERIFIER_VERSION,
    source: 'llm-claude'
  };
}

/**
 * Verify a single (question + claimedTeks + scenario) candidate.
 *   args = { item } where item is the JUDGE-ITEM shape used by run-seed-batch.js:
 *     { type, subj, grade, tek_code, claimedTeks?, strand, standard_type,
 *       region_tag?, prompt, choices, correctIndex, explanation,
 *       passage?: { title, body } }
 * Returns the verdict shape documented at top of file.
 */
async function verifyQuestion(item) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set — verifier requires Anthropic key (Secrets Manager: staar-tutor/anthropic-api-key)');
  }
  if (!item || typeof item !== 'object') {
    return failOpen('no-item');
  }

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(item);
  const generatorCorrect = Number.isFinite(item.correctIndex) ? item.correctIndex : -1;

  let completion;
  // Fail-open: judge is a quality gate, not an availability gate.
  // Anthropic blip != content drop.
  try {
    completion = await callAnthropic(systemPrompt, userMessage, apiKey);
  } catch (err) {
    const tag = err && err.name === 'AbortError' ? 'timeout' : 'api-error';
    return failOpen(`${tag}:${(err && err.message || 'unknown').slice(0, 160)}`);
  }

  stats.calls++;
  stats.totalTokensIn += completion?.usage?.input_tokens || 0;
  stats.totalTokensOut += completion?.usage?.output_tokens || 0;

  const raw = completion?.content?.[0]?.text;
  if (!raw || typeof raw !== 'string') {
    return failOpen('empty-response');
  }

  let parsed;
  try {
    // prefilled=true: the model's response continues an assistant turn
    // that already committed to "{", so the response text starts with
    // the field after the brace, not the brace itself.
    parsed = JSON.parse(extractJson(raw, true));
  } catch (err) {
    return failOpen(`json-parse:${(err.message || '').slice(0, 80)}`);
  }

  const out = normalizeAndDecide(parsed, generatorCorrect);
  if (!out) {
    return failOpen('unparseable-verdict');
  }

  if (out.verdict === 'pass') stats.passes++;
  else stats.rejects++;
  return out;
}

module.exports = {
  verifyQuestion,
  VERIFIER_MODEL,
  VERIFIER_VERSION,
  stats,
  _internal: { buildSystemPrompt, buildUserMessage, normalizeAndDecide, extractJson }
};
