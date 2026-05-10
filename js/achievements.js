// GradeEarn — Achievements + Rewards system.
// Industry-tested gamification patterns blended for K-8 STAAR practice:
//   - Milestones (Khan Academy-style total-correct ladders)
//   - Streaks (Duolingo-style daily login streak with shields)
//   - Quality (perfect runs)
//   - Mastery (per-topic, leverages Mastery module)
//   - Variety (cross-subject exploration)
//   - In-session streaks (current correct-in-a-row count)
//   - Discovery (fun facts seen)
//   - Daily missions
//   - Time-of-day novelty (early bird, night owl, weekend warrior)
//   - Tenure (days-since-first-session — a quiet "thanks for sticking with us")
//   - Endurance (long sessions)
//
// Public API:
//   Achievements.init() → loads catalog + earned list from localStorage
//   Achievements.track(event, payload) → call after a relevant action
//     (e.g. answer-correct, session-end, fact-seen). Fires onUnlock for
//     each newly-earned achievement.
//   Achievements.getEarned() → array of achievement ids the kid has.
//   Achievements.getCatalog() → full achievement catalog from JSON.
//   Achievements.getProgress(achievementId) → { current, threshold, pct } | null
//   Achievements.onUnlock(cb) → register a callback fired when an achievement unlocks.
//
// Persistence: localStorage today; server sync deferred to a lambda
// `updateAchievements` action so cross-device works (similar to fun-facts
// state). For MVP, kid's progress sticks to one device.

(function () {
  'use strict';

  const LS_EARNED = 'gradeearn:achievements:earned';
  const LS_STATS  = 'gradeearn:achievements:stats';
  const LS_FIRST_SESSION = 'gradeearn:achievements:firstSession';
  const LS_DAILY_MISSION = 'gradeearn:achievements:dailyMission';
  const CATALOG_URL = '/data/achievements.json?v=20260510a';

  let _catalog = null;
  let _catalogLoading = null;
  const _unlockCallbacks = [];

  // ----- localStorage helpers -----
  function lsGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (_) { return fallback; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) {}
  }

  // Keyed per user so multiple kid accounts on the same device don't share progress.
  function userScope() {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      return (u && u.username) ? u.username : 'anon';
    } catch (_) { return 'anon'; }
  }
  function k(key) { return `${key}:${userScope()}`; }

  // ----- Earned list -----
  function getEarned() {
    const arr = lsGet(k(LS_EARNED), []);
    return Array.isArray(arr) ? arr : [];
  }
  function setEarned(arr) { lsSet(k(LS_EARNED), arr); }

  // ----- Cumulative stats — written by track() events -----
  function getStats() {
    const s = lsGet(k(LS_STATS), null);
    return s && typeof s === 'object' ? s : {
      lifetimeCorrect: 0,
      perfectRuns: 0,
      sessionsCompleted: 0,
      factsSeen: 0,
      dailyMissionsCompleted: 0,
      longestSession: 0,
      lastWeekendPractice: null,    // ISO date
      lastEarlyMorning: null,        // ISO date
      lastNightOwl: null,            // ISO date
      lastComebackAfterGap: null,    // ISO date
      // Per-subject question/correct counts
      subjects: {},                  // { math: { questions: N, correct: N }, ... }
      // Topics tried (set of unitIds)
      topicsTried: [],
      // Login streak
      loginStreak: 0,
      lastLoginDate: null,           // YYYY-MM-DD
      // Tenure
      firstSessionDate: null         // YYYY-MM-DD
    };
  }
  function setStats(s) { lsSet(k(LS_STATS), s); }

  // ----- Catalog loader -----
  function loadCatalog() {
    if (_catalog) return Promise.resolve(_catalog);
    if (_catalogLoading) return _catalogLoading;
    _catalogLoading = fetch(CATALOG_URL, { cache: 'force-cache' })
      .then(res => {
        if (!res.ok) throw new Error('catalog ' + res.status);
        return res.json();
      })
      .then(json => {
        _catalog = Array.isArray(json) ? json.filter(a => a && a.id) : [];
        return _catalog;
      })
      .catch(err => {
        _catalogLoading = null;
        console.warn('[achievements] catalog load failed:', err && err.message || err);
        return [];
      });
    return _catalogLoading;
  }

  // ----- Date helpers -----
  function todayIso() {
    const d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }
  function isWeekend() { const d = new Date().getDay(); return d === 0 || d === 6; }
  function hourNow() { return new Date().getHours(); }
  function daysBetween(isoA, isoB) {
    if (!isoA || !isoB) return 0;
    const a = new Date(isoA + 'T00:00:00');
    const b = new Date(isoB + 'T00:00:00');
    return Math.round((b - a) / (1000 * 60 * 60 * 24));
  }

  // ----- Pull stats from external sources (auth, mastery, fun-facts) -----
  function pullExternalStats(stats) {
    // STAARAuth currentUser may have authoritative lifetimeCorrect / lifetimeCents
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      if (u) {
        if (Number.isFinite(u.lifetimeCorrect)) stats.lifetimeCorrect = Math.max(stats.lifetimeCorrect, u.lifetimeCorrect);
        if (Number.isFinite(u.lifetimeCents))  stats.lifetimeCents = u.lifetimeCents;
      }
    } catch (_) {}

    // Mastery — count topicsMastered across all known stats keys for this user
    // staar.stats.<who>.<gradeSlug> → { units: { unitId: { total, correct } } }
    try {
      const who = userScope();
      let topicsMastered = 0;
      const triedSet = new Set(stats.topicsTried || []);
      // Scan localStorage for staar.stats.* keys for this user
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(`staar.stats.${who}.`)) continue;
        try {
          const obj = JSON.parse(localStorage.getItem(key));
          if (!obj || !obj.units) continue;
          for (const unitId of Object.keys(obj.units)) {
            const u = obj.units[unitId];
            if (!u || !u.total) continue;
            triedSet.add(`${key}:${unitId}`);
            if (window.Mastery) {
              const lev = window.Mastery.levelFor(u);
              if (lev && lev.key === 'mastered') topicsMastered++;
            }
          }
        } catch (_) {}
      }
      stats.topicsMastered = topicsMastered;
      stats.topicsTried = Array.from(triedSet);
    } catch (_) {}

    // Fun facts seen
    try {
      const seen = window.FunFacts && window.FunFacts._getSeenIds && window.FunFacts._getSeenIds();
      if (Array.isArray(seen)) stats.factsSeen = seen.length;
    } catch (_) {}

    // subjectsTried = number of distinct keys in stats.subjects with >=5 questions
    stats.subjectsTried = Object.keys(stats.subjects || {})
      .filter(s => stats.subjects[s] && (stats.subjects[s].questions || 0) >= 5)
      .length;

    return stats;
  }

  // ----- Trigger evaluators -----
  function triggerSatisfied(trig, stats) {
    if (!trig || !trig.type) return false;
    switch (trig.type) {
      case 'lifetimeCorrect':
        return (stats.lifetimeCorrect || 0) >= (trig.threshold || 0);
      case 'lifetimeCents':
        return (stats.lifetimeCents || 0) >= (trig.threshold || 0);
      case 'perfectRuns':
        return (stats.perfectRuns || 0) >= (trig.threshold || 0);
      case 'topicsMastered':
        return (stats.topicsMastered || 0) >= (trig.threshold || 0);
      case 'topicsTried':
        return (stats.topicsTried || []).length >= (trig.threshold || 0);
      case 'subjectsTried':
        return (stats.subjectsTried || 0) >= (trig.threshold || 0);
      case 'subjectQuestions': {
        const s = (stats.subjects || {})[trig.subject];
        return s && (s.questions || 0) >= (trig.threshold || 0);
      }
      case 'subjectCorrect': {
        const s = (stats.subjects || {})[trig.subject];
        return s && (s.correct || 0) >= (trig.threshold || 0);
      }
      case 'factsSeen':
        return (stats.factsSeen || 0) >= (trig.threshold || 0);
      case 'loginStreak':
        return (stats.loginStreak || 0) >= (trig.threshold || 0);
      case 'sessionStreak':
        return (stats.bestSessionStreak || 0) >= (trig.threshold || 0);
      case 'dailyMissionsCompleted':
        return (stats.dailyMissionsCompleted || 0) >= (trig.threshold || 0);
      case 'longestSession':
        return (stats.longestSession || 0) >= (trig.threshold || 0);
      case 'daysSinceFirstSession': {
        if (!stats.firstSessionDate) return false;
        return daysBetween(stats.firstSessionDate, todayIso()) >= (trig.threshold || 0);
      }
      case 'timeOfDay': {
        const h = hourNow();
        if (trig.before) {
          const beforeH = parseInt(String(trig.before).split(':')[0], 10);
          return h < beforeH;
        }
        if (trig.after) {
          const afterH = parseInt(String(trig.after).split(':')[0], 10);
          return h >= afterH;
        }
        return false;
      }
      case 'weekendPractice':
        return isWeekend();
      case 'comebackAfterGap':
        // Was the gap between lastLoginDate and today >= 1 day?
        return stats.lastLoginDate && daysBetween(stats.lastLoginDate, todayIso()) >= 2;
    }
    return false;
  }

  // ----- Check + fire newly-earned achievements -----
  async function checkUnlocks() {
    const cat = await loadCatalog();
    if (!cat || cat.length === 0) return [];
    const earned = new Set(getEarned());
    const stats = pullExternalStats(getStats());
    const newly = [];
    for (const ach of cat) {
      if (!ach || !ach.id) continue;
      if (earned.has(ach.id)) continue;
      if (triggerSatisfied(ach.trigger, stats)) {
        earned.add(ach.id);
        newly.push(ach);
      }
    }
    if (newly.length > 0) {
      setEarned(Array.from(earned));
      // Award the cents reward via STAARAuth if available
      let totalCents = 0;
      for (const ach of newly) {
        const c = (ach.reward && ach.reward.cents) || 0;
        if (c > 0) totalCents += c;
      }
      if (totalCents > 0 && window.STAARAuth && window.STAARAuth.awardCents) {
        try { window.STAARAuth.awardCents(totalCents, 'achievements'); } catch (_) {}
      }
      // Fire user callbacks
      for (const ach of newly) {
        for (const cb of _unlockCallbacks) {
          try { cb(ach); } catch (e) { console.warn('[achievements] cb error:', e); }
        }
      }
    }
    return newly;
  }

  // ----- Track events from caller -----
  // Caller signals an event; we update stats then re-check unlocks.
  function track(event, payload) {
    payload = payload || {};
    const stats = getStats();
    const today = todayIso();

    // Initialize first-session date on first track call
    if (!stats.firstSessionDate) stats.firstSessionDate = today;

    switch (event) {
      case 'answer': {
        // payload: { isCorrect, subject, unitId }
        if (payload.isCorrect) {
          stats.lifetimeCorrect = (stats.lifetimeCorrect || 0) + 1;
        }
        const subj = payload.subject || 'math';
        if (!stats.subjects) stats.subjects = {};
        if (!stats.subjects[subj]) stats.subjects[subj] = { questions: 0, correct: 0 };
        stats.subjects[subj].questions += 1;
        if (payload.isCorrect) stats.subjects[subj].correct += 1;

        if (payload.unitId) {
          const triedSet = new Set(stats.topicsTried || []);
          triedSet.add(payload.unitId);
          stats.topicsTried = Array.from(triedSet);
        }

        // Time-of-day stamps
        const h = hourNow();
        if (h < 8) stats.lastEarlyMorning = today;
        if (h >= 20) stats.lastNightOwl = today;
        if (isWeekend()) stats.lastWeekendPractice = today;
        break;
      }
      case 'session-end': {
        // payload: { correct, total, subject, unitId, sessionStreak }
        stats.sessionsCompleted = (stats.sessionsCompleted || 0) + 1;
        if (payload.total > 0 && payload.correct === payload.total) {
          stats.perfectRuns = (stats.perfectRuns || 0) + 1;
        }
        if (payload.total && payload.total > (stats.longestSession || 0)) {
          stats.longestSession = payload.total;
        }
        if (payload.sessionStreak && payload.sessionStreak > (stats.bestSessionStreak || 0)) {
          stats.bestSessionStreak = payload.sessionStreak;
        }
        // Login-streak update — exactly once per day, on session-end
        if (stats.lastLoginDate !== today) {
          if (stats.lastLoginDate) {
            const gap = daysBetween(stats.lastLoginDate, today);
            if (gap === 1) stats.loginStreak = (stats.loginStreak || 0) + 1;
            else if (gap >= 2) {
              stats.loginStreak = 1;            // streak broken; today restarts
              stats.lastComebackAfterGap = today;
            } else if (gap === 0) {
              // same day, no change to streak
            }
          } else {
            stats.loginStreak = 1;
          }
          stats.lastLoginDate = today;
        }
        break;
      }
      case 'fact-seen': {
        stats.factsSeen = (stats.factsSeen || 0) + 1;
        break;
      }
      case 'daily-mission-complete': {
        stats.dailyMissionsCompleted = (stats.dailyMissionsCompleted || 0) + 1;
        break;
      }
    }
    setStats(stats);
    // Async — caller doesn't need to await, toasts fire when ready
    checkUnlocks();
  }

  // ----- Daily mission helpers -----
  // Daily mission state is per-user, per-day. Mission shape:
  //   { date: 'YYYY-MM-DD', target: N, current: N, rewardCents: N, completed: bool }
  function getDailyMissionState() {
    const today = todayIso();
    const stored = lsGet(k(LS_DAILY_MISSION), null);
    if (stored && stored.date === today) return stored;
    // New day — generate today's mission. Simple v1: 5 correct answers
    // for 10¢ bonus. Could be tier-based later (kids who already do
    // 50/day get a harder mission).
    const fresh = { date: today, target: 5, current: 0, rewardCents: 10, completed: false };
    lsSet(k(LS_DAILY_MISSION), fresh);
    return fresh;
  }
  function bumpDailyMission(amount) {
    amount = Number.isFinite(amount) ? amount : 1;
    const m = getDailyMissionState();
    if (m.completed) return m;
    m.current = Math.min(m.target, (m.current || 0) + amount);
    if (m.current >= m.target) {
      m.completed = true;
      // Award the cents
      if (m.rewardCents && window.STAARAuth && window.STAARAuth.awardCents) {
        try { window.STAARAuth.awardCents(m.rewardCents, 'dailyMission'); } catch (_) {}
      }
      track('daily-mission-complete');
    }
    lsSet(k(LS_DAILY_MISSION), m);
    return m;
  }

  // ----- Progress helper for UI -----
  async function getProgress(achievementId) {
    const cat = await loadCatalog();
    const ach = cat.find(a => a.id === achievementId);
    if (!ach) return null;
    const stats = pullExternalStats(getStats());
    const t = ach.trigger || {};
    let current = 0, threshold = t.threshold || 0;
    switch (t.type) {
      case 'lifetimeCorrect':       current = stats.lifetimeCorrect || 0; break;
      case 'lifetimeCents':         current = stats.lifetimeCents || 0; break;
      case 'perfectRuns':           current = stats.perfectRuns || 0; break;
      case 'topicsMastered':        current = stats.topicsMastered || 0; break;
      case 'topicsTried':           current = (stats.topicsTried || []).length; break;
      case 'subjectsTried':         current = stats.subjectsTried || 0; break;
      case 'subjectQuestions':      current = ((stats.subjects || {})[t.subject] || {}).questions || 0; break;
      case 'subjectCorrect':        current = ((stats.subjects || {})[t.subject] || {}).correct || 0; break;
      case 'factsSeen':             current = stats.factsSeen || 0; break;
      case 'loginStreak':           current = stats.loginStreak || 0; break;
      case 'sessionStreak':         current = stats.bestSessionStreak || 0; break;
      case 'dailyMissionsCompleted':current = stats.dailyMissionsCompleted || 0; break;
      case 'longestSession':        current = stats.longestSession || 0; break;
      case 'daysSinceFirstSession': current = stats.firstSessionDate ? daysBetween(stats.firstSessionDate, todayIso()) : 0; break;
      default: return null;
    }
    const pct = threshold > 0 ? Math.min(100, Math.round((current / threshold) * 100)) : 0;
    return { current, threshold, pct };
  }

  // ----- Public surface -----
  window.Achievements = {
    init: loadCatalog,
    track,
    getEarned,
    getCatalog: loadCatalog,
    getProgress,
    getDailyMissionState,
    bumpDailyMission,
    onUnlock: function (cb) { if (typeof cb === 'function') _unlockCallbacks.push(cb); },
    getStats,                  // exposed for debugging / parent dashboard
    _checkUnlocks: checkUnlocks
  };
})();
