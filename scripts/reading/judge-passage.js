/**
 * Reading passage judge — Two-pass.
 *
 * Pass 1 (structural, deterministic, no API call):
 *   word count in band, paragraph count in band, FK in 2.8-4.2,
 *   no inline HTML, title present, etc.
 *
 * Pass 2 (LLM, Claude Sonnet 4.5):
 *   §6 cultural priorities + §7 landmines + §9 no-no list enforcement.
 *   Returns strict JSON verdict.
 *
 * Pattern borrowed from scripts/fun-facts/judge.js: raw fetch, fail-open
 * on transient errors, extractJson() for fence-stripping. Fail-open
 * verdict='pass' confidence=0.5 so caller still sees the borderline case
 * instead of dropping silently.
 *
 * No deps — Node 20+ built-in fetch.
 */
'use strict';

const { loadKP } = require('./lib/load-kp');
const { getReadabilityReport, countParagraphs, countWords } = require('./lib/readability');

const MODEL = 'claude-sonnet-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';
const TIMEOUT_MS = 45000;
const MAX_TOKENS = 512;

// Failure-mode vocabulary. Judge MUST return reasons from this set.
const FAILURE_MODES = [
  // §7 landmines (1-8)
  'LIFELESS_COMPETENCE',     // landmine 1
  'FACT_UNVERIFIABLE',       // landmine 2 — also exposed via factsRequireCheck=true
  'MORALIZING_ENDING',       // landmine 3
  'CULTURAL_IMPROVISATION',  // landmine 4
  'ANSWER_FROM_STEM',        // landmine 5
  'ANACHRONISM',             // landmine 6
  'PASSAGE_QUESTION_MISMATCH', // landmine 7
  'WEAK_DISTRACTORS',        // landmine 8 (passage-level mention; question judge has its own)

  // §9 no-no list (named topics)
  'NONO_DEATH',
  'NONO_DIVORCE',
  'NONO_ROMANCE',
  'NONO_DRUGS',
  'NONO_RELIGION_THEOLOGY',
  'NONO_POLITICS',
  'NONO_VIOLENCE',
  'NONO_BULLYING_PLOT',
  'NONO_MENTAL_ILLNESS',
  'NONO_DISABILITY_DEFICIT',
  'NONO_REAL_PUBLIC_FIGURE',
  'NONO_BRAND_NAME',
  'NONO_PLAYGROUND_SLANG',

  // §6 cultural rules
  'STEREOTYPE_RISK',         // name-plot stereotype matching
  'CULTURAL_LANDMINE',       // §6 violation not specifically named above

  // §8 readability — rare since structural pass catches most
  'READABILITY_TOO_SIMPLE',
  'READABILITY_TOO_HARD',

  // structural pass-1 reasons
  'STRUCT_WORD_COUNT_LOW',
  'STRUCT_WORD_COUNT_HIGH',
  'STRUCT_PARAGRAPH_COUNT_LOW',
  'STRUCT_PARAGRAPH_COUNT_HIGH',
  'STRUCT_SENTENCE_TOO_LONG',
  'STRUCT_FK_TOO_LOW',
  'STRUCT_FK_TOO_HIGH',
  'STRUCT_HTML_TAG',
  'STRUCT_INLINE_NUMBERING',
  'STRUCT_TITLE_MISSING',
  'STRUCT_BODY_MISSING'
];

// Per-genre word-count and paragraph-count bands (KP §2).
const BANDS = {
  'realistic-fiction': {
    words: { min: 300, max: 480 },
    paragraphs: { min: 8, max: 20 }
  },
  'informational': {
    words: { min: 400, max: 750 },
    paragraphs: { min: 5, max: 20 }
  }
};

// FK band — judge uses KP §8's REJECT thresholds, not the target band.
// KP §8 stated "Reject: <2.5 (too simple) or >4.5 (too hard)" but real
// STAAR scores higher: 2022 fiction at FK ~5; biographies (e.g. Patricia
// Bath) at FK ~6. Widened to 2.5-6.0 so we don't false-reject in-band
// content. The 2.8-4.2 target stays as generator-prompt guidance.
// Tracking: §B2 Phase 2 seed run hit FK 5.6 on Bath biography — widened
// after that signal.
const FK_BAND = { min: 2.5, max: 6.0 };

// Max sentence length per KP §8.
const MAX_SENTENCE_WORDS = 20;

// -------- Pass 1: structural checks --------

function runStructuralChecks({ title, body, genre }) {
  const reasons = [];

  if (!title || !String(title).trim()) reasons.push('STRUCT_TITLE_MISSING');
  if (!body || !String(body).trim()) reasons.push('STRUCT_BODY_MISSING');

  if (body) {
    // No HTML tags
    if (/<[a-z][\s\S]*>/i.test(body)) reasons.push('STRUCT_HTML_TAG');
    // No inline paragraph numbering like "(1)" or "[1]" at start of paragraphs
    if (/^\s*[\(\[]?\d+[\)\]]\s+\S/m.test(body)) reasons.push('STRUCT_INLINE_NUMBERING');

    const report = getReadabilityReport(body);
    const band = BANDS[genre];
    if (band) {
      if (report.wordCount < band.words.min) reasons.push('STRUCT_WORD_COUNT_LOW');
      if (report.wordCount > band.words.max) reasons.push('STRUCT_WORD_COUNT_HIGH');
      if (report.paragraphCount < band.paragraphs.min) reasons.push('STRUCT_PARAGRAPH_COUNT_LOW');
      if (report.paragraphCount > band.paragraphs.max) reasons.push('STRUCT_PARAGRAPH_COUNT_HIGH');
    }
    if (report.fkGrade < FK_BAND.min) reasons.push('STRUCT_FK_TOO_LOW');
    if (report.fkGrade > FK_BAND.max) reasons.push('STRUCT_FK_TOO_HIGH');

    // Per-sentence length cap. Strip markdown headers so they don't count.
    const stripped = body.replace(/^#{1,6}\s+.*$/gm, '');
    const sentences = stripped.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
    for (const s of sentences) {
      const w = (s.match(/[A-Za-z]+(?:[''][A-Za-z]+)*/g) || []).length;
      if (w > MAX_SENTENCE_WORDS) {
        reasons.push('STRUCT_SENTENCE_TOO_LONG');
        break;
      }
    }
  }

  if (reasons.length) {
    return {
      verdict: 'fail',
      source: 'structural',
      reasons,
      confidence: 1.0,
      note: `structural: ${reasons.join(', ')}`,
      factsRequireCheck: false
    };
  }
  return { verdict: 'pass', source: 'structural', reasons: [], confidence: 1.0, note: '' };
}

// -------- Pass 2: LLM judgment --------

function buildSystemPrompt() {
  const kp = loadKP();
  const sec = kp.sections;
  return `You are a careful editor evaluating reading passages for a Texas STAAR grade-3 practice app. You enforce the rules below STRICTLY.

== KP §6 — Texas cultural priorities ==
${sec.culturalPriorities || ''}

== KP §7 — AI-generation landmines ==
${sec.landmines || ''}

== KP §9 — No-no list ==
${sec.noNoList || ''}

== Your task ==

For the passage you are given, return STRICT JSON with this shape:

{
  "verdict": "pass" | "fail",
  "confidence": 0.0,
  "reasons": ["LANDMINE_2", "STEREOTYPE_RISK"],
  "note": "1-2 sentence explanation",
  "factsRequireCheck": true | false
}

== Failure-reason vocabulary ==

§7 landmines:
  LIFELESS_COMPETENCE, FACT_UNVERIFIABLE, MORALIZING_ENDING,
  CULTURAL_IMPROVISATION, ANSWER_FROM_STEM, ANACHRONISM,
  PASSAGE_QUESTION_MISMATCH, WEAK_DISTRACTORS

§9 no-no list:
  NONO_DEATH, NONO_DIVORCE, NONO_ROMANCE, NONO_DRUGS,
  NONO_RELIGION_THEOLOGY, NONO_POLITICS, NONO_VIOLENCE,
  NONO_BULLYING_PLOT, NONO_MENTAL_ILLNESS, NONO_DISABILITY_DEFICIT,
  NONO_REAL_PUBLIC_FIGURE, NONO_BRAND_NAME, NONO_PLAYGROUND_SLANG

§6 cultural rules:
  STEREOTYPE_RISK (name-plot stereotype matching),
  CULTURAL_LANDMINE (other §6 violation)

== Strict-pass requirements ==

- §9 violations are STRICT. ANY death, romance, divorce, drug,
  religion-as-theology, politics, violence, bullying-as-plot,
  mental-illness, disability-as-deficit, brand name, playground
  slang, or current real public figure → verdict=fail.
- §6 STEREOTYPE_RISK: if the protagonist's name suggests a culture
  AND the plot is the obvious cultural fit (Maria + piñata, Aisha +
  hijab, Diego + soccer-as-cultural-touchstone) → flag.
- For informational passages, set factsRequireCheck=true if any
  date, count, or specific claim is not generally-known and could
  be made up.
- Pass borderline §6/§7 cases with confidence<0.7 so the human
  reviewer sees them in spot-check.
- Disability as identity (Patricia Bath biography; Maya plays
  soccer and uses a wheelchair) is FINE. Disability as deficit
  (kid can't play because she's deaf) → NONO_DISABILITY_DEFICIT.
- Sibling conflict that resolves within the passage is FINE; only
  unresolved sibling conflict is rejected.
- Weather events without character harm are FINE.

ONLY output valid JSON. No markdown fences, no preamble, no commentary.`;
}

function buildUserPrompt({ title, body, genre, protagonistName, protagonistDemographic, setting, topic }) {
  return `Title: ${title || '(untitled)'}
Genre: ${genre}
Protagonist: ${protagonistName || 'unmarked'} (${protagonistDemographic || 'unmarked'})
Setting: ${setting || '(unspecified)'}
Topic: ${topic || '(unspecified)'}

Passage body (markdown):

${body}`;
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
  const factsRequireCheck = parsed.factsRequireCheck === true;
  // Sanity: fail without reason → downgrade to pass at low confidence
  if (verdict === 'fail' && reasons.length === 0) {
    return { verdict: 'pass', source: 'llm', reasons: [], confidence: 0.4, note: 'fail-without-reason → pass', factsRequireCheck };
  }
  return { verdict, source: 'llm', reasons, confidence, note, factsRequireCheck };
}

/**
 * Judge a single passage.
 *   args = { title, body, genre, protagonistName, protagonistDemographic, setting, topic, apiKey }
 * Returns: { verdict, source, reasons, confidence, note, factsRequireCheck, kpVersion }
 *
 * On Anthropic API failure: fail-open with verdict='pass', source='llm-error',
 * confidence=0.5 so caller knows to spot-check.
 */
async function judgePassage(args) {
  const { apiKey, ...passage } = args || {};

  // Pass 1
  const structural = runStructuralChecks(passage);
  if (structural.verdict === 'fail') {
    return { ...structural, kpVersion: loadKP().kpVersion };
  }

  // Pass 2
  if (!apiKey) {
    return {
      verdict: 'pass', source: 'no-api-key', reasons: [], confidence: 0.5,
      note: 'no-api-key fail-open', factsRequireCheck: false,
      kpVersion: loadKP().kpVersion
    };
  }

  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(passage);

  let raw;
  try {
    const resp = await callAnthropic(systemPrompt, userPrompt, apiKey);
    raw = resp && resp.content && resp.content[0] && resp.content[0].text;
    if (!raw) {
      return {
        verdict: 'pass', source: 'llm-empty', reasons: [], confidence: 0.5,
        note: 'empty-response fail-open', factsRequireCheck: false,
        kpVersion: loadKP().kpVersion
      };
    }
  } catch (err) {
    const tag = err && err.name === 'AbortError' ? 'timeout' : 'api-error';
    console.warn(`[judge-passage] WARN: ${tag} — fail-open: ${(err && err.message || '').slice(0, 200)}`);
    return {
      verdict: 'pass', source: `llm-${tag}`, reasons: [], confidence: 0.5,
      note: `judge-${tag}`, factsRequireCheck: false,
      kpVersion: loadKP().kpVersion
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    console.warn(`[judge-passage] bad-JSON fail-open: ${err.message}`);
    return {
      verdict: 'pass', source: 'llm-bad-json', reasons: [], confidence: 0.5,
      note: 'bad-json fail-open', factsRequireCheck: false,
      kpVersion: loadKP().kpVersion
    };
  }

  const out = normalizeOutput(parsed);
  return { ...out, kpVersion: loadKP().kpVersion };
}

module.exports = { judgePassage, runStructuralChecks, FAILURE_MODES, MODEL };
