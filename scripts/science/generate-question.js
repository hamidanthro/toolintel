/**
 * Texas Science question generator — claude-sonnet-4-5.
 *
 * Generates a set of science MC questions — either as a cluster anchored
 * to a scenario, or as standalone (KP §6 Pattern A). Mirror of
 * scripts/reading/generate-question.js shape: raw fetch to Anthropic,
 * KP injected into the system prompt, strict JSON array out.
 *
 * KP injection: §3 (full SE catalog) + §5 (misconceptions) + §7
 * (generation rules) wrapped with '== KP §N — Title ==' markers.
 *
 * Distractor rule (per KP §7 #9): for every MC, at least 1 of 3 wrong
 * answers MUST reflect a documented misconception from KP §5.
 *
 * Diversity rule: when count >= 3, span ≥2 strands across the set.
 *
 * Generator does NOT stamp _judge*. Orchestrator stamps after the judge.
 */
'use strict';

const { loadKP } = require('./lib/load-kp');

// Phase I: model swap from Sonnet 4.5 to Opus 4.7. Pure model change —
// no prompt edits. Hypothesis: stronger reasoning cuts the
// ANSWER_FOUND_IN_PROMPT / SCIENCE_FACTUAL_ERROR / TEXAS_GEO_ERROR
// classes that survive the H2 verifier+judge double gate. ~5x cost
// per call ($0.015 → $0.075 typical) — total run ~$15-25.
const MODEL = 'claude-opus-4-7';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 90000;
// Phase I retry: Sonnet sized fine at 1536. Opus 4.7 produces longer
// explanations/rationales and truncated mid-JSON for 100% of calls
// (parser breaks at position ~3600-4000, well past 1536 tokens'
// worth of text). 4096 leaves ~3x headroom for 5-question batches.
const MAX_TOKENS = 4096;

function extractJson(text) {
  const trimmed = String(text || '').trim();
  const strict = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (strict) return strict[1];
  const anyFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (anyFence) return anyFence[1];
  // For an array response, find first '[' and last ']'
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  return trimmed;
}

function buildSystemPrompt() {
  const kp = loadKP();
  const sec3 = kp.sections['3'] || '';
  const sec5 = kp.sections['5'] || '';
  const sec7 = kp.sections['7'] || '';
  return `You write multiple-choice science questions for a Texas STAAR practice app. Each question MUST target a real Student Expectation (SE) from KP §3 and obey the generation rules in KP §7.

== KP §3 — Full SE catalog by grade ==
${sec3}
== END KP §3 ==

== KP §5 — Common misconceptions library ==
${sec5}
== END KP §5 ==

== KP §7 — Generation rules ==
${sec7}
== END KP §7 ==

== Locked rules (LOCKED) ==

1. Each question references exactly ONE primary tek_code from §3.
2. Declare strand from the 4-strand taxonomy. Use these strand strings
   (not snake_case keys): "Matter & Energy", "Force, Motion & Energy",
   "Earth & Space", "Organisms & Environments", "Biological Structures,
   Functions, & Processes", "Mechanisms of Genetics", "Biological
   Evolution", "Interdependence within Environmental Systems",
   "Scientific & Engineering Practices".
3. Declare standardType: "Readiness" or "Supporting" for STAAR-tested
   grades (5, 8, biology); "Practice" for grades 3, 4, 6, 7.
4. Vocabulary at or below the grade-band ceiling.
5. NO diagram references. NO references to "the figure", "the chart",
   "the picture", "the food web shown" — text only.
6. Exactly 4 choices per MC. correctIndex 0..3.
7. AT LEAST ONE of the 3 wrong answers MUST reflect a documented
   misconception from KP §5. Note in the rationale which distractor
   is the misconception and which §5 entry it maps to.
8. NO "All of the above" / "None of the above".
9. The correct answer must NOT be reliably the longest or shortest
   option — kids notice.
10. Diversity: when generating 3+ questions, span at least 2 different
    strands across the set.

== TEK claim discipline (LOCKED, this is the most important rule) ==

For each question, follow this exact 3-step process:

1. DRAFT the question stem and 4 choices first. Do not commit to a
   tek_code yet. Focus on the science, the scenario reference, and
   the misconception in the distractor.

2. RE-READ KP §3 above. Find the SE whose text most precisely matches
   what your question actually tests. Not the SE the brief suggested —
   the SE that the question, AS WRITTEN, tests.

   Example: brief targets 5.6A ("compare/contrast matter by properties:
   mass, magnetism, relative density..."). You drafted a question
   about whether the mass of salt + water stays the same after
   dissolving. That tests 5.6C ("matter is conserved in solutions"),
   NOT 5.6A. Claim 5.6C.

3. Set claimedTeks to that SE. Quote the first 6-10 words of the SE
   text into a new field 'tekText' so the judge can verify alignment.

== GRADE FENCE (HARD RULE — CHECK BEFORE EMITTING) ==

The brief specifies a target grade. claimedTeks MUST be from THAT
grade's SE catalog in KP §3. Concretely:

- Grade 3 brief → claimedTeks starts with "3." (e.g. 3.6A, 3.10C)
- Grade 4 brief → claimedTeks starts with "4."
- Grade 5 brief → claimedTeks starts with "5."
- Grade 6 brief → claimedTeks starts with "6."
- Grade 7 brief → claimedTeks starts with "7."
- Grade 8 brief → claimedTeks starts with "8."
- Biology brief → claimedTeks starts with "B."

If your drafted question genuinely tests a SE from a DIFFERENT grade,
the question is wrong for this brief — REWRITE the question to test
a Grade-N SE. Do NOT claim the off-grade SE.

Example of forbidden drift:
  Grade 5 brief about a magnet experiment.
  You drafted: "What type of force pulled the paperclip toward the
                magnet?" with answer "magnetic force".
  Tempting claim: 3.7A ("demonstrate forces acting on object:
                magnetism, gravity, push/pull").
  REJECTED — 3.7A is Grade 3, not Grade 5.
  Correct: rewrite the question so it tests Grade 5 content. The
  Grade 5 sibling here is the bigger picture — comparing matter
  properties (5.6A includes magnetism) — so reframe as a property-
  classification question, not a force-identification question.
  Then claim 5.6A.

When EVERY rewrite of a question keeps testing an off-grade SE, the
brief topic itself doesn't fit the target grade — emit the question
with claimedTeks: '' and tekText: 'OUT_OF_GRADE_SCOPE'. The judge
will reject and the orchestrator will regen.

When in doubt between two SEs:
- **The SE MUST be from the brief's target grade. No cross-grade claims.**
- Prefer the more specific SE (5.6C beats 5.6 generally).
- Prefer the SE whose verbs (classify / demonstrate / investigate /
  compare) match the question's cognitive demand.
- If a question genuinely tests two SEs WITHIN THE TARGET GRADE,
  claim the one the question asks the kid to DO, not the one the
  scenario describes.

This claim-after-drafting discipline is mandatory. The brief's
targetTeks is a SUGGESTION — your question may legitimately drift to
a sibling SE during drafting, and the claim must follow the question,
not the brief.

== Output format ==

Return STRICT JSON: an array of question objects, each shaped:

{
  "type": "science_mc",
  "stem": "...",
  "stemPattern": "Which of these...",
  "choices": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "claimedTeks": "5.6C",
  "tekText": "compare substance properties before/after solution",
  "strand": "Matter & Energy",
  "standardType": "Readiness",
  "regionTag": null,
  "explanation": "1-2 sentences for the kid AFTER they answer. Plain language. Why correct is correct, briefly.",
  "rationale": "1-line internal: which distractor maps to which §5 misconception."
}

ONLY output a valid JSON array. No markdown fences around the array, no preamble.`;
}

function buildUserPrompt({ scenario, grade, count, targetTeks }) {
  const teksHint = targetTeks ? `\nTarget tek_code (use this on at least one question): ${targetTeks}` : '';
  if (scenario && scenario.body) {
    return `Generate ${count} cluster questions for the scenario below. ALL questions MUST reference the scenario directly (named variables, numbers, or events from it). Span at least 2 different strands across the set.

Grade: ${grade}${teksHint}
Scenario type: ${scenario.scenarioType}
Region tag: ${scenario.regionTag || 'none'}

Scenario title: ${scenario.title}

Scenario body:
${scenario.body}

Return strict JSON array of ${count} question objects. Apply distractor rule (§7 #9): at least 1 wrong answer per MC reflects a §5 misconception. Diversity rule applies (≥2 strands across the set when count ≥ 3).`;
  }
  return `Generate ${count} STANDALONE multiple-choice science questions.

Grade: ${grade}${teksHint}

Each question stands on its own (no shared scenario). Span at least 2 different strands across the set when count ≥ 3. Apply distractor rule (§7 #9): at least 1 wrong answer per MC reflects a §5 misconception.

Return strict JSON array of ${count} question objects.`;
}

async function callAnthropic(systemPrompt, userMessage, apiKey) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Opus 4.7 deprecated `temperature`. Anthropic returns 400
        // 'temperature is deprecated for this model' if it's set.
        // Sonnet 4.5 still accepts it. Keep 0.6 for Sonnet, omit for Opus.
        ...(MODEL.startsWith('claude-opus-') ? {} : { temperature: 0.6 }),
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }]
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

/**
 * Generate `count` questions.
 *   args = { scenario?, grade, count, apiKey, targetTeks? }
 * Returns: array of question objects (see system prompt for shape).
 *   Each item also gets _generatedBy, _generatedAt stamped.
 */
async function generateQuestionSet(args) {
  const { scenario, grade, count, apiKey, targetTeks } = args || {};
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!grade) throw new Error('grade required');
  const n = Number.isFinite(count) && count > 0 ? Math.min(count, 12) : 5;

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ scenario, grade, count: n, targetTeks });

  const resp = await callAnthropic(systemPrompt, userPrompt, apiKey);
  const raw = resp?.content?.[0]?.text;
  if (!raw) throw new Error('Anthropic returned no text content');

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(`question generator returned non-JSON: ${err.message} — first 200: ${String(raw).slice(0, 200)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('question generator did not return a JSON array');
  }

  const generatedAt = new Date().toISOString();
  return parsed
    .filter(q => q && typeof q === 'object' && typeof q.stem === 'string')
    .map(q => ({
      type: 'science_mc',
      stem: String(q.stem).trim(),
      stemPattern: String(q.stemPattern || '').trim(),
      choices: Array.isArray(q.choices) ? q.choices.map(c => String(c).trim()) : [],
      correctIndex: Number.isFinite(q.correctIndex) ? q.correctIndex : -1,
      claimedTeks: String(q.claimedTeks || q.tek_code || '').trim(),
      tekText: String(q.tekText || '').trim(),
      strand: String(q.strand || '').trim(),
      standardType: String(q.standardType || q.standard_type || 'Practice').trim(),
      regionTag: q.regionTag || q.region_tag || null,
      explanation: String(q.explanation || '').trim(),
      rationale: String(q.rationale || '').slice(0, 280),
      _generatedBy: MODEL,
      _generatedAt: generatedAt
    }));
}

module.exports = { generateQuestionSet, MODEL, _internal: { extractJson, callAnthropic } };
