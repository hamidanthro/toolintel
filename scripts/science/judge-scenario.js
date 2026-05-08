/**
 * Texas Science scenario judge — claude-sonnet-4-5, temp 0.
 *
 * Mirrors scripts/science/judge-question.js shape: raw fetch to Anthropic,
 * x-api-key header, anthropic-version: 2023-06-01, AbortController 30s
 * timeout, fail-open on every error path. Hard-fails on missing
 * ANTHROPIC_API_KEY (config bug, not transient).
 *
 * Injects KP §4 (regions) + §6 (sample patterns) only — NOT §3 (the
 * SE catalog is for question judging, not scenario judging — keeps the
 * prompt cheaper).
 *
 * Verdict shape:
 *   {
 *     verdict: 'pass' | 'reject',
 *     confidence: number in [0, 1],
 *     reasons: string[],
 *     judgeVersion: 'science-scenario-judge-v1',
 *     source: 'llm-claude' | 'llm-error'
 *   }
 *
 * Reason codes:
 *   - DIAGRAM_REFERENCED  — text refers to a non-textual visual ("the
 *     diagram", "the figure", "shown above", "the chart", "the table")
 *   - TOO_SHORT / TOO_LONG — word count outside 60-220 range
 *   - VAGUE_NUMBERS — claims to be an experiment / data analysis but
 *     lacks concrete numbers/measurements that cluster questions could
 *     reference
 *   - BIAS_OR_STEREOTYPE
 *   - TEXAS_GEO_ERROR
 *   - SCIENCE_FACTUAL_ERROR
 */
'use strict';

const { loadKP } = require('./lib/load-kp');

const JUDGE_MODEL = 'claude-sonnet-4-5';
const JUDGE_VERSION = 'science-scenario-judge-v1';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 30000;
const MAX_TOKENS = 600;

const stats = {
  calls: 0,
  passes: 0,
  rejects: 0,
  failOpens: 0,
  totalTokensIn: 0,
  totalTokensOut: 0
};

// 3-tier fence stripper — same shape as judge-question.js
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
  const sec4 = kp.sections['4'] || '';
  const sec6 = kp.sections['6'] || '';
  return `You are the Scenario Judge for gradeearn.com — a Texas STAAR science practice app. You evaluate science scenarios (lab experiments, data-analysis snippets, described-diagram passages) for content accuracy, completeness, and v1 text-only constraints. You are NOT judging questions here — only the scenario passage itself.

== KP §4 — Texas regional context tags ==
${sec4}
== END KP §4 ==

== KP §6 — Sample question patterns (scenario shapes referenced) ==
${sec6}
== END KP §6 ==

== Your task ==

You receive JSON describing one scenario. Return STRICT JSON:

{
  "verdict": "pass" | "reject",
  "confidence": 0.0,
  "reasons": ["DIAGRAM_REFERENCED", "VAGUE_NUMBERS"],
  "note": "1-2 sentence explanation"
}

== Failure-reason vocabulary ==

DIAGRAM_REFERENCED   — the body text references a visual that isn't there.
                       Triggers: "the diagram", "the figure shows", "shown
                       above", "the chart", "the table", "the picture", "see
                       below". Describing a setup in words is FINE; pointing
                       at a visual asset is NOT.
TOO_SHORT            — word count below 60. Cluster questions need anchorage.
TOO_LONG             — word count above 220. Kid loses focus.
VAGUE_NUMBERS        — scenarioType is 'experiment' or 'data_analysis' but
                       the body has no concrete numbers/measurements/named
                       variables for cluster questions to reference. A
                       'described_diagram' may be looser; experiments may
                       not.
BIAS_OR_STEREOTYPE   — gendered framing, SES assumptions, racial/cultural
                       stereotypes.
TEXAS_GEO_ERROR      — regionTag claim is geographically wrong (e.g.,
                       "Big Bend on the Gulf Coast"). Reference KP §4.
SCIENCE_FACTUAL_ERROR — any factual error in the scenario itself
                        (water cycle reversed, Sun called a planet, etc.).

== Strict-pass requirements ==

- Hard rules:
  * Never PASS a scenario you have any doubt about scientific accuracy on.
  * Never PASS a scenario that references a diagram (v1 is text-only).
  * For experiments without concrete numbers, REJECT with VAGUE_NUMBERS.
- Pass borderline cases at confidence < 0.7 so reviewers see them.
- Always include at least one reason code on REJECT.
- Always return JSON only, no preamble, no commentary.

ONLY output valid JSON. No markdown fences, no preamble.`;
}

function buildUserMessage(scenario) {
  // Pass through the scenario fields the judge needs. Don't include
  // generator-only metadata like _generatedAt.
  const payload = {
    scenarioType: scenario.scenarioType,
    regionTag: scenario.regionTag || null,
    grade: scenario.grade,
    title: scenario.title,
    body: scenario.body
  };
  return JSON.stringify(payload);
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
        model: JUDGE_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
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

function failOpen(reason) {
  stats.failOpens++;
  return {
    verdict: 'pass',
    confidence: 0.5,
    reasons: [],
    judgeVersion: JUDGE_VERSION,
    source: 'llm-error',
    _failOpenReason: reason
  };
}

function normalizeVerdict(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  const raw = String(parsed.verdict || '').toLowerCase();
  let verdict;
  if (raw === 'pass') verdict = 'pass';
  else if (raw === 'reject' || raw === 'fail') verdict = 'reject';
  else return null;
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter(r => typeof r === 'string' && r.length > 0).slice(0, 16)
    : [];
  // Sanity: reject without reason → degrade to pass at low confidence
  if (verdict === 'reject' && reasons.length === 0) {
    return {
      verdict: 'pass',
      confidence: 0.4,
      reasons: [],
      judgeVersion: JUDGE_VERSION,
      source: 'llm-claude',
      _note: 'reject-without-reason → pass'
    };
  }
  const conf = typeof parsed.confidence === 'number'
    ? Math.max(0, Math.min(1, parsed.confidence))
    : (verdict === 'pass' ? 0.95 : 0.85);
  return {
    verdict,
    confidence: conf,
    reasons,
    judgeVersion: JUDGE_VERSION,
    source: 'llm-claude',
    note: String(parsed.note || '').slice(0, 240)
  };
}

async function judgeScenario(scenario) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set — scenario judge requires Anthropic key (Secrets Manager: staar-tutor/anthropic-api-key)');
  }
  if (!scenario || !scenario.body) {
    return {
      verdict: 'reject',
      confidence: 1.0,
      reasons: ['TOO_SHORT'],
      judgeVersion: JUDGE_VERSION,
      source: 'structural',
      note: 'no body'
    };
  }

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(scenario);

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
    parsed = JSON.parse(extractJson(raw));
  } catch (err) {
    return failOpen(`json-parse:${(err.message || '').slice(0, 80)}`);
  }

  const out = normalizeVerdict(parsed);
  if (!out) {
    return failOpen(`unknown-verdict:${String(parsed?.verdict || '').slice(0, 40)}`);
  }

  if (out.verdict === 'pass') stats.passes++;
  else stats.rejects++;
  return out;
}

module.exports = {
  judgeScenario,
  JUDGE_MODEL,
  JUDGE_VERSION,
  stats,
  _internal: { buildSystemPrompt, normalizeVerdict, failOpen, extractJson, callAnthropic }
};
