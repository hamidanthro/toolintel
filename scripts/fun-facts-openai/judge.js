/**
 * Fun-facts judge — OpenAI gpt-4o fork.
 *
 * Mirrors scripts/fun-facts/judge.js. Uses OpenAI gpt-4o instead of
 * Claude. Same 9 failure modes + an added CONTROVERSIAL mode for
 * Hamid's hard rule that nothing controversial reaches kids.
 */
'use strict';

const MODEL = 'gpt-4o';
const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
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
  'DUPLICATE_TOPIC',
  'CONTROVERSIAL'
];

function buildSystemPrompt(gradeBand) {
  const band = gradeBand || '3-4';
  const vocabBar = band === 'k-2'
    ? 'Vocabulary appropriate for K-2 readers (5-7 yo). Reject "fascinating", "approximately", "phenomenon", "process", "particular", multi-syllable Latin/Greek roots a kindergartener wouldn\'t recognize. Single-clause sentences strongly preferred. Sentence cap: 14 words.'
    : band === '5-8'
      ? 'Vocabulary appropriate for 5th-8th grade readers (10-13 yo). Specific scientific or historical terms ARE allowed if naturally introduced. Sentence cap: 20 words. Total 1-3 sentences ≤55 words.'
      : 'Vocabulary appropriate for 3rd-4th grade readers (8-9 yo). Reject "fascinating", "phenomenon", "remarkable", "extraordinary", "approximately", "complex", "essentially", "consume", "comprise", "predominantly", and similar adult-register words. Concrete proper nouns are fine. Sentence cap: 15 words.';

  return `You are a strict content reviewer for K-8 educational content. You verify fun facts for ${band === 'k-2' ? 'K-2 (5-7 yo)' : band === '5-8' ? '5th-8th grade (10-13 yo)' : '3rd-4th grade (8-9 yo)'} readers in the United States.

Evaluate the given fact against these criteria:

1. FACTUAL_INCORRECT: Is the claim accurate within reasonable kid-level approximation? Reject if it's actually false, urban-legend-only, or substantially misleading. ACCEPT minor approximations that are commonly true ("cheetahs run as fast as a highway car" — yes, a fast highway car). ACCEPT well-attested facts even if the citation phrasing is rough. Reject only when the FACT itself is wrong, not when you're nitpicking the citation. When in doubt about a borderline approximation, PASS.

2. VOCAB_TOO_HARD: ${vocabBar}

3. SENTENCE_TOO_LONG: Count words per sentence carefully (split on .!?). A title or single-word interjection counts as a sentence too. ${band === 'k-2' ? '14-word cap' : band === '5-8' ? '20-word cap' : '15-word cap'}.

4. TOO_LONG: ${band === '5-8' ? '≤55 words total' : '≤40 words total'}. Count all words across all sentences.

5. REQUIRES_BACKGROUND: Does understanding require knowledge a kid in this band wouldn't have?

6. SCARY_OR_VIOLENT: Is content scary, violent, sexual, gross beyond fun-gross, or upsetting? Animal predation should not be graphic. Death should not be highlighted. Reject if it would unsettle a child.

7. CULTURALLY_INSENSITIVE: Does the fact stereotype, exoticize, or condescend to any group? Avoid "weird foods from country X" framing. Avoid "primitive" / "ancient people who didn't know" framing. Be respectful.

8. NOT_WOW: Does the fact have ANY chance of delighting a kid in the band? Be GENEROUS here — many "obvious to adults" facts are pure wow to kids (cheetahs run very fast, sloths are slow, octopus has 3 hearts). Reject ONLY if the fact is genuinely boring (e.g., "trees are tall", "the sky is blue") or has no surprise factor for ANY kid. When in doubt, PASS — kids find more things wow than adults do.

9. DUPLICATE_TOPIC: Is the angle a near-duplicate of another fact in this batch (or a prior covered angle)? Reject if the same surprising "core" appears elsewhere.

10. CONTROVERSIAL: HARD RULE — reject anything controversial:
    - Politics, current events, elections, parties, political figures.
    - Wars, military operations, ancient or modern conflicts as primary topic.
    - Religion or religious practice (EXCEPT in the mythology category where ancient myths are explicitly the topic).
    - Divisive figures or topics families could disagree about.
    - Anything that could make a parent uncomfortable showing to their kid.
    When unsure, reject.

Format: return ONLY JSON. No prose, no markdown fences.
{ "verdict": "pass" | "reject", "reasons": [ZERO_OR_MORE_FAILURE_CODES], "confidence": 0.0-1.0, "note": "brief 1-line reasoning, max 80 chars" }

Failure codes (use these exact strings):
FACTUAL_INCORRECT, VOCAB_TOO_HARD, SENTENCE_TOO_LONG, TOO_LONG, REQUIRES_BACKGROUND, SCARY_OR_VIOLENT, CULTURALLY_INSENSITIVE, NOT_WOW, DUPLICATE_TOPIC, CONTROVERSIAL

Be strict. Better to reject and regenerate than pass weak content. Confidence 0.0-1.0.`;
}

function buildUserPrompt({ fact, citation, category, wowLevel, batchPeers }) {
  const peers = Array.isArray(batchPeers) && batchPeers.length
    ? '\n\nOther facts in the same batch (check for duplicate angles):\n' +
      batchPeers.slice(0, 30).map((p, i) => `${i + 1}. ${String(p).slice(0, 120)}`).join('\n')
    : '';
  return `Category: ${category}\nWow level: ${wowLevel}\nFact to evaluate: "${fact}"\nCitation: ${citation || '(none)'}${peers}\n\nReturn JSON verdict.`;
}

async function callOpenAI(systemPrompt, userMessage, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        max_tokens: 256,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });
    if (!res.ok) {
      const errText = await res.text();
      const err = new Error(`OpenAI ${res.status}: ${errText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Judge one fact. Returns { verdict, reasons, confidence, note, source }.
 * On API error returns fail-open verdict (verdict='pass') with note tagged
 * 'judge-fail-open' — better to ship a probably-OK fact than to drop the
 * whole pipeline on a transient API hiccup.
 */
async function judgeFact({ fact, citation, category, wowLevel, batchPeers, apiKey, gradeBand }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const system = buildSystemPrompt(gradeBand);
  const user = buildUserPrompt({ fact, citation, category, wowLevel, batchPeers });
  let resp;
  try {
    resp = await callOpenAI(system, user, apiKey);
  } catch (err) {
    return {
      verdict: 'pass',
      reasons: [],
      confidence: 0.5,
      note: 'judge-fail-open: ' + (err.message || String(err)).slice(0, 60),
      source: 'fail-open'
    };
  }
  const raw = resp && resp.choices && resp.choices[0] && resp.choices[0].message && resp.choices[0].message.content;
  if (!raw) {
    return { verdict: 'pass', reasons: [], confidence: 0.5, note: 'judge-empty-response', source: 'fail-open' };
  }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (_) {
    return { verdict: 'pass', reasons: [], confidence: 0.5, note: 'judge-non-json', source: 'fail-open' };
  }
  const verdict = parsed.verdict === 'reject' ? 'reject' : 'pass';
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter(r => FAILURE_MODES.indexOf(r) >= 0)
    : [];
  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.7;
  const note = String(parsed.note || '').slice(0, 100);
  return { verdict, reasons, confidence, note, source: MODEL };
}

module.exports = { judgeFact, FAILURE_MODES, MODEL };
