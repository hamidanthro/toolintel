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
  const CATALOG_URL = '/data/achievements.json?v=20260510b';

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
    const base = s && typeof s === 'object' ? s : {};
    // Defaults on every read so older stats objects pick up new fields
    if (!Number.isFinite(base.lifetimeCorrect)) base.lifetimeCorrect = 0;
    if (!Number.isFinite(base.perfectRuns)) base.perfectRuns = 0;
    if (!Number.isFinite(base.sessionsCompleted)) base.sessionsCompleted = 0;
    if (!Number.isFinite(base.factsSeen)) base.factsSeen = 0;
    if (!Number.isFinite(base.dailyMissionsCompleted)) base.dailyMissionsCompleted = 0;
    if (!Number.isFinite(base.longestSession)) base.longestSession = 0;
    if (!base.subjects || typeof base.subjects !== 'object') base.subjects = {};
    if (!Array.isArray(base.topicsTried)) base.topicsTried = [];
    if (!Number.isFinite(base.loginStreak)) base.loginStreak = 0;
    // NEW: streak shields (Duolingo pattern)
    if (!Number.isFinite(base.streakShields)) base.streakShields = 0;
    if (!Number.isFinite(base.shieldsConsumed)) base.shieldsConsumed = 0;
    if (!Number.isFinite(base.shieldsEarned)) base.shieldsEarned = 0;
    if (!Number.isFinite(base.lastShieldStreakAwarded)) base.lastShieldStreakAwarded = 0;
    // NEW: XP / energy points (Khan pattern — separate from cents which
    // are spendable IRL; XP is a pure-progress signal that never drops).
    if (!Number.isFinite(base.xp)) base.xp = 0;
    if (!Number.isFinite(base.level)) base.level = 1;
    return base;
  }
  function setStats(s) { lsSet(k(LS_STATS), s); }

  // ----- Level math -----
  // Thresholds tuned so a kid practicing ~15 questions/day hits level 2-3
  // in week 1, levels 5-7 in month 1, etc. Mirrors Khan's energy-point
  // ladder (always-up; never decreases).
  const LEVEL_THRESHOLDS = [
    0,       // L1 starts here
    100,     // L2
    250,     // L3
    500,     // L4
    1000,    // L5
    1750,    // L6
    2750,    // L7
    4000,    // L8
    5500,    // L9
    7500,    // L10
    10000,   // L11
    13000,   // L12
    16500,   // L13
    20500,   // L14
    25000,   // L15
    30000,   // L16
    36000,   // L17
    43000,   // L18
    51000,   // L19
    60000    // L20
  ];
  function levelFromXp(xp) {
    let level = 1;
    for (let i = LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
      if (xp >= LEVEL_THRESHOLDS[i]) { level = i + 1; break; }
    }
    const cur = LEVEL_THRESHOLDS[level - 1] || 0;
    const next = LEVEL_THRESHOLDS[level] || (cur * 1.5 + 1000);
    const inLevelXp = xp - cur;
    const levelSpan = next - cur;
    const pct = levelSpan > 0 ? Math.min(100, Math.round((inLevelXp / levelSpan) * 100)) : 100;
    return { level, current: xp, levelMin: cur, levelMax: next, inLevelXp, levelSpan, pct };
  }

  // XP awarded per event. Wrong answers still earn a tiny bit so kids
  // who try aren't punished for trying — Khan's design philosophy.
  function xpFor(event, payload) {
    if (event === 'answer') return payload && payload.isCorrect ? 10 : 1;
    if (event === 'session-end') {
      const correct = (payload && payload.correct) || 0;
      const total = (payload && payload.total) || 0;
      let bonus = 5; // session-end bonus
      if (total > 0 && correct === total) bonus += 50; // perfect
      if (total >= 50) bonus += 20;
      return bonus;
    }
    if (event === 'fact-seen') return 2;
    if (event === 'daily-mission-complete') return 25;
    return 0;
  }

  // Streak shield rules (Duolingo-inspired):
  //   - Earn 1 shield every 5 days of streak (so 5d=1, 10d=2, ...)
  //   - Cap at 7 shields held (so it never trivializes).
  //   - On a 2+ day gap during session-end, auto-consume 1 if available
  //     to KEEP the streak alive, instead of resetting to 1.
  const SHIELD_AWARD_INTERVAL = 5;   // days
  const SHIELD_HOLD_CAP = 7;

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
      case 'shieldsHeld':
        return (stats.streakShields || 0) >= (trig.threshold || 0);
      case 'shieldsEarned':
        return (stats.shieldsEarned || 0) >= (trig.threshold || 0);
      case 'shieldsConsumed':
        return (stats.shieldsConsumed || 0) >= (trig.threshold || 0);
      case 'xpReached':
        return (stats.xp || 0) >= (trig.threshold || 0);
      case 'levelReached':
        return (stats.level || 1) >= (trig.threshold || 0);
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
  // Track event handler. Side-effects: stat updates, XP, shields, then
  // achievement unlock checks. Caller doesn't await; toasts fire async.
  function track(event, payload) {
    payload = payload || {};
    const stats = getStats();
    const today = todayIso();

    // Initialize first-session date on first track call
    if (!stats.firstSessionDate) stats.firstSessionDate = today;

    // XP — every tracked event awards XP. Level updates auto-recompute.
    const earnedXp = xpFor(event, payload);
    if (earnedXp > 0) {
      stats.xp = (stats.xp || 0) + earnedXp;
      const lev = levelFromXp(stats.xp);
      if (lev.level !== stats.level) {
        stats.level = lev.level;
        // Fire level-up event (caller can listen). Use unlockCallbacks
        // for now since they're already wired into the toast system.
        const levelUpAch = {
          id: `level-up-${lev.level}`,
          name: `Level ${lev.level}!`,
          description: `You hit Level ${lev.level}.`,
          emoji: lev.level >= 10 ? '⭐' : '🆙',
          tier: lev.level >= 15 ? 'diamond' : lev.level >= 10 ? 'gold' : lev.level >= 5 ? 'silver' : 'bronze',
          reward: { cents: Math.min(100, lev.level * 5) }
        };
        // Fire the level-up toast via the same channel as achievements.
        for (const cb of _unlockCallbacks) {
          try { cb(levelUpAch); } catch (e) { console.warn('[level-up cb]', e); }
        }
        // Award the cents
        if (window.STAARAuth && window.STAARAuth.awardCents) {
          try { window.STAARAuth.awardCents(levelUpAch.reward.cents, 'level-up'); } catch (_) {}
        }
      }
    }

    switch (event) {
      case 'answer': {
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
        // Login-streak update — exactly once per day, on session-end.
        // Streak shields (Duolingo) consume here on gaps to preserve streak.
        if (stats.lastLoginDate !== today) {
          if (stats.lastLoginDate) {
            const gap = daysBetween(stats.lastLoginDate, today);
            if (gap === 1) {
              stats.loginStreak = (stats.loginStreak || 0) + 1;
            } else if (gap >= 2) {
              // Try to spend shields to absorb the gap. One shield per
              // missed day. Shields never extend a streak — they only
              // patch holes.
              const missedDays = gap - 1;
              if ((stats.streakShields || 0) >= missedDays) {
                stats.streakShields -= missedDays;
                stats.shieldsConsumed = (stats.shieldsConsumed || 0) + missedDays;
                stats.loginStreak = (stats.loginStreak || 0) + 1; // today still counts
                stats.lastShieldUsed = today;
              } else {
                stats.loginStreak = 1;
                stats.lastComebackAfterGap = today;
              }
            } else if (gap === 0) {
              // same day, no change
            }
          } else {
            stats.loginStreak = 1;
          }
          stats.lastLoginDate = today;
          // Award a fresh shield each time the streak crosses a SHIELD_AWARD_INTERVAL
          // boundary that hasn't already been awarded. Hard-cap at SHIELD_HOLD_CAP.
          if (stats.loginStreak > 0 && stats.loginStreak % SHIELD_AWARD_INTERVAL === 0
              && stats.loginStreak !== stats.lastShieldStreakAwarded) {
            if ((stats.streakShields || 0) < SHIELD_HOLD_CAP) {
              stats.streakShields = (stats.streakShields || 0) + 1;
              stats.shieldsEarned = (stats.shieldsEarned || 0) + 1;
              stats.lastShieldStreakAwarded = stats.loginStreak;
            }
          }
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
    checkUnlocks();
  }

  // ----- Daily quest (multi-task) -----
  // Duolingo-pattern: 3 sub-tasks per day. Kid returns BECAUSE they
  // want to finish what they started. Per Hamid + memory_no_repeat,
  // tasks vary day-to-day for novelty.
  //
  // Shape:
  //   {
  //     date: 'YYYY-MM-DD',
  //     tasks: [
  //       { id, label, emoji, target, current, done }
  //     ],
  //     rewardCents: N,
  //     completed: bool
  //   }
  //
  // For K-2 kids (pulled from STAARAuth.currentUser().grade), tasks
  // are smaller (3 correct vs 5 correct) so the daughter actually
  // completes them.
  function _isK2User() {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      const grade = u && u.grade;
      return grade === 'grade-k' || grade === 'grade-1' || grade === 'grade-2';
    } catch (_) { return false; }
  }
  // Variety bank — picks 3 tasks from a pool with deterministic
  // per-date seed so the kid sees the same set all day but a fresh
  // set tomorrow.
  function _seedFromDate(dateIso) {
    let h = 0;
    for (let i = 0; i < dateIso.length; i++) h = (h * 31 + dateIso.charCodeAt(i)) & 0xffff;
    return h;
  }
  function _pickTaskBank(dateIso) {
    const isK2 = _isK2User();
    const ALL_TASKS = isK2 ? [
      { id: 'answer-3-correct', label: 'Answer 3 correctly', emoji: '✅', target: 3, current: 0, done: false, kind: 'correct' },
      { id: 'see-1-fact',       label: 'See 1 fun fact',     emoji: '✨', target: 1, current: 0, done: false, kind: 'fact' },
      { id: 'try-1-topic',      label: 'Try any topic',      emoji: '🎯', target: 1, current: 0, done: false, kind: 'topic' },
      { id: 'play-2-min',       label: 'Practice for 2+ min',emoji: '⏱️', target: 1, current: 0, done: false, kind: 'session' },
      { id: 'one-perfect-pair', label: 'Get 2 in a row',     emoji: '🔥', target: 2, current: 0, done: false, kind: 'streak' }
    ] : [
      { id: 'answer-5-correct', label: 'Answer 5 correctly', emoji: '✅', target: 5, current: 0, done: false, kind: 'correct' },
      { id: 'see-2-facts',      label: 'See 2 fun facts',    emoji: '✨', target: 2, current: 0, done: false, kind: 'fact' },
      { id: 'try-1-topic',      label: 'Try any topic',      emoji: '🎯', target: 1, current: 0, done: false, kind: 'topic' },
      { id: 'finish-session',   label: 'Finish a session',   emoji: '🏁', target: 1, current: 0, done: false, kind: 'session' },
      { id: 'three-in-a-row',   label: 'Get 3 in a row',     emoji: '🔥', target: 3, current: 0, done: false, kind: 'streak' },
      { id: 'one-correct-each-subject', label: 'One right in math', emoji: '➕', target: 1, current: 0, done: false, kind: 'correct-math' }
    ];
    // Deterministic seed-based shuffle, take first 3
    const seed = _seedFromDate(dateIso);
    const shuffled = ALL_TASKS.slice();
    let s = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const j = s % (i + 1);
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.slice(0, 3);
  }
  function getDailyMissionState() {
    const today = todayIso();
    const stored = lsGet(k(LS_DAILY_MISSION), null);
    if (stored && stored.date === today && Array.isArray(stored.tasks) && stored.tasks.length === 3) {
      return stored;
    }
    const isK2 = _isK2User();
    const fresh = {
      date: today,
      tasks: _pickTaskBank(today),
      rewardCents: isK2 ? 10 : 15,
      completed: false
    };
    lsSet(k(LS_DAILY_MISSION), fresh);
    return fresh;
  }
  // Bump a specific task kind by amount. Each kind maps to triggers
  // from practice events. Returns the updated mission.
  function bumpDailyMission(kindOrAmount, amount) {
    const m = getDailyMissionState();
    if (m.completed) return m;

    // Backwards-compat: if first arg is a number, default kind = 'correct'
    let kind, amt;
    if (typeof kindOrAmount === 'number') { kind = 'correct'; amt = kindOrAmount; }
    else { kind = String(kindOrAmount || 'correct'); amt = Number.isFinite(amount) ? amount : 1; }

    let anyChanged = false;
    for (const task of m.tasks) {
      if (task.done) continue;
      // Match task.kind to incoming kind
      const matches = (
        task.kind === kind
        || (kind === 'correct-math' && task.kind === 'correct')   // math counts toward correct
      );
      if (matches) {
        task.current = Math.min(task.target, (task.current || 0) + amt);
        if (task.current >= task.target) task.done = true;
        anyChanged = true;
      }
    }

    // Quest fully complete?
    if (!m.completed && m.tasks.every(t => t.done)) {
      m.completed = true;
      if (m.rewardCents && window.STAARAuth && window.STAARAuth.awardCents) {
        try { window.STAARAuth.awardCents(m.rewardCents, 'dailyQuest'); } catch (_) {}
      }
      track('daily-mission-complete');
    }

    if (anyChanged) lsSet(k(LS_DAILY_MISSION), m);
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
      case 'shieldsHeld':           current = stats.streakShields || 0; break;
      case 'shieldsEarned':         current = stats.shieldsEarned || 0; break;
      case 'shieldsConsumed':       current = stats.shieldsConsumed || 0; break;
      case 'xpReached':             current = stats.xp || 0; break;
      case 'levelReached':          current = stats.level || 1; break;
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
    _checkUnlocks: checkUnlocks,
    // NEW: XP / Levels / Shields
    levelFromXp,
    LEVEL_THRESHOLDS,
    SHIELD_AWARD_INTERVAL,
    SHIELD_HOLD_CAP
  };
})();
