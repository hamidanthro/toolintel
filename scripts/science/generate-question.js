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

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 60000;
const MAX_TOKENS = 1536;

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

== Output format ==

Return STRICT JSON: an array of question objects, each shaped:

{
  "type": "science_mc",
  "stem": "...",
  "stemPattern": "Which of these...",
  "choices": ["...", "...", "...", "..."],
  "correctIndex": 0,
  "claimedTeks": "5.6A",
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
        temperature: 0.6,
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
