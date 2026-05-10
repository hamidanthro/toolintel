// GradeEarn — Mastery levels + next-topic recommendations.
// Shared by practice.js (end-of-session screen) and subject-page.js
// (topic cards). Pure functions — no DOM, no state.
//
// Designed kid-first: encouraging language ("crushing", "let's try"),
// single-emoji badges (not littered), forgiving thresholds (Strong
// at 70% not 80%), and Starter shown only when there's not enough
// data to grade — never as a put-down.

(function () {
  'use strict';

  // Level thresholds. Tuned for STAAR-prep kids:
  //   • A 70% on a real STAAR test passes; 80% is meets-grade-level.
  //   • Strong starts at 70% so kids feel rewarded for passing-level
  //     work, then Mastered at 90%+ rewards fluency.
  //   • Need 5+ questions before grading at all (Starter shows).
  //   • Need 10+ before "Mastered" can fire — single lucky run shouldn't
  //     give a kid a trophy on 3-of-3.
  const MIN_TO_GRADE = 5;
  const MIN_FOR_MASTERED = 10;
  const STRONG_PCT = 70;
  const MASTERED_PCT = 90;

  // Returns { key, label, emoji, blurb, color } for a unit's stats.
  // stats shape: { total: int, correct: int } or null/undefined.
  function levelFor(stats) {
    if (!stats || !stats.total || stats.total < MIN_TO_GRADE) {
      return {
        key: 'starter',
        label: 'New',
        emoji: '🌱',
        blurb: stats && stats.total
          ? `${stats.total} answered — keep going to earn a badge`
          : 'No questions answered yet',
        color: '#94a3b8' // slate-400
      };
    }
    const pct = Math.round((stats.correct / stats.total) * 100);
    if (stats.total >= MIN_FOR_MASTERED && pct >= MASTERED_PCT) {
      return {
        key: 'mastered',
        label: 'Mastered',
        emoji: '🏆',
        blurb: `${stats.correct} of ${stats.total} correct · ${pct}%`,
        color: '#fbbf24' // gold
      };
    }
    if (pct >= STRONG_PCT) {
      return {
        key: 'strong',
        label: 'Strong',
        emoji: '💪',
        blurb: `${stats.correct} of ${stats.total} correct · ${pct}%`,
        color: '#34d399' // emerald-400
      };
    }
    return {
      key: 'building',
      label: 'Building',
      emoji: '📈',
      blurb: `${stats.correct} of ${stats.total} correct · ${pct}%`,
      color: '#60a5fa' // blue-400
    };
  }

  // Given the kid's localStorage stats for a grade and the curriculum
  // (so we know all unit ids + titles), return the unit they should
  // try next AFTER finishing strong/mastered work in `currentUnitId`.
  //
  // Decision rule (in order of preference):
  //   1. A unit that's never been touched (no stats entry).
  //      → highest leverage; the kid hasn't even started this topic.
  //   2. A unit at Starter level (under-tested — fewer than MIN_TO_GRADE
  //      questions).
  //      → kid started but hasn't gotten data; let's get them more.
  //   3. A unit at Building level (lowest-pct first).
  //      → kid is struggling here; pivot to where help is needed most.
  //   4. null if every other unit is already Strong / Mastered — kid
  //      is done in this grade for now.
  //
  // Returns { unit, level, reason } or null.
  function recommendNext(allStats, curr, currentUnitId) {
    if (!curr || !Array.isArray(curr.units) || curr.units.length === 0) return null;
    const otherUnits = curr.units.filter(u => u.id !== currentUnitId);
    if (otherUnits.length === 0) return null;

    const statsUnits = (allStats && allStats.units) || {};

    // Priority 1: never touched
    const untouched = otherUnits.filter(u => !statsUnits[u.id] || !statsUnits[u.id].total);
    if (untouched.length > 0) {
      // Pick the FIRST untouched unit by curriculum order — kids learn
      // best in the order the curriculum was designed.
      const u = untouched[0];
      return {
        unit: u,
        level: levelFor(null),
        reason: 'never_practiced'
      };
    }

    // Priority 2: Starter level (touched but under-tested)
    const starters = otherUnits
      .filter(u => statsUnits[u.id] && statsUnits[u.id].total < MIN_TO_GRADE)
      .sort((a, b) => (statsUnits[a.id].total || 0) - (statsUnits[b.id].total || 0));
    if (starters.length > 0) {
      const u = starters[0];
      return {
        unit: u,
        level: levelFor(statsUnits[u.id]),
        reason: 'undertested'
      };
    }

    // Priority 3: Building level (lowest-pct first)
    const building = otherUnits
      .map(u => ({ u, s: statsUnits[u.id], lev: levelFor(statsUnits[u.id]) }))
      .filter(x => x.lev.key === 'building')
      .sort((a, b) => (a.s.correct / a.s.total) - (b.s.correct / b.s.total));
    if (building.length > 0) {
      const top = building[0];
      return {
        unit: top.u,
        level: top.lev,
        reason: 'building'
      };
    }

    // Priority 4: nothing to recommend — kid is doing well everywhere.
    return null;
  }

  // Friendly opener for the recommendation card. Varied to avoid
  // template fatigue.
  const RECOMMEND_OPENERS = {
    never_practiced: [
      "Ready for a new topic?",
      "Let's try something fresh.",
      "Want to explore a new topic?",
      "How about something new?"
    ],
    undertested: [
      "Pick this back up?",
      "You started this — let's keep going.",
      "Want to give this another shot?",
      "Worth a few more questions here."
    ],
    building: [
      "Some practice would help here.",
      "Let's build this one up.",
      "Worth working on this one.",
      "A little more practice and you'll have it."
    ]
  };
  function pickOpener(reason) {
    const arr = RECOMMEND_OPENERS[reason] || RECOMMEND_OPENERS.never_practiced;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Read per-grade stats from localStorage, matching the key shape
  // practice.js writes via Stats.record(). Returns null if absent.
  function loadStatsFor(gradeSlug) {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      const who = (u && u.username) ? u.username : 'anon';
      const key = `staar.stats.${who}.${gradeSlug}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.units) return null;
      return obj;
    } catch (_) { return null; }
  }

  window.Mastery = {
    levelFor,
    recommendNext,
    loadStatsFor,
    pickOpener,
    // expose constants for any test/UI introspection
    MIN_TO_GRADE,
    MIN_FOR_MASTERED,
    STRONG_PCT,
    MASTERED_PCT
  };
})();
