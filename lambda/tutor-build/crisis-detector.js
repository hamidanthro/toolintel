/**
 * Crisis detector + output moderator for the AI-chat surfaces.
 *
 * THIS IS A SAFETY-CRITICAL FILE. Every change requires a parity copy
 * in lambda/tutor-build/ (per CLAUDE.md §5 deploy hazard).
 *
 * Threat model (Character.AI / OpenAI / Replika lawsuit fact patterns):
 *   - Kid expresses self-harm or suicide ideation → AI continues chat
 *     casually → kid hurts themselves → wrongful death suit
 *   - Kid mentions abuse → AI doesn't surface to a trusted adult
 *   - AI agrees to "keep a secret" from a parent
 *   - AI outputs sexual / romantic / violent content
 *   - Kid shares PII (phone, address, school) and AI stores/echoes it
 *
 * Defense (this file):
 *   1. detectCrisis() runs BEFORE every LLM call. On self-harm /
 *      abuse / acute distress match, the calling action MUST skip the
 *      LLM entirely and return a fixed safety message (988 referenced).
 *   2. moderateOutput() runs AFTER every LLM call. On any banned
 *      pattern in the model reply, swap with a safe fallback.
 *   3. logSafetyEvent() writes to staar-safety-events for compliance.
 *
 * Lawyer review tag: <!-- LAWYER-REVIEW --> applies to the fixed-text
 * safety messages too. The 988 phrasing is the standard one used by
 * 988 Suicide & Crisis Lifeline, but a privacy lawyer + a child-safety
 * clinician should review final wording before launch.
 */

'use strict';

// ============================================================
// CRISIS PATTERNS
// ============================================================
//
// Conservative on purpose. False positives are cheap (kid gets a kind
// "talk to a grown-up" reply); false negatives are catastrophic.
// Regexes use \b word boundaries to avoid catching e.g. "killing it
// at math" → 'kill' matches in "kill myself" only.

const CRISIS_PATTERNS = {
  self_harm: [
    /\bkill\s*(my\s*self|myself)\b/i,
    /\bend\s+(it|my\s*life)\b/i,
    /\bsuicid(e|al)\b/i,
    /\bwant\s+to\s+die\b/i,
    /\bdon[''']?t\s+want\s+to\s+(live|be\s+here|exist)\b/i,
    /\bcut(ting)?\s*my\s*self\b/i,
    /\bhurt(ing)?\s*my\s*self\b/i,
    /\bself[\s-]?harm\b/i,
    /\bstarv(e|ing)\s*my\s*self\b/i,
    /\bthrow\s*up\s+(on\s*purpose|after\s*eating)\b/i,
    /\bi\s+want\s+to\s+(stop\s+(existing|living)|disappear\s+forever)\b/i,
  ],
  abuse: [
    /\b(hits|hurts|punches|kicks)\s+me\b/i,
    /\btouches\s+me\s+(weird|bad|wrong|where)\b/i,
    /\bscared\s+of\s+(my\s+)?(dad|mom|mother|father|step[\s-]?(dad|mom|father|mother))\b/i,
    /\b(dad|mom|mother|father)\s+(hits|hurts|beats)\b/i,
  ],
  distress: [
    /\bno\s+one\s+(likes|loves|cares\s+about)\s+me\b/i,
    /\bhate\s+my\s*self\b/i,
    /\bi[''']?m\s+worthless\b/i,
    /\bi[''']?m\s+hopeless\b/i,
    /\beveryone\s+(hates\s+me|would\s+be\s+better\s+(off\s+)?without\s+me)\b/i,
  ],
  pii_share: [
    /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/,
    /\b\d{1,5}\s+\w+\s+(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/i,
    /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/,
  ],
  // Jailbreak attempts — kid trying to break the AI's safety
  jailbreak: [
    /\bignore\s+(your\s+)?(previous\s+)?(instructions|system\s+prompt)\b/i,
    /\b(pretend|act|roleplay)\s+(to\s+be|as\s+if\s+you\s+are)\s+(my\s+)?(girlfriend|boyfriend|partner|crush)\b/i,
    /\btell\s+me\s+(your\s+)?(system\s+prompt|instructions)\b/i,
    /\b(don[''']?t|do\s+not)\s+tell\s+(my\s+)?(mom|dad|parent|teacher)\b/i,  // secret-keeping
    /\b(can\s+you\s+)?keep\s+(a|this)\s+secret\b/i,
  ],
};

const SEVERITY = {
  self_harm: 'critical',
  abuse:     'critical',
  distress:  'high',
  pii_share: 'medium',
  jailbreak: 'medium',
};

// ============================================================
// FIXED SAFETY REPLIES
// ============================================================
// These bypass the LLM. <!-- LAWYER-REVIEW --> on every string.

const SAFETY_REPLIES = {
  self_harm: [
    "What you're feeling sounds really hard, and I'm so glad you said something.",
    "I'm a computer program, so I can't help with this the way a real person can — but a grown-up you trust can.",
    "Please talk to a parent, teacher, school counselor, or any adult who cares about you.",
    "If you need someone right now in the U.S., you can call or text 988 — they listen, they help, and they're always there.",
  ].join(' '),

  abuse: [
    "What you just told me sounds really serious, and you did the right thing saying it.",
    "I'm just a computer program, so I can't help directly — but you should tell a grown-up you trust who isn't the person you're worried about.",
    "A school counselor, a teacher, or another family member can listen and help.",
    "In the U.S., you can also call or text the Childhelp National Child Abuse Hotline at 1-800-422-4453.",
  ].join(' '),

  distress: [
    "I hear you, and what you're feeling matters.",
    "I'm just a computer program, so a real person can help in ways I can't.",
    "Talking to a grown-up you trust — a parent, teacher, or counselor — can make a real difference.",
    "If you ever need someone right now in the U.S., you can call or text 988 anytime.",
  ].join(' '),

  pii_share: "Let's keep your personal info safe — I don't need that to help you. What were we working on?",

  jailbreak_secret: "I can't keep secrets from grown-ups who care about you — important things should always be something a parent or teacher knows. What's on your mind?",
  jailbreak_role:   "I'm a study helper, not a friend or anyone else. Want to work on homework or your journal?",
  jailbreak_prompt: "I can't share my instructions. Let's get back to what you're working on.",
};

// ============================================================
// OUTPUT MODERATION PATTERNS
// ============================================================
// Scan the LLM's response BEFORE showing it to the kid. If any of these
// match, replace the reply with a safe fallback — the model jailbroke
// despite the system prompt.

const BANNED_OUTPUT_PATTERNS = [
  // Sexual / romantic
  /\b(my\s+(love|darling|sweetheart|baby)|i\s+love\s+you)\b/i,
  /\b(kiss(ing)?|making\s+love|sex)\b/i,
  // Self-harm encouragement (model should never produce this)
  /\b(you\s+should\s+(kill|hurt|cut)\s+(yourself|your\s*self))\b/i,
  // Violent instruction
  /\b(how\s+to\s+make\s+a\s+(bomb|weapon|gun)|kill\s+someone)\b/i,
  // Drugs / alcohol / gambling
  /\b(how\s+to\s+(get|buy)\s+(weed|alcohol|drugs|cocaine|heroin))\b/i,
  // Secret-keeping from parents
  /\b(i\s+(won[''']?t|will\s+not)\s+tell\s+(your\s+)?(parent|mom|dad))\b/i,
  /\b(let[''']?s|let\s+us|we\s+can|i\s+(can|will))\s+keep\s+(this|that|it)\s+a?\s*secret\b/i,
  /\b(don[''']?t\s+tell\s+(your\s+)?(parent|mom|dad|grown\s*[\-\s]?up))\b/i,
  /\b(our\s+little\s+secret)\b/i,
];

const SAFE_OUTPUT_FALLBACK = "Let me try that a different way. What's something you've been working on that I can help with?";

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Scan the kid's incoming message for crisis signals.
 * @param {string} message
 * @returns {null | { signal_type, severity, matched }}
 */
function detectCrisis(message) {
  if (!message || typeof message !== 'string') return null;
  for (const signalType of Object.keys(CRISIS_PATTERNS)) {
    const patterns = CRISIS_PATTERNS[signalType];
    for (let i = 0; i < patterns.length; i++) {
      const m = message.match(patterns[i]);
      if (m) {
        return {
          signal_type: signalType,
          severity: SEVERITY[signalType] || 'medium',
          matched: m[0].slice(0, 80),
        };
      }
    }
  }
  return null;
}

/**
 * Pick the right fixed safety reply for a detected signal.
 * On critical signals (self_harm, abuse), this REPLACES the LLM call.
 */
function safetyReplyFor(signal) {
  if (!signal) return null;
  switch (signal.signal_type) {
    case 'self_harm': return SAFETY_REPLIES.self_harm;
    case 'abuse':     return SAFETY_REPLIES.abuse;
    case 'distress':  return SAFETY_REPLIES.distress;
    case 'pii_share': return SAFETY_REPLIES.pii_share;
    case 'jailbreak':
      if (/secret|tell\s+(my|mom|dad|parent|teacher)/i.test(signal.matched || '')) return SAFETY_REPLIES.jailbreak_secret;
      if (/girlfriend|boyfriend|partner|crush/i.test(signal.matched || '')) return SAFETY_REPLIES.jailbreak_role;
      return SAFETY_REPLIES.jailbreak_prompt;
    default: return null;
  }
}

/**
 * Scan the model's outgoing reply. If any banned pattern matches,
 * return null so the caller swaps in a safe fallback.
 */
function moderateOutput(reply) {
  if (!reply || typeof reply !== 'string') return { clean: false, replacement: SAFE_OUTPUT_FALLBACK, reason: 'empty' };
  for (let i = 0; i < BANNED_OUTPUT_PATTERNS.length; i++) {
    if (BANNED_OUTPUT_PATTERNS[i].test(reply)) {
      return { clean: false, replacement: SAFE_OUTPUT_FALLBACK, reason: 'banned_pattern_' + i };
    }
  }
  return { clean: true };
}

module.exports = {
  detectCrisis,
  safetyReplyFor,
  moderateOutput,
  CRISIS_PATTERNS,
  SAFETY_REPLIES,
};
