// GradeEarn — interactive practice runner
// URL params:  ?g=<gradeSlug>&u=<unitId>&l=<lessonId>
// Loads data/<gradeSlug>-curriculum.json, builds a question queue, checks answers,
// and on incorrect answers calls the AI tutor endpoint for an interactive explanation.

(function () {
  const TUTOR_ENDPOINT = window.STAAR_TUTOR_ENDPOINT
    || 'https://api.gradeearn.com/tutor'; // override via window.STAAR_TUTOR_ENDPOINT before this script

  // Tutor auto-fire timeout. If we don't have a reply in this long, the
  // entire .tutor-box is removed silently — see fireInitialTutor() / §69.
  const TUTOR_TIMEOUT_MS = 12000;

  // End-of-set headers, score-band aware. Single lookup table so future
  // tuning is one place. Growth-mindset language at the low end, varied
  // tone elsewhere, celebration only on perfect.
  const END_OF_SET_HEADERS = {
    low:     "You learned a lot. Let's try again.",
    mid:     "Solid round.",
    high:    "Strong run.",
    perfect: "Clean sweep."
  };

  const MASTERY_HEADERS = {
    justMastered:    "Section mastered.",
    alreadyMastered: "Section already mastered."
  };

  function pickEndHeader(correct, total) {
    if (!total) return END_OF_SET_HEADERS.low;
    if (correct === total) return END_OF_SET_HEADERS.perfect;
    const pct = correct / total;
    if (pct < 0.5) return END_OF_SET_HEADERS.low;
    if (pct < 0.8) return END_OF_SET_HEADERS.mid;
    return END_OF_SET_HEADERS.high;
  }

  // §15-aligned varied phrasings. Avoid banned literals (no "trip",
  // "tricky", "no worries", "Most kids", "Good try", "Nice work",
  // "Great job"). Short, factual, growth-mindset, ungushy.
  const WRONG_HEADERS = [
    "Not quite.",
    "Almost.",
    "Close, but no.",
    "Not this time.",
    "Off this time.",
    "Worth another look."
  ];
  const DAILY_GOAL_TOASTS = [
    "Daily mission complete! 🌟",
    "Daily goal hit! 🌟",
    "Done for today! 🌟",
    "Daily quota cleared! 🌟"
  ];
  const STREAK_TOAST_TEMPLATES = [
    n => `${n} in a row! 🔥`,
    n => `${n} straight! 🔥`,
    n => `${n} correct in a row 🔥`,
    n => `${n}-streak 🔥`
  ];
  const STREAK_DAY_TEMPLATES = [
    n => `${n}-day streak! 🔥`,
    n => `${n} days strong 🔥`,
    n => `${n} days running 🔥`,
    n => `${n}-day mark hit 🔥`
  ];
  const STAAR_STREAK_TEMPLATES = [
    (test, n) => `${test} streak: ${n} 🔥`,
    (test, n) => `${test} ${n} in a row 🔥`,
    (test, n) => `${test}: ${n} straight 🔥`
  ];
  function pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  const root = document.getElementById('practice-root');
  const params = new URLSearchParams(location.search);

  // §76 — Dual-icon speaker. CSS toggles which SVG is visible based on
  // the .speech-btn--playing class. When idle the muted icon shows
  // ("this isn't playing"); while playing the active icon shows ("this
  // one IS playing") — kids can tell at a glance which speaker is live.
  const SPEECH_ICON_HTML = `<svg class="speech-icon speech-icon-muted" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.796 8.796 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"/></svg><svg class="speech-icon speech-icon-active" viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>`;

  // ============================================================
  // PRACTICE PAGE — URL PARAMS (state-aware)
  //
  // New URL: ?s=<state>&g=<grade>&subj=<subject>
  // Legacy:  ?g=<grade>  (defaults to user/stored state, math)
  // Also: &u=<unitId>&l=<lessonId> for unit/lesson scoping (existing).
  // ============================================================
  const STATES = window.STATES_API;
  const _u0 = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;

  // Subject — math + reading are live; science / social-studies bounce back.
  let SUBJECT_SLUG = (params.get('subj') || 'math').toLowerCase();
  const _VALID_SUBJECTS = ['math', 'reading', 'science', 'social-studies'];
  const _LIVE_SUBJECTS = ['math', 'reading', 'science'];
  if (!_VALID_SUBJECTS.includes(SUBJECT_SLUG)) SUBJECT_SLUG = 'math';
  if (!_LIVE_SUBJECTS.includes(SUBJECT_SLUG)) {
    if (params.get('s') && params.get('g')) {
      location.href = `grade.html?s=${encodeURIComponent(params.get('s'))}&g=${encodeURIComponent(params.get('g'))}`;
      return;
    }
    SUBJECT_SLUG = 'math';
  }
  // §75 — body[data-subject] hook for CSS layout overrides (two-col reading,
  // hide right rail during reading, etc.). Set early so CSS applies before
  // first paint of the practice surface.
  try { document.body.setAttribute('data-subject', SUBJECT_SLUG); } catch (_) {}

  // State — URL → user record → localStorage → 'texas' fallback.
  let STATE_SLUG = params.get('s');
  if (!STATE_SLUG && _u0 && _u0.state) STATE_SLUG = _u0.state;
  if (!STATE_SLUG) {
    try { STATE_SLUG = localStorage.getItem('gradeearn.state') || null; } catch (_) {}
  }
  if (!STATE_SLUG) STATE_SLUG = 'texas';
  if (STATES && !STATES.getBySlug(STATE_SLUG)) STATE_SLUG = 'texas';

  // Grade — URL, then user record. Required.
  let slug = params.get('g');
  if (!slug && _u0 && _u0.grade) slug = _u0.grade;
  const unitId = params.get('u');
  const lessonId = params.get('l');

  // Validate grade is offered in this state when both provided
  if (slug && STATES) {
    const _st = STATES.getBySlug(STATE_SLUG);
    if (_st && Array.isArray(_st.gradesTested) && !_st.gradesTested.includes(slug)) {
      console.warn(`[Practice] Grade ${slug} not offered in ${STATE_SLUG}; redirecting`);
      location.href = `states/?s=${encodeURIComponent(STATE_SLUG)}`;
      return;
    }
  }

  const STATE_SLUG_RESOLVED = STATE_SLUG;
  const SUBJECT_SLUG_RESOLVED = SUBJECT_SLUG;
  const STATE_INFO = STATES ? STATES.getBySlug(STATE_SLUG) : null;

  if (!slug) {
    // No grade context — bounce to state page (or home if guest with no state).
    if (params.get('s') || (_u0 && _u0.state) || (function(){ try { return localStorage.getItem('gradeearn.state'); } catch(_) { return null; } })()) {
      location.href = `states/?s=${encodeURIComponent(STATE_SLUG)}`;
      return;
    }
    return renderHome();
  }

  // Populate practice context bar (back arrow + state/grade/subject pills).
  populatePracticeContextBar();

  function populatePracticeContextBar() {
    const bar = document.getElementById('practice-context-bar');
    if (!bar) return;
    if (!STATE_INFO) { bar.hidden = true; return; }
    const gradeNames = {
      'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
      'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
      'grade-8':'Grade 8','grade-9':'Grade 9','grade-10':'Grade 10','grade-11':'Grade 11',
      'algebra-1':'Algebra 1'
    };
    const gradeName = gradeNames[slug] || slug;
    const subjLabel = SUBJECT_SLUG.charAt(0).toUpperCase() + SUBJECT_SLUG.slice(1).replace('-', ' ');
    const backHref = `grade.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(slug)}`;
    // Days-to-test pill — uses state's testWindowMonth (1=Jan..12=Dec).
    // Roll forward to NEXT year if test month already passed. Hidden if
    // state lacks testWindowMonth or if test is more than 365 days out.
    let countdownPill = '';
    if (STATE_INFO.testWindowMonth) {
      const now = new Date();
      const tm = parseInt(STATE_INFO.testWindowMonth, 10);
      let nextTest = new Date(now.getFullYear(), tm - 1, 1);
      if (nextTest <= now) nextTest = new Date(now.getFullYear() + 1, tm - 1, 1);
      const daysOut = Math.ceil((nextTest - now) / (1000 * 60 * 60 * 24));
      if (daysOut > 0 && daysOut <= 365) {
        const label = daysOut === 1 ? '1 day' : `${daysOut} days`;
        countdownPill = `<span class="practice-pill practice-pill--countdown" title="Days until ${escapePcb(STATE_INFO.testName)} testing window opens">${label} to ${escapePcb(STATE_INFO.testName || 'test')}</span>`;
      }
    }
    bar.innerHTML = `
      <nav class="practice-breadcrumb" aria-label="Practice context">
        <a class="practice-breadcrumb-back" href="${backHref}" aria-label="Back to grade">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </a>
        <div class="practice-breadcrumb-pills">
          <span class="practice-pill practice-pill--state">
            <span class="practice-pill-state-abbr">${escapePcb(STATE_INFO.nameAbbr || '')}</span>
            <span class="practice-pill-state-test">${escapePcb(STATE_INFO.testName || '')}</span>
          </span>
          <span class="practice-pill practice-pill--grade">${escapePcb(gradeName)}</span>
          <span class="practice-pill practice-pill--subject">${escapePcb(subjLabel)}</span>
          ${countdownPill}
        </div>
        <!-- §44: overflow menu trigger. On mobile (<768px), the
             original .btn-restart inside .practice-title-row is hidden
             via CSS to declutter the question screen; this ... button
             becomes the only restart entrypoint. Clicking it
             programmatically clicks #restart-btn so all existing
             confirm-modal + reload logic in runQuiz fires unchanged. -->
        <button type="button" class="practice-breadcrumb-overflow" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>
        <div class="practice-breadcrumb-menu" role="menu" hidden>
          <button type="button" role="menuitem" class="practice-breadcrumb-menu-item" data-action="restart">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
            <span>Restart practice</span>
          </button>
        </div>
      </nav>
    `;
    document.title = `${STATE_INFO.testName} ${gradeName} ${subjLabel} — GradeEarn`;

    // Wire the overflow menu. Toggle on click, close on outside click,
    // close on Escape. Restart item delegates to the original
    // #restart-btn so the existing confirm-modal + restart flow fires.
    const overflowBtn = bar.querySelector('.practice-breadcrumb-overflow');
    const overflowMenu = bar.querySelector('.practice-breadcrumb-menu');
    if (overflowBtn && overflowMenu) {
      overflowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const expanded = overflowBtn.getAttribute('aria-expanded') === 'true';
        overflowBtn.setAttribute('aria-expanded', String(!expanded));
        overflowMenu.hidden = expanded;
      });
      overflowMenu.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          overflowBtn.setAttribute('aria-expanded', 'false');
          overflowMenu.hidden = true;
          if (action === 'restart') {
            const realBtn = document.getElementById('restart-btn');
            if (realBtn) realBtn.click();
          }
        });
      });
      document.addEventListener('click', (e) => {
        if (!bar.contains(e.target)) {
          overflowBtn.setAttribute('aria-expanded', 'false');
          overflowMenu.hidden = true;
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && overflowBtn.getAttribute('aria-expanded') === 'true') {
          overflowBtn.setAttribute('aria-expanded', 'false');
          overflowMenu.hidden = true;
        }
      });
    }
  }
  function escapePcb(s) {
    return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ---- Guest free-trial: 5 questions across all grades, no login required.
  // Enough to demo the full experience (question card, streak, wrong-answer
  // AI tutor, end-of-set summary) without giving away the content library.
  // Was 100 pre-2026-05-09 — that was effectively unlimited for typical use.
  const GUEST_LIMIT = 5;
  const GUEST_KEY = 'staar.guest.answered';
  function isGuest() {
    return !(window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser());
  }

  // ---- Local "Your journey" tracker: streak, today's correct, best run-in-a-row.
  // Stored locally per-user so it stays kid-friendly and zero-cost.
  function todayKeyJ() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function yesterdayKeyJ() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function twoDaysAgoKeyJ() {
    const d = new Date(); d.setDate(d.getDate() - 2);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  // ISO week key (YYYY-Www) for tracking 1-freeze-per-week budget.
  function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
  function recordJourney(isCorrect) {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      if (!u || !u.username) return;
      const key = `staar.journey.${u.username}`;
      const j = JSON.parse(localStorage.getItem(key) || '{}');
      const tk = todayKeyJ();
      j.daily = j.daily || {};
      j.daily[tk] = j.daily[tk] || { correct: 0, answered: 0 };
      j.daily[tk].answered += 1;
      if (isCorrect) j.daily[tk].correct += 1;
      // Streak: bump if first activity today.
      // Streak freeze: 1 per ISO week. If kid returns after exactly ONE
      // missed day AND has not used this week's freeze, auto-burn the
      // freeze and keep the streak intact (still bump for today). If 2+
      // days missed, or freeze already used this week, reset to 1.
      const last = j.lastActiveDay;
      let usedFreeze = false;
      if (last !== tk) {
        const wkKey = isoWeekKey(new Date());
        j.freezesUsedByWeek = (j.freezesUsedByWeek && typeof j.freezesUsedByWeek === 'object') ? j.freezesUsedByWeek : {};
        const usedThisWeek = !!j.freezesUsedByWeek[wkKey];
        if (last === yesterdayKeyJ()) {
          j.streak = (parseInt(j.streak, 10) || 0) + 1;
        } else if (last === twoDaysAgoKeyJ() && !usedThisWeek && parseInt(j.streak, 10) > 0) {
          // Used a freeze: bridge the missed day, keep prior streak, +1 for today.
          j.streak = (parseInt(j.streak, 10) || 0) + 1;
          j.freezesUsedByWeek[wkKey] = (j.freezesUsedByWeek[wkKey] || 0) + 1;
          usedFreeze = true;
        } else {
          j.streak = 1;
        }
        j.lastActiveDay = tk;
        const best = parseInt(j.bestStreak, 10) || 0;
        if (j.streak > best) j.bestStreak = j.streak;
        // Trim freezesUsedByWeek to last 8 entries to stay tiny.
        const wkKeys = Object.keys(j.freezesUsedByWeek).sort();
        if (wkKeys.length > 8) for (const k of wkKeys.slice(0, wkKeys.length - 8)) delete j.freezesUsedByWeek[k];
      }
      // Best run in a row of correct answers.
      if (isCorrect) {
        j.currentRun = (parseInt(j.currentRun, 10) || 0) + 1;
        const pb = parseInt(j.bestRunInARow, 10) || 0;
        if (j.currentRun > pb) j.bestRunInARow = j.currentRun;
      } else {
        j.currentRun = 0;
      }
      // Trim daily history to last ~60 days.
      const keys = Object.keys(j.daily).sort();
      if (keys.length > 60) {
        for (const k of keys.slice(0, keys.length - 60)) delete j.daily[k];
      }
      // Aggregate counters used by the state-aware dashboard.
      j.totalAnswered = (parseInt(j.totalAnswered, 10) || 0) + 1;
      if (isCorrect) j.totalCorrect = (parseInt(j.totalCorrect, 10) || 0) + 1;
      j.lastSession = new Date().toISOString();
      j.lastSubject = SUBJECT_SLUG;
      localStorage.setItem(key, JSON.stringify(j));
      // Detect milestones to celebrate.
      const dailyGoal = (window.STAARPrefs && window.STAARPrefs.get().dailyGoal) || 5;
      const todayCorrect = j.daily[tk].correct;
      const out = {};
      if (isCorrect && todayCorrect === dailyGoal) out.dailyGoalHit = true;
      if (isCorrect && [5, 10, 15, 25, 50, 100].includes(j.currentRun)) out.streakMilestone = j.currentRun;
      // Streak day milestone: only fire once per day, on the first activity of the day that bumped the streak.
      const streakKey = `${key}.streakDayCelebrated.${tk}`;
      if ([3, 5, 7, 14, 30, 60, 100].includes(j.streak) && !localStorage.getItem(streakKey)) {
        out.streakDayMilestone = j.streak;
        try { localStorage.setItem(streakKey, '1'); } catch (_) {}
      }
      // Streak freeze used today — only fires once.
      if (usedFreeze) out.streakFreezeUsed = j.streak;
      return out;
    } catch (_) { /* localStorage unavailable */ }
    return null;
  }
  function guestCount() {
    try { return parseInt(localStorage.getItem(GUEST_KEY), 10) || 0; } catch (_) { return 0; }
  }
  function guestIncrement() {
    try { localStorage.setItem(GUEST_KEY, String(guestCount() + 1)); } catch (_) {}
  }
  function guestRemaining() { return Math.max(0, GUEST_LIMIT - guestCount()); }
  function renderGuestBanner() {
    if (!isGuest()) {
      const old = document.getElementById('guest-banner');
      if (old) old.remove();
      return;
    }
    let bar = document.getElementById('guest-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'guest-banner';
      // §56 — quiet footer style. No alert-yellow background, no border;
      // muted single-line link below the question card. Was wasting hero
      // real estate at the top of the practice page.
      bar.style.cssText = 'margin-top:18px;padding:12px 14px;border-top:1px solid rgba(255,255,255,0.08);color:rgba(255,255,255,0.55);font-size:0.85rem;display:flex;justify-content:center;align-items:center;gap:10px;flex-wrap:wrap;text-align:center;';
      const root = document.getElementById('practice-root');
      if (root) root.appendChild(bar); // §56 — bottom, not top
    } else {
      // If banner already exists at top from prior render, move it to the bottom.
      const root = document.getElementById('practice-root');
      if (root && bar.parentNode === root && bar !== root.lastChild) {
        root.appendChild(bar);
      }
    }
    const remaining = guestRemaining();
    bar.innerHTML = `<span>Preview · ${remaining} of ${GUEST_LIMIT} free questions left.</span>
      <a href="#" id="guest-signup-btn" style="color:#fbbf24;font-weight:600;text-decoration:none;">Sign up to unlock the full content library →</a>`;
    const btn = document.getElementById('guest-signup-btn');
    if (btn) btn.onclick = (e) => { e.preventDefault(); if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
  }
  function maybeBlockGuest() {
    if (!isGuest()) return false;
    if (guestCount() < GUEST_LIMIT) return false;
    // Hit the cap: lock the practice area behind a sign-up wall.
    const root = document.getElementById('practice-root');
    if (root) {
      root.innerHTML = `
        <div class="card" style="text-align:center;padding:36px;">
          <h2 style="margin-top:0;">You finished your free preview! 🎉</h2>
          <p style="color:var(--muted);max-width:520px;margin:8px auto 20px;">
            Sign up free to unlock the full content library &mdash; thousands of TEKS-aligned
            questions across every subject and grade, the AI tutor on every wrong answer, points
            you can spend on real toys in the marketplace, and your streak saved on every device.
          </p>
          <p><button type="button" class="btn btn-primary" id="guest-cap-signup">Create your free account</button></p>
          <p style="font-size:0.88rem;margin-top:14px;"><a href="#" id="guest-cap-signin">Already have an account? Sign in</a></p>
        </div>`;
      const sup = document.getElementById('guest-cap-signup');
      const sin = document.getElementById('guest-cap-signin');
      if (sup) sup.onclick = () => { if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
      if (sin) sin.onclick = (e) => { e.preventDefault(); if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
    }
    return true;
  }
  if (maybeBlockGuest()) return;
  renderGuestBanner();

  // When a guest signs in mid-practice, reload so they continue with full progress tracking.
  window.onSTAARLogin = function () { try { location.reload(); } catch (_) {} };

  // Gate: kids can only practice their own grade or higher (set at signup).
  // Uses shared STAARGradeAccess.canPracticeGrade when available; falls back
  // to legacy STAARAuth.gradeLevel comparison.
  const Auth = window.STAARAuth || {};
  const Access = window.STAARGradeAccess;
  const _user = (Auth.currentUser && Auth.currentUser()) || null;
  const _allowed = Access
    ? Access.canPracticeGrade(_user, slug)
    : (() => {
        if (!Auth.userGradeLevel || !Auth.gradeLevel) return true;
        const userLvl = Auth.userGradeLevel();
        const reqLvl = Auth.gradeLevel(slug);
        return !(userLvl > -Infinity && reqLvl < userLvl);
      })();
  if (!_allowed) {
    // Redirect them to their actual grade rather than a dead end.
    const target = (_user && _user.grade) ? _user.grade : null;
    if (target && target !== slug) {
      try {
        location.replace(`practice.html?g=${encodeURIComponent(target)}`);
        return;
      } catch (_) { /* fall through to message */ }
    }
    root.innerHTML = `
      <h2>That grade is below your level</h2>
      <div class="card">
        <p style="color:var(--muted);">You're set to a higher grade, so practice for lower grades is locked. Pick your grade or higher from the home page.</p>
        <p><a class="btn btn-primary" href="index.html">Back to your dashboard</a></p>
      </div>`;
    return;
  }

  // ============================================================
  // READING SUBJECT — lake-batch flow (no per-grade curriculum file).
  // ============================================================
  // NOTE: do NOT early-return here. Both reading + math paths kick off async
  // work, then need the IIFE to keep running so the `const Stats = {...}`
  // (and other deferred consts) at the bottom get initialized. Returning
  // early leaves Stats in TDZ; when startReading's fetch resolves and calls
  // runQuiz → Stats.load(), it throws "Cannot access 'Stats' before
  // initialization", caught by the surrounding try/catch as a fetch failure.
  // Review-mode: ?review=1 pulls the kid's recent wrong answers from
  // the lambda and re-runs them as a quiz. Auth required.
  if (params.get('review') === '1') {
    startReview();
  } else if (params.get('print') === '1') {
    startPrintWorksheet();
  } else if (SUBJECT_SLUG === 'reading') {
    startReading();
  } else if (SUBJECT_SLUG === 'science') {
    startScience();
  } else {
    fetch(`data/${slug}-curriculum.json?v=20260426m`)
      .then(r => r.ok ? r.json() : Promise.reject('not-found'))
      .then(curr => start(curr))
      .catch(() => {
        root.innerHTML = `
          <h2>Practice</h2>
          <div class="card">
            <p style="color:var(--muted);">Practice for this grade is coming soon.</p>
            <p><a href="grades.html">Back to grades</a></p>
          </div>`;
      });
  }

  function renderHome() {
    root.innerHTML = `
      <h2>Choose a grade to practice</h2>
      <div class="grade-grid practice-grid" id="grid"></div>`;
    const grid = document.getElementById('grid');
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    const visible = window.STAARGradeAccess
      ? window.STAARGradeAccess.getVisibleGrades(u)
      : (window.STAAR_GRADES || []);
    visible.forEach(g => {
      const isCurrent = !!(u && u.grade === g.slug);
      if (window.STAARGradeCard) {
        grid.appendChild(window.STAARGradeCard.render(g, { variant: 'practice', isCurrent }));
      } else {
        // Defensive fallback (shared component should always be loaded).
        const a = document.createElement('a');
        a.href = `practice.html?g=${encodeURIComponent(g.slug)}`;
        a.className = 'grade-card';
        a.innerHTML = `<h3 class="grade-card-title">${g.title}</h3><p class="grade-card-meta">${g.categories.length} reporting categories</p>`;
        grid.appendChild(a);
      }
    });
  }

  function start(curr) {
    let questions = [];
    let lessonMeta = null;

    if (lessonId) {
      for (const u of curr.units) {
        const l = u.lessons.find(l => l.id === lessonId);
        if (l) {
          questions = l.questions.map(q => ({ ...q, _unit: u, _lesson: l }));
          lessonMeta = { unit: u, lesson: l };
          break;
        }
      }
    } else if (unitId) {
      const u = curr.units.find(u => u.id === unitId);
      if (u) {
        questions = u.lessons.flatMap(l => l.questions.map(q => ({ ...q, _unit: u, _lesson: l })));
        lessonMeta = { unit: u };
      }
    } else {
      questions = curr.units.flatMap(u =>
        u.lessons.flatMap(l => l.questions.map(q => ({ ...q, _unit: u, _lesson: l })))
      );
    }

    if (questions.length === 0) {
      root.innerHTML = `<h2>Nothing to practice yet</h2><p><a href="grade.html?g=${slug}">Back</a></p>`;
      return;
    }

    // Start instantly with a curriculum-only set so the kid never waits,
    // then swap in fresh AI-generated questions in the background.
    const initial = buildInitialSet(questions);
    runQuiz(curr, initial, lessonMeta, {
      enhance: cb => fetchGeneratedAsync(curr, questions, lessonMeta, cb)
    });
  }

  // ---- No-repeat tracking ----------------------------------------------
  // Per student + grade, remember which question ids have been served so the
  // kid never sees the same item twice until the bank is exhausted.
  function seenKey() {
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser());
    const who = (u && u.username) ? u.username : 'anon';
    return `staar.seen.${who}.${slug}`;
  }
  function loadSeen() {
    try {
      const raw = localStorage.getItem(seenKey());
      if (!raw) return new Set();
      return new Set(JSON.parse(raw));
    } catch (_) { return new Set(); }
  }
  function saveSeen(set) {
    try { localStorage.setItem(seenKey(), JSON.stringify(Array.from(set))); } catch (_) {}
  }
  function markSeen(id) {
    if (!id) return;
    const s = loadSeen();
    if (!s.has(id)) {
      s.add(id);
      saveSeen(s);
    }
  }

  // Build a curriculum-only set immediately, preferring unseen.
  // ?n=<N> URL param overrides session length (10/25/50/100). Default 25.
  // Quick-mode buttons on grade.html pass &n=… in the practice URL.
  function buildInitialSet(pool) {
    const reqN = parseInt(params.get('n'), 10);
    const TARGET = [10, 25, 50, 100].includes(reqN) ? reqN : 25;
    const seen = loadSeen();
    const unseen = pool.filter(q => q.id && !seen.has(q.id));
    const seenPool = pool.filter(q => q.id && seen.has(q.id));
    const noId = pool.filter(q => !q.id);

    let merged = shuffle(unseen.slice()).slice(0, TARGET);

    // If unseen is fully exhausted, recycle from the seen pool and tell the kid.
    if (merged.length === 0 && (seenPool.length || noId.length)) {
      try { localStorage.removeItem(seenKey()); } catch (_) {}
      showToast('Nice — you\u2019ve answered every question we have here! Recycling for review.');
      return shuffle(pool.slice()).slice(0, TARGET);
    }

    // Top up if we don't have enough unseen questions yet.
    if (merged.length < TARGET) {
      const filler = shuffle(seenPool.concat(noId));
      for (const q of filler) {
        if (merged.length >= TARGET) break;
        merged.push(q);
      }
    }
    return shuffle(merged).slice(0, TARGET);
  }

  // Background fetch of AI-generated questions. Calls back with the list.
  async function fetchGeneratedAsync(curr, pool, meta, onReady) {
    // Match generated count to session size so deep/marathon modes have
    // enough fresh content. Cap at 30 (lambda's per-call max).
    const reqN = parseInt(params.get('n'), 10);
    const targetSession = [10, 25, 50, 100].includes(reqN) ? reqN : 25;
    const GENERATE = Math.min(30, Math.max(10, Math.ceil(targetSession * 0.8)));
    const topics = buildTopicSpec(pool, meta);
    try {
      const seed = `${slug}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null,
          state: STATE_SLUG_RESOLVED,
          subject: SUBJECT_SLUG_RESOLVED,
          grade: curr.grade,
          count: GENERATE,
          seed,
          topics,
          sessionId: (window.GradeEarnLake && window.GradeEarnLake.startSession()) || null,
          recentContentIds: (window.GradeEarnLake && window.GradeEarnLake.getRecent()) || []
        })
      });
      if (res.status === 403) {
        try {
          const errBody = await res.json();
          const msg = errBody && errBody.message;
          if (msg === 'grade_locked') {
            showToast('That grade is locked. Practicing your own grade.');
            setTimeout(() => {
              const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
              if (u && u.grade) location.href = `practice.html?s=${encodeURIComponent(u.state || STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(u.grade)}&subj=math`;
              else location.href = 'index.html#state-picker';
            }, 1500);
            return;
          }
          if (msg === 'state_mismatch') {
            showToast('Please practice for your state.');
            setTimeout(() => {
              const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
              if (u && u.state) location.href = `practice.html?s=${encodeURIComponent(u.state)}&g=${encodeURIComponent(u.grade || curr.grade)}&subj=math`;
            }, 1500);
            return;
          }
        } catch (_) {}
      }
      if (!res.ok) return;
      const data = await res.json();
      const generated = (data.questions || []).map(g => normalizeGenerated(g, curr));
      if (generated.length) onReady(generated);
    } catch (_) { /* silently keep curriculum-only */ }
  }

  function pickRandom(arr, n) {
    return shuffle(arr.slice()).slice(0, n);
  }

  // Build the topic spec the LLM uses to target TEKS.
  function buildTopicSpec(pool, meta) {
    const byTeks = new Map();
    for (const q of pool) {
      const teks = q._lesson?.teks || '';
      if (!teks) continue;
      if (byTeks.has(teks)) continue;
      byTeks.set(teks, {
        teks,
        title: q._unit?.title || '',
        objective: q._lesson?.objective || q._lesson?.title || '',
        sample: q.prompt || ''
      });
    }
    const list = Array.from(byTeks.values());
    // If we're scoped to a unit/lesson, the pool is already narrow;
    // otherwise cap at 12 topics so the prompt stays focused.
    return list.slice(0, 12);
  }

  // Convert a generator result into the shape the renderer expects.
  function normalizeGenerated(g, curr) {
    const unit = curr.units.find(u => u.title === g.unitTitle)
      || curr.units.find(u => u.lessons.some(l => l.teks === g.teks))
      || { title: g.unitTitle || 'Practice' };
    const lesson = (unit.lessons || []).find(l => l.teks === g.teks)
      || { teks: g.teks || '', title: g.lessonTitle || '' };
    return {
      id: g.id,
      contentId: g.contentId || null,
      poolKey: g.poolKey || null,
      type: g.type,
      prompt: g.prompt,
      choices: g.choices,
      answer: g.answer,
      explanation: g.explanation,
      _unit: unit,
      _lesson: lesson,
      _generated: true
    };
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sectionKey(meta) {
    // Build a stable key for the practice scope: grade | unit | lesson.
    const parts = [slug];
    if (meta?.unit?.id) parts.push(meta.unit.id);
    if (meta?.lesson?.id) parts.push(meta.lesson.id);
    if (parts.length < 2) return null; // don't lock full-grade mixes
    return parts.join('|').replace(/[^A-Za-z0-9_\-|:.]/g, '_');
  }

  function sectionLabel(curr, meta) {
    const bits = [curr.title];
    if (meta?.unit) bits.push(`Unit ${meta.unit.order}: ${meta.unit.title}`);
    if (meta?.lesson) bits.push(meta.lesson.title);
    return bits.join(' › ');
  }

  function runQuiz(curr, questions, meta, opts) {
    let i = 0;
    let correct = 0;
    // Per-question results for the end-of-set summary call. Keep it to the
    // fields the lambda actually needs (see handleSummarizeSession in
    // lambda/tutor.js): brief question text, correct flag, the kid's
    // wrong choice if any, the topic name. Capped to last 20 in the lambda.
    const sessionResults = [];
    const sessionStartedAt = Date.now();
    const sKey = sectionKey(meta);
    const isLocked = !!(sKey && window.STAARAuth?.isMastered?.(sKey));

    const titleBits = [curr.title];
    if (meta?.unit) titleBits.push(`Unit ${meta.unit.order}: ${meta.unit.title}`);
    if (meta?.lesson) titleBits.push(meta.lesson.title);

    const stats = Stats.load(slug);

    const lockedBanner = isLocked ? `
      <div class="mastered-banner">
        <span class="mastered-star">⭐</span>
        <div>
          <div class="mastered-title">You've mastered this section!</div>
          <div class="mastered-sub">Practice freely for review — no points earned or lost here. Try a different section to keep earning.</div>
        </div>
      </div>` : '';

    // §77 — UI overhaul (Owners' Room: Apple/Google/MS/Tesla):
    //   B1: redundant "Back to ..." link removed (breadcrumb back arrow stays)
    //   B2: H1 hero killed; eyebrow row "[title] · Question N of M" instead
    //   B3: Restart wrapped in #restart-wrap; hidden by CSS until Q2
    //       (.practice-header[data-q="1"]). Progress bar formula fixed below
    //       in setQuestion: pct = ((i + 0.5) / N) * 100 so Q1/5 reads 10%
    //       not 0% — kid sees momentum just by being on a question.
    root.innerHTML = `
      <div class="practice-layout">
        <div class="practice-main">
          ${lockedBanner}
          <div class="practice-header" data-q="1">
            <div class="practice-eyebrow">
              <span class="practice-eyebrow-title">${titleBits.join(' · ')}</span>
              <span class="practice-eyebrow-sep">·</span>
              <span class="practice-eyebrow-progress">Question <span id="progress-num">1</span> of ${questions.length}</span>
              <span id="restart-wrap" class="practice-eyebrow-restart">
                <button type="button" class="btn-restart" id="restart-btn" title="Start this practice over">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                  <span>Restart</span>
                </button>
              </span>
            </div>
            <div class="progress-bar"><div class="progress-track"><div class="progress-fill" id="bar"></div></div><div class="progress-pulse" id="bar-pulse"></div></div>
          </div>
          <div id="qbox"></div>
          <div id="scratchpad-mount"></div>
        </div>
        <aside class="performance-panel" id="perf-panel"></aside>
      </div>`;

    const qbox = document.getElementById('qbox');
    const bar = document.getElementById('bar');
    const barPulse = document.getElementById('bar-pulse');
    const progressNum = document.getElementById('progress-num');
    const perfPanel = document.getElementById('perf-panel');
    const restartBtn = document.getElementById('restart-btn');

    restartBtn.addEventListener('click', async () => {
      const answered = i + (qbox.querySelector('.feedback') ? 1 : 0);
      if (answered > 0) {
        const ok = await confirmModal({
          title: 'Restart practice?',
          message: 'You\u2019ll get a fresh set of 25 questions. Your overall performance stats will stay.',
          confirmText: 'Yes, restart',
          cancelText: 'Keep going'
        });
        if (!ok) return;
      }
      // Show a brief toast then reload to get a freshly shuffled 25.
      showToast('Loading a fresh set\u2026');
      setTimeout(() => location.reload(), 350);
    });

    renderPerf(perfPanel, curr, stats);
    show();

    // Background enhance: when AI questions arrive, splice them into upcoming slots
    // so the kid doesn't see the same curriculum-only items repeated.
    if (opts && typeof opts.enhance === 'function') {
      opts.enhance(generated => {
        // Replace upcoming positions (strictly after current index) with generated items.
        // Shuffle generated and slot them in random upcoming positions to keep the mix fresh.
        const upcomingStart = i + 1; // never replace the question the kid is on
        const upcomingSlots = [];
        for (let k = upcomingStart; k < questions.length; k++) upcomingSlots.push(k);
        if (upcomingSlots.length === 0) return;
        const shuffledSlots = shuffle(upcomingSlots.slice());
        const fresh = shuffle(generated.slice());
        const replaceCount = Math.min(fresh.length, shuffledSlots.length);
        for (let k = 0; k < replaceCount; k++) {
          questions[shuffledSlots[k]] = fresh[k];
        }
      });
    }

    // §71 — Fun Fact card. Mounted inline at the end of the
    // [data-role="inline-fb"] slot below the CORRECT feedback chip
    // when window.FunFacts.pickFactForCorrect returns a fact. Replaces
    // the auto-advance progress bar — kid taps "Got it!" to advance
    // instead of the 1.5s timer firing.
    //
    // §71-FIX: this helper MUST be defined inside runQuiz so it
    // closes over qbox / i / show / the local correct counter.
    // Originally lived at IIFE-level, where qbox / i / show resolved
    // to undefined → ReferenceError on every call → silently swallowed
    // by the integration's try/catch → the card never mounted, the
    // auto-advance bar was already removed, the kid was stuck. Hamid
    // screenshot 5:12pm.
    const FUN_FACT_CATEGORY_EMOJI = {
      animals: '🐙', space: '🚀', body: '🧠', food: '🥑',
      texas: '⭐', sports: '🏀', inventions: '💡',
      history: '📜', 'math-numbers': '🔢', 'weird-funny': '🎲',
      // §73 — Phase 5 new categories
      dinosaurs: '🦕', music: '🎵', geography: '🌍',
      'robots-tech': '🤖', mythology: '🐉'
    };
    function mountFunFactCard(fact, isFirstFactEver, seqAtCall) {
      const qCard = qbox.querySelector('.question-card');
      if (!qCard) return;
      const fbSlot = qCard.querySelector('[data-role="inline-fb"]');
      if (!fbSlot) return;

      // §73 — fact card mounts cancel any in-flight question speech.
      try { if (window.Speech) window.Speech.stop(); } catch (_) {}

      const icon = FUN_FACT_CATEGORY_EMOJI[fact.category] || '✨';
      const card = document.createElement('div');
      card.className = 'ff-card';
      card.setAttribute('data-fact-id', fact.id);
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', 'Fun fact');
      const welcomeHtml = isFirstFactEver
        ? '<div class="ff-card-welcome">Welcome to fun facts</div>'
        : '';
      const speakerHtml = (window.Speech && window.Speech._isSupported())
        ? `<button type="button" class="speech-btn ff-speech-btn" data-role="ff-speak" aria-label="Read aloud" aria-pressed="false">
            ${SPEECH_ICON_HTML}
          </button>`
        : '';
      card.innerHTML = `
        ${speakerHtml}
        ${welcomeHtml}
        <div class="ff-card-label" aria-hidden="true">★ Fun Fact</div>
        <div class="ff-card-icon" aria-hidden="true">${icon}</div>
        <div class="ff-card-body">${escapeHtml(fact.fact || '')}</div>
        <button type="button" class="ff-card-cta" data-act="ff-got-it">Got it!</button>
      `;
      fbSlot.appendChild(card);

      // §73 — fact-card speaker wiring. Tap-to-play, tap-to-stop.
      const speakBtn = card.querySelector('[data-role="ff-speak"]');
      if (speakBtn && window.Speech) {
        const setPlaying = (on) => {
          speakBtn.classList.toggle('speech-btn--playing', !!on);
          speakBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
          speakBtn.setAttribute('aria-label', on ? 'Stop reading' : 'Read aloud');
        };
        speakBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.Speech.isPlaying()) {
            window.Speech.stop();
            setPlaying(false);
          } else {
            window.Speech.play(fact.fact || '').then(() => setPlaying(false));
            setPlaying(true);
          }
        });
        window.Speech.onStateChange(state => {
          if (state === 'idle') setPlaying(false);
        });
      }

      const cta = card.querySelector('[data-act="ff-got-it"]');
      // §71-FIX: stopPropagation defends against any ancestor click
      // listener (the question-card form, the inline-fb slot, etc.)
      // swallowing the click before our handler runs. type="button"
      // already keeps it out of form submission, but belt-and-suspenders
      // here is cheap insurance after the scope-bug class.
      cta.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // §73 — Got it! cancels any in-flight fact-card speech.
        try { if (window.Speech) window.Speech.stop(); } catch (_) {}
        try {
          if (window.FunFacts && typeof window.FunFacts.markFactSeen === 'function') {
            window.FunFacts.markFactSeen(fact.id);
          }
        } catch (_) {}
        if (window._stAutoAdvance) {
          try { clearTimeout(window._stAutoAdvance); } catch (_) {}
          window._stAutoAdvance = null;
        }
        if (i === seqAtCall) {
          try { i++; show(); } catch (_) {}
        }
      });

      // Defer focus to the next frame so the slide-up animation can start
      // before the focus ring lands; reduces visual jank.
      requestAnimationFrame(() => {
        try { cta.focus({ preventScroll: false }); } catch (_) { try { cta.focus(); } catch (_) {} }
      });
    }

    function show() {
      // §68 — clear pending auto-advance from a previous CORRECT
      // state. The qbox.innerHTML reset below would orphan the
      // timer's setTimeout-driven advance call (harmless but extra
      // i++; show()). Cancelling here is the clean fix.
      if (window._stAutoAdvance) {
        try { clearTimeout(window._stAutoAdvance); } catch (_) {}
        window._stAutoAdvance = null;
      }
      // §73 — cancel any in-flight speech when a new question loads.
      try { if (window.Speech) window.Speech.stop(); } catch (_) {}
      if (i >= questions.length) {
        return finish();
      }
      // §56 — drop body.q-answered so 'Need scratch paper?' link
      // re-shows for the new question (it's hidden via CSS during
      // CORRECT/WRONG states).
      document.body.classList.remove('q-answered');
      // Reset the scratchpad between questions so kids don't see prior scribbles.
      try { window.STAARScratchpad?.reset(); } catch (_) {}
      progressNum.textContent = i + 1;
      // §77 B3 — kid sees momentum on Q1 (10%) instead of empty bar.
      // (i + 0.5) / N — Q1/5=10%, Q2/5=30%, Q3/5=50%, Q4/5=70%, Q5/5=90%.
      // The end-of-set screen sets the bar to 100% explicitly.
      const pct = ((i + 0.5) / questions.length) * 100;
      bar.style.width = `${pct}%`;
      if (barPulse) barPulse.style.left = `${pct}%`;
      // §77 B5 — Restart hidden on Q1 (no progress to lose). data-q on the
      // header drives a CSS rule that hides #restart-wrap when q=1.
      const headerEl = document.querySelector('.practice-header');
      if (headerEl) headerEl.setAttribute('data-q', String(i + 1));
      const q = questions[i];
      markSeen(q.id);
      qbox.innerHTML = renderQuestion(q, isLocked, i, questions.length);
      attachQuestionHandlers(q);
      // Lake: record question shown (Prompt I1)
      if (window.GradeEarnLake && q.contentId) {
        window.GradeEarnLake.onQuestionShown({
          contentId: q.contentId,
          poolKey: q.poolKey,
          state: STATE_SLUG_RESOLVED,
          grade: curr.grade,
          subject: SUBJECT_SLUG_RESOLVED
        });
      }
    }

    function attachQuestionHandlers(q) {
      const form = qbox.querySelector('form');
      // Reading passage toggle (R2)
      const passageEl = qbox.querySelector('#reading-passage');
      if (passageEl) {
        const toggleBtn = passageEl.querySelector('[data-act="passage-toggle"]');
        if (toggleBtn) {
          toggleBtn.addEventListener('click', () => {
            const collapsed = passageEl.classList.toggle('reading-passage--collapsed');
            toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            const label = toggleBtn.querySelector('.reading-passage-toggle-label');
            if (label) label.textContent = collapsed ? 'Show passage' : 'Hide passage';
          });
        }
      }
      // §74 Phase 3 — wire the new reading passage card (markdown body
      // via ReadingRender; CSS counter renders paragraph numbers).
      const passageCard = qbox.querySelector('.reading-passage-card');
      if (passageCard && q.passage && q.passage.body) {
        // Speaker — read plain text (no inline numbers, no markdown chars).
        const speakBtn = passageCard.querySelector('[data-role="speak-passage"]');
        if (speakBtn && window.Speech) {
          const plainText = window.ReadingRender
            ? window.ReadingRender.toPlainText(q.passage.body)
            : (q.passage.body || '');
          // §76b — Prewarm cloud TTS the moment the passage mounts so
          // the kid's tap on the speaker plays in ~50ms instead of
          // waiting 1.5-3s for fetch + Google synth + audio download.
          // Fire-and-forget; failure is silent (Speech.prewarm catches).
          if (typeof window.Speech.prewarm === 'function') {
            try { window.Speech.prewarm(plainText); } catch (_) {}
          }
          const setPlaying = (on) => {
            speakBtn.classList.toggle('speech-btn--playing', !!on);
            speakBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
            speakBtn.setAttribute('aria-label', on ? 'Stop reading' : 'Read passage aloud');
          };
          speakBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (window.Speech.isPlaying()) {
              window.Speech.stop();
              setPlaying(false);
            } else {
              window.Speech.play(plainText).then(() => setPlaying(false));
              setPlaying(true);
            }
          });
          window.Speech.onStateChange(state => { if (state === 'idle') setPlaying(false); });
        }
        // Expand toggle (40vh ↔ 80vh).
        const expandBtn = passageCard.querySelector('[data-role="expand-passage"]');
        if (expandBtn) {
          expandBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const cur = passageCard.getAttribute('data-state') || 'default';
            const next = cur === 'expanded' ? 'default' : 'expanded';
            passageCard.setAttribute('data-state', next);
            expandBtn.setAttribute('aria-pressed', next === 'expanded' ? 'true' : 'false');
          });
        }
        // §77 Phase C — tap-any-word definitions
        wrapPassageWordsForTap(passageCard);
        attachWordTapHandler(passageCard);
      }
      // Lake: track radio choice changes for rapid-flip detection (Prompt I1)
      if (window.GradeEarnLake) {
        form.querySelectorAll('input[type="radio"][name="ans"]').forEach(r => {
          r.addEventListener('change', () => window.GradeEarnLake.onChoiceFlip());
        });
      }
      // Esc clears the typed answer (free-response only).
      const numInput = form.querySelector('.num-input');
      if (numInput) {
        numInput.addEventListener('keydown', e => {
          if (e.key === 'Escape') { e.preventDefault(); numInput.value = ''; }
        });
        // Auto-focus the input so kids can just type.
        setTimeout(() => { try { numInput.focus(); } catch (_) {} }, 50);
      }
      // §73 — Read-aloud button (always rendered when Speech is supported).
      // Per Owners' Room: NEVER auto-play. Tap to play, tap to stop.
      // Spoken text = prompt + (multi-choice → " Choices: A, B, C, D").
      const readBtn = qbox.querySelector('[data-act="read"]');
      if (readBtn && window.Speech && window.Speech._isSupported()) {
        const textToRead = (() => {
          const choices = (q.type === 'multiple_choice' && Array.isArray(q.choices))
            ? '. Choices: ' + q.choices.join(', ')
            : '';
          return String(q.prompt || '') + choices;
        })();
        const setPlaying = (on) => {
          readBtn.classList.toggle('speech-btn--playing', !!on);
          readBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
          readBtn.setAttribute('aria-label', on ? 'Stop reading' : 'Read aloud');
        };
        readBtn.addEventListener('click', () => {
          if (window.Speech.isPlaying()) {
            window.Speech.stop();
            setPlaying(false);
          } else {
            window.Speech.play(textToRead).then(() => setPlaying(false));
            setPlaying(true);
          }
        });
        // Sync state if some other speaker (fact card) starts/stops.
        window.Speech.onStateChange(state => {
          // Only reflect playing state when WE are the source — proxy via
          // checking aria-pressed first, then the global isPlaying. If
          // something else started a different utterance our button should
          // go idle.
          if (state === 'idle') setPlaying(false);
        });
      }
      form.addEventListener('submit', e => {
        e.preventDefault();
        const userAnswer = getAnswerFromForm(q, form);
        if (userAnswer == null || userAnswer === '') {
          showToast(q.type === 'multiple_choice' ? 'Pick an answer first.' : 'Type your answer first.');
          return;
        }
        // §73 — Check cancels any in-flight question speech.
        try { if (window.Speech) window.Speech.stop(); } catch (_) {}
        const isCorrect = checkAnswer(q, userAnswer);
        // Lake: record answer event (Prompt I1)
        if (window.GradeEarnLake && q.contentId) {
          let pickedIdx = null;
          if (q.type === 'multiple_choice' && Array.isArray(q.choices)) {
            const idx = q.choices.indexOf(userAnswer);
            if (idx >= 0) pickedIdx = idx;
          }
          window.GradeEarnLake.onAnswered({
            contentId: q.contentId,
            poolKey: q.poolKey,
            pickedChoice: pickedIdx,
            isCorrect
          });
        }
        if (isCorrect) correct++;
        sessionResults.push({
          question: String(q.prompt || '').slice(0, 80),
          correct: isCorrect,
          wrongChoice: isCorrect ? null : String(userAnswer == null ? '' : userAnswer).slice(0, 60),
          topic: q._unit?.title || null
        });
        if (isCorrect) spawnPointsPop(qbox, difficultyCents(q));
        if (isCorrect) {
          const _streak = (window._stCorrectStreak = (window._stCorrectStreak || 0) + 1);
          if (_streak % 5 === 0 && STATE_INFO && STATE_INFO.testName) {
            showToast(pickRandom(STAAR_STREAK_TEMPLATES)(STATE_INFO.testName, _streak));
          }
          try {
            document.dispatchEvent(new CustomEvent('gradeearn:correct-answer', {
              detail: { count: _streak }
            }));
          } catch (_) {}
        } else {
          window._stCorrectStreak = 0;
        }
        Stats.record(slug, stats, { unitId: q._unit?.id, unitTitle: q._unit?.title, isCorrect });
        const milestones = recordJourney(isCorrect);
        if (window.STAARFx) {
          if (isCorrect) { window.STAARFx.playCorrect(); window.STAARFx.vibrate(20); }
          else { window.STAARFx.playWrong(); window.STAARFx.vibrate([40, 50, 40]); }
          if (milestones && milestones.dailyGoalHit) {
            window.STAARFx.confetti({ count: 90, duration: 1800 });
            window.STAARFx.playMilestone();
            window.STAARFx.toast(pickRandom(DAILY_GOAL_TOASTS), { kind: 'win' });
          } else if (milestones && milestones.streakMilestone) {
            window.STAARFx.confetti({ count: 60, duration: 1400 });
            window.STAARFx.playMilestone();
            window.STAARFx.toast(pickRandom(STREAK_TOAST_TEMPLATES)(milestones.streakMilestone), { kind: 'win' });
          } else if (milestones && milestones.streakDayMilestone) {
            window.STAARFx.confetti({ count: 70, duration: 1600 });
            window.STAARFx.playMilestone();
            window.STAARFx.toast(pickRandom(STREAK_DAY_TEMPLATES)(milestones.streakDayMilestone), { kind: 'win' });
          } else if (milestones && milestones.streakFreezeUsed) {
            window.STAARFx.toast(`Streak freeze used 🛡 — ${milestones.streakFreezeUsed}-day streak saved`, { kind: 'win' });
          }
        }
        if (isGuest()) {
          guestIncrement();
          renderGuestBanner();
        }
        renderPerf(perfPanel, curr, stats);
        showFeedback(q, userAnswer, isCorrect);
        if (isCorrect && window.STAARAuth && typeof window.STAARAuth.earn === 'function') {
          window.STAARAuth.earn(difficultyCents(q), sKey);
        } else if (!isCorrect && window.STAARAuth && typeof window.STAARAuth.lose === 'function') {
          window.STAARAuth.lose(difficultyCents(q), sKey);
        }
        // After feedback, if guest hit the cap, lock the page on the next question advance.
        if (isGuest() && guestCount() >= GUEST_LIMIT) {
          setTimeout(() => { maybeBlockGuest(); }, 1500);
        }
      });
    }

    function showFeedback(q, userAnswer, isCorrect) {
      // §54 + §56 — explicit state machine (asking → correct | wrong).
      // Single source of truth for feedback: inline inside the card,
      // between the input and the primary button. The legacy out-of-card
      // <div class="feedback">…</div> panel is gone (was double-rendering
      // the symbol + explanation alongside the inline data-state chrome).
      const qCard = qbox.querySelector('.question-card');
      const cents = qCard ? parseInt(qCard.dataset.cents, 10) || 0 : 0;
      const nextLabel = i + 1 >= questions.length ? 'See results' : 'Next question →';

      // 1. Flip card data-state — drives green/red border + input-lock CSS.
      if (qCard) qCard.setAttribute('data-state', isCorrect ? 'correct' : 'wrong');
      // 1b. body.q-answered → CSS hides 'Need scratch paper?' link (kid is
      //     done with this question; opening scratch now adds noise).
      document.body.classList.add('q-answered');

      // 2. Lock the inputs. Read-only (text) + disabled (radios) so the
      //    kid still sees what they answered, but can't edit.
      if (qCard) {
        qCard.querySelectorAll('input[name="ans"]').forEach(el => {
          if (el.type === 'radio') {
            el.disabled = true;
          } else {
            el.readOnly = true;
            el.setAttribute('aria-readonly', 'true');
          }
        });
      }

      // 3. Populate the inline feedback slot (between body and CTA).
      //    §59 + §68 — content per state:
      //      CORRECT: single-line tight chip "✓ +N pts earned · explanation".
      //               Kid got it right; auto-advance handles 'continue'.
      //      WRONG:   AI tutor IS the feedback. Slot holds only tutor mount
      //               points so the explanation + Socratic guidance live
      //               inside the card without duplication.
      const fbSlot = qCard ? qCard.querySelector('[data-role="inline-fb"]') : null;
      if (fbSlot) {
        const explanation = String(q.explanation || '').trim();
        if (isCorrect) {
          // §68 — single-line compact: pts + explanation in one row,
          // separated by middle dot. Hamid 10:47am compaction call.
          const explanationHtml = explanation
            ? ` <span class="q-inline-fb-sep" aria-hidden="true">·</span> <span class="q-inline-fb-body-inline">${escapeHtml(explanation)}</span>`
            : '';
          fbSlot.innerHTML = `<div class="q-inline-fb-head">✓ <span class="q-inline-fb-pts">+${cents} pts earned</span>${explanationHtml}</div>`;
          fbSlot.classList.remove('q-inline-fb--tutor');
        } else {
          // §69 — WRONG inline. Render only the static parts up-front:
          //   - brief inline header (✗ + correct answer)
          //   - brief explanation
          //   - empty .tutor-box wrapper with #tutor-out only
          // Follow-up form + chip buttons are NOT in the markup yet —
          // they get insertAdjacentHTML'd by fireInitialTutor() ONLY
          // on success. If the tutor fails or times out, we remove
          // the entire .tutor-box silently — kid sees no apology UI.
          const briefExplanationHtml = explanation
            ? `<div class="q-inline-fb-body">${escapeHtml(explanation)}</div>`
            : '';
          fbSlot.innerHTML = `
            <div class="q-inline-fb-head">✗ ${pickRandom(WRONG_HEADERS)} <span class="q-inline-fb-correct">The answer is <strong>${escapeHtml(q.answer)}</strong>.</span></div>
            ${briefExplanationHtml}
            <div class="tutor-box" id="tutor-box">
              <div class="tutor-output" id="tutor-out" aria-live="polite" aria-atomic="false"></div>
            </div>`;
          fbSlot.classList.remove('q-inline-fb--tutor');
        }
        fbSlot.hidden = false;
      }

      // 4. CTA replacement.
      //    §68 — CORRECT auto-advances 1.5s — no Next button needed.
      //         The Check button is replaced by a subtle progress
      //         indicator that drains over 1.5s, then we call show().
      //    §71 — When a Fun Fact is selected for this CORRECT, the
      //         auto-advance timer + drain bar are cancelled and the
      //         fact card takes over as the kid's "continue" surface.
      //    WRONG keeps the manual Next button (kid needs reading time
      //         for the AI tutor + explanation; auto-advance feels
      //         punishing on a wrong answer).
      const checkBtn = qCard ? qCard.querySelector('button[data-role="check"]') : null;
      if (checkBtn) {
        if (isCorrect) {
          // Auto-advance: replace Check with a progress indicator
          // that visually drains, then advances after 1.5s.
          const advance = document.createElement('div');
          advance.className = 'q-autoadvance';
          advance.setAttribute('data-role', 'autoadvance');
          advance.innerHTML = `
            <span class="q-autoadvance-text">Auto-advancing in 1.5s…</span>
            <span class="q-autoadvance-bar" aria-hidden="true"><span class="q-autoadvance-fill"></span></span>`;
          checkBtn.replaceWith(advance);
          window._stAutoAdvance = setTimeout(() => {
            try { i++; show(); } catch (_) {}
          }, 1500);

          // §71 — Fun Facts integration. Pure-fn selector returns null
          // synchronously when the gate fails (frequency, paused, etc.)
          // OR when the catalog isn't loaded yet (lazy fetch kicks off
          // in the background; next correct will see it ready). When a
          // fact IS returned, cancel auto-advance and mount the card.
          // Race protection: capture i so a slow catalog fetch can't
          // mount a stale card after the kid moved on.
          if (window.FunFacts && typeof window.FunFacts.pickFactForCorrect === 'function') {
            try {
              const _u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
              const lifetimeCorrect = (_u && Number.isFinite(_u.lifetimeCorrect)) ? _u.lifetimeCorrect : 0;
              const seqAtCall = i;
              const fact = window.FunFacts.pickFactForCorrect({
                isFirstTry: true,                  // No retry mechanism in this codebase — every check is first try.
                lifetimeCorrect,
                sessionCorrectCount: correct       // already incremented before showFeedback
              });
              if (fact && i === seqAtCall) {
                if (window._stAutoAdvance) {
                  clearTimeout(window._stAutoAdvance);
                  window._stAutoAdvance = null;
                }
                const aa = qCard ? qCard.querySelector('.q-autoadvance') : null;
                if (aa && aa.parentNode) aa.parentNode.removeChild(aa);
                const isFirstFactEver = !(window.FunFacts._getFirstShownAt && window.FunFacts._getFirstShownAt());
                mountFunFactCard(fact, isFirstFactEver, seqAtCall);
              }
            } catch (err) {
              // Silent fallback — auto-advance still active, kid moves on normally.
              console.warn('[funFacts] integration error:', err && err.message || err);
            }
          }
        } else {
          const nextInline = document.createElement('button');
          nextInline.type = 'button';
          nextInline.id = 'next-btn';
          nextInline.className = 'btn btn-primary q-cta';
          nextInline.setAttribute('data-role', 'next');
          nextInline.textContent = nextLabel;
          checkBtn.replaceWith(nextInline);
        }
      }

      // 5. §68 — Update muted footer line. Drop the '±N pts' stake
      //    chip since pts are now inline in the q-inline-fb head
      //    on CORRECT, and 0 pts is implied on WRONG. Footer is
      //    just topic + TEKS (informational, no scoring duplication).
      const metaText = qCard ? qCard.querySelector('.q-meta-text') : null;
      if (metaText) {
        const base = metaText.textContent.replace(/ · ±?\d+ pts.*$/, '').replace(/ · ⭐ Mastered$/, '');
        metaText.textContent = base;
      }

      // 6. §59 — out-of-card panel deleted entirely. Both states render
      //    inside the question card now: CORRECT inline chip, WRONG AI
      //    tutor (mount points injected at step 3 above). No appendChild.

      // In-flight tutor request controller. Aborted on Next Question click
      // and on Retry (which restarts a fresh call). Scoped to this panel.
      let currentTutorController = null;

      // §68 — CORRECT auto-advances; no #next-btn exists. WRONG renders
      // the Next button; wire its click to advance.
      const nextBtn = document.getElementById('next-btn');
      if (nextBtn) {
        nextBtn.addEventListener('click', () => {
          if (currentTutorController) {
            try { currentTutorController.abort(); } catch (_) {}
            currentTutorController = null;
          }
          if (window.STAARFx) window.STAARFx.stopSpeak();
          i++;
          show();
        });
      }

      if (!isCorrect) {
        // \u00a769 \u2014 WRONG-state tutor wiring. Follow-up form + chips are
        // mounted lazily on the FIRST successful tutor reply (was
        // pre-rendered with hidden attribute, which leaked through
        // CSS specificity in some browsers). On tutor failure we
        // remove the entire .tutor-box silently \u2014 kid sees no
        // apology UI, just feedback header + Next button.
        const tutorOut = document.getElementById('tutor-out');
        const tutorBox = document.getElementById('tutor-box');
        let followup = null;
        let tutorQ = null;
        const history = [];

        // Build full tutor context once.
        const tutorCtx = buildTutorContext(q, stats, curr);

        const submitFollowup = (text) => {
          if (!text || !followup || !tutorQ) return;
          tutorQ.value = text;
          followup.dispatchEvent(new Event('submit', { cancelable: true }));
        };

        // \u00a769 \u2014 mount the follow-up form + chips only after the
        // tutor's first successful reply. Markup matches the
        // previous pre-rendered version; just deferred to success.
        function mountTutorInputs() {
          if (followup) return; // idempotent
          tutorBox.insertAdjacentHTML('beforeend', `
            <form class="tutor-followup" id="tutor-followup">
              <input type="text" id="tutor-q" placeholder="Ask a follow-up question\u2026" />
              <button class="tutor-send" type="submit" aria-label="Send">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
            </form>
          `);
          followup = document.getElementById('tutor-followup');
          tutorQ = document.getElementById('tutor-q');
          followup.addEventListener('submit', onFollowupSubmit);
        }

        const renderChips = () => {
          const wrap = document.createElement('div');
          wrap.className = 'tutor-suggestions';
          ['I still don\u2019t get it', 'Give me a hint', 'Show me the answer'].forEach(label => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tutor-chip';
            btn.textContent = label;
            btn.addEventListener('click', () => { submitFollowup(label); });
            wrap.appendChild(btn);
          });
          tutorOut.appendChild(wrap);
        };

        // Single network call helper. Used by (a) auto-fire on wrong answer,
        // (b) chip clicks via submitFollowup, (c) free-text follow-ups.
        // Returns { reply } | { aborted: true } | { error: true }.
        async function runTutor(userText, isInitial) {
          if (currentTutorController) {
            try { currentTutorController.abort(); } catch (_) {}
          }
          const ac = new AbortController();
          currentTutorController = ac;
          let timedOut = false;
          const timeoutId = setTimeout(() => {
            timedOut = true;
            try { ac.abort(); } catch (_) {}
          }, TUTOR_TIMEOUT_MS);

          // Send history exactly the way the previous code did:
          // initial auto-fire sends [], appending the placeholder user turn
          // only after success. Follow-ups send history with the new user
          // turn already pushed.
          const sendHistory = isInitial ? [] : history.concat([{ role: 'user', content: userText }]);

          try {
            const reply = await callTutor(Object.assign({}, tutorCtx, {
              question: q.prompt,
              correctAnswer: q.answer,
              studentAnswer: userAnswer,
              explanation: q.explanation,
              teks: q._lesson?.teks,
              topic: q._unit?.title,
              history: sendHistory
            }), ac.signal);
            clearTimeout(timeoutId);
            if (currentTutorController === ac) currentTutorController = null;
            history.push({
              role: 'user',
              content: isInitial ? 'Help me understand this problem.' : userText
            });
            history.push({ role: 'assistant', content: reply });
            return { reply };
          } catch (err) {
            clearTimeout(timeoutId);
            if (currentTutorController === ac) currentTutorController = null;
            // AbortError without timedOut means the kid clicked Next Question
            // (or Retry while a previous call was in flight). Silent — no UI.
            if (err && err.name === 'AbortError' && !timedOut) {
              return { aborted: true };
            }
            console.warn('[tutor] failed', {
              contentId: q.contentId,
              name: err && err.name,
              message: err && err.message,
              timedOut: timedOut
            });
            return { error: true };
          }
        }

        // §69 — silent failure: remove the entire .tutor-box from
        // the DOM. The kid never sees an apology UI.
        // The inline feedback header above (✗ + correct answer +
        // brief explanation) is the failsafe teaching for that beat.
        const removeTutorBox = () => {
          if (tutorBox && tutorBox.parentNode) tutorBox.parentNode.removeChild(tutorBox);
        };

        async function fireInitialTutor() {
          tutorOut.innerHTML = `<div class="tutor-msg assistant tutor-loading"><span style="color:var(--text-muted,#6b7280);font-size:0.95rem;margin-right:8px;">AI tutor is reading…</span>${thinkingHTML()}</div>`;
          const result = await runTutor(null, true);
          if (result.aborted) return;
          if (result.error) { removeTutorBox(); return; }
          tutorOut.innerHTML = `<div class="tutor-msg assistant">${formatTutor(result.reply)}</div>`;
          renderChips();
          mountTutorInputs(); // §69 — only after first successful reply
        }

        // Auto-fire the tutor as soon as the wrong-answer panel renders.
        // The stored explanation above is the immediate fallback the kid
        // can already read while this call is in flight.
        fireInitialTutor();

        async function onFollowupSubmit(e) {
          e.preventDefault();
          const text = tutorQ.value.trim();
          if (!text) return;
          tutorQ.value = '';
          // Remove any old chips before adding a new turn.
          tutorOut.querySelector('.tutor-suggestions')?.remove();
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg user"><strong>You:</strong> ${escapeHtml(text)}</div>`);
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg loading">${thinkingHTML()}</div>`);
          const result = await runTutor(text, false);
          tutorOut.querySelector('.tutor-msg.loading')?.remove();
          if (result.aborted) return;
          if (result.error) {
            // §69 — kid is in the conversation now; brief soft-fail
            // is OK. Keep it short — no apology paragraph.
            tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg assistant error">Try again in a moment.</div>`);
            return;
          }
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg assistant">${formatTutor(result.reply)}</div>`);
          renderChips();
        }
      }
    }

    function finish() {
      bar.style.width = '100%';
      if (barPulse) barPulse.style.left = '100%';
      const pct = Math.round((correct / questions.length) * 100);
      const perfect = correct === questions.length && questions.length > 0;
      const justMastered = perfect && sKey && !isLocked;
      if (justMastered && window.STAARAuth?.markMastered) {
        window.STAARAuth.markMastered(sKey, sectionLabel(curr, meta));
      }
      const banner = perfect
        ? `<div class="mastered-banner mastered-celebrate">
             <span class="mastered-star">⭐</span>
             <div>
               <div class="mastered-title">${justMastered ? MASTERY_HEADERS.justMastered : MASTERY_HEADERS.alreadyMastered}</div>
               <div class="mastered-sub">Every question correct. This section is locked from earning so you can explore new ones.</div>
             </div>
           </div>`
        : '';
      qbox.innerHTML = `
        ${banner}
        <div class="card">
          <h3>${pickEndHeader(correct, questions.length)}</h3>
          <p style="font-size:1.4rem;"><strong>${correct} / ${questions.length}</strong> correct (${pct}%)</p>
          <div id="session-summary" class="session-summary tutor-output" aria-live="polite" aria-atomic="true" style="margin:14px 0;padding:10px 14px;font-size:0.95rem;color:var(--text,#374151);background:var(--bg-soft,#f9fafb);border-left:3px solid var(--border,#e5e7eb);border-radius:6px;font-style:italic;">${thinkingHTML()}</div>
          <a class="btn btn-primary" id="end-try-again" href="practice.html?${new URLSearchParams(Object.fromEntries([...params])).toString()}">Try again</a>
          <a class="btn btn-secondary" id="end-back" href="grade.html?g=${slug}" style="margin-left:8px;color:var(--blue);border-color:var(--blue);">Back to ${curr.title}</a>
          ${(() => {
            const cur = parseInt(params.get('n'), 10) || 25;
            const choices = [10, 25, 50, 100].filter(n => n !== cur);
            const baseParams = new URLSearchParams(Object.fromEntries([...params]));
            const chips = choices.map(n => {
              const p = new URLSearchParams(baseParams.toString());
              p.set('n', String(n));
              const label = n === 10 ? 'Quick (10)' : n === 25 ? 'Standard (25)' : n === 50 ? 'Deep (50)' : 'Marathon (100)';
              return `<a class="practice-mode-chip" href="practice.html?${p.toString()}">${label}</a>`;
            }).join('');
            // "Review wrong answers" CTA — only shown to authed users with
            // a known scope. Guests get an upsell via startReview()'s gate.
            const reviewParams = new URLSearchParams(baseParams.toString());
            reviewParams.set('review', '1');
            reviewParams.delete('n');
            const reviewChip = `<a class="practice-mode-chip" href="practice.html?${reviewParams.toString()}" style="border-color:rgba(251,191,36,0.35);">Review wrong answers ↻</a>`;
            return `<div class="practice-mode-row" aria-label="Try a different session length">${reviewChip}${chips}</div>`;
          })()}
        </div>`;

      // Fire the AI session summary in the background. The score is already
      // visible above; this is purely additive. Silently drops on null /
      // error / 8s timeout — the end-of-set screen looks like today minus
      // the placeholder in any failure case.
      const summaryController = new AbortController();
      let summaryTimedOut = false;
      const summaryTimeoutId = setTimeout(() => {
        summaryTimedOut = true;
        try { summaryController.abort(); } catch (_) {}
      }, 8000);

      const removeSummaryPlaceholder = () => {
        const el = document.getElementById('session-summary');
        if (el) el.remove();
      };
      const renderSummary = (text) => {
        const el = document.getElementById('session-summary');
        if (!el) return;
        el.innerHTML = escapeHtml(String(text));
        el.style.fontStyle = 'normal';
      };

      // Abort if the kid clicks away before the summary lands. Browser
      // navigation would kill the fetch anyway, but explicit abort is
      // cheaper than a stranded request and matches the prompt spec.
      ['end-try-again', 'end-back'].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) {
          btn.addEventListener('click', () => {
            clearTimeout(summaryTimeoutId);
            try { summaryController.abort(); } catch (_) {}
          });
        }
      });

      const ctx = buildTutorContext(null, stats, curr);
      const summaryPayload = {
        action: 'summarize-session',
        studentName: ctx.studentName,
        grade: ctx.studentGrade,
        state: ctx.studentState,
        testName: ctx.testName,
        subject: SUBJECT_SLUG || 'math',
        unitTitle: curr?.title || null,
        results: sessionResults.slice(),
        durationSeconds: Math.round((Date.now() - sessionStartedAt) / 1000),
        perfectRun: perfect
      };

      (async () => {
        try {
          const res = await fetch(TUTOR_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(summaryPayload),
            signal: summaryController.signal
          });
          clearTimeout(summaryTimeoutId);
          if (!res.ok) { removeSummaryPlaceholder(); return; }
          const data = await res.json();
          if (!data || !data.summary) { removeSummaryPlaceholder(); return; }
          renderSummary(data.summary);
        } catch (err) {
          clearTimeout(summaryTimeoutId);
          if (err && err.name === 'AbortError') {
            console.log('[summary]', summaryTimedOut ? 'timeout 8s' : 'aborted (navigation)');
            removeSummaryPlaceholder();
            return;
          }
          console.warn('[summary] failed:', err && err.message);
          removeSummaryPlaceholder();
        }
      })();
    }
  }

  function difficultyCents(q) {
    if (q && Number.isFinite(q.cents) && q.cents >= 1 && q.cents <= 5) return q.cents;
    if (q && q._cents) return q._cents;
    // Deterministic 1–5 from question prompt so the same question always pays the same.
    const s = String((q && q.prompt) || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    const v = ((h % 5) + 5) % 5 + 1; // 1..5
    if (q) q._cents = v;
    return v;
  }

  function renderChoiceLabel(c) {
    // For tiny comparison-symbol choices, also show a plain-language helper
    // so 3rd graders can clearly tell ">", "<", and "=" apart.
    const SYMBOL_HINTS = {
      '<': 'less than',
      '>': 'greater than',
      '=': 'equal to',
      '≤': 'less than or equal',
      '≥': 'greater than or equal',
      '≠': 'not equal to'
    };
    const hint = SYMBOL_HINTS[String(c).trim()];
    if (hint) {
      return `<span class="choice-symbol">${escapeHtml(c)}</span><span class="choice-hint"> (${hint})</span>`;
    }
    return `<span>${escapeHtml(c)}</span>`;
  }

  function spawnPointsPop(qbox, points) {
    if (!qbox) return;
    const main = qbox.closest('.practice-main') || qbox.parentElement;
    if (!main) return;
    if (getComputedStyle(main).position === 'static') main.style.position = 'relative';
    const pop = document.createElement('div');
    pop.className = 'points-pop';
    pop.textContent = `+${points}`;
    main.appendChild(pop);
    setTimeout(() => { try { pop.remove(); } catch (_) {} }, 1300);
  }

  // ============================================================
  // READING START — fetch a batch of reading questions from the lake
  // (state+grade), then runQuiz with a minimal curriculum stand-in.
  // ============================================================
  async function startReading() {
    const grTitle = ({
      'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
      'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
      'grade-8':'Grade 8'
    })[slug] || slug;
    const fakeCurr = { grade: slug, title: `${grTitle} Reading`, units: [] };
    // §74 Phase 3 — fetch one passage + its question set via getReadingItem
    // (Phase 1 lambda action). Gets back { passage: {...}, questions: [...] }.
    // Each question is hydrated with the same passage object so renderQuestion
    // can mount the passage card on every render (it's idempotent — same
    // passageId = same DOM, just re-painted by qbox.innerHTML).
    try {
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getReadingItem',
          token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null,
          state: STATE_SLUG_RESOLVED,
          grade: slug
        })
      });
      if (!res.ok) throw new Error('reading_item_failed_' + res.status);
      const data = await res.json();
      const passage = data.passage || null;
      const rawQuestions = data.questions || [];
      if (!passage || rawQuestions.length === 0) {
        root.innerHTML = `
          <h2>Reading practice</h2>
          <div class="card">
            <p style="color:var(--muted);">No reading passages available yet for ${escapeHtml(grTitle)}. Try Math while we add more reading content!</p>
            <p><a class="btn btn-primary" href="index.html">Back to home</a></p>
          </div>`;
        return;
      }
      // §74 — map staar-content-pool reading_mc rows to runQuiz item shape.
      const items = rawQuestions.map(g => ({
        id: g.contentId || g.id,
        contentId: g.contentId || null,
        poolKey: g.poolKey || null,
        type: 'multiple_choice',
        prompt: g.stem || g.prompt || '',
        choices: g.choices || [],
        answer: (Number.isFinite(g.correctIndex) && Array.isArray(g.choices)) ? g.choices[g.correctIndex] : (g.answer || ''),
        correctIndex: g.correctIndex,
        explanation: g.explanation || '',
        passage: passage,                     // ← attach the same passage to every question
        _unit: { title: passage.title || 'Reading' },
        _lesson: { teks: g.claimedTeks || g.teks || '', title: '' }
      }));
      if (!items.length) {
        root.innerHTML = `
          <h2>Reading practice</h2>
          <div class="card">
            <p style="color:var(--muted);">Building reading questions for ${escapeHtml(grTitle)} — give us a moment and try again.</p>
            <p><a class="btn btn-primary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}">Back</a></p>
          </div>`;
        return;
      }
      runQuiz(fakeCurr, items, null, { enhance: null });
    } catch (err) {
      console.warn('[reading] fetch failed:', err.message);
      root.innerHTML = `
        <h2>Reading practice</h2>
        <div class="card" style="text-align:center;padding:32px;">
          <div style="font-size:2.4rem;margin-bottom:8px;" aria-hidden="true">📚</div>
          <p style="font-size:1.05rem;margin-bottom:6px;">We couldn’t load reading questions right now.</p>
          <p style="color:var(--muted);margin-bottom:18px;">This usually clears up in a few seconds.</p>
          <p><button type="button" class="btn btn-primary" onclick="location.reload()">Retry</button>
            <a class="btn btn-secondary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}" style="margin-left:8px;">Back</a></p>
        </div>`;
    }
  }

  // ============================================================
  // SCIENCE START — Phase K. Mirror of startReading: one scenario +
  // its 4-5 cluster questions per session via getScienceItem. Texas
  // Grade 5 only at launch (per Phase I-J pilot scope). Scenario body
  // is plain text; the same reading-passage UI handles it (ReadingRender
  // → marked.js wraps paragraphs cleanly even without markdown headers).
  // ============================================================
  async function startScience() {
    const grTitle = ({
      'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
      'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
      'grade-8':'Grade 8'
    })[slug] || slug;
    const fakeCurr = { grade: slug, title: `${grTitle} Science`, units: [] };
    try {
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getScienceItem',
          token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null,
          state: STATE_SLUG_RESOLVED,
          grade: slug
        })
      });
      if (!res.ok) throw new Error('science_item_failed_' + res.status);
      const data = await res.json();
      const scenario = data.scenario || null;
      const rawQuestions = data.questions || [];
      if (!scenario || rawQuestions.length === 0) {
        root.innerHTML = `
          <h2>Science practice</h2>
          <div class="card" style="text-align:center;padding:36px;">
            <div style="font-size:3rem;margin-bottom:12px;" aria-hidden="true">🌱</div>
            <p style="font-size:1.05rem;margin-bottom:6px;"><strong>${escapeHtml(grTitle)} science is coming soon.</strong></p>
            <p style="color:var(--muted);max-width:480px;margin:0 auto 18px;">We're growing the science library one grade at a time — quality over quantity. In the meantime, math and reading are fully stocked and ready.</p>
            <p>
              <a class="btn btn-primary" href="practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=math">Practice Math</a>
              <a class="btn btn-secondary" href="practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=reading" style="margin-left:8px;">Practice Reading</a>
            </p>
          </div>`;
        return;
      }
      // The scenario row from staar-passages already has { title, body }.
      // Reuse the reading-passage UI by treating it as a passage object —
      // marked.js wraps plain-text paragraph breaks into <p> tags cleanly.
      const passage = {
        passageId: scenario.passageId,
        title: scenario.title || 'Science scenario',
        body: scenario.body || '',
        scenarioType: scenario.scenarioType || null,
        regionTag: scenario.regionTag || null
      };
      const items = rawQuestions.map(g => ({
        id: g.contentId || g.id,
        contentId: g.contentId || null,
        poolKey: g.poolKey || null,
        type: 'multiple_choice',
        prompt: g.stem || g.prompt || '',
        choices: g.choices || [],
        answer: (Number.isFinite(g.correctIndex) && Array.isArray(g.choices)) ? g.choices[g.correctIndex] : (g.answer || ''),
        correctIndex: g.correctIndex,
        explanation: g.explanation || '',
        passage: passage,
        _unit: { title: passage.title || 'Science' },
        _lesson: { teks: g.claimedTeks || g.teks || '', title: '' }
      }));
      if (!items.length) {
        root.innerHTML = `
          <h2>Science practice</h2>
          <div class="card">
            <p style="color:var(--muted);">Loading science questions for ${escapeHtml(grTitle)} — try again in a moment.</p>
            <p><a class="btn btn-primary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}">Back</a></p>
          </div>`;
        return;
      }
      runQuiz(fakeCurr, items, null, { enhance: null });
    } catch (err) {
      console.warn('[science] fetch failed:', err.message);
      root.innerHTML = `
        <h2>Science practice</h2>
        <div class="card" style="text-align:center;padding:32px;">
          <div style="font-size:2.4rem;margin-bottom:8px;" aria-hidden="true">🔬</div>
          <p style="font-size:1.05rem;margin-bottom:6px;">We couldn’t load science questions right now.</p>
          <p style="color:var(--muted);margin-bottom:18px;">This usually clears up in a few seconds.</p>
          <p><button type="button" class="btn btn-primary" onclick="location.reload()">Retry</button>
            <a class="btn btn-secondary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}" style="margin-left:8px;">Back</a></p>
        </div>`;
    }
  }

  // ============================================================
  // Review-mode practice — re-do recent wrong answers.
  // CLAUDE.md §39 + this commit's lambda action getWrongAnswers.
  // Pulls last ~50 wrong-answer events, fetches the questions, and
  // runs them through the same runQuiz pipeline. If kid gets it right
  // this time, it doesn't disappear from the wrong list (kid might
  // want to re-do again later); the lambda only logs incorrect events,
  // so a correct retry just doesn't add to the queue.
  // ============================================================
  async function startReview() {
    if (!(window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser())) {
      root.innerHTML = `
        <h2>Review your wrong answers</h2>
        <div class="card">
          <p style="color:var(--muted);">Sign up to save your progress and review the questions you missed.</p>
          <p><button type="button" class="btn btn-primary" id="rev-signup">Create your free account</button></p>
        </div>`;
      const sup = document.getElementById('rev-signup');
      if (sup) sup.onclick = () => { if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
      return;
    }
    root.innerHTML = `
      <div class="ge-skel-card" aria-busy="true" aria-label="Loading your review set">
        <div class="ge-skel ge-skel-line medium" style="margin-bottom:18px;"></div>
        <div class="ge-skel ge-skel-line long"></div>
        <div class="ge-skel ge-skel-line long"></div>
        <div class="ge-skel ge-skel-line short"></div>
        <div class="ge-skel-stack" style="margin-top:16px;">
          <div class="ge-skel ge-skel-block"></div>
          <div class="ge-skel ge-skel-block"></div>
          <div class="ge-skel ge-skel-block"></div>
        </div>
      </div>`;
    try {
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getWrongAnswers',
          token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null,
          state: STATE_SLUG_RESOLVED,
          grade: slug,
          subject: SUBJECT_SLUG_RESOLVED,
          limit: 25
        })
      });
      if (!res.ok) throw new Error('review_failed_' + res.status);
      const data = await res.json();
      const items = (data.items || []).map(q => ({
        id: q.contentId,
        contentId: q.contentId,
        poolKey: q.poolKey,
        type: q.type || 'multiple_choice',
        prompt: q.prompt,
        choices: q.choices || [],
        answer: q.answer || ((Number.isFinite(q.correctIndex) && Array.isArray(q.choices)) ? q.choices[q.correctIndex] : ''),
        correctIndex: q.correctIndex,
        explanation: q.explanation || '',
        teks: q.teks,
        _unit: { title: q.unitTitle || 'Review', id: 'review' },
        _lesson: { title: q.lessonTitle || 'Wrong answers', teks: q.teks || '' }
      }));
      if (items.length === 0) {
        root.innerHTML = `
          <h2>Review your wrong answers</h2>
          <div class="card" style="text-align:center;padding:36px;">
            <p style="font-size:1.05rem;">Nothing to review. 👏</p>
            <p style="color:var(--muted);">You haven't missed any questions in this scope yet — keep practicing and we'll surface anything you miss here.</p>
            <p><a class="btn btn-primary" href="practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=${encodeURIComponent(SUBJECT_SLUG_RESOLVED)}">Practice ${escapeHtml(SUBJECT_SLUG_RESOLVED)}</a></p>
          </div>`;
        return;
      }
      const fakeCurr = { grade: slug, title: 'Review · wrong answers', units: [] };
      runQuiz(fakeCurr, items, null, { enhance: null });
    } catch (err) {
      console.warn('[review] fetch failed:', err.message);
      root.innerHTML = `
        <h2>Review your wrong answers</h2>
        <div class="card" style="text-align:center;padding:32px;">
          <div style="font-size:2.4rem;margin-bottom:8px;" aria-hidden="true">↻</div>
          <p style="font-size:1.05rem;margin-bottom:6px;">Couldn't load your review set right now.</p>
          <p style="color:var(--muted);margin-bottom:18px;">This usually clears up in a few seconds.</p>
          <p><button type="button" class="btn btn-primary" onclick="location.reload()">Retry</button>
            <a class="btn btn-secondary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}" style="margin-left:8px;">Back</a></p>
        </div>`;
    }
  }

  // ============================================================
  // Print-friendly worksheet mode — ?print=1[&n=N]
  //
  // Loads a question set the same way the regular quiz path does,
  // then renders a clean printable HTML (numbered questions, A/B/C/D
  // options, blank work lines, answer key on a separate page break).
  // No DDB writes, no quiz state. Kid/parent hits browser Print.
  // ============================================================
  async function startPrintWorksheet() {
    document.body.classList.add('print-worksheet-mode');
    const grTitle = ({
      'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
      'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
      'grade-8':'Grade 8','algebra-1':'Algebra 1'
    })[slug] || slug;
    const subjLabel = SUBJECT_SLUG.charAt(0).toUpperCase() + SUBJECT_SLUG.slice(1).replace('-', ' ');
    const stateName = STATE_INFO ? (STATE_INFO.name || STATE_INFO.nameAbbr) : '';
    const reqN = parseInt(params.get('n'), 10);
    const N = [10, 25, 50].includes(reqN) ? reqN : 10;

    root.innerHTML = `
      <div class="ge-skel-card" aria-busy="true" aria-label="Building worksheet">
        <h2 style="margin-top:0;">Building your ${escapeHtml(subjLabel)} worksheet…</h2>
        <p style="color:var(--muted);margin-bottom:18px;">${N} questions for ${escapeHtml(grTitle)}.</p>
        <div class="ge-skel ge-skel-line long"></div>
        <div class="ge-skel ge-skel-line long"></div>
        <div class="ge-skel ge-skel-line medium"></div>
      </div>`;
    let items = [];
    try {
      // Reuse pool — math: load curriculum JSON; reading/science: lambda.
      if (SUBJECT_SLUG === 'reading' || SUBJECT_SLUG === 'science') {
        const action = SUBJECT_SLUG === 'reading' ? 'getReadingItem' : 'getScienceItem';
        const res = await fetch(TUTOR_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, state: STATE_SLUG_RESOLVED, grade: slug,
            token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null })
        });
        if (!res.ok) throw new Error('worksheet_load_failed');
        const data = await res.json();
        const rawQ = data.questions || [];
        items = rawQ.map(g => ({
          prompt: g.stem || g.prompt || '',
          choices: g.choices || [],
          answer: (Number.isFinite(g.correctIndex) && Array.isArray(g.choices)) ? g.choices[g.correctIndex] : (g.answer || ''),
          correctIndex: g.correctIndex,
          explanation: g.explanation || '',
          passage: data.passage || data.scenario || null
        })).slice(0, N);
      } else {
        const r = await fetch(`data/${slug}-curriculum.json?v=20260426m`);
        if (!r.ok) throw new Error('curr_load_failed');
        const curr = await r.json();
        const pool = curr.units.flatMap(u => u.lessons.flatMap(l => l.questions));
        const shuffled = pool.slice().sort(() => Math.random() - 0.5).slice(0, N);
        items = shuffled.map(q => ({
          prompt: q.prompt || q.question || '',
          choices: q.choices || [],
          answer: q.answer || '',
          correctIndex: Number.isFinite(q.correctIndex) ? q.correctIndex : (q.choices ? q.choices.indexOf(q.answer) : -1),
          explanation: q.explanation || ''
        }));
      }
    } catch (err) {
      root.innerHTML = `<div class="card"><h2>Couldn't build worksheet</h2><p>Try again in a moment.</p></div>`;
      return;
    }

    if (items.length === 0) {
      root.innerHTML = `<div class="card"><h2>No questions available</h2></div>`;
      return;
    }

    const escapeP = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const passageBlock = items[0].passage
      ? `<section class="ws-passage"><h3>${escapeP(items[0].passage.title || '')}</h3><div class="ws-passage-body">${escapeP(items[0].passage.body || '').split(/\n+/).map(p => `<p>${p}</p>`).join('')}</div></section>`
      : '';
    const qBlocks = items.map((q, i) => {
      const choices = (q.choices || []).map((c, j) => `
        <div class="ws-choice"><span class="ws-choice-letter">${'ABCD'[j] || ''}</span> ${escapeP(c)}</div>`).join('');
      const workLines = q.choices && q.choices.length ? '' : `<div class="ws-work-lines"></div>`;
      return `
        <article class="ws-question">
          <div class="ws-q-head"><span class="ws-q-num">${i + 1}.</span> ${escapeP(q.prompt)}</div>
          ${choices ? `<div class="ws-choices">${choices}</div>` : workLines}
        </article>`;
    }).join('');
    const answerKey = items.map((q, i) => {
      const letter = (q.choices && q.choices.length && Number.isFinite(q.correctIndex)) ? ('ABCD'[q.correctIndex] || '?') : '';
      const ans = q.answer || (q.choices && Number.isFinite(q.correctIndex) ? q.choices[q.correctIndex] : '');
      return `<li><strong>${i + 1}.</strong> ${letter ? `${letter}. ` : ''}${escapeP(ans)}${q.explanation ? `<div class="ws-key-exp">${escapeP(q.explanation)}</div>` : ''}</li>`;
    }).join('');

    root.innerHTML = `
      <div class="ws-toolbar no-print">
        <button type="button" class="btn btn-primary" id="ws-print">🖨 Print worksheet</button>
        <a class="btn btn-secondary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}" style="margin-left:8px;">Back</a>
      </div>
      <div class="ws-page">
        <header class="ws-header">
          <div class="ws-title">${escapeP(stateName)} ${escapeP(grTitle)} ${escapeP(subjLabel)} — Practice Worksheet</div>
          <div class="ws-meta">Name: _________________________ &nbsp; Date: _____________</div>
        </header>
        ${passageBlock}
        <div class="ws-questions">${qBlocks}</div>
        <div class="ws-pagebreak"></div>
        <section class="ws-answer-key">
          <h3>Answer Key</h3>
          <ol class="ws-key-list">${answerKey}</ol>
        </section>
      </div>`;
    const btn = document.getElementById('ws-print');
    if (btn) btn.onclick = () => window.print();
  }

  function renderQuestion(q, locked, idx, total) {
    let body = '';
    if (q.type === 'multiple_choice') {
      // §77 B8 — A/B/C/D letter chips. STAAR uses lettered choices and
      // kids need to learn "circle B." Letter chip is not just decoration:
      // it expands the visual hit-target leftward and gives the choice a
      // stable identity for screen readers.
      const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
      body = q.choices.map((c, cIdx) => `
        <label class="choice">
          <input type="radio" name="ans" value="${escapeAttr(c)}" required />
          <span class="choice-letter" aria-hidden="true">${LETTERS[cIdx] || (cIdx + 1)}</span>
          <span class="choice-content">${renderChoiceLabel(c)}</span>
        </label>
      `).join('');
    } else {
      body = `<input class="num-input" type="text" name="ans" autocomplete="off" placeholder="Your answer" required />`;
    }
    const cents = difficultyCents(q);
    // §73 — speaker is always rendered (pref no longer gates visibility).
    // Hidden only if Web Speech API isn't supported by the device.
    const readBtn = (window.Speech && window.Speech._isSupported())
      ? `<button type="button" class="speech-btn q-speech-btn" data-act="read" data-role="speak" aria-label="Read aloud" aria-pressed="false">
          ${SPEECH_ICON_HTML}
        </button>`
      : '';

    // Reading passage rendering — two paths:
    //  - §74 Phase 3 (markdown body via ReadingRender): when q.passage.body is present
    //  - R2 legacy (plain text via formatPassageText): when q.passage.text is present
    let passageHtml = '';
    if (q.passage && q.passage.body && window.ReadingRender) {
      passageHtml = renderReadingPassageCard(q.passage);
    } else if (q.passage && q.passage.text) {
      passageHtml = renderPassage(q.passage);
    }
    // §74 — question-of-N navigator for reading sets. Renders only when a
    // passage is present (math single-question flow doesn't need it).
    const navHtml = (q.passage && Number.isFinite(idx) && Number.isFinite(total))
      ? `<div class="reading-q-nav" aria-label="Question position">Question ${idx + 1} of ${total}</div>`
      : '';

    // §54 — explicit state machine. data-state drives CSS visuals
    // (border color, input lock styling). Footer chip demoted from
    // pair-of-pills (caps + ±N PTS) to a single muted sentence-case
    // line. Reward text is the only stake-info shown; topic/TEKS
    // moves into the same line, lowercase + separated by middots.
    const topic = q._unit?.title ? escapeHtml(q._unit.title) : '';
    const teks = q._lesson?.teks ? escapeHtml(q._lesson.teks) : '';
    const stake = locked
      ? '⭐ Mastered'
      : `±${cents} pts`;
    const metaParts = [topic, teks ? `TEKS ${teks}` : '', stake].filter(Boolean);

    // §56 — inline feedback slot. Sits between input and primary
    // button so the kid sees outcome → explanation → next-action in
    // natural reading order. Hidden in ASKING; populated by showFeedback.
    return `
      ${passageHtml}
      <form class="question-card" data-state="asking" data-cents="${cents}">
        ${navHtml}
        <div class="q-prompt">${readBtn}<span class="q-prompt-text">${escapeHtml(q.prompt)}</span></div>
        <div class="q-body">${body}</div>
        <div class="q-inline-fb" data-role="inline-fb" hidden></div>
        <button class="btn btn-primary q-cta" type="submit" data-role="check">Check answer</button>
        <div class="q-meta" data-role="meta"><span class="q-meta-text">${metaParts.join(' · ')}</span></div>
      </form>`;
  }

  // §74 Phase 3 — Reading passage card (markdown body via ReadingRender).
  // Mounted above the question card on every reading-flow question render.
  // Speaker icon wired by attachQuestionHandlers via [data-role="speak-passage"].
  function renderReadingPassageCard(p) {
    if (!p || !p.body) return '';
    const title = String(p.title || '').replace(/^#{1,6}\s+/, '');
    const innerHtml = window.ReadingRender ? window.ReadingRender.renderPassage(p.body) : '';
    const speechSupported = window.Speech && window.Speech._isSupported && window.Speech._isSupported();
    const speakerHtml = speechSupported
      ? `<button type="button" class="speech-btn passage-speech-btn" data-role="speak-passage" aria-label="Read passage aloud" aria-pressed="false">
          ${SPEECH_ICON_HTML}
        </button>`
      : '';
    return `
      <article class="reading-passage-card" data-state="default" data-passage-id="${escapeAttr(p.passageId || '')}">
        <header class="reading-passage-card-header">
          <h2 class="reading-passage-card-title">${escapeHtml(title)}</h2>
          ${speakerHtml}
          <button type="button" class="reading-passage-expand" data-role="expand-passage" aria-label="Expand passage" aria-pressed="false" title="Expand">⤢</button>
        </header>
        <div class="reading-passage-card-body">${innerHtml}</div>
      </article>`;
  }

  // ============================================================
  // §77 Phase C — Tap-any-word definitions
  // ============================================================
  //
  // Walks the passage body's text nodes and wraps each non-stopword
  // token in a <span class="word" data-word="..."> so kids can tap any
  // unfamiliar word and get a kid-friendly definition. Skips:
  //   - tokens shorter than 3 chars (also handled by stopwords)
  //   - stopwords (high-frequency Dolch/Fry list — see js/stopwords.js)
  //   - punctuation-only tokens
  //   - text inside <strong>/<em> tagged words (still tappable, just
  //     wrapped through the same logic via the recursive walk)
  //
  // The walker preserves the existing CSS counter() paragraph numbering
  // because we only modify text NODES, never element structure.

  function wrapPassageWordsForTap(passageCard) {
    if (!passageCard) return;
    const body = passageCard.querySelector('.reading-passage-card-body');
    if (!body || body.dataset.wordsWrapped === '1') return;
    body.dataset.wordsWrapped = '1';
    const stop = window.STAARStopwords || { has: () => false };

    function walk(node) {
      if (node.nodeType === 3) { // text
        const text = node.nodeValue;
        if (!text || !/[A-Za-z]/.test(text)) return;
        // Tokenize while preserving non-word separators (spaces, punctuation).
        const parts = text.split(/(\b[A-Za-z][A-Za-z']*\b)/);
        const frag = document.createDocumentFragment();
        let touched = false;
        for (const part of parts) {
          if (/^[A-Za-z][A-Za-z']*$/.test(part) && part.length >= 3 && !stop.has(part)) {
            const span = document.createElement('span');
            span.className = 'word';
            span.dataset.word = part.toLowerCase();
            span.textContent = part;
            frag.appendChild(span);
            touched = true;
          } else {
            frag.appendChild(document.createTextNode(part));
          }
        }
        if (touched) node.parentNode.replaceChild(frag, node);
        return;
      }
      if (node.nodeType !== 1) return;
      // Skip nested headers/buttons/svg
      const tag = node.nodeName.toLowerCase();
      if (tag === 'button' || tag === 'svg' || tag === 'a' || tag === 'script') return;
      // Iterate copy of children since we mutate
      for (const child of Array.from(node.childNodes)) walk(child);
    }
    walk(body);
  }

  // Click delegation — one listener per passage card. Tap a word →
  // fetch its definition, render a popover anchored to the word.
  function attachWordTapHandler(passageCard) {
    if (!passageCard || passageCard.dataset.wordHandlerWired === '1') return;
    passageCard.dataset.wordHandlerWired = '1';

    let openPopover = null;
    let openWord = null;

    const closeOpen = () => {
      if (openPopover) {
        openPopover.remove();
        openPopover = null;
      }
      if (openWord) {
        openWord.classList.remove('word--active');
        openWord = null;
      }
    };

    passageCard.addEventListener('click', async (ev) => {
      const span = ev.target.closest('.word');
      if (!span) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (openWord === span) { closeOpen(); return; }
      closeOpen();
      openWord = span;
      span.classList.add('word--active');

      const word = span.dataset.word;
      const popover = document.createElement('div');
      popover.className = 'word-popover';
      popover.setAttribute('role', 'dialog');
      popover.setAttribute('aria-label', `Definition of ${word}`);
      popover.innerHTML = `
        <div class="word-popover-header">
          <span class="word-popover-word">${escapeHtml(word)}</span>
          <button type="button" class="speech-btn word-popover-speak" data-role="speak-word" aria-label="Read word aloud" aria-pressed="false">${SPEECH_ICON_HTML}</button>
          <button type="button" class="word-popover-close" aria-label="Close">×</button>
        </div>
        <div class="word-popover-body" data-role="def">
          <span class="word-popover-loading">Looking it up…</span>
        </div>
      `;
      span.appendChild(popover);
      openPopover = popover;

      // Speaker — read the word
      const speakBtn = popover.querySelector('[data-role="speak-word"]');
      if (speakBtn && window.Speech) {
        speakBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (window.Speech.isPlaying()) {
            window.Speech.stop();
            speakBtn.classList.remove('speech-btn--playing');
          } else {
            window.Speech.play(word).then(() => speakBtn.classList.remove('speech-btn--playing'));
            speakBtn.classList.add('speech-btn--playing');
          }
        });
      }

      // Close button + outside-click
      const closeBtn = popover.querySelector('.word-popover-close');
      if (closeBtn) closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeOpen(); });

      // Fetch definition (sessionStorage cache → lambda)
      const grade = (typeof slug === 'string') ? slug.replace(/^grade-/, '') : '3';
      const cacheKey = `def#${grade}#${word}`;
      let def = null;
      try {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) def = cached;
      } catch (_) {}
      if (!def) {
        try {
          const res = await fetch(TUTOR_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'defineWord',
              token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null,
              word,
              grade
            })
          });
          if (res.ok) {
            const data = await res.json();
            def = data.definition || null;
            if (def) {
              try { sessionStorage.setItem(cacheKey, def); } catch (_) {}
            }
          }
        } catch (err) {
          console.warn('[defineWord] fetch failed:', err.message || err);
        }
      }

      // Render result (or sorry message)
      if (openPopover === popover) {
        const bodyEl = popover.querySelector('[data-role="def"]');
        if (bodyEl) {
          bodyEl.innerHTML = def
            ? `<span class="word-popover-def">${escapeHtml(def)}</span>`
            : `<span class="word-popover-error">We couldn't get a definition right now.</span>`;
        }
      }
    });

    // Outside-click + Esc dismiss
    document.addEventListener('click', (e) => {
      if (!openPopover) return;
      if (passageCard.contains(e.target) && e.target.closest('.word-popover')) return;
      closeOpen();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && openPopover) closeOpen();
    });
  }

  function renderPassage(p) {
    const TYPE_LABEL = { fiction:'Story', nonfiction:'True story', poetry:'Poem', informational:'Article' };
    const typeRaw = String(p.type || '').toLowerCase();
    const typeLabel = TYPE_LABEL[typeRaw] || (typeRaw ? typeRaw[0].toUpperCase() + typeRaw.slice(1) : 'Passage');
    const title = p.title || '';
    const isMobile = window.innerWidth < 768;
    const collapsedClass = isMobile ? ' reading-passage--collapsed' : '';
    const ariaExpanded = isMobile ? 'false' : 'true';
    const toggleLabel = isMobile ? 'Show passage' : 'Hide passage';
    return `
      <article class="reading-passage${collapsedClass}" id="reading-passage">
        <header class="reading-passage-header">
          <span class="reading-passage-type">${escapeHtml(typeLabel)}</span>
          <h2 class="reading-passage-title">${escapeHtml(title)}</h2>
          <button type="button" class="reading-passage-toggle" data-act="passage-toggle" aria-expanded="${ariaExpanded}" aria-controls="passage-text">
            <span class="reading-passage-toggle-label">${toggleLabel}</span>
            <svg class="reading-passage-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
        </header>
        <div class="reading-passage-text" id="passage-text">${formatPassageText(p.text || '')}</div>
      </article>`;
  }

  function formatPassageText(text) {
    return String(text)
      .split(/\n\s*\n/)
      .map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function getAnswerFromForm(q, form) {
    if (q.type === 'multiple_choice') {
      const sel = form.querySelector('input[name="ans"]:checked');
      return sel ? sel.value : null;
    }
    return form.querySelector('input[name="ans"]').value.trim();
  }

  function checkAnswer(q, userAnswer) {
    const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
    const a = norm(userAnswer);
    if (a === norm(q.answer)) return true;
    if (Array.isArray(q.acceptable) && q.acceptable.some(x => norm(x) === a)) return true;
    // Numeric equivalence (handles "$27" vs "27", "5.0" vs "5", etc.)
    const numUser = parseFloat(String(userAnswer).replace(/[^0-9.\-]/g, ''));
    const numAns  = parseFloat(String(q.answer).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(numUser) && Number.isFinite(numAns) && numUser === numAns) return true;
    return false;
  }

  async function callTutor(payload, signal) {
    const res = await fetch(TUTOR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: signal
    });
    if (!res.ok) throw new Error(`Tutor request failed: HTTP ${res.status}`);
    const data = await res.json();
    return data.reply || data.message || '';
  }

  function formatTutor(text) {
    if (!text) return '';
    let t = String(text).replace(/\r\n/g, '\n');

    // Extract fenced code blocks first so their content isn't touched by other rules.
    const fences = [];
    t = t.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
      const idx = fences.length;
      fences.push(code.replace(/^\n+|\n+$/g, ''));
      return `\u0000FENCE${idx}\u0000`;
    });

    // Strip markdown headings (## Heading)
    t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');

    const lines = t.split('\n');
    const html = [];
    let listType = null; // 'ol' | 'ul' | null
    let para = [];
    let olCounter = 0;

    const flushPara = () => {
      if (para.length) {
        html.push(`<p>${para.join(' ')}</p>`);
        para = [];
      }
    };
    const closeList = () => {
      if (listType) { html.push(`</${listType}>`); listType = null; olCounter = 0; }
    };

    for (const raw of lines) {
      const line = raw.trim();

      const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
      const ul = line.match(/^[-*•]\s+(.*)$/);

      if (!line) {
        // Blank line: end the current paragraph but keep an open list open,
        // so consecutive numbered/bulleted items separated by blank lines
        // stay in the same <ol>/<ul> instead of restarting numbering.
        flushPara();
        continue;
      }

      if (ol) {
        flushPara();
        if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; olCounter = 0; }
        olCounter += 1;
        // Use <li value="N"> with sequential N so we never repeat "1." even if
        // the model sent "1." for every step.
        html.push(`<li value="${olCounter}">${inline(ol[2])}</li>`);
      } else if (ul) {
        flushPara();
        if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
        html.push(`<li>${inline(ul[1])}</li>`);
      } else {
        closeList();
        para.push(inline(line));
      }
    }
    flushPara();
    closeList();
    let out = html.join('');
    // Restore fenced code blocks as monospace pre.code blocks.
    out = out.replace(/\u0000FENCE(\d+)\u0000/g, (_, n) => {
      const code = fences[Number(n)] || '';
      return `<pre class="tutor-code"><code>${escapeHtml(code)}</code></pre>`;
    });
    return out;
  }

  // Inline markdown: **bold**, *italic*, `code`. Escapes HTML first.
  function inline(s) {
    let out = escapeHtml(s);
    // bold **text**
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // italic *text* (single star, not part of **)
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    // inline code `text`
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return out;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  // §71 — Kick off catalog fetch on practice page init so the FIRST
  // correct answer can already see a loaded catalog. Without this,
  // the very first call returns null while the catalog loads in
  // background and the kid skips a fact on their first correct.
  try {
    if (window.FunFacts && typeof window.FunFacts.loadCatalog === 'function') {
      window.FunFacts.loadCatalog();
    }
  } catch (_) {}

  function spinnerHTML() {
    return `<span class="rainbow-spinner" aria-hidden="true"></span>`;
  }

  function thinkingHTML() {
    return `<div class="tutor-thinking" aria-label="Thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div>`;
  }

  // Map grade slug -> numeric grade. e.g., 'grade-3' -> 3, 'kindergarten' -> 0
  function gradeNumberFromSlug(slug) {
    if (slug == null) return null;
    const s = String(slug).toLowerCase();
    if (s.includes('kinder') || s === 'k' || s === 'grade-k') return 0;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Builds the personalization context the new system prompt expects.
  function buildTutorContext(q, stats, curr) {
    let studentName = '', studentGrade = null, studentState = '', testName = 'STAAR';
    try {
      const u = window.STAARAuth?.currentUser?.();
      if (u) {
        studentName = String(u.displayName || u.username || '').split(/\s+/)[0] || '';
        studentState = u.state || '';
        const gn = gradeNumberFromSlug(u.grade);
        if (gn != null) studentGrade = gn;
      }
    } catch (_) {}
    if (studentGrade == null) studentGrade = gradeNumberFromSlug(curr?.slug || curr?.grade);
    // Prefer URL-resolved state context (state-aware practice flow).
    if (STATE_SLUG_RESOLVED) studentState = STATE_SLUG_RESOLVED;
    if (STATE_INFO && STATE_INFO.testName) testName = STATE_INFO.testName;

    // Topic accuracy & weak areas from in-session Stats.
    let accuracyToDate = null;
    const weakAreas = [];
    try {
      if (q?._unit?.id && stats?.units?.[q._unit.id]) {
        const us = stats.units[q._unit.id];
        if (us.total > 0) accuracyToDate = `${Math.round((us.correct / us.total) * 100)}%`;
      }
      Object.values(stats?.units || {}).forEach(u => {
        if (u && u.total >= 4 && (u.correct / u.total) < 0.7 && u.title) {
          weakAreas.push(u.title);
        }
      });
    } catch (_) {}

    return {
      grade: studentGrade,
      studentName,
      studentGrade,
      studentState,
      state: STATE_SLUG_RESOLVED,
      subject: SUBJECT_SLUG_RESOLVED,
      testName,
      accuracyToDate,
      weakAreas
    };
  }

  // Branded confirmation modal. Returns a Promise<boolean>.
  function confirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel' }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h3 id="modal-title" class="modal-title">${escapeHtml(title)}</h3>
          <p class="modal-message">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="btn btn-primary" data-act="confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      // Allow CSS transition
      requestAnimationFrame(() => overlay.classList.add('open'));

      const close = (result) => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 180);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onKey = e => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      };
      document.addEventListener('keydown', onKey);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) close(false);
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => close(true));
      overlay.querySelector('[data-act="confirm"]').focus();
    });
  }

  function showToast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 2000);
  }

  function flashRestart() {
    const main = document.querySelector('.practice-main');
    if (!main) return;
    main.classList.remove('flash');
    // Reflow to retrigger animation
    void main.offsetWidth;
    main.classList.add('flash');
    setTimeout(() => main.classList.remove('flash'), 700);
  }

  // ---- Performance tracking ----
  const Stats = {
    key(slug) {
      // If the auth module is loaded, namespace stats per user so multiple
      // students on one device don't share progress. Otherwise fall back
      // to the legacy single-user key for backward compatibility.
      if (window.STAARAuth && typeof window.STAARAuth.statsKey === 'function') {
        return window.STAARAuth.statsKey(slug);
      }
      return `staar-stats:${slug}`;
    },
    load(slug) {
      try {
        const raw = localStorage.getItem(this.key(slug));
        if (raw) return JSON.parse(raw);
      } catch {}
      return { total: 0, correct: 0, streak: 0, bestStreak: 0, recent: [], units: {} };
    },
    save(slug, s) {
      try { localStorage.setItem(this.key(slug), JSON.stringify(s)); } catch {}
      // Sync to the cloud so progress follows the student to any device.
      if (window.STAARAuth && typeof window.STAARAuth.pushStats === 'function'
          && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
        window.STAARAuth.pushStats(slug, s);
      }
    },
    record(slug, s, { unitId, unitTitle, isCorrect }) {
      s.total += 1;
      if (isCorrect) {
        s.correct += 1;
        s.streak += 1;
        if (s.streak > s.bestStreak) s.bestStreak = s.streak;
      } else {
        s.streak = 0;
      }
      s.recent.push(isCorrect ? 1 : 0);
      if (s.recent.length > 20) s.recent.shift();
      if (unitId) {
        if (!s.units[unitId]) s.units[unitId] = { title: unitTitle || unitId, total: 0, correct: 0 };
        s.units[unitId].total += 1;
        if (isCorrect) s.units[unitId].correct += 1;
      }
      this.save(slug, s);
    }
  };

  function renderPerf(panel, curr, s) {
    const acc = s.total === 0 ? 0 : Math.round((s.correct / s.total) * 100);
    const ringRadius = 70;
    const ringCirc = 2 * Math.PI * ringRadius;
    const ringOffset = ringCirc - (acc / 100) * ringCirc;
    const ringColor = acc >= 80 ? '#16a34a' : acc >= 60 ? '#f59e0b' : acc >= 1 ? '#dc2626' : '#cbd5e1';
    const useGoldGrad = acc >= 1;

    const dots = (() => {
      const cells = [];
      for (let n = 0; n < 20; n++) {
        const v = s.recent[n];
        const cls = v === 1 ? 'dot correct' : v === 0 ? 'dot incorrect' : 'dot empty';
        cells.push(`<span class="${cls}"></span>`);
      }
      return cells.join('');
    })();

    // Mastery tiers — 4 levels visible per unit. Khan-Academy-style
    // progression target. Requires ≥4 attempts at the unit before any
    // tier shows (avoids "1/1 = 100%" looking like Gold).
    function masteryTier(correct, total) {
      if (total < 4) return null;
      const pct = correct / total;
      if (pct >= 0.9) return { name: 'Gold', glyph: '🥇' };
      if (pct >= 0.75) return { name: 'Silver', glyph: '🥈' };
      if (pct >= 0.5) return { name: 'Bronze', glyph: '🥉' };
      return null;
    }
    const unitRows = curr.units
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(u => {
        const us = s.units[u.id];
        if (!us || us.total === 0) {
          return `
            <div class="unit-row dim">
              <div class="unit-row-title">${escapeHtml(u.title)}</div>
              <div class="unit-row-bar"><div class="unit-row-fill" style="width:0%"></div></div>
              <div class="unit-row-pct">—</div>
            </div>`;
        }
        const pct = Math.round((us.correct / us.total) * 100);
        const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--accent)' : 'var(--error)';
        const tier = masteryTier(us.correct, us.total);
        const tierBadge = tier ? `<span class="unit-tier unit-tier--${tier.name.toLowerCase()}" title="${tier.name} mastery">${tier.glyph}</span>` : '';
        return `
          <div class="unit-row">
            <div class="unit-row-title">${escapeHtml(u.title)}${tierBadge}</div>
            <div class="unit-row-bar"><div class="unit-row-fill" style="width:${pct}%;background:${color};"></div></div>
            <div class="unit-row-pct">${us.correct}/${us.total}</div>
          </div>`;
      }).join('');

    panel.innerHTML = `
      <div class="perf-card">
        <div class="perf-title">Your performance</div>
        <div class="perf-ring-wrap">
          <svg class="perf-ring" viewBox="0 0 160 160" width="160" height="160">
            <defs>
              <linearGradient id="accuracyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fde68a"/>
                <stop offset="55%" stop-color="#fbbf24"/>
                <stop offset="100%" stop-color="#f59e0b"/>
              </linearGradient>
              <filter id="accuracyGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <circle cx="80" cy="80" r="${ringRadius}" stroke="rgba(255,255,255,0.08)" stroke-width="12" fill="none"/>
            <circle cx="80" cy="80" r="${ringRadius}" stroke="${useGoldGrad ? 'url(#accuracyGrad)' : ringColor}" stroke-width="12" fill="none"
                    stroke-dasharray="${ringCirc}" stroke-dashoffset="${ringOffset}"
                    stroke-linecap="round" transform="rotate(-90 80 80)"
                    filter="${useGoldGrad ? 'url(#accuracyGlow)' : ''}"
                    style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"/>
            <text class="accuracy-value" x="80" y="82" text-anchor="middle" font-size="38" font-weight="700">${acc}<tspan class="accuracy-suffix" font-size="22">%</tspan></text>
            <text class="accuracy-label" x="80" y="106" text-anchor="middle" font-size="11">accuracy</text>
          </svg>
        </div>
        <div class="perf-stats">
          <div class="stat"><div class="stat-num">${s.correct}</div><div class="stat-label">correct</div></div>
          <div class="stat"><div class="stat-num">${s.total}</div><div class="stat-label">answered</div></div>
          <div class="stat ${s.streak > 0 ? 'has-streak' : ''}"><div class="stat-num">${s.streak}${s.streak > 0 ? '<span class="streak-emoji">🔥</span>' : ''}</div><div class="stat-label">streak</div></div>
        </div>
      </div>

      <div class="perf-card">
        <div class="perf-section-title">Last 20 answers</div>
        <div class="recent-dots">${dots}</div>
      </div>

      <div class="perf-card">
        <div class="perf-section-title">Mastery by unit</div>
        <div class="unit-rows">${unitRows}</div>
      </div>
    `;
  }

  // Track time-on-task while the practice page is open & visible.
  if (window.STAARAuth && typeof window.STAARAuth.startHeartbeat === 'function') {
    window.STAARAuth.startHeartbeat();
  }
})();
