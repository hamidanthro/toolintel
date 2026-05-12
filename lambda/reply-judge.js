/**
 * reply-judge — voice / banned-phrase regex scanner for LLM outputs.
 *
 * Why this exists: the cold-start judge (lambda/judge.js, scripts/cold-
 * start/judge.js) scores GENERATED QUESTIONS. Tutor replies and session
 * summaries are content too, and the §15 voice rules apply to them just
 * as strictly. This module is the zero-cost, sub-millisecond first line
 * of defense — if a banned literal slips into a model reply, we catch
 * it without an LLM call.
 *
 * What this is NOT:
 *  - NOT a safety / crisis gate. crisis-detector.js#moderateOutput
 *    handles "Let us keep this a secret" / PII-echo / role-play —
 *    that's the safety axis (Character.AI lawsuit defense). Reply-
 *    judge is the voice axis (§15 banned phrases, ungushy tone).
 *  - NOT a hard gate by default. The caller decides whether a failed
 *    verdict should replace the reply (summarize-session does) or
 *    just emit a [reply-judge] log line for offline review (mid-tutor).
 *
 * Surfaces:
 *  - 'summary'  — session-summary 2-4 sentence reflection (§17)
 *  - 'tutor'    — mid-question wrong-answer Socratic reply (§15)
 *  - 'myspace'  — MySpace AI Buddy chat reply
 *
 * Mirror requirement: lambda/reply-judge.js ↔ lambda/tutor-build/reply-
 * judge.js must be byte-identical. scripts/check-tutor-parity.sh
 * enforces this on every deploy.
 */

'use strict';

// §15 banned literal phrases. Lowercase comparison; case-insensitive.
// Keep this list in sync with CLAUDE.md §15 "Banned literal phrases".
const BANNED_PHRASES = [
  // Worksheet-template openers
  'most kids trip',
  "trip on this",
  'trips lots of kids',
  'lots of kids',
  'no worries',
  "sure thing — let's work through",
  "let's work through",
  "now you try",

  // Gushy generic praise
  'good try',
  'nice work',
  'great job',
  "i'd be happy to help",
  'happy to help',

  // The infamous closer — kid can't answer "Does that make sense?"
  // productively, so it's a banned closer.
  'does that make sense'
];

// Banned closers — anything ending in these forms is rejected even if
// the body is clean, because they're filler that adds no value for the
// kid.
const BANNED_CLOSERS = [
  /\bdoes that make sense\?\s*$/i,
  /\b(got it|got that)\?\s*$/i,
  /\bany questions\?\s*$/i
];

// Per-surface minimum reply length. Below this is treated as EMPTY_OR_TINY
// and the caller is expected to fall back. Numbers tuned to be permissive
// of legitimate-but-terse replies ("Yes." is too terse; "Yes, that's right."
// is fine).
const MIN_LENGTH = {
  summary:  20,
  tutor:    20,
  myspace:  10
};

/**
 * Run the voice gate on a reply.
 *
 * @param {string} text  the LLM-generated reply
 * @param {{surface?: string}} [opts]
 * @returns {{ ok: boolean, failedChecks: string[], reasons: string[] }}
 */
function judgeReply(text, opts) {
  const surface = (opts && opts.surface) || 'tutor';
  const failedChecks = [];
  const reasons = [];

  if (typeof text !== 'string') {
    failedChecks.push('EMPTY_OR_TINY');
    reasons.push('reply is not a string (got ' + typeof text + ')');
    return { ok: false, failedChecks, reasons };
  }

  const trimmed = text.trim();
  const minLen = MIN_LENGTH[surface] || MIN_LENGTH.tutor;

  if (trimmed.length === 0) {
    failedChecks.push('EMPTY_OR_TINY');
    reasons.push('reply is empty after trim');
    return { ok: false, failedChecks, reasons };
  }
  if (trimmed.length < minLen) {
    failedChecks.push('EMPTY_OR_TINY');
    reasons.push('reply length ' + trimmed.length + ' < minimum ' + minLen + ' for surface=' + surface);
  }

  // Banned phrase check (substring, case-insensitive)
  const lower = trimmed.toLowerCase();
  const bannedHits = BANNED_PHRASES.filter(p => lower.indexOf(p) !== -1);
  if (bannedHits.length > 0) {
    failedChecks.push('BANNED_PHRASE');
    reasons.push('banned literal(s): ' + bannedHits.join(', '));
  }

  // Banned closer check (regex on the end of the reply)
  for (const re of BANNED_CLOSERS) {
    if (re.test(trimmed)) {
      failedChecks.push('BANNED_CLOSER');
      reasons.push('reply ends with banned closer: ' + re.source);
      break;
    }
  }

  return { ok: failedChecks.length === 0, failedChecks, reasons };
}

/**
 * The same set of banned phrases, exposed for any caller (test fixture,
 * cold-start judge mirror) that needs to keep its own list in sync.
 */
module.exports = {
  judgeReply,
  BANNED_PHRASES,
  BANNED_CLOSERS,
  MIN_LENGTH
};
