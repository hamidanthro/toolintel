/**
 * Reading passage generator — Claude Sonnet 4.5.
 *
 * NOT RUN IN PHASE 1. Exists, syntax-checks, ready for Phase 2 to call.
 *
 * Loads KP §2 (passage characteristics), §6 (cultural priorities),
 * §7 (landmines), §8 (reading levels), §9 (no-no list) into the system
 * prompt. User prompt is the per-call brief: genre, topic, setting,
 * protagonist name + demographic.
 *
 * Returns: { title, body, wordCount, paragraphCount, fkGrade, ... }.
 *
 * No deps — Node 20+ built-in fetch.
 */
'use strict';

const { loadKP } = require('./lib/load-kp');
const { getReadabilityReport } = require('./lib/readability');

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const TIMEOUT_MS = 90000;
const MAX_TOKENS = 2048;

const VALID_GENRES = ['realistic-fiction', 'informational'];
const VALID_DEMOGRAPHICS = [
  'hispanic-latino', 'black', 'asian', 'other-named',
  'native-american', 'unmarked'
];

function buildSystemPrompt() {
  const kp = loadKP();
  const sec = kp.sections;
  return `You are a children's reading-passage writer for a Texas STAAR grade-3 practice app. You write passages that match what a kid would see on the actual test: kid-readable, factually grounded (informational), Texas-rooted often but not always, and free of landmines listed below.

== KP §2 — Passage characteristics ==
${sec.passageCharacteristics || ''}

== KP §6 — Texas cultural priorities ==
${sec.culturalPriorities || ''}

== KP §7 — AI-generation landmines ==
${sec.landmines || ''}

== KP §8 — Reading levels ==
${sec.readingLevels || ''}

== KP §9 — No-no list ==
${sec.noNoList || ''}

== Output format ==

Return STRICT JSON with this shape:

{
  "title": "Short imaginative or topic-direct title",
  "body": "## Title\\n\\nFirst paragraph...\\n\\nSecond paragraph...\\n\\n...",
  "wordCount": 412,
  "paragraphCount": 14,
  "topicNotes": "1-line internal note on the topic chosen"
}

== Body format requirements (LOCKED) ==

- The body is MARKDOWN.
- Open with a level-2 heading: "## " followed by the title.
- Each paragraph separated from the next by a single blank line.
- Use **bold** sparingly for Tier-3 vocabulary in informational passages.
- Use *italic* for foreign-language words ("ven aquí") if relevant.
- Informational passages may use ## section headings ("Hope Spots", "Beyond the Ocean") between paragraph groups.
- DO NOT include inline paragraph numbers — kid UI renders them via CSS counter().
- DO NOT include HTML tags.
- DO NOT include images, figures, or markdown image syntax.

== Strict-pass requirements ==

- Word count + paragraph count + Flesch-Kincaid 2.8-4.2 must match the genre band in §2.
- §9 violations are STRICT — no death, romance, divorce, drugs, religion-as-theology, politics, violence, bullying-as-plot, mental-illness, disability-as-deficit, brand names, or current real public figures.
- §6 generator naming rule: the protagonist's name should NOT match the obvious cultural-fit plot. If you're given "Maria" as protagonist, do NOT write a piñata story — write whatever plot the brief asks for.
- Sibling conflict OK if resolved in-passage. Weather events OK if no character is hurt.
- Disability as identity is fine; disability as deficit is rejected.

ONLY output valid JSON. No markdown fences around the JSON, no preamble.`;
}

function buildUserPrompt({ genre, topic, setting, protagonistName, protagonistDemographic, teksTargets }) {
  const genreLabel = genre === 'realistic-fiction' ? 'Realistic fiction' : 'Informational';
  const teksHint = (Array.isArray(teksTargets) && teksTargets.length)
    ? `\nTEKS strands the question set will target: ${teksTargets.join(', ')} (passage should support these but you do NOT generate questions in this call).`
    : '';
  const protagonistLine = protagonistName
    ? `Protagonist: ${protagonistName} (${protagonistDemographic || 'unspecified'})`
    : `Protagonist: demographically unmarked (no specific named protagonist; or animal protagonist; or focal-object story)`;
  return `Generate ONE passage.

Genre: ${genreLabel}
Topic: ${topic}
Setting: ${setting || '(your choice — pick a Texas city or a specific elsewhere; honor the 60% Texas / 40% non-Texas distribution)'}
${protagonistLine}${teksHint}

Match the §2 word-count band for this genre, the §8 readability target, and obey ALL §6/§7/§9 rules. Apply the generator naming rule: do NOT match plot to the obvious cultural fit for the protagonist's name.

Return strict JSON.`;
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
        temperature: 0.7,
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
 * Generate a single passage.
 * args = { genre, topic, setting, protagonistName, protagonistDemographic, teksTargets, apiKey }
 *
 * Returns: {
 *   title, body, genre, protagonistName, protagonistDemographic,
 *   setting, topic, wordCount, paragraphCount, fkGrade, lexileEstimate,
 *   _topicNotes, _generatedBy, _generatedAt
 * }
 */
async function generatePassage(args) {
  const {
    genre, topic, setting, protagonistName, protagonistDemographic,
    teksTargets, apiKey
  } = args || {};

  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  if (!VALID_GENRES.includes(genre)) throw new Error(`invalid genre: ${genre}`);
  if (protagonistDemographic && !VALID_DEMOGRAPHICS.includes(protagonistDemographic)) {
    throw new Error(`invalid demographic: ${protagonistDemographic}`);
  }
  if (!topic || typeof topic !== 'string') throw new Error('topic required');

  const system = buildSystemPrompt();
  const user = buildUserPrompt({ genre, topic, setting, protagonistName, protagonistDemographic, teksTargets });

  const resp = await callAnthropic(system, user, apiKey);
  const raw = resp && resp.content && resp.content[0] && resp.content[0].text;
  if (!raw) throw new Error('Anthropic returned no text content');

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    throw new Error(`generator returned non-JSON: ${err.message} — first 200: ${String(raw).slice(0, 200)}`);
  }

  const title = String(parsed.title || '').trim();
  const body = String(parsed.body || '').trim();
  if (!title) throw new Error('generator returned empty title');
  if (!body) throw new Error('generator returned empty body');

  const report = getReadabilityReport(body);

  return {
    title, body, genre,
    protagonistName: protagonistName || null,
    protagonistDemographic: protagonistDemographic || 'unmarked',
    setting: setting || null,
    topic,
    wordCount: report.wordCount,
    paragraphCount: report.paragraphCount,
    fkGrade: report.fkGrade,
    lexileEstimate: report.lexileEstimate,
    _topicNotes: String(parsed.topicNotes || '').slice(0, 200),
    _generatedBy: MODEL,
    _generatedAt: new Date().toISOString()
  };
}

module.exports = { generatePassage, MODEL, VALID_GENRES, VALID_DEMOGRAPHICS };
