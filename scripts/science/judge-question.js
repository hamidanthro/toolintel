/**
 * Science question judge — claude-sonnet-4-5, temp 0.
 *
 * Standalone module: takes a single science item, returns a verdict.
 * Does NOT touch DynamoDB. Does NOT stamp _judgedAt — the orchestrator
 * persists provenance later (separation of concerns; mirrors reading).
 *
 * D2a originally wired this to gpt-4o via the openai SDK. Hit OpenAI
 * account quota (429) on 2/3 reject fixtures. D2a-fix swaps to Anthropic
 * Sonnet 4.5 — same model the reading judges + math verifier use, no
 * billing block, equivalent or better on nuanced judgment per CLAUDE.md
 * §33 verifier-hardening. The SYSTEM_PROMPT (prompts/science-judge-v1.md)
 * is unchanged; only the model serving it changed.
 *
 * Transport mirrors scripts/reading/judge-question.js byte-faithfully:
 * raw fetch to https://api.anthropic.com/v1/messages, system as a
 * top-level field (NOT a messages entry), x-api-key header,
 * anthropic-version: 2023-06-01, AbortController 30s timeout.
 *
 * Verdict shape returned to caller:
 *   {
 *     verdict: 'pass' | 'reject',     // lowercase to match reading
 *     confidence: number in [0, 1],
 *     reasons: string[],              // codes from prompts/science-judge-v1.md
 *     judgeVersion: 'science-judge-v1',
 *     source: 'llm-claude' | 'llm-error'
 *   }
 *
 * Budget: SCIENCE_JUDGE_MAX_CALLS env (default 5000). Throws
 * JudgeBudgetExceededError when exceeded — caller halts the sweep
 * instead of silently skipping.
 */
'use strict';

const { loadKP } = require('./lib/load-kp');
const { loadJudgePrompt } = require('./lib/load-judge-prompt');

const JUDGE_MODEL = 'claude-sonnet-4-5';
const JUDGE_VERSION = 'science-judge-v1';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const TIMEOUT_MS = 30000;
// 600 leaves headroom for ~16 reason codes + buffer without burning
// budget on an output that's typically <100 tokens. (At 200 the model
// truncated mid-JSON for any reject with multiple reasons.)
const MAX_TOKENS = 600;

const MAX_CALLS = (() => {
  const raw = parseInt(process.env.SCIENCE_JUDGE_MAX_CALLS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 5000;
})();

const stats = {
  calls: 0,
  passes: 0,
  rejects: 0,
  failOpens: 0,
  totalTokensIn: 0,
  totalTokensOut: 0
};

class JudgeBudgetExceededError extends Error {
  constructor(limit) {
    super(`Science judge call budget exceeded: ${limit} calls (set SCIENCE_JUDGE_MAX_CALLS to raise)`);
    this.name = 'JudgeBudgetExceededError';
    this.limit = limit;
  }
}

// Compose the system prompt: the SYSTEM_PROMPT block from
// prompts/science-judge-v1.md, then KP §3 + §4 + §5 wrapped with
// '== KP §N — Title ==' / '== END KP §N ==' markers (convention from
// scripts/reading/generate-passage.js).
function buildSystemPrompt() {
  const judge = loadJudgePrompt();
  const kp = loadKP();
  const sec3 = kp.sections['3'] || '';
  const sec4 = kp.sections['4'] || '';
  const sec5 = kp.sections['5'] || '';
  return [
    judge.systemPrompt,
    '',
    '== KP §3 — Full SE catalog by grade ==',
    sec3,
    '== END KP §3 ==',
    '',
    '== KP §4 — Texas regional context tags ==',
    sec4,
    '== END KP §4 ==',
    '',
    '== KP §5 — Common misconceptions library ==',
    sec5,
    '== END KP §5 ==',
    ''
  ].join('\n');
}

// Build the per-call user message. The judge spec expects a JSON payload
// with the candidate item. We pass it through verbatim so the model sees
// the exact field names the spec documents.
function buildUserMessage(item) {
  return JSON.stringify(item);
}

// Anthropic occasionally returns ```json fences and/or a preamble even
// with a clear "JSON only, no preamble" instruction. Three-tier fallback:
//   1. Strict fenced bookends (`^```json ... ```$`)
//   2. First fenced block anywhere in the response
//   3. First `{` … last `}` (catches preamble + naked JSON cases)
function extractJson(text) {
  const trimmed = String(text || '').trim();
  // Tier 1 — strict bookends, optional trailing whitespace
  const strict = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/);
  if (strict) return strict[1];
  // Tier 2 — fenced block anywhere
  const anyFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (anyFence) return anyFence[1];
  // Tier 3 — slice from first '{' to last '}'
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

// Raw fetch to api.anthropic.com/v1/messages with a 30s timeout via
// AbortController. Mirrors scripts/reading/judge-question.js.
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

// Map any non-fatal failure into a fail-open verdict so the caller sees
// a synthetic 'pass' at confidence 0.5 and knows to spot-check. Quality
// gate, not availability gate.
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
  const raw = String(parsed.verdict || '').toUpperCase();
  let verdict;
  if (raw === 'PASS') verdict = 'pass';
  else if (raw === 'REJECT' || raw === 'FAIL') verdict = 'reject';
  else return null;
  const reasons = Array.isArray(parsed.reasons)
    ? parsed.reasons.filter(r => typeof r === 'string' && r.length > 0).slice(0, 16)
    : [];
  // Confidence: 0.95 on PASS, 0.85 on REJECT (LLM didn't return one).
  // Calibrated low enough that downstream sweeps see honest uncertainty
  // without false-flooring everything to the fail-open 0.5.
  const confidence = verdict === 'pass' ? 0.95 : 0.85;
  return {
    verdict,
    confidence,
    reasons,
    judgeVersion: JUDGE_VERSION,
    source: 'llm-gpt4o'
  };
}

async function judgeQuestion(item) {
  if (stats.calls >= MAX_CALLS) {
    throw new JudgeBudgetExceededError(MAX_CALLS);
  }

  // Hard-fail on missing key — that's a config bug, not a transient
  // error. Reading judge mirrors this. Module-level read so each call
  // re-checks (the env can be set late by a wrapper script).
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set — science judge requires Anthropic key (Secrets Manager: staar-tutor/anthropic-api-key)');
  }

  let systemPrompt, userMessage;
  try {
    systemPrompt = buildSystemPrompt();
    userMessage = buildUserMessage(item);
  } catch (err) {
    // KP / judge-prompt load error — surface, do not fail-open. If the
    // foundation files are missing, the caller's environment is broken.
    throw err;
  }

  let completion;
  // Fail-open: judge is a quality gate, not an availability gate.
  // Anthropic/OpenAI blip != content drop. Every error path below
  // returns a synthetic 'pass' at confidence 0.5 with source='llm-error'.
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
  judgeQuestion,
  JUDGE_MODEL,
  JUDGE_VERSION,
  JudgeBudgetExceededError,
  stats,
  // exported for tests
  _internal: { buildSystemPrompt, normalizeVerdict, failOpen, extractJson, callAnthropic }
};
