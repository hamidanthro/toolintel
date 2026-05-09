/**
 * GradeEarn — SPACED REPETITION (client-side).
 *
 * SM-2-flavored interval schedule. After a kid answers a question:
 *   - Wrong  → schedule review in 24h
 *   - Correct (after a wrong) → 3d, then 7d, 14d, 30d, 60d
 *   - Correct without a prior wrong → no entry (no need to schedule
 *     a review for content the kid already knows)
 *
 * State lives in localStorage, keyed per-user (or 'guest'). Capped at
 * ~600 entries per user/scope; oldest evicted. Total storage budget
 * ~60KB per user — well within localStorage limits.
 *
 * Usage:
 *   const SR = window.GradeEarnSpacedRep;
 *   SR.record(qId, isCorrect);           // call after every answer
 *   const due = SR.getDueIds();          // [qId, ...] currently overdue
 *   const dueSorted = SR.getDueIds({ sort: 'most-overdue' });
 *
 * Practice integration: buildInitialSet() in practice.js can pull a
 * weighted mix of (due-for-review × 25%) + (unseen × 75%) so kids see
 * their weak topics on a schedule without losing fresh content.
 */
(function () {
  if (window.GradeEarnSpacedRep) return; // load-once

  const KEY_PREFIX = 'gradeearn.sr.';
  const CAP = 600;
  const DAY = 24 * 60 * 60 * 1000;
  // SM-2-flavored intervals (days). Index = correctStreak after wrong.
  // streak 0 = just got it wrong → review in 1 day
  // streak 1 = first correct after wrong → 3 days; etc.
  const INTERVALS_DAYS = [1, 3, 7, 14, 30, 60, 120];

  function userKey() {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      return KEY_PREFIX + ((u && u.username) || 'guest');
    } catch (_) {
      return KEY_PREFIX + 'guest';
    }
  }

  function load() {
    try {
      const raw = localStorage.getItem(userKey());
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch (_) { return {}; }
  }

  function save(map) {
    try {
      // FIFO cap: drop oldest entries (lowest lastTouched) when over cap.
      const ids = Object.keys(map);
      if (ids.length > CAP) {
        const sorted = ids.sort((a, b) => (map[a].t || 0) - (map[b].t || 0));
        const drop = sorted.slice(0, ids.length - CAP);
        for (const id of drop) delete map[id];
      }
      localStorage.setItem(userKey(), JSON.stringify(map));
    } catch (_) {}
  }

  function intervalFor(streak) {
    const i = Math.min(Math.max(streak, 0), INTERVALS_DAYS.length - 1);
    return INTERVALS_DAYS[i] * DAY;
  }

  function record(qId, isCorrect) {
    if (!qId) return;
    const map = load();
    const now = Date.now();
    const cur = map[qId] || null;
    if (isCorrect) {
      if (!cur) return; // never wrong → no need to track
      cur.s = (cur.s || 0) + 1;
      cur.due = now + intervalFor(cur.s);
      cur.t = now;
      map[qId] = cur;
    } else {
      // Wrong: reset streak, schedule for tomorrow.
      const entry = cur || { wrongAt: now, s: 0 };
      entry.s = 0;
      entry.wrongAt = now;
      entry.due = now + intervalFor(0);
      entry.t = now;
      map[qId] = entry;
    }
    save(map);
  }

  function getDueIds(opts) {
    const map = load();
    const now = Date.now();
    const due = [];
    for (const id of Object.keys(map)) {
      const e = map[id];
      if (e && e.due && e.due <= now) due.push({ id, due: e.due });
    }
    if (opts && opts.sort === 'most-overdue') {
      due.sort((a, b) => a.due - b.due); // oldest due first
    }
    return due.map(x => x.id);
  }

  function getStats() {
    const map = load();
    const ids = Object.keys(map);
    const now = Date.now();
    let due = 0, scheduled = 0;
    for (const id of ids) {
      const e = map[id];
      if (!e || !e.due) continue;
      if (e.due <= now) due++;
      else scheduled++;
    }
    return { tracked: ids.length, due, scheduled };
  }

  function clear() {
    try { localStorage.removeItem(userKey()); } catch (_) {}
  }

  window.GradeEarnSpacedRep = { record, getDueIds, getStats, clear };
})();
