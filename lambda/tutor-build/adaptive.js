/**
 * GradeEarn — Adaptive Pacing Engine (Phase 1)
 *
 * Three layers, all pure-logic (no AWS calls — caller does the IO):
 *
 *   1) Per-strand ability rating (ELO-lite, K=24). Each strand a kid
 *      practices builds an internal rating. Items are sized to match.
 *
 *   2) Session-level streak-triggered difficulty bumps. After 5
 *      consecutive correct in a strand, the selector targets a
 *      harder band; after 2 consecutive wrong, it eases back.
 *
 *   3) Mastery flag + cross-strand recommendation. When a strand
 *      hits ≥85% on the last 10 (with ≥10 attempts), it's marked
 *      mastered — the selector then biases AWAY from it on free
 *      practice, surfacing weaker strands instead. This is the
 *      "kids cherry-pick easy units" fix: still tappable, just
 *      visually deprioritised by the subject picker, and the
 *      lambda's generate path won't keep returning the same
 *      mastered content when better practice exists elsewhere.
 *
 * What this module does NOT do (deferred to Phase 2-4 — CLAUDE.md §118):
 *  - Cents-reward calibration tied to difficulty.
 *  - Population-level item ELO from staar-content-events history.
 *  - Bayesian Knowledge Tracing (per-skill mastery distributions).
 *  - Reading/Science/SS strand mapping (text-math only for v1).
 *
 * State shape (stored at staar-stats.{userId, slug='adaptive#<state>#<grade>#<subject>'}.data):
 *
 *   {
 *     v: 1,
 *     strands: {
 *       "<strand-slug>": {
 *         r: 1200,            // ELO rating (int)
 *         n: 47,              // total attempts
 *         c: 38,              // total correct
 *         last10: "1011110111", // last 10 outcomes (oldest left, newest right)
 *         masteredAt: "2026-05-17T..." // sticky once set
 *       }
 *     },
 *     session: {
 *       id: "s_abc",          // matches client sessionId; resets engine session on change
 *       strand: "<slug>",     // strand of the most recent question
 *       cc: 5,                // consecutive correct in this strand
 *       cw: 0,                // consecutive wrong in this strand
 *       band: 2,              // current target difficulty band 0..4
 *       startedAt: "..."
 *     },
 *     rec: "<strand-slug>",   // next-strand nudge for subject picker
 *     updatedAt: "..."
 *   }
 *
 * Hard rules baked in:
 *  - Defensive: every public function tolerates missing/bad state and
 *    returns sane defaults. The lambda must not 500 on a malformed
 *    adaptiveState blob — degrade to "no pacing signal" and serve.
 *  - No persistence here. Caller wraps the result in PutItem/UpdateItem.
 */

'use strict';

// ============================================================
// CONSTANTS
// ============================================================

const SCHEMA_VERSION = 1;

const K_FACTOR = 24;              // ELO step size; converges in ~15-20 answers
const STARTING_ELO = 1200;        // population-average baseline
const BAND_TO_ELO = [800, 1000, 1200, 1400, 1600]; // band 0..4

const BUMP_AFTER_CC = 5;          // 5 in a row → band += 1
const DROP_AFTER_CW = 2;          // 2 wrong → band -= 1

const MASTERY_MIN_ATTEMPTS = 10;
const MASTERY_PCT_THRESHOLD = 0.85;
const MASTERY_LAST10_THRESHOLD = 8;

const COMFORT_STREAK_NUDGE = 10;  // 10 in a row → flag "ready for sibling strand"

// Type → band delta (light cognitive-difficulty adjustment vs the
// TEKS-tier default). Word-problem and concept are neutral.
const TYPE_DELTA = {
  'computation': -1,
  'word-problem': 0,
  'concept': 0,
  'data-interpretation': +1
};

// TEKS cognitive_demand → band delta
const DEMAND_DELTA = { 'l': -1, 'm': 0, 'h': +1 };

// ============================================================
// PUBLIC API
// ============================================================

function defaultState() {
  return { v: SCHEMA_VERSION, strands: {}, session: null, rec: null, updatedAt: null };
}

/**
 * Look up the strand-slug + grade + cognitive demand for a TEKS id.
 * Returns null if the TEKS is unknown (reading/science/etc., or a
 * typo in the lake row's `teks` field).
 */
function strandForTeks(teksId) {
  if (!teksId) return null;
  const rec = TEKS_STRANDS[String(teksId).trim()];
  if (!rec) return null;
  return { strand: rec.s, grade: rec.g, demand: rec.d };
}

/**
 * Reverse lookup: every TEKS id under a (strand, grade) pair.
 * Used when the selector wants to swap an LLM topic spec from one
 * strand to another (e.g. "kid mastered Number Ops, push them into
 * Geometry"). Returns an array of TEKS ids sorted lexicographically.
 */
function teksForStrand(strand, grade) {
  if (!strand || !grade) return [];
  const out = [];
  for (const [id, rec] of Object.entries(TEKS_STRANDS)) {
    if (rec.s === strand && rec.g === grade) out.push(id);
  }
  out.sort();
  return out;
}

/**
 * Parse the TEKS id out of a poolKey of the form
 *   "<state>#<grade>#<subject>#teks-<id>"
 * Returns null if shape doesn't match. Tolerant of casing on the id.
 */
function teksFromPoolKey(poolKey) {
  if (!poolKey || typeof poolKey !== 'string') return null;
  const idx = poolKey.lastIndexOf('#teks-');
  if (idx < 0) return null;
  const raw = poolKey.slice(idx + 6).trim();
  if (!raw || raw === 'unknown') return null;
  // TEKS ids are case-mixed in TEKS_STRANDS (e.g. "A.6B", "3.2A").
  // poolKey stores them lowercased per handleGenerate. Try direct
  // match; else uppercase-the-letters fallback.
  if (TEKS_STRANDS[raw]) return raw;
  const upped = raw.toUpperCase();
  if (TEKS_STRANDS[upped]) return upped;
  // Match by case-insensitive scan as last resort.
  const lc = raw.toLowerCase();
  for (const id of Object.keys(TEKS_STRANDS)) {
    if (id.toLowerCase() === lc) return id;
  }
  return null;
}

/**
 * Infer the difficulty band [0..4] of a pool item from its row
 * fields. Uses (in order): explicit _difficultyBand if stamped;
 * TEKS cognitive demand + question type; population pass rate;
 * fallback to 2 (centred).
 */
function inferItemDifficultyBand(item) {
  if (!item || typeof item !== 'object') return 2;
  if (Number.isInteger(item._difficultyBand)) {
    return clamp(item._difficultyBand, 0, 4);
  }
  let band = 2; // centred default
  const teks = item.teks || (item._lesson && item._lesson.teks);
  const meta = strandForTeks(teks);
  if (meta) band += (DEMAND_DELTA[meta.demand] || 0);
  band += (TYPE_DELTA[item.type] || 0);

  // Population pass-rate: if many kids got it right, it's probably
  // easier than the TEKS demand suggests, and vice versa. Only kicks
  // in once the item has ≥ 5 plays so we don't whipsaw on noise.
  const c = parseInt(item.timesCorrect, 10) || 0;
  const w = parseInt(item.timesIncorrect, 10) || 0;
  if (c + w >= 5) {
    const pct = c / (c + w);
    if (pct >= 0.85) band -= 1;
    else if (pct <= 0.45) band += 1;
  }
  return clamp(band, 0, 4);
}

/**
 * Apply an answer event to the adaptiveState. Pure: returns a new
 * state object plus a `pacing` summary the caller may bundle into
 * the lambda response.
 *
 * @param {object} prevState - the existing adaptiveState (or null/empty)
 * @param {object} signal - { sessionId, teks, isCorrect, contentId, itemBand }
 * @returns {{ state: object, pacing: object }}
 */
function recordAnswer(prevState, signal) {
  const state = cloneState(prevState);
  if (!signal || typeof signal.isCorrect !== 'boolean') {
    return { state, pacing: emptyPacing(state) };
  }
  const meta = strandForTeks(signal.teks);
  if (!meta) {
    // Unknown TEKS — still bump session counters under a sentinel so
    // the streak logic keeps working for non-pack content.
    return { state, pacing: emptyPacing(state) };
  }
  const strandKey = meta.strand;
  const itemBand = Number.isInteger(signal.itemBand)
    ? clamp(signal.itemBand, 0, 4)
    : 2;
  const opponent = BAND_TO_ELO[itemBand];

  // Init strand record if first encounter
  if (!state.strands[strandKey]) {
    state.strands[strandKey] = { r: STARTING_ELO, n: 0, c: 0, last10: '', masteredAt: null };
  }
  const ss = state.strands[strandKey];

  // ELO step
  const expected = 1 / (1 + Math.pow(10, (opponent - ss.r) / 400));
  const actual = signal.isCorrect ? 1 : 0;
  ss.r = Math.round(ss.r + K_FACTOR * (actual - expected));
  ss.n += 1;
  if (signal.isCorrect) ss.c += 1;
  ss.last10 = appendLast10(ss.last10, signal.isCorrect);

  // Sticky mastery
  if (!ss.masteredAt && isMastered(ss)) {
    ss.masteredAt = new Date().toISOString();
  }

  // Session: reset if new sessionId, else track streak in current strand
  const sid = signal.sessionId || (state.session && state.session.id) || null;
  if (!state.session || state.session.id !== sid) {
    state.session = {
      id: sid,
      strand: strandKey,
      cc: 0,
      cw: 0,
      band: 2,
      startedAt: new Date().toISOString()
    };
  }
  const sess = state.session;
  // If we switched strands mid-session, reset streak counters but
  // keep the band (the band reflects the kid's overall difficulty
  // ceiling within this sitting, not the strand).
  if (sess.strand !== strandKey) {
    sess.strand = strandKey;
    sess.cc = 0;
    sess.cw = 0;
  }

  let bumped = null; // 'up' | 'down' | null
  if (signal.isCorrect) {
    sess.cc += 1;
    sess.cw = 0;
    if (sess.cc >= BUMP_AFTER_CC && sess.band < 4) {
      sess.band += 1;
      sess.cc = 0;
      bumped = 'up';
    }
  } else {
    sess.cw += 1;
    sess.cc = 0;
    if (sess.cw >= DROP_AFTER_CW && sess.band > 0) {
      sess.band -= 1;
      sess.cw = 0;
      bumped = 'down';
    }
  }

  // Re-compute the cross-strand recommendation. Pick the strand most
  // worth practising next: not yet mastered, lowest rating, with at
  // least one TEKS available in the kid's grade.
  state.rec = pickRecommendedStrand(state, meta.grade);
  state.updatedAt = new Date().toISOString();

  return {
    state,
    pacing: {
      strand: strandKey,
      strandRating: ss.r,
      sessionBand: sess.band,
      cc: sess.cc,
      cw: sess.cw,
      bumped,
      mastered: !!ss.masteredAt,
      comfortNudge: sess.cc >= COMFORT_STREAK_NUDGE,
      rec: state.rec
    }
  };
}

/**
 * Score a pool of candidate items against the kid's adaptiveState +
 * a target strand. Returns the items sorted by adaptive fit
 * (best-first), plus a `pacing` block the caller can echo into the
 * lambda response.
 *
 * @param {array}  pool       - candidate items (already filtered by state/grade/subject/seenIds)
 * @param {object} prevState  - the kid's adaptiveState
 * @param {object} opts       - { grade, sessionId, scopedTeks?, scopedStrand? }
 * @returns {{ items, pacing }}
 */
function selectAdaptive(pool, prevState, opts) {
  const state = cloneState(prevState);
  const grade = opts && opts.grade;
  const sessionId = opts && opts.sessionId;
  const scopedTeks = opts && opts.scopedTeks;   // single-TEKS scope (unit-pinned practice)
  const scopedStrand = opts && opts.scopedStrand;

  // Determine the target strand. Scoped wins (kid explicitly picked a
  // unit/lesson); else session-current; else recommendation; else
  // weakest known; else null.
  //
  // CRITICAL: when the session-current strand is mastered AND the
  // caller hasn't scope-pinned, redirect to the recommendation. This
  // is the "kids cherry-pick easy units" fix — once a strand is
  // mastered, free-practice serves something they'll actually grow
  // from. Scoped practice (e.g. ?u=addition&t=3.4A) ignores this rule:
  // the kid asked for that TEKS, give them that TEKS.
  let targetStrand = null;
  const scoped = !!(scopedTeks || scopedStrand);
  if (scopedTeks) {
    const m = strandForTeks(scopedTeks);
    if (m) targetStrand = m.strand;
  }
  if (!targetStrand && scopedStrand) targetStrand = scopedStrand;
  if (!targetStrand && state.session && state.session.id === sessionId) {
    const candidate = state.session.strand;
    const candidateMastered = !!(state.strands[candidate] && state.strands[candidate].masteredAt);
    if (!candidateMastered) targetStrand = candidate;
  }
  if (!targetStrand) targetStrand = state.rec || pickRecommendedStrand(state, grade);
  // Last-resort fallback for an empty/cold state.
  if (!targetStrand) targetStrand = pickRecommendedStrand(state, grade);

  // Target difficulty band: current session band, or 2 if no session
  // exists yet.
  let targetBand = 2;
  if (state.session && state.session.id === sessionId) {
    targetBand = state.session.band;
  } else if (targetStrand && state.strands[targetStrand]) {
    // Cold-open: map current ELO to nearest band
    targetBand = nearestBandForRating(state.strands[targetStrand].r);
  }

  // Score each candidate. Lower = better fit.
  const scored = pool.map(item => {
    const itemMeta = strandForTeks(item.teks);
    const itemBand = inferItemDifficultyBand(item);
    let score = 0;
    if (targetStrand && itemMeta && itemMeta.strand === targetStrand) score -= 100;
    else if (!itemMeta) score += 5; // mild penalty for un-tagged items
    score += Math.abs(itemBand - targetBand) * 8;
    // Tiebreak: prefer items with fewer total plays (population
    // freshness — gives every row a chance to gather signal).
    const plays = (parseInt(item.timesCorrect, 10) || 0) + (parseInt(item.timesIncorrect, 10) || 0);
    score += plays * 0.05;
    return { item, score, itemBand, itemMeta };
  });

  scored.sort((a, b) => a.score - b.score);

  return {
    items: scored.map(s => s.item),
    pacing: {
      targetStrand,
      targetBand,
      sessionBand: state.session ? state.session.band : 2,
      strandRating: targetStrand && state.strands[targetStrand]
        ? state.strands[targetStrand].r
        : null,
      mastered: !!(targetStrand && state.strands[targetStrand]
        && state.strands[targetStrand].masteredAt),
      rec: state.rec || null
    }
  };
}

/**
 * Lightweight read-only summary used by the subject picker (subject.html).
 * Returns { recommended, mastered: [], ratings: {strand: rating, ...} }
 * for a (state, grade, subject) scope.
 */
function summarize(prevState, grade) {
  const state = cloneState(prevState);
  const ratings = {};
  const mastered = [];
  for (const [strand, ss] of Object.entries(state.strands || {})) {
    ratings[strand] = ss.r;
    if (ss.masteredAt) mastered.push(strand);
  }
  return {
    v: state.v || SCHEMA_VERSION,
    recommended: state.rec || pickRecommendedStrand(state, grade),
    mastered,
    ratings,
    sessionBand: state.session ? state.session.band : null,
    updatedAt: state.updatedAt || null
  };
}

// ============================================================
// INTERNALS
// ============================================================

function cloneState(prev) {
  if (!prev || typeof prev !== 'object') return defaultState();
  // Shallow-ish clone good enough — leaf values are primitives.
  return {
    v: SCHEMA_VERSION,
    strands: Object.fromEntries(
      Object.entries(prev.strands || {}).map(([k, v]) => [k, Object.assign({}, v)])
    ),
    session: prev.session ? Object.assign({}, prev.session) : null,
    rec: prev.rec || null,
    updatedAt: prev.updatedAt || null
  };
}

function clamp(n, lo, hi) {
  n = Math.round(Number(n) || 0);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function appendLast10(prev, isCorrect) {
  const s = String(prev || '') + (isCorrect ? '1' : '0');
  return s.slice(-10);
}

function isMastered(strandState) {
  if (!strandState) return false;
  if (strandState.n < MASTERY_MIN_ATTEMPTS) return false;
  if (strandState.c / strandState.n < MASTERY_PCT_THRESHOLD) return false;
  const last10 = String(strandState.last10 || '');
  if (last10.length < MASTERY_MIN_ATTEMPTS) return false;
  let ones = 0;
  for (const ch of last10) if (ch === '1') ones++;
  return ones >= MASTERY_LAST10_THRESHOLD;
}

function nearestBandForRating(rating) {
  let best = 2;
  let bestDist = Infinity;
  for (let b = 0; b < BAND_TO_ELO.length; b++) {
    const d = Math.abs(BAND_TO_ELO[b] - rating);
    if (d < bestDist) { best = b; bestDist = d; }
  }
  return best;
}

function emptyPacing(state) {
  return {
    strand: state.session ? state.session.strand : null,
    sessionBand: state.session ? state.session.band : 2,
    bumped: null,
    mastered: false,
    comfortNudge: false,
    rec: state.rec || null
  };
}

/**
 * Pick the strand most worth practising next for the kid's current
 * grade. Rules, in order:
 *   1. Skip strands the kid has mastered.
 *   2. Skip strands without TEKS in the kid's grade.
 *   3. Prefer strands the kid has attempted at least once but with
 *      the lowest rating (active weak spot).
 *   4. If all attempted strands are at/above starting ELO, pick the
 *      strand with the FEWEST attempts (encourage breadth).
 *   5. If no attempts yet at all, pick the first strand by stable
 *      lexical order in this grade.
 */
function pickRecommendedStrand(state, grade) {
  if (!grade) return null;
  // Set of strands that have at least one TEKS in this grade.
  const gradeStrands = new Set();
  for (const rec of Object.values(TEKS_STRANDS)) {
    if (rec.g === grade) gradeStrands.add(rec.s);
  }
  if (gradeStrands.size === 0) return null;

  const ratedNotMastered = [];
  const unattempted = [];
  for (const strand of gradeStrands) {
    const ss = state.strands && state.strands[strand];
    if (ss && ss.masteredAt) continue;
    if (ss && ss.n > 0) ratedNotMastered.push([strand, ss]);
    else unattempted.push(strand);
  }

  if (ratedNotMastered.length) {
    // Sort by (rating asc, attempts asc) — weakest first, with
    // attempts as tiebreaker so a low-attempt low-rating strand
    // (volatile) doesn't dominate one that's clearly weaker by
    // sample size.
    ratedNotMastered.sort((a, b) => {
      if (a[1].r !== b[1].r) return a[1].r - b[1].r;
      return a[1].n - b[1].n;
    });
    return ratedNotMastered[0][0];
  }

  if (unattempted.length) {
    unattempted.sort(); // stable lexical
    return unattempted[0];
  }

  // All strands mastered (rare, late-game). Don't recommend any —
  // the subject picker treats null as "no nudge needed".
  return null;
}

// ============================================================
// TEKS → strand snapshot
//
// Built from state-packs/texas/standards/teks-math.json. Re-generate
// when that file changes:
//
//   node -e "const t=require('./state-packs/texas/standards/teks-math.json');
//   const sl=s=>String(s).toLowerCase().replace(/[()]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-\$/g,'');
//   const o={}; for(const k of Object.keys(t)){ if(k.startsWith('_')||!t[k].standards) continue;
//   for(const s of t[k].standards) o[s.id]={s:sl(s.strand),g:k.replace('_','-'),d:(s.cognitive_demand||'medium').charAt(0)};}
//   console.log(JSON.stringify(o));"
// ============================================================

const TEKS_STRANDS = {"3.2A":{"s":"number-and-operations","g":"grade-3","d":"m"},"3.2B":{"s":"number-and-operations","g":"grade-3","d":"m"},"3.2C":{"s":"number-and-operations","g":"grade-3","d":"m"},"3.2D":{"s":"number-and-operations","g":"grade-3","d":"l"},"3.3A":{"s":"number-and-operations-fractions","g":"grade-3","d":"m"},"3.3B":{"s":"number-and-operations-fractions","g":"grade-3","d":"m"},"3.3F":{"s":"number-and-operations-fractions","g":"grade-3","d":"m"},"3.3G":{"s":"number-and-operations-fractions","g":"grade-3","d":"m"},"3.3H":{"s":"number-and-operations-fractions","g":"grade-3","d":"m"},"3.4A":{"s":"number-and-operations-computation","g":"grade-3","d":"m"},"3.4D":{"s":"number-and-operations-computation","g":"grade-3","d":"m"},"3.4E":{"s":"number-and-operations-computation","g":"grade-3","d":"m"},"3.4F":{"s":"number-and-operations-computation","g":"grade-3","d":"l"},"3.4G":{"s":"number-and-operations-computation","g":"grade-3","d":"m"},"3.4H":{"s":"number-and-operations-computation","g":"grade-3","d":"m"},"3.4K":{"s":"number-and-operations-computation","g":"grade-3","d":"m"},"3.5A":{"s":"algebraic-reasoning","g":"grade-3","d":"m"},"3.5B":{"s":"algebraic-reasoning","g":"grade-3","d":"m"},"3.5E":{"s":"algebraic-reasoning","g":"grade-3","d":"m"},"3.6A":{"s":"geometry","g":"grade-3","d":"l"},"3.6C":{"s":"geometry","g":"grade-3","d":"m"},"3.6E":{"s":"geometry","g":"grade-3","d":"m"},"3.7B":{"s":"measurement","g":"grade-3","d":"m"},"3.7C":{"s":"measurement","g":"grade-3","d":"m"},"3.7D":{"s":"measurement","g":"grade-3","d":"l"},"3.7E":{"s":"measurement","g":"grade-3","d":"m"},"3.8A":{"s":"data-analysis","g":"grade-3","d":"m"},"3.8B":{"s":"data-analysis","g":"grade-3","d":"m"},"3.9A":{"s":"personal-financial-literacy","g":"grade-3","d":"l"},"3.9C":{"s":"personal-financial-literacy","g":"grade-3","d":"m"},"3.9D":{"s":"personal-financial-literacy","g":"grade-3","d":"m"},"4.2A":{"s":"number-and-operations","g":"grade-4","d":"m"},"4.2B":{"s":"number-and-operations","g":"grade-4","d":"m"},"4.2C":{"s":"number-and-operations","g":"grade-4","d":"l"},"4.2E":{"s":"number-and-operations","g":"grade-4","d":"m"},"4.2F":{"s":"number-and-operations","g":"grade-4","d":"m"},"4.2G":{"s":"number-and-operations","g":"grade-4","d":"m"},"4.2H":{"s":"number-and-operations","g":"grade-4","d":"m"},"4.3A":{"s":"number-and-operations-fractions","g":"grade-4","d":"m"},"4.3B":{"s":"number-and-operations-fractions","g":"grade-4","d":"m"},"4.3C":{"s":"number-and-operations-fractions","g":"grade-4","d":"m"},"4.3D":{"s":"number-and-operations-fractions","g":"grade-4","d":"m"},"4.3E":{"s":"number-and-operations-fractions","g":"grade-4","d":"m"},"4.4A":{"s":"number-and-operations-computation","g":"grade-4","d":"m"},"4.4B":{"s":"number-and-operations-computation","g":"grade-4","d":"l"},"4.4D":{"s":"number-and-operations-computation","g":"grade-4","d":"m"},"4.4F":{"s":"number-and-operations-computation","g":"grade-4","d":"m"},"4.4H":{"s":"number-and-operations-computation","g":"grade-4","d":"m"},"4.5A":{"s":"algebraic-reasoning","g":"grade-4","d":"m"},"4.5B":{"s":"algebraic-reasoning","g":"grade-4","d":"m"},"4.5C":{"s":"algebraic-reasoning","g":"grade-4","d":"m"},"4.5D":{"s":"algebraic-reasoning","g":"grade-4","d":"m"},"4.6A":{"s":"geometry","g":"grade-4","d":"l"},"4.6D":{"s":"geometry","g":"grade-4","d":"m"},"4.7C":{"s":"geometry-measurement","g":"grade-4","d":"m"},"4.8A":{"s":"measurement","g":"grade-4","d":"l"},"4.8B":{"s":"measurement","g":"grade-4","d":"m"},"4.8C":{"s":"measurement","g":"grade-4","d":"m"},"4.9A":{"s":"data-analysis","g":"grade-4","d":"m"},"4.9B":{"s":"data-analysis","g":"grade-4","d":"m"},"4.10A":{"s":"personal-financial-literacy","g":"grade-4","d":"l"},"4.10B":{"s":"personal-financial-literacy","g":"grade-4","d":"m"},"4.10E":{"s":"personal-financial-literacy","g":"grade-4","d":"l"},"5.2A":{"s":"number-and-operations","g":"grade-5","d":"m"},"5.2B":{"s":"number-and-operations","g":"grade-5","d":"l"},"5.2C":{"s":"number-and-operations","g":"grade-5","d":"l"},"5.3A":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3B":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3C":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3E":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3F":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3H":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3I":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3K":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.3L":{"s":"number-and-operations-computation","g":"grade-5","d":"m"},"5.4A":{"s":"algebraic-reasoning","g":"grade-5","d":"l"},"5.4B":{"s":"algebraic-reasoning","g":"grade-5","d":"h"},"5.4C":{"s":"algebraic-reasoning","g":"grade-5","d":"m"},"5.4F":{"s":"algebraic-reasoning","g":"grade-5","d":"m"},"5.4H":{"s":"geometry-measurement","g":"grade-5","d":"m"},"5.5A":{"s":"geometry","g":"grade-5","d":"m"},"5.6A":{"s":"geometry-measurement","g":"grade-5","d":"m"},"5.6B":{"s":"geometry-measurement","g":"grade-5","d":"m"},"5.7A":{"s":"measurement","g":"grade-5","d":"m"},"5.8A":{"s":"geometry-measurement","g":"grade-5","d":"l"},"5.8B":{"s":"geometry-measurement","g":"grade-5","d":"m"},"5.9A":{"s":"data-analysis","g":"grade-5","d":"m"},"5.9B":{"s":"data-analysis","g":"grade-5","d":"m"},"5.9C":{"s":"data-analysis","g":"grade-5","d":"m"},"5.10A":{"s":"personal-financial-literacy","g":"grade-5","d":"l"},"5.10F":{"s":"personal-financial-literacy","g":"grade-5","d":"m"},"6.2A":{"s":"number-and-operations","g":"grade-6","d":"l"},"6.2B":{"s":"number-and-operations","g":"grade-6","d":"l"},"6.2C":{"s":"number-and-operations","g":"grade-6","d":"m"},"6.2D":{"s":"number-and-operations","g":"grade-6","d":"m"},"6.2E":{"s":"number-and-operations","g":"grade-6","d":"l"},"6.3A":{"s":"number-and-operations-computation","g":"grade-6","d":"m"},"6.3B":{"s":"number-and-operations-computation","g":"grade-6","d":"m"},"6.3C":{"s":"number-and-operations-computation","g":"grade-6","d":"m"},"6.3D":{"s":"number-and-operations-computation","g":"grade-6","d":"m"},"6.3E":{"s":"number-and-operations-computation","g":"grade-6","d":"m"},"6.4A":{"s":"proportionality","g":"grade-6","d":"h"},"6.4B":{"s":"proportionality","g":"grade-6","d":"h"},"6.4D":{"s":"proportionality","g":"grade-6","d":"m"},"6.4E":{"s":"proportionality","g":"grade-6","d":"m"},"6.4G":{"s":"proportionality","g":"grade-6","d":"m"},"6.5A":{"s":"proportionality","g":"grade-6","d":"m"},"6.5B":{"s":"proportionality","g":"grade-6","d":"m"},"6.5C":{"s":"proportionality","g":"grade-6","d":"m"},"6.6A":{"s":"expressions-equations-relationships","g":"grade-6","d":"m"},"6.6C":{"s":"expressions-equations-relationships","g":"grade-6","d":"m"},"6.7A":{"s":"expressions-equations-relationships","g":"grade-6","d":"m"},"6.7B":{"s":"expressions-equations-relationships","g":"grade-6","d":"l"},"6.7C":{"s":"expressions-equations-relationships","g":"grade-6","d":"m"},"6.8A":{"s":"expressions-equations-relationships-geometry","g":"grade-6","d":"m"},"6.8B":{"s":"expressions-equations-relationships-geometry","g":"grade-6","d":"m"},"6.8D":{"s":"expressions-equations-relationships-geometry","g":"grade-6","d":"m"},"6.10A":{"s":"statistics","g":"grade-6","d":"m"},"6.12A":{"s":"statistics","g":"grade-6","d":"m"},"6.14A":{"s":"personal-financial-literacy","g":"grade-6","d":"m"},"6.14F":{"s":"personal-financial-literacy","g":"grade-6","d":"m"},"7.2A":{"s":"number-and-operations","g":"grade-7","d":"l"},"7.3A":{"s":"number-and-operations-computation","g":"grade-7","d":"m"},"7.3B":{"s":"number-and-operations-computation","g":"grade-7","d":"h"},"7.4A":{"s":"proportionality","g":"grade-7","d":"m"},"7.4B":{"s":"proportionality","g":"grade-7","d":"m"},"7.4D":{"s":"proportionality","g":"grade-7","d":"h"},"7.4E":{"s":"proportionality","g":"grade-7","d":"m"},"7.5A":{"s":"proportionality-geometry","g":"grade-7","d":"m"},"7.5C":{"s":"proportionality-geometry","g":"grade-7","d":"m"},"7.6A":{"s":"probability","g":"grade-7","d":"m"},"7.6C":{"s":"probability","g":"grade-7","d":"m"},"7.6D":{"s":"probability","g":"grade-7","d":"m"},"7.6I":{"s":"probability","g":"grade-7","d":"m"},"7.7A":{"s":"expressions-equations-relationships","g":"grade-7","d":"m"},"7.8A":{"s":"expressions-equations-relationships","g":"grade-7","d":"m"},"7.9A":{"s":"expressions-equations-relationships-geometry","g":"grade-7","d":"m"},"7.9B":{"s":"expressions-equations-relationships-geometry","g":"grade-7","d":"m"},"7.9C":{"s":"expressions-equations-relationships-geometry","g":"grade-7","d":"m"},"7.10A":{"s":"expressions-equations-relationships","g":"grade-7","d":"m"},"7.11A":{"s":"expressions-equations-relationships","g":"grade-7","d":"m"},"7.11B":{"s":"expressions-equations-relationships","g":"grade-7","d":"l"},"7.12A":{"s":"statistics","g":"grade-7","d":"m"},"7.12B":{"s":"statistics","g":"grade-7","d":"m"},"7.13A":{"s":"personal-financial-literacy","g":"grade-7","d":"m"},"7.13E":{"s":"personal-financial-literacy","g":"grade-7","d":"h"},"8.2A":{"s":"number-and-operations","g":"grade-8","d":"l"},"8.2B":{"s":"number-and-operations","g":"grade-8","d":"m"},"8.2C":{"s":"number-and-operations","g":"grade-8","d":"m"},"8.2D":{"s":"number-and-operations","g":"grade-8","d":"m"},"8.3A":{"s":"proportionality","g":"grade-8","d":"m"},"8.3B":{"s":"proportionality","g":"grade-8","d":"m"},"8.4A":{"s":"proportionality","g":"grade-8","d":"h"},"8.4B":{"s":"proportionality","g":"grade-8","d":"m"},"8.4C":{"s":"proportionality","g":"grade-8","d":"m"},"8.5A":{"s":"proportionality-functions","g":"grade-8","d":"m"},"8.5B":{"s":"proportionality-functions","g":"grade-8","d":"m"},"8.5G":{"s":"proportionality-functions","g":"grade-8","d":"m"},"8.5I":{"s":"proportionality-functions","g":"grade-8","d":"m"},"8.7A":{"s":"geometry-measurement","g":"grade-8","d":"m"},"8.7B":{"s":"geometry-measurement","g":"grade-8","d":"m"},"8.7C":{"s":"geometry-measurement","g":"grade-8","d":"m"},"8.7D":{"s":"geometry-measurement","g":"grade-8","d":"m"},"8.8A":{"s":"expressions-equations-relationships","g":"grade-8","d":"m"},"8.8C":{"s":"expressions-equations-relationships","g":"grade-8","d":"h"},"8.10A":{"s":"two-dimensional-shapes","g":"grade-8","d":"m"},"8.11A":{"s":"statistics","g":"grade-8","d":"m"},"8.12A":{"s":"personal-financial-literacy","g":"grade-8","d":"h"},"8.12D":{"s":"personal-financial-literacy","g":"grade-8","d":"h"},"A.2A":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.2B":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.2D":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.2H":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.3A":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.3B":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.3C":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.5A":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.5B":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"m"},"A.5C":{"s":"linear-functions-equations-inequalities","g":"algebra-1","d":"h"},"A.6A":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"m"},"A.6B":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"h"},"A.6C":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"h"},"A.7A":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"m"},"A.7B":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"m"},"A.7C":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"h"},"A.8A":{"s":"quadratic-functions-and-equations","g":"algebra-1","d":"h"},"A.10A":{"s":"polynomial-expressions-and-operations","g":"algebra-1","d":"m"},"A.10B":{"s":"polynomial-expressions-and-operations","g":"algebra-1","d":"m"},"A.10E":{"s":"polynomial-expressions-and-operations","g":"algebra-1","d":"m"},"A.11A":{"s":"number-and-algebraic-methods","g":"algebra-1","d":"m"},"A.11B":{"s":"number-and-algebraic-methods","g":"algebra-1","d":"m"},"A.12A":{"s":"exponential-functions-and-equations","g":"algebra-1","d":"l"},"A.12B":{"s":"exponential-functions-and-equations","g":"algebra-1","d":"l"},"A.12C":{"s":"exponential-functions-and-equations","g":"algebra-1","d":"m"}};

module.exports = {
  // Public API
  defaultState,
  strandForTeks,
  teksForStrand,
  teksFromPoolKey,
  inferItemDifficultyBand,
  recordAnswer,
  selectAdaptive,
  summarize,
  // Snapshot accessor — used by handleGetAdaptive to ship a TEKS→strand
  // map to the frontend so subject-page.js doesn't need its own copy.
  // Returns the inline snapshot directly; callers must not mutate.
  _teksSnapshot: () => TEKS_STRANDS,
  // Exposed constants for tests / tuning
  K_FACTOR,
  STARTING_ELO,
  BAND_TO_ELO,
  BUMP_AFTER_CC,
  DROP_AFTER_CW,
  MASTERY_MIN_ATTEMPTS,
  MASTERY_PCT_THRESHOLD,
  COMFORT_STREAK_NUDGE,
  SCHEMA_VERSION
};
