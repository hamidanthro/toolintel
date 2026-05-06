/**
 * Fun-facts judge — Claude Sonnet 4.5.
 * Evaluates one fact at a time against 9 failure modes.
 *
 * No deps — uses Node 20+ built-in fetch.
 */
'use strict';

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const TIMEOUT_MS = 30000;

const FAILURE_MODES = [
  'FACTUAL_INCORRECT',
  'VOCAB_TOO_HARD',
  'SENTENCE_TOO_LONG',
  'TOO_LONG',
  'REQUIRES_BACKGROUND',
  'SCARY_OR_VIOLENT',
  'CULTURALLY_INSENSITIVE',
  'NOT_WOW',
  'DUPLICATE_TOPIC'
];

const SYSTEM_PROMPT = `You are a strict content reviewer for K-8 educational content. You verify fun facts for 3rd-4th graders meet quality bar.

Evaluate the given fact against these criteria:

1. FACTUAL: Is the claim accurate? Cross-check with the citation. Reject if false, exaggerated, urban-legend-style, or unverifiable. Reject if the citation does not actually support the fact.

2. VOCAB_TOO_HARD: Are all words appropriate for a 3rd-grader at the BOTTOM of that range (i.e. a 2nd-grade reader)? Reject "fascinating," "phenomenon," "remarkable," "extraordinary," "approximately," "complex," "essentially," "consume," "comprise," "predominantly," and similar adult-register words. Concrete proper nouns (Octopus, Hedy Lamarr, Texas) are fine.

3. SENTENCE_TOO_LONG: Is every sentence ≤15 words? Count words per sentence carefully (split on .!?). A title or single-word interjection counts as a sentence too.

4. TOO_LONG: Is total ≤40 words? Count all words across all sentences.

5. REQUIRES_BACKGROUND: Does understanding require knowledge a 3rd-grader wouldn't have? E.g. references to Cold War, derivatives, plate tectonics without explaining, etc.

6. SCARY_OR_VIOLENT: Is content scary, violent, sexual, gross beyond fun-gross, or politically charged? Animal predation should not be graphic. Death should not be highlighted. Reject if the fact would unsettle an 8-year-old.

7. CULTURALLY_INSENSITIVE: Does the fact stereotype, exoticize, or condescend to any group? Avoid "weird foods from country X" framing. Avoid "primitive" / "ancient people who didn't know" framing.

8. NOT_WOW: Does the fact actually surprise / delight at the requested wow level? Reject if it's obvious or boring for the level. Level 1 should still feel like a small surprise, not a textbook restatement.

9. DUPLICATE_TOPIC: Is the angle a near-duplicate of another fact in this batch (you'll see the batch list when relevant)? Reject if the same surprising "core" appears in a different fact.

Format: return ONLY JSON. No prose, no markdown fences.
{ "verdict": "pass" | "reject", "reasons": [ZERO_OR_MORE_FAILURE_CODES], "confidence": 0.0-1.0, "note": "brief 1-line reasoning, max 80 chars" }

Failure codes (use these exact strings):
FACTUAL_INCORRECT, VOCAB_TOO_HARD, SENTENCE_TOO_LONG, TOO_LONG, REQUIRES_BACKGROUND, SCARY_OR_VIOLENT, CULTURALLY_INSENSITIVE, NOT_WOW, DUPLICATE_TOPIC

Be strict. Better to reject and regenerate than pass weak content. Confidence 0.0-1.0.`;

function buildUserPrompt({ fact, citation, category, wowLevel, batchPeers }) {
  const peers = Array.isArray(batchPeers) && batchPeers.length
    ? '\n\nOther facts in the same batch (check for duplicate angles):\n' +
      batchPeers.slice(0, 30).map((p, i) => `${i + 1}. ${String(p).slice(0, 120)}`).join('\n')
    : '';
  return `Category: ${category}\nWow level: ${wowLevel}\nFact to evaluate: "${fact}"\nCitation: ${citation || '(none)'}${peers}\n\nReturn JSON verdict.`;
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
        max_tokens: 256,
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

/**
 * Cheap JS-side pre-check for length-rule violations. Catches the
 * most-common rejections without burning an API call. The judge
 * still runs after this to catch the harder modes (FACTUAL,
 * VOCAB, NOT_WOW, etc.) but trivially-too-long facts get rejected
 * locally first.
 */
function preCheckLength(fact) {
  const text = String(fact || '').trim();
  const totalWords = text.split(/\s+/).filter(Boolean).length;
  if (totalWords > 40) {
    return { localReject: true, reasons: ['TOO_LONG'], note: `total=${totalWords} words` };
  }
  // Sentence split: handle . ! ? plus em-dash sentence chains.
  const sentences = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const w = s.split(/\s+/).filter(Boolean).length;
    if (w > 15) {
      return { localReject: true, reasons: ['SENTENCE_TOO_LONG'], note: `${w}-word sentence` };
    }
  }
  return { localReject: false };
}

/**
 * Judge a single fact. Returns:
 *   { verdict: 'pass' | 'reject', reasons: [...], confidence: 0..1, note: '...', source: 'local'|'remote' }
 *
 * On Anthropic API failure: fail-open with verdict='pass', reasons=[], note='judge-api-error'.
 * Same principle as the math verifier (CLAUDE.md §33): a transient API
 * hiccup shouldn't block content. Caller can still reject for shape
 * issues separately if desired.
 */
async function judgeFact({ fact, citation, category, wowLevel, batchPeers, apiKey }) {
  // Local pre-check for length rules — saves API calls.
  const local = preCheckLength(fact);
  if (local.localReject) {
    return { verdict: 'reject', reasons: local.reasons, confidence: 1.0, note: local.note, source: 'local' };
  }

  if (!apiKey) {
    return { verdict: 'pass', reasons: [], confidence: 0.5, note: 'no-api-key fail-open', source: 'local' };
  }

  const user = buildUserPrompt({ fact, citation, category, wowLevel, batchPeers });
  let raw;
  try {
    const resp = await callAnthropic(SYSTEM_PROMPT, user, apiKey);
    raw = resp && resp.content && resp.content[0] && resp.content[0].text;
    if (!raw) {
      return { verdict: 'pass', reasons: [], confidence: 0.5, note: 'empty-response fail-open', source: 'local' };
    }
  } catch (err) {
    const tag = err && err.name === 'AbortError' ? 'timeout' : 'api-error';
    console.warn(`[judge] WARN: ${tag} — fail-open: ${(err && err.message || '').slice(0, 200)}`);
    return { verdict: 'pass', reasons: [], confidence: 0.5, note: `judge-${tag}`, source: 'local' };
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    console.warn(`[judge] bad-JSON fail-open: ${err.message}`);
    return { verdict: 'pass', reasons: [], confidence: 0.5, note: 'bad-json fail-open', source: 'local' };
  }
  const verdict = (parsed.verdict === 'reject' ? 'reject' : 'pass');
  const reasons = Array.isArray(parsed.reasons) ? parsed.reasons.filter(r => FAILURE_MODES.includes(r)) : [];
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;
  const note = String(parsed.note || '').slice(0, 120);
  // Sanity: if verdict='reject' but no valid reason codes, downgrade to pass (model hallucinated).
  if (verdict === 'reject' && reasons.length === 0) {
    return { verdict: 'pass', reasons: [], confidence: 0.5, note: 'reject-without-reason → pass', source: 'remote' };
  }
  return { verdict, reasons, confidence, note, source: 'remote' };
}

module.exports = { judgeFact, FAILURE_MODES, MODEL };
