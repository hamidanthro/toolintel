/**
 * Texas Science scenario generator — claude-sonnet-4-5.
 *
 * Generates a text-only lab scenario / data-analysis snippet / described-
 * diagram passage for cluster questions. NO diagram references; v1 is
 * text-only per locked decisions in CLAUDE.md §38 + prompts/science-judge-v1.md.
 *
 * Mirror of scripts/reading/generate-passage.js shape:
 *   - raw fetch to api.anthropic.com/v1/messages (no SDK)
 *   - x-api-key + anthropic-version: 2023-06-01 headers
 *   - system as top-level field, NOT a messages entry
 *   - 3-tier extractJson() helper for fence robustness
 *
 * KP injection: §3 (full SE catalog) + §4 (Texas regions) + §6 (sample
 * patterns) wrapped with '== KP §N — Title ==' / '== END KP §N ==' markers.
 *
 * Returns: { scenarioId, title, body, scenarioType, regionTag, grade,
 *            _generatedBy, _generatedAt }.
 *
 * Generator does NOT stamp _judge*. Orchestrator handles all judge
 * provenance at write time (separation of concerns).
 */
'use strict';

const crypto = require('crypto');
const { loadKP } = require('./lib/load-kp');

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 60000;
const MAX_TOKENS = 1024;

const VALID_SCENARIO_TYPES = ['experiment', 'data_analysis', 'described_diagram'];

// 3-tier fence stripper — same as judge-question.js
function extractJson(text) {
  const trimmed = String(text || '').trim();
  const strict = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (strict) return strict[1];
  const anyFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (anyFence) return anyFence[1];
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function buildSystemPrompt() {
  const kp = loadKP();
  const sec3 = kp.sections['3'] || '';
  const sec4 = kp.sections['4'] || '';
  const sec6 = kp.sections['6'] || '';
  return `You are a children's science scenario writer for a Texas STAAR practice app. You write short, text-only science lab / data / phenomenon scenarios that cluster questions can reference. The scenarios must be kid-readable, factually grounded, and free of diagrams or visual references.

== KP §3 — Full SE catalog by grade ==
${sec3}
== END KP §3 ==

== KP §4 — Texas regional context tags ==
${sec4}
== END KP §4 ==

== KP §6 — Sample question patterns ==
${sec6}
== END KP §6 ==

== Output format ==

Return STRICT JSON with this shape:

{
  "title": "Short title (≤8 words)",
  "body": "80-180 words of plain text describing the scenario. No headings, no bullet points, no markdown. Concrete names + numbers so cluster questions can reference them."
}

== Body format requirements (LOCKED) ==

- 80-180 words. Sentences ≤20 words each.
- Plain text. NO markdown headers, NO bullet points, NO bold/italic.
- NO references to "the diagram below", "the figure shows", "this graph",
  "the picture", "the image", "shown in the table", or any other visual
  cue. v1 is text-only — describe everything in words.
- For experiments: name the variables, the procedure steps, what is
  measured, what was held constant. Concrete enough that cluster
  questions can ask "what is the independent variable?" / "why did
  the student keep X the same?".
- For data analysis: describe the dataset in prose. Give the actual
  numbers in the text (e.g., "Group A measured 12 cm; Group B measured
  18 cm").
- For described-diagram: describe what a diagram WOULD show, in words.
  Locations, parts, labels — all in prose.

== Strict-pass requirements ==

- §6 sample patterns are inspiration, not boilerplate. Match the spirit
  of real STAAR scenarios.
- For grades 3-8: vocabulary at or below the stated grade-band ceiling
  in prompts/science-judge-v1.md.
- If a Texas regionTag is set, weave the region into the scenario
  naturally (e.g., "Mr. Chen's class in Houston is testing..."). If
  regionTag is null, keep the scenario region-neutral.

ONLY output valid JSON. No markdown fences around the JSON, no preamble.`;
}

function buildUserPrompt({ grade, topic, scenarioType, regionTag }) {
  const regionLine = regionTag
    ? `\nRegion: ${regionTag} (weave a Texas region from KP §4 — pick the most natural fit for this topic).`
    : `\nRegion: none (region-neutral scenario).`;
  return `Generate ONE science scenario.

Grade: ${grade}
Scenario type: ${scenarioType}
Topic: ${topic}${regionLine}

Match the body format requirements (80-180 words, plain text, no diagrams referenced). Return strict JSON.`;
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
        temperature: 0.7,
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
 * Generate one scenario.
 *   args = { grade, topic, scenarioType, regionTag?, apiKey }
 * Returns: { scenarioId, title, body, scenarioType, regionTag, grade,
 *            _generatedBy, _generatedAt }
 */
async function generateScenario(args) {
  const { grade, topic, scenarioType, regionTag, apiKey } = args || {};
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!grade) throw new Error('grade required');
  if (!topic || typeof topic !== 'string') throw new Error('topic required');
  if (!VALID_SCENARIO_TYPES.includes(scenarioType)) {
    throw new Error(`invalid scenarioType: ${scenarioType} (must be one of ${VALID_SCENARIO_TYPES.join(', ')})`);
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ grade, topic, scenarioType, regionTag });

  const resp = await callAnthropic(systemPrompt, userPrompt, apiKey);
  const raw = resp?.content?.[0]?.text;
  if (!raw) throw new Error('Anthropic returned no text content');

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(`scenario generator returned non-JSON: ${err.message} — first 200: ${String(raw).slice(0, 200)}`);
  }

  const title = String(parsed.title || '').trim();
  const body = String(parsed.body || '').trim();
  if (!title) throw new Error('scenario generator returned empty title');
  if (!body) throw new Error('scenario generator returned empty body');

  // Deterministic scenarioId — same topic + type yields the same id, so
  // re-runs of the same brief don't multiply rows in the lake.
  const hash = crypto.createHash('sha256').update(`${topic}|${scenarioType}`).digest('hex').slice(0, 8);
  const scenarioId = `sci_tx_${grade}_${hash}`;

  return {
    scenarioId,
    title,
    body,
    scenarioType,
    regionTag: regionTag || null,
    grade: String(grade),
    _generatedBy: MODEL,
    _generatedAt: new Date().toISOString()
  };
}

module.exports = { generateScenario, MODEL, VALID_SCENARIO_TYPES, _internal: { extractJson, callAnthropic } };
