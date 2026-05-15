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

  // §83 — Correct-answer praise. Grade-band-aware varied praise that
  // replaces the bare ⭐ + truncated-explanation whisper with a short
  // encouragement line first. K-2 gets concrete short cheer; 3-5 gets
  // a touch more sophistication; 6+ gets understated factual praise.
  // No banned phrases from §15 — every line here is fresh.
  const CORRECT_PRAISE_K2 = [
    "You got it!",
    "Yes — that's it!",
    "Spot on!",
    "Nailed it!",
    "Way to go!",
    "You did it!",
    "Right on!",
    "Yes!",
    "Smart!",
    "Brilliant!"
  ];
  const CORRECT_PRAISE_35 = [
    "Nice thinking.",
    "You worked that out.",
    "Solid reasoning.",
    "Sharp.",
    "Cleanly done.",
    "You earned that one.",
    "Smart move.",
    "Bingo.",
    "Right where you needed to land.",
    "Read it well, answered it well."
  ];
  const CORRECT_PRAISE_6PLUS = [
    "Correct.",
    "Right.",
    "Cleanly solved.",
    "Nicely reasoned.",
    "Tight work.",
    "Locked in.",
    "Clean.",
    "Read that one well.",
    "On the nose.",
    "Got it."
  ];
  function pickCorrectPraise(gradeSlug) {
    const g = String(gradeSlug || '');
    if (g === 'grade-k' || g === 'grade-1' || g === 'grade-2') return pickRandom(CORRECT_PRAISE_K2);
    if (g === 'grade-3' || g === 'grade-4' || g === 'grade-5') return pickRandom(CORRECT_PRAISE_35);
    return pickRandom(CORRECT_PRAISE_6PLUS);
  }
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

  // §71 — Floating "+N pts" toast for correct answers. Slides in
  // top-right of viewport, holds 1800ms, slides out. Does NOT push
  // any content (position: fixed). Reuses .ge-pts-toast CSS in §71.
  // Replaces the inline "+5 pts earned" chip the old practice
  // surface rendered as part of the green-bordered correct card.
  function spawnPtsToast(cents) {
    try {
      const t = document.createElement('div');
      t.className = 'ge-pts-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      t.innerHTML = `<span class="ge-pts-toast-coin" aria-hidden="true">🪙</span><strong>+${cents} pts</strong>`;
      document.body.appendChild(t);
      // Force reflow then add .show so the slide-in animation fires
      requestAnimationFrame(() => t.classList.add('ge-pts-toast--show'));
      setTimeout(() => t.classList.remove('ge-pts-toast--show'), 1800);
      setTimeout(() => { try { t.remove(); } catch (_) {} }, 2100);
    } catch (_) {}
  }

  const root = document.getElementById('practice-root');
  const params = new URLSearchParams(location.search);

  // Wire achievement unlock toast. Fires whenever the kid earns a trophy
  // mid-session. Toast auto-dismisses after 4s; tap to navigate to the
  // trophy room.
  try {
    if (window.Achievements && typeof window.Achievements.onUnlock === 'function') {
      window.Achievements.onUnlock(function (ach) {
        try {
          const cents = (ach.reward && ach.reward.cents) || 0;
          const html = `<div class="achievement-toast-emoji" aria-hidden="true">${ach.emoji || '🏆'}</div>` +
            `<div>` +
              `<div class="achievement-toast-eyebrow">Trophy unlocked</div>` +
              `<div class="achievement-toast-name">${(ach.name || '').replace(/[<>]/g, '')}</div>` +
              `<div class="achievement-toast-desc">${(ach.description || '').replace(/[<>]/g, '')}</div>` +
              (cents > 0 ? `<div class="achievement-toast-cents">+${cents}¢ bonus</div>` : '') +
            `</div>`;
          const toast = document.createElement('div');
          toast.className = 'achievement-toast';
          toast.innerHTML = html;
          toast.addEventListener('click', () => { location.href = 'achievements.html'; });
          document.body.appendChild(toast);
          setTimeout(() => { try { toast.remove(); } catch (_) {} }, 4500);
          // Confetti for higher-tier trophies (gold + diamond)
          if (window.STAARFx && (ach.tier === 'gold' || ach.tier === 'diamond')) {
            try {
              window.STAARFx.confetti({ count: 120, duration: 2200 });
              window.STAARFx.playMilestone();
            } catch (_) {}
          }
        } catch (e) { console.warn('[ach toast]', e); }
      });
      // Initial check on load — catches unlocks that happened on a prior
      // page (e.g. a fact-seen on grade.html). No-op if everything's
      // already earned.
      window.Achievements._checkUnlocks();
    }
  } catch (_) {}

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
  const _LIVE_SUBJECTS = ['math', 'reading', 'science', 'social-studies'];
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
    // §69 (May 13) — STAAR countdown dropped from the practice surface.
    // "323 days to STAAR" was anxiety chrome above every question.
    // The asset is a great parent-acquisition hook — it belongs on
    // marketing / MySpace (when that lands), not above a kid mid-
    // session. countdownPill kept as an empty string so the template
    // string interpolation below doesn't error.
    let countdownPill = '';
    // §99 (May 15) — kid-comprehension pass on the top bar.
    //   - brand-star removed: it duplicates the points-pill star
    //     icon at 5px difference (Hamid 2:31 AM screenshot — kid sees
    //     two stars, can't tell which is what). Kid is already inside
    //     the app; logo isn't load-bearing here.
    //   - state/grade/subject pill row removed: "Grade 3 Math"
    //     already renders prominently in the slim header below
    //     (.practice-eyebrow-title). Redundant.
    //   - points-chip icon: 'target' glyph instead of ★ so it reads
    //     visually distinct from any star elsewhere.
    //   - kept: back arrow, points chip, ⋯ menu. Three things, all
    //     functional, none decorative.
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    const ptsChip = u
      ? `<a class="practice-pts-chip" href="myspace.html" aria-label="Your points">
           <span class="practice-pts-chip-icon" aria-hidden="true">
             <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>
           </span>
           <span class="practice-pts-chip-value">${Number(u.balanceCents || 0)}</span>
           <span class="practice-pts-chip-suffix">pts</span>
         </a>`
      : `<a class="practice-pts-chip practice-pts-chip--guest" href="index.html#auth" aria-label="Sign in">Sign in</a>`;
    const soundOn = !(window.STAARPrefs && window.STAARPrefs.get && window.STAARPrefs.get().sound === false);
    const userDisplay = u ? (u.displayName || u.username || '') : '';
    bar.innerHTML = `
      <nav class="practice-breadcrumb" aria-label="Practice context">
        <a class="practice-breadcrumb-back" href="${backHref}" aria-label="Back">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
        </a>
        <span class="practice-breadcrumb-title">${escapePcb(gradeName)} ${escapePcb(subjLabel)}</span>
        ${ptsChip}
        <button type="button" class="practice-breadcrumb-overflow" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
        </button>
        <div class="practice-breadcrumb-menu" role="menu" hidden>
          <button type="button" role="menuitem" class="practice-breadcrumb-menu-item" data-action="sound" aria-pressed="${soundOn ? 'true' : 'false'}">
            <span class="practice-breadcrumb-menu-ico" aria-hidden="true">${soundOn ? '🔊' : '🔇'}</span>
            <span class="practice-breadcrumb-menu-label">Sound</span>
            <span class="practice-breadcrumb-menu-state">${soundOn ? 'On' : 'Off'}</span>
          </button>
          <!-- §81 "Switch state" item removed 2026-05-14 — Texas-only
               product per memory rule (feedback_texas_only.md). The
               item was a no-op TODO; surfacing a "Switch state" menu
               item that always says "TX" with no other choices is
               affordance-pollution. If multi-state ever ships, this
               is the right home for the picker. -->
          <button type="button" role="menuitem" class="practice-breadcrumb-menu-item" data-action="progress">
            <span class="practice-breadcrumb-menu-ico" aria-hidden="true">📊</span>
            <span class="practice-breadcrumb-menu-label">Show progress</span>
          </button>
          <button type="button" role="menuitem" class="practice-breadcrumb-menu-item" data-action="restart">
            <span class="practice-breadcrumb-menu-ico" aria-hidden="true">↻</span>
            <span class="practice-breadcrumb-menu-label">Restart unit</span>
          </button>
          <button type="button" role="menuitem" class="practice-breadcrumb-menu-item" data-action="home">
            <span class="practice-breadcrumb-menu-ico" aria-hidden="true">🏠</span>
            <span class="practice-breadcrumb-menu-label">Exit to home</span>
          </button>
          ${u ? `<div class="practice-breadcrumb-menu-sep" role="separator"></div>
          <a role="menuitem" class="practice-breadcrumb-menu-item practice-breadcrumb-menu-item--user" href="myspace.html">
            <span class="practice-breadcrumb-menu-ico" aria-hidden="true">👤</span>
            <span class="practice-breadcrumb-menu-label">${escapePcb(userDisplay)}</span>
          </a>
          <button type="button" role="menuitem" class="practice-breadcrumb-menu-item" data-action="signout">
            <span class="practice-breadcrumb-menu-ico" aria-hidden="true">⎋</span>
            <span class="practice-breadcrumb-menu-label">Sign out</span>
          </button>` : ''}
        </div>
      </nav>
    `;
    document.title = `${STATE_INFO.testName} ${gradeName} ${subjLabel} — GradeEarn`;

    // Wire the overflow menu. Toggle on click, close on outside click,
    // close on Escape. Each action is routed below — restart still
    // delegates to the legacy #restart-btn so the existing confirm-
    // modal + reload flow fires unchanged.
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
          if (action === 'sound') {
            const prev = !(window.STAARPrefs && window.STAARPrefs.get && window.STAARPrefs.get().sound === false);
            const next = !prev;
            if (window.STAARPrefs && window.STAARPrefs.set) window.STAARPrefs.set({ sound: next });
            btn.setAttribute('aria-pressed', String(next));
            const ico = btn.querySelector('.practice-breadcrumb-menu-ico');
            const state = btn.querySelector('.practice-breadcrumb-menu-state');
            if (ico) ico.textContent = next ? '🔊' : '🔇';
            if (state) state.textContent = next ? 'On' : 'Off';
            return;
          }
          overflowBtn.setAttribute('aria-expanded', 'false');
          overflowMenu.hidden = true;
          if (action === 'restart') {
            const realBtn = document.getElementById('restart-btn');
            if (realBtn) realBtn.click();
          } else if (action === 'progress') {
            window.location.href = 'myspace.html';
          } else if (action === 'home') {
            window.location.href = 'index.html';
          } else if (action === 'signout') {
            // §94 — invoke the public auth signOut. Handles the
            // mid-practice confirm dialog (practice.html IS mid-
            // practice by definition) + clears session + redirects
            // to '/' which then re-renders unauthenticated state.
            try {
              if (window.STAARAuth && typeof window.STAARAuth.signOut === 'function') {
                window.STAARAuth.signOut();
              }
            } catch (_) {}
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

  // ---- Guest free-trial (May 10): 30 questions per (subject, grade)
  // so a visitor can poke around different areas and actually get a
  // feel for the product before being asked to sign up. Stored
  // per-bucket in localStorage so K-math and 3-reading have separate
  // counters — a parent evaluating the app shouldn't get locked out
  // of math after demoing reading.
  const GUEST_LIMIT = 30;
  const GUEST_KEY_PREFIX = 'staar.guest.answered';
  function guestBucketKey() {
    // Read the active subject + grade from the same params the page
    // already uses. Falls back to 'math' / 'unknown' so an unscoped
    // session still has a single counter.
    const g = (typeof slug === 'string' && slug) ? slug : (params.get('g') || 'unknown');
    const s = (typeof SUBJECT_SLUG === 'string' && SUBJECT_SLUG) ? SUBJECT_SLUG : (params.get('subj') || 'math');
    return `${GUEST_KEY_PREFIX}:${s}:${g}`;
  }
  function isGuest() {
    return !(window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser());
  }

  // §67 — Guest deterministic question set. For non-signed-in
  // visitors, cache the question IDs for this (subject, grade) on
  // first visit and replay the SAME set on every subsequent visit
  // (up to the 30-question cap). Two effects:
  //
  //   1. The "preview" is a real preview — a kid who comes back the
  //      next day sees the SAME 30 questions, so they feel the limit
  //      ("I've seen all this already") and convert to sign up.
  //   2. We don't burn lambda quota or AI tokens on returning guests.
  //
  // Cache stores the FULL question objects (not just IDs), keyed by
  // `staar.guest.qcache:<subject>:<grade>`. Capped at 30 entries to
  // match GUEST_LIMIT. Total size: ~25 buckets × ~50KB = ~1.2MB
  // worst case across all (subject, grade) combos — well under the
  // 5MB localStorage origin limit.
  function guestQCacheKey() {
    const g = (typeof slug === 'string' && slug) ? slug : (params.get('g') || 'unknown');
    const s = (typeof SUBJECT_SLUG === 'string' && SUBJECT_SLUG) ? SUBJECT_SLUG : (params.get('subj') || 'math');
    return `staar.guest.qcache:${s}:${g}`;
  }
  function loadGuestQCache() {
    try {
      const raw = localStorage.getItem(guestQCacheKey());
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.length ? arr : null;
    } catch (_) { return null; }
  }
  function saveGuestQCache(questions) {
    try {
      const trimmed = questions.slice(0, GUEST_LIMIT);
      localStorage.setItem(guestQCacheKey(), JSON.stringify(trimmed));
    } catch (_) { /* localStorage full or unavailable — quietly degrade to non-cached */ }
  }

  // §67 — Session points accumulator. Visible in the perf panel +
  // guest banner so the kid feels accumulated value during the test
  // (and, for guests, sees what they'd lose by closing the tab
  // without signing up). Resets each runQuiz session.
  window._sessionPoints = window._sessionPoints || 0;

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
    try { return parseInt(localStorage.getItem(guestBucketKey()), 10) || 0; } catch (_) { return 0; }
  }
  function guestIncrement() {
    try { localStorage.setItem(guestBucketKey(), String(guestCount() + 1)); } catch (_) {}
  }
  function guestRemaining() { return Math.max(0, GUEST_LIMIT - guestCount()); }
  function renderGuestBanner() {
    if (!isGuest()) {
      const old = document.getElementById('guest-banner');
      if (old) old.remove();
      document.body.classList.remove('has-guest-banner');
      return;
    }
    // §95 — per-session dismissal. sessionStorage so closing the
    // tab clears it; banner reappears on next visit. (NOT
    // localStorage — that would persist permanently and the kid
    // would never see the sign-up nudge again.)
    let dismissed = false;
    try { dismissed = sessionStorage.getItem('staar.guestBanner.dismissed') === '1'; } catch (_) {}
    if (dismissed) {
      const old = document.getElementById('guest-banner');
      if (old) old.remove();
      document.body.classList.remove('has-guest-banner');
      return;
    }

    let bar = document.getElementById('guest-banner');
    if (!bar) {
      // §95 — Khan-style fixed-top sticky banner. Was inline at
      // bottom of #practice-root (pushed content off the fold on
      // iPhone). Now: position:fixed at viewport top, ~44px tall,
      // mounted on document.body so it's not constrained by the
      // practice-root flow.
      bar = document.createElement('div');
      bar.id = 'guest-banner';
      bar.className = 'guest-banner';
      document.body.appendChild(bar);
    } else if (bar.parentNode !== document.body) {
      // Migrate any pre-§95 inline banner up to body so the fixed
      // positioning works.
      document.body.appendChild(bar);
    }
    document.body.classList.add('has-guest-banner');

    const remaining = guestRemaining();
    const pts = window._sessionPoints || 0;
    // §103 — consolidated guest banner. Was scarcity-only ("N of 30
    // free preview · X pts earned · Sign up →"); §94 polish spec
    // asked for a SECOND banner below the card with value messaging
    // ("save progress · earn cents toward toys"). Per §94 STEP 5
    // 'consolidate to ONE banner', the §95 sticky-top stays as the
    // single guest CTA but now combines both messages:
    //   - Lead: value pitch ("Save progress + earn toys")
    //   - Trail: scarcity count ("N of 30 free") so kids feel the
    //     bounded session
    //   - Pts-earned breadcrumb still shown when >0 (loss-aversion)
    bar.innerHTML = `
      <span class="guest-banner-count">Save progress + earn toys · <strong>${remaining} of ${GUEST_LIMIT} free</strong>${pts > 0 ? ` · <strong class="guest-banner-pts">${pts} pts earned</strong>` : ''}</span>
      <a href="#" class="guest-banner-cta" id="guest-signup-btn">Sign up &rarr;</a>
      <button type="button" class="guest-banner-dismiss" id="guest-banner-dismiss" aria-label="Dismiss">×</button>
    `;
    const btn = document.getElementById('guest-signup-btn');
    if (btn) btn.onclick = (e) => { e.preventDefault(); if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
    const dismissBtn = document.getElementById('guest-banner-dismiss');
    if (dismissBtn) dismissBtn.onclick = () => {
      try { sessionStorage.setItem('staar.guestBanner.dismissed', '1'); } catch (_) {}
      bar.remove();
      document.body.classList.remove('has-guest-banner');
    };
  }
  function maybeBlockGuest() {
    if (!isGuest()) return false;
    if (guestCount() < GUEST_LIMIT) return false;
    // Hit the cap: lock the practice area behind a sign-up wall.
    const root = document.getElementById('practice-root');
    if (root) {
      root.innerHTML = `
        <div class="card guest-cap-card" style="text-align:center;padding:32px 24px;max-width:560px;margin:24px auto;">
          <h2 style="margin:0 0 6px;font-size:1.55rem;">You used your 30 free questions 🎉</h2>
          <p style="color:rgba(255,255,255,0.65);margin:0 0 22px;font-size:0.95rem;">
            That was just one slice. Sign up free to unlock everything.
          </p>

          <ul class="guest-cap-bullets" style="text-align:left;display:inline-block;padding:0;margin:0 0 24px;list-style:none;max-width:420px;">
            <li style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;color:rgba(255,255,255,0.88);">
              <span style="color:#fbbf24;flex-shrink:0;font-size:1.05rem;line-height:1.3;">✓</span>
              <span><strong>100,000+ TEKS-aligned questions</strong> across K-8 + Algebra 1, Math &amp; Reading</span>
            </li>
            <li style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;color:rgba(255,255,255,0.88);">
              <span style="color:#fbbf24;flex-shrink:0;font-size:1.05rem;line-height:1.3;">✓</span>
              <span><strong>Built-in AI tutor</strong> on every wrong answer &mdash; explains, asks Socratic questions, never gives up</span>
            </li>
            <li style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;color:rgba(255,255,255,0.88);">
              <span style="color:#fbbf24;flex-shrink:0;font-size:1.05rem;line-height:1.3;">✓</span>
              <span><strong>Reading passages + comprehension</strong>, voice-record-yourself, vocabulary tap-to-define</span>
            </li>
            <li style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;color:rgba(255,255,255,0.88);">
              <span style="color:#fbbf24;flex-shrink:0;font-size:1.05rem;line-height:1.3;">✓</span>
              <span><strong>Real toys</strong> shipped to your door &mdash; kids earn points for correct answers and spend them in the marketplace</span>
            </li>
            <li style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;color:rgba(255,255,255,0.88);">
              <span style="color:#fbbf24;flex-shrink:0;font-size:1.05rem;line-height:1.3;">✓</span>
              <span><strong>Daily missions, streak shields, 66 trophies</strong> &mdash; progress saved on every device</span>
            </li>
          </ul>

          <p style="margin:0 0 18px;">
            <button type="button" class="btn btn-primary btn-primary--large" id="guest-cap-signup" style="min-width:240px;">Create your free account</button>
          </p>
          <p style="font-size:0.9rem;margin:0 0 6px;color:rgba(255,255,255,0.55);">
            <a href="#" id="guest-cap-signin" style="color:#fde68a;">Already have an account? Sign in</a>
          </p>
          <p style="font-size:0.78rem;color:rgba(255,255,255,0.45);margin:14px 0 0;">
            Free during beta · No credit card · Parent consent required
          </p>
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
  // Mock-STAAR-mode: ?mock=1 serves a full-length timed test with no
  // AI tutor (matches real test conditions). See startMockStaar().
  if (params.get('mock') === '1') {
    startMockStaar();
  } else if (params.get('review') === '1') {
    startReview();
  } else if (params.get('print') === '1') {
    startPrintWorksheet();
  } else if (SUBJECT_SLUG === 'reading') {
    startReading();
  } else if (SUBJECT_SLUG === 'science') {
    startScience();
  } else if (SUBJECT_SLUG === 'social-studies') {
    startSocialStudies();
  } else {
    fetch(`data/${slug}-curriculum.json?v=20260514a`)
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
    // §67 — for guests, restore the cached question set (if any) so
    // they see the SAME 30 on every visit. No AI enhancement either
    // — fresh content via lambda would defeat the "you've seen this"
    // psychology that drives signup.
    let initial;
    if (isGuest()) {
      const cached = loadGuestQCache();
      if (cached && cached.length) {
        initial = cached;
      } else {
        initial = buildInitialSet(questions);
        saveGuestQCache(initial);
      }
    } else {
      initial = buildInitialSet(questions);
    }
    runQuiz(curr, initial, lessonMeta, {
      enhance: isGuest()
        ? null  // §67 — guests get a fixed deterministic preview set; no lambda fresh content
        : (cb => fetchGeneratedAsync(curr, questions, lessonMeta, cb))
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
  // J3: when spaced-rep has overdue items, mix ~25% of them into the
  // session ahead of fresh unseen content. Kids see their weak topics
  // on the SM-2-flavored schedule (1d -> 3d -> 7d -> 14d -> 30d -> 60d).
  function buildInitialSet(pool) {
    const reqN = parseInt(params.get('n'), 10);
    const TARGET = [10, 25, 50, 100].includes(reqN) ? reqN : 25;
    const seen = loadSeen();
    const unseen = pool.filter(q => q.id && !seen.has(q.id));
    const seenPool = pool.filter(q => q.id && seen.has(q.id));
    const noId = pool.filter(q => !q.id);

    // Spaced-rep prepull: take overdue items first.
    const SR = window.GradeEarnSpacedRep;
    const dueIds = SR ? new Set(SR.getDueIds({ sort: 'most-overdue' })) : new Set();
    const due = pool.filter(q => q.id && dueIds.has(q.id));
    const dueSlots = Math.min(due.length, Math.floor(TARGET * 0.25));
    let merged = dueSlots > 0 ? due.slice(0, dueSlots) : [];

    // Fill remaining with unseen.
    const usedIds0 = new Set(merged.map(m => m.id));
    const unseenFreshLeft = unseen.filter(q => !usedIds0.has(q.id));
    const unseenSlots = TARGET - merged.length;
    merged = merged.concat(shuffle(unseenFreshLeft.slice()).slice(0, unseenSlots));

    // If everything's exhausted, recycle from the seen pool.
    if (merged.length === 0 && (seenPool.length || noId.length)) {
      try { localStorage.removeItem(seenKey()); } catch (_) {}
      showToast('Nice — you\u2019ve answered every question we have here! Recycling for review.');
      return shuffle(pool.slice()).slice(0, TARGET);
    }

    // Top up from seen if we still don't have enough.
    if (merged.length < TARGET) {
      const usedIds = new Set(merged.map(m => m.id));
      const filler = shuffle(seenPool.concat(noId).filter(q => !usedIds.has(q.id)));
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
      // Adaptive difficulty hint (rolling-30 accuracy). Sent as a soft
      // signal — lambda may use it to bias generated questions easier
      // or harder. Backwards-compatible: legacy lambda ignores unknown
      // fields. Hint values: 'easier' (< 60%), 'on-level' (60-85%),
      // 'harder' (> 85%). Pulls from per-user staar.stats.<grade>
      // recent-30 if available.
      let difficultyHint = 'on-level';
      try {
        const recent = computeRollingAccuracy(slug);
        if (recent && recent.n >= 10) {
          if (recent.pct < 60) difficultyHint = 'easier';
          else if (recent.pct > 85) difficultyHint = 'harder';
        }
      } catch (_) {}

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
          difficultyHint,
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
      let generated = (data.questions || []).map(g => normalizeGenerated(g, curr));
      // Unit-scope guardrail: when the kid picked a specific topic
      // (?u=<unitId>), drop any AI-generated question whose unit (by
      // title or by lesson TEKS) doesn't match the scoped unit. The
      // lambda is given a narrow topic-spec so it usually returns
      // matching items, but this is the belt-and-suspenders pass that
      // ensures "addition shows addition" — never a fraction question
      // sneaking into the addition queue.
      if (unitId && Array.isArray(curr.units)) {
        const scopedUnit = curr.units.find(u => u.id === unitId);
        if (scopedUnit) {
          const allowedTeks = new Set();
          (scopedUnit.lessons || []).forEach(l => { if (l.teks) allowedTeks.add(l.teks); });
          const allowedTitle = scopedUnit.title;
          const filtered = generated.filter(q => {
            const unitTitleMatch = q._unit && q._unit.title === allowedTitle;
            const teksMatch = q._lesson && q._lesson.teks && allowedTeks.has(q._lesson.teks);
            return unitTitleMatch || teksMatch;
          });
          if (filtered.length < generated.length) {
            console.info(`[unit-scope] dropped ${generated.length - filtered.length} of ${generated.length} generated questions outside scoped unit ${scopedUnit.title}`);
          }
          generated = filtered;
        }
      }
      if (generated.length) onReady(generated);
    } catch (_) { /* silently keep curriculum-only */ }
  }

  // Renamed from pickRandom to sampleN — was shadowing the earlier
  // single-element pickRandom at line ~72 and causing the comma-
  // joined "✗ Almost.,Off this time.,Close, but no.,Not this time.,
  // Not quite.,Worth another look." disaster on every wrong answer.
  // (Bug F per master audit.)
  function sampleN(arr, n) {
    return shuffle(arr.slice()).slice(0, n);
  }

  // Rolling-N accuracy from the kid's per-grade stats. Reads
  // staar.stats.<who>.<gradeSlug>.recent if available — the existing
  // Stats.record() writer keeps a rolling-30 trail of {ts, isCorrect}.
  // If trail is missing or short, returns null and the lambda treats
  // it as 'on-level'. This is a SOFT signal — it nudges generation
  // difficulty without blocking content.
  function computeRollingAccuracy(gradeSlug) {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      const who = (u && u.username) ? u.username : 'anon';
      const raw = localStorage.getItem(`staar.stats.${who}.${gradeSlug}`);
      if (!raw) return null;
      const stats = JSON.parse(raw);
      // Existing rolling trail (Stats.record at line ~3455) stores
      // 0/1 as integers, capped at 20. Use it as-is.
      const trail = Array.isArray(stats.recent) ? stats.recent : [];
      if (trail.length < 5) {
        const total = stats.totalAnswered || 0;
        const correct = stats.totalCorrect || 0;
        if (total < 5) return null;
        return { n: total, correct, pct: Math.round((correct / total) * 100) };
      }
      const correct = trail.filter(x => x === 1 || x === true || (x && x.isCorrect)).length;
      return { n: trail.length, correct, pct: Math.round((correct / trail.length) * 100) };
    } catch (_) { return null; }
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
    // §67 — reset session points each new runQuiz call. The kid's
    // accumulated pts during this session feeds the perf-panel tile
    // + the guest banner ("X pts earned · sign up to keep them").
    window._sessionPoints = 0;
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
    // §71 (May 13) — practice screen stripped to 7 elements. No
    // sidebar, no two-column grid. The <aside id="perf-panel"> stays
    // in the DOM (display:none in CSS) so the existing renderPerf
    // writes don't throw — but it never paints. All accuracy/stats/
    // mastery moves to MySpace in a follow-up prompt.
    root.innerHTML = `
      <div class="practice-layout practice-layout--solo">
        <div class="practice-main">
          ${lockedBanner}
          <!-- §99 — header redesign for kid comprehension. The prior
               .practice-eyebrow block was:
                 "Grade 3 Math · 1/25 · 4 correct · 12 pts [Restart]"
               + a near-empty progress bar.

               Replaced with a single "today line" that GROWS as the
               kid answers questions (emotionally additive vs the prior
               near-empty progress bar). Format:
                 "Question 4 today · 3 right so far 🔥"
               Streak emoji at ≥3 correct in a row (one 🔥), ≥7 (two),
               ≥12 (three).

               The 1/25 total counter, the progress bar, and the in-bar
               restart button are gone — restart already lives in the
               §81 ⋯ menu. -->
          <div class="practice-header practice-header--slim" data-q="1">
            <!-- §105 Phase 2 + 5 (May 15) — topic name + 4-char skill
                 ID + session-elapsed time chip. Sits above the
                 §99 today line. Populated by updateTopicLine() on
                 every question mount (topic may change between
                 questions in mixed mode). -->
            <div class="practice-topic-line" id="practice-topic-line" hidden>
              <span class="practice-topic-name" id="practice-topic-name"></span>
              <span class="practice-topic-sep" id="practice-topic-sep" hidden>·</span>
              <span class="practice-topic-id" id="practice-topic-id"></span>
              <span class="practice-topic-time" id="practice-topic-time"></span>
            </div>
            <div class="practice-today-line" id="practice-today-line">
              <span class="practice-today-q"><span id="progress-num">1</span> today</span>
              <span class="practice-today-sep practice-today-correctsep" hidden>·</span>
              <span class="practice-today-correct" id="practice-today-correct" hidden>
                <span id="practice-live-correct-num">0</span> right so far
              </span>
              <span class="practice-today-streak" id="practice-today-streak" aria-hidden="true" hidden></span>
              <!-- Live-pts span kept hidden for back-compat with the
                   updateLiveScore() writer (id is still queried). The
                   number is now surfaced inside the §99 Check answer
                   button instead. -->
              <span class="practice-today-live-pts" id="practice-live-pts" hidden><span id="practice-live-pts-num">0</span></span>
              <!-- Restart wrapper kept hidden for back-compat with the
                   ⋯ menu handler that programmatically clicks #restart-btn.
                   The visible Restart pill is gone; the ⋯ menu's Restart
                   unit item is the canonical entry. -->
              <span id="restart-wrap" class="practice-eyebrow-restart" hidden>
                <button type="button" class="btn-restart" id="restart-btn" title="Start over">
                  <span>Restart</span>
                </button>
              </span>
            </div>
          </div>
          <div id="qbox"></div>
          <div id="scratchpad-mount"></div>
        </div>
        <aside class="performance-panel" id="perf-panel" aria-hidden="true"></aside>
      </div>`;

    const qbox = document.getElementById('qbox');
    const bar = document.getElementById('bar');
    const barPulse = document.getElementById('bar-pulse');
    const progressNum = document.getElementById('progress-num');
    const perfPanel = document.getElementById('perf-panel');
    const restartBtn = document.getElementById('restart-btn');

    // Tier 7 AP: top-anchored stats pill. On phones the perf-panel is
    // hidden by default; a small top-right pill shows a live correct/total
    // summary, taps to slide the full panel down from the top.
    // Tap-outside or X button dismisses. Inserted once per session.
    if (!document.getElementById('mobile-stats-trigger')) {
      const trigger = document.createElement('button');
      trigger.id = 'mobile-stats-trigger';
      trigger.type = 'button';
      trigger.className = 'mobile-stats-trigger';
      trigger.innerHTML = '<span aria-hidden="true">📊</span><span class="mst-label">Stats</span>';
      trigger.setAttribute('aria-label', 'Show your stats');
      document.body.appendChild(trigger);
      // Refresh the pill label whenever perf-panel renders. Called from
      // inside renderPerf below — `s` is the per-session stats object
      // built by that function. Falls back to "Stats" pre-first-answer.
      window._refreshStatsPill = function (s) {
        try {
          if (!s) return;
          const total = s.total || 0;
          const correct = s.correct || 0;
          const streak = s.streak || 0;
          const label = trigger.querySelector('.mst-label');
          if (label) {
            label.textContent = total > 0
              ? `${correct}/${total}${streak > 1 ? ' · 🔥' + streak : ''}`
              : 'Stats';
          }
        } catch (_) {}
      };
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'mobile-stats-close';
      close.setAttribute('aria-label', 'Close stats');
      close.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="3" x2="11" y2="11"/><line x1="11" y1="3" x2="3" y2="11"/></svg>';
      perfPanel.appendChild(close);
      const closeDrawer = () => document.body.classList.remove('mobile-stats-open');
      trigger.addEventListener('click', () => document.body.classList.toggle('mobile-stats-open'));
      close.addEventListener('click', closeDrawer);
      // Tap on backdrop closes (the ::after pseudo-element catches taps
      // outside the panel; we listen on document instead since we can't
      // attach to a pseudo).
      document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('mobile-stats-open')) return;
        if (perfPanel.contains(e.target) || trigger.contains(e.target)) return;
        closeDrawer();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('mobile-stats-open')) closeDrawer();
      });
    }

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

      // §73 — fact card mounts cancel any in-flight question speech.
      try { if (window.Speech) window.Speech.stop(); } catch (_) {}

      // §71 — Fun Fact as a MODAL overlay (was inline card that pushed
      // question content). Native <dialog>. Mobile gets a bottom-sheet
      // treatment via CSS; desktop a centered card. The kid's question
      // stays exactly where it is, dimmed behind the backdrop.
      //
      // The category-emoji map (octopus/space/etc.) is dropped — kept
      // tripping content mismatches (octopus icon over chameleon fact
      // in user screenshot). One consistent bulb SVG for every fact.
      const welcomeHtml = isFirstFactEver
        ? '<div class="ff-card-welcome">Welcome to fun facts</div>'
        : '';
      const speakerHtml = (window.Speech && window.Speech._isSupported())
        ? `<button type="button" class="speech-btn ff-speech-btn" data-role="ff-speak" aria-label="Read aloud" aria-pressed="false">${SPEECH_ICON_HTML}</button>`
        : '';
      const card = document.createElement('dialog');
      card.className = 'practice-modal ff-modal';
      card.setAttribute('data-fact-id', fact.id);
      card.setAttribute('aria-label', 'Fun fact');
      card.innerHTML = `
        <div class="practice-modal-inner">
          ${speakerHtml}
          ${welcomeHtml}
          <div class="ff-modal-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 1 4 12.7c-.6.5-1 1.2-1 2v.3H9v-.3c0-.8-.4-1.5-1-2A7 7 0 0 1 12 2z"/></svg>
          </div>
          <div class="ff-modal-label" aria-hidden="true">Fun fact</div>
          <div class="ff-modal-body">${escapeHtml(fact.fact || '')}</div>
          <button type="button" class="ff-modal-cta" data-act="ff-got-it">Got it!</button>
        </div>
      `;
      document.body.appendChild(card);
      try { card.showModal(); } catch (_) {
        // Fallback for ancient browsers without <dialog>: render as
        // a flex-overlay so the kid isn't stuck.
        card.setAttribute('open', '');
        card.style.position = 'fixed';
        card.style.inset = '0';
        card.style.zIndex = '200';
      }
      // §71 — backdrop click on MOBILE only (per spec — desktop
      // backdrop click is too easy to misfire). 768px breakpoint.
      card.addEventListener('click', (e) => {
        if (e.target !== card) return; // only fire on the backdrop itself
        if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
          const cta = card.querySelector('[data-act="ff-got-it"]');
          if (cta) cta.click();
        }
      });

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
          // Achievements: track each fact viewed for "fact collector" trophies
          try {
            if (window.Achievements && typeof window.Achievements.track === 'function') {
              window.Achievements.track('fact-seen', { factId: fact.id });
              window.Achievements.bumpDailyMission('fact', 1);
            }
          } catch (_) {}
        } catch (_) {}
        if (window._stAutoAdvance) {
          try { clearTimeout(window._stAutoAdvance); } catch (_) {}
          window._stAutoAdvance = null;
        }
        // §71 — close + remove the dialog before advancing so the
        // backdrop disappears cleanly (was inline card → DOM removal
        // happened naturally via qbox.innerHTML reset; dialog needs
        // explicit close + remove).
        try {
          if (typeof card.close === 'function') card.close();
        } catch (_) {}
        try { card.remove(); } catch (_) {}
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
      // Tier 5 Y — runtime grammar fix for lambda-generated content.
      // Static curriculum was scrubbed in Bug A but on-demand generation
      // can still emit "1 pencils". GETextUtils corrects it at render.
      if (window.GETextUtils && q.contentId) {
        if (q.prompt) q.prompt = window.GETextUtils.fixCountAgreement(q.prompt);
        if (q.explanation) q.explanation = window.GETextUtils.fixCountAgreement(q.explanation);
        if (Array.isArray(q.choices)) {
          q.choices = q.choices.map(function (c) {
            return typeof c === 'string' ? window.GETextUtils.fixCountAgreement(c) : c;
          });
        }
      }
      qbox.innerHTML = renderQuestion(q, isLocked, i, questions.length);
      // §98 — scroll the question stem into view on every new mount
      // (initial load + Next tap). Was gated to i>0; spec says always.
      // The original guard was "only if not already near top"; preserve
      // that to avoid jitter when the page already opens at top.
      try {
        const rect = qbox.getBoundingClientRect();
        if (rect.top < 0 || rect.top > window.innerHeight * 0.5) {
          qbox.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (_) {}
      // §105 Phase 2 + 5 — topic name + skill ID + time chip refresh
      try { updateTopicLine(q); } catch (_) {}
      // §105 Phase 6 — trouble-spot banner check (renders if streak ≥ 3
      // AND not currently in a dismissal-suppression window).
      try { maybeShowTroubleSpot(i); } catch (_) {}
      attachQuestionHandlers(q);
      // §98 — install IntersectionObserver indicator chip so kids on
      // long-content questions (Reading passages, Grade 8 Science
      // multi-sentence answers, multi-step word problems) get a
      // visible "↓ Scroll to check answer" affordance when the
      // in-flow button is below the fold. Mobile-only (CSS hides
      // .q-cta-indicator at >=768px).
      try { installCtaIndicator(qbox); } catch (_) {}
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

    // ============================================================
    // §105 — Phase 2 (skill ID) + Phase 5 (time chip) + Phase 6
    // (trouble-spot empathy banner)
    // ============================================================
    const STOPWORDS_4ID = new Set([
      'to','of','the','a','an','in','on','and','or','for','with',
      'from','at','by','as','is','are','be'
    ]);
    function computeSkillId(gradeSlug, topicName) {
      let gradePart = '';
      if (gradeSlug === 'grade-k') gradePart = 'K';
      else if (gradeSlug === 'algebra-1') gradePart = 'A1';
      else if (gradeSlug && gradeSlug.startsWith('grade-')) gradePart = gradeSlug.slice(6);
      else gradePart = (gradeSlug || '').toUpperCase().slice(0, 2);
      if (!topicName) return gradePart;
      const tokens = String(topicName).split(/[\s\-—]+/).filter(t => /[a-z0-9]/i.test(t));
      const significant = tokens.filter(t => !STOPWORDS_4ID.has(t.toLowerCase()));
      let abbr = significant.map(t => t[0].toUpperCase()).join('');
      // If only one significant word: take 3-letter consonant-rich slice.
      if (significant.length === 1) {
        const w = significant[0].toUpperCase();
        const consonants = w.replace(/[^BCDFGHJKLMNPQRSTVWXZ]/g, '');
        abbr = (consonants.length >= 3 ? consonants.slice(0, 3) : w.slice(0, 3));
      } else if (abbr.length < 3 && significant[0]) {
        const consonants = significant[0].slice(1).replace(/[^bcdfghjklmnpqrstvwxz]/gi, '').toUpperCase();
        abbr = (abbr + consonants).slice(0, 4 - gradePart.length);
      }
      return (gradePart + abbr).slice(0, 5); // cap total length
    }

    // §105 Phase 5 — session timer. Starts on first paint of the
    // practice surface; resets when kid leaves + re-enters.
    let _practiceStartedAt = null;
    let _timeChipInterval = null;
    function fmtElapsed(ms) {
      const total = Math.floor(ms / 1000);
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
      return `${m}:${String(s).padStart(2,'0')}`;
    }
    function updateTimeChip() {
      const el = document.getElementById('practice-topic-time');
      if (!el || !_practiceStartedAt) return;
      el.textContent = '⏱ ' + fmtElapsed(Date.now() - _practiceStartedAt);
    }

    // §105 Phase 2 — populate the topic-line on every new question
    // mount. Hidden when no _unit.title is present (math without a
    // topic context; reading without a passage; etc).
    function updateTopicLine(q) {
      const row = document.getElementById('practice-topic-line');
      const nameEl = document.getElementById('practice-topic-name');
      const idEl = document.getElementById('practice-topic-id');
      const sepEl = document.getElementById('practice-topic-sep');
      const timeEl = document.getElementById('practice-topic-time');
      if (!row) return;
      const topicName = (q && q._unit && q._unit.title) ? String(q._unit.title) : '';
      const skillId = computeSkillId(slug, topicName);
      if (!topicName && !skillId) { row.hidden = true; return; }
      row.hidden = false;
      if (nameEl) nameEl.textContent = topicName || '';
      if (idEl)   idEl.textContent   = skillId || '';
      if (sepEl)  sepEl.hidden = !(topicName && skillId);
      // Start the session timer on first call.
      if (!_practiceStartedAt) {
        _practiceStartedAt = Date.now();
        if (timeEl) timeEl.textContent = '⏱ 0:00';
        if (_timeChipInterval) clearInterval(_timeChipInterval);
        _timeChipInterval = setInterval(updateTimeChip, 1000);
      } else {
        updateTimeChip();
      }
    }

    // §105 Phase 6 — trouble-spot empathy banner. Surfaces when the
    // kid has 3 wrong in a row on the current topic. Dismissable for
    // the next 5 questions (suppressDismissedUntil = current question
    // index + 5). The full "Show example" interaction lands when
    // Phase 3 ships; for now the banner is empathetic copy + dismiss
    // so the kid feels seen but isn't promised a feature that
    // doesn't exist yet.
    let _troubleDismissedUntilIdx = -1;
    function maybeShowTroubleSpot(qIndex) {
      const card = document.querySelector('.question-card[data-state="asking"]');
      if (!card) return;
      // Already-rendered banner — bail (avoid double-paint on re-render).
      if (card.querySelector('.q-trouble-banner')) return;
      const wrong = window._stWrongStreak || 0;
      if (wrong < 3) return;
      if (typeof qIndex === 'number' && qIndex < _troubleDismissedUntilIdx) return;
      const banner = document.createElement('div');
      banner.className = 'q-trouble-banner';
      banner.setAttribute('role', 'status');
      banner.innerHTML = `
        <span class="q-trouble-banner-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><polygon points="12 2 15 8 21 9 17 14 18 21 12 18 6 21 7 14 3 9 9 8"/></svg>
        </span>
        <span class="q-trouble-banner-text">Lumen noticed you might be stuck. Take your time — you've got this.</span>
        <button type="button" class="q-trouble-banner-dismiss" aria-label="Dismiss">×</button>
      `;
      // Mount above the question prompt so the kid sees encouragement
      // BEFORE re-reading the next question.
      const prompt = card.querySelector('.q-prompt');
      if (prompt && prompt.parentNode) {
        prompt.parentNode.insertBefore(banner, prompt);
      } else {
        card.insertBefore(banner, card.firstChild);
      }
      const dismiss = banner.querySelector('.q-trouble-banner-dismiss');
      if (dismiss) dismiss.addEventListener('click', () => {
        _troubleDismissedUntilIdx = (typeof qIndex === 'number' ? qIndex : 0) + 5;
        banner.remove();
      });
    }

    // §98 — IntersectionObserver-driven scroll indicator. Single
    // shared observer; re-targeted on each new question mount.
    // Pattern matches js/facts.js#io for consistency.
    let _ctaObserver = null;
    function installCtaIndicator(scope) {
      // Reset prior observation
      if (_ctaObserver) {
        try { _ctaObserver.disconnect(); } catch (_) {}
        _ctaObserver = null;
      }
      // Phone only — at >=768px the CSS hides .q-cta-indicator entirely,
      // and natural desktop scroll is sufficient. Bail to avoid
      // installing a no-op observer.
      if (window.innerWidth >= 768) return;

      // Find the primary action button (asking → q-cta; wrong → first
      // button in .q-wrong-actions). One of them is always present
      // post-renderQuestion.
      const target = scope.querySelector('.q-cta')
        || scope.querySelector('.q-wrong-actions .btn-primary')
        || scope.querySelector('.q-wrong-next');
      if (!target) return;

      // Build (or reuse) the floating indicator chip mounted on body
      // so position:fixed isn't constrained by ancestor overflow.
      let chip = document.getElementById('q-cta-indicator');
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.id = 'q-cta-indicator';
        chip.className = 'q-cta-indicator';
        chip.setAttribute('aria-label', 'Scroll to action button');
        chip.innerHTML = '<span class="q-cta-indicator-arrow" aria-hidden="true">↓</span><span class="q-cta-indicator-label"></span>';
        document.body.appendChild(chip);
        chip.addEventListener('click', () => {
          const t = chip._target;
          if (!t) return;
          try {
            t.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } catch (_) {}
        });
      }
      chip._target = target;
      // Label by state: asking → "Scroll to check answer";
      // wrong/correct → "Scroll to next".
      const labelEl = chip.querySelector('.q-cta-indicator-label');
      if (labelEl) {
        const isAsking = !!scope.querySelector('.question-card[data-state="asking"]');
        labelEl.textContent = isAsking ? ' Scroll to check answer' : ' Scroll to next';
      }
      // Reset visibility before observing — the prior question's chip
      // state shouldn't bleed into the new one.
      chip.classList.remove('visible');

      _ctaObserver = new IntersectionObserver((entries) => {
        entries.forEach((e) => {
          // Visible (intersecting ≥50%) → hide chip; offscreen → show.
          if (e.isIntersecting) chip.classList.remove('visible');
          else chip.classList.add('visible');
        });
      }, {
        root: null, // viewport
        rootMargin: '0px 0px -16px 0px',
        threshold: 0.5,
      });
      _ctaObserver.observe(target);
    }

    function attachQuestionHandlers(q) {
      const form = qbox.querySelector('form');
      // K7: keyboard nav. Press 1-4 (or A-D) to pick the choice. Enter
      // submits the form. Skip when an input is focused (kid is typing
      // a free-text follow-up to the AI tutor, etc.). Per-question; not
      // attached when there's no form (review-mode list is the same shape).
      if (form && q.type === 'multiple_choice' && Array.isArray(q.choices)) {
        const onKey = (e) => {
          // Skip if user is typing in any input/textarea
          const t = e.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
            // Allow on radios (those are choices) but not on text inputs.
            if (t.type !== 'radio') return;
          }
          // Skip if any modal is open
          if (document.querySelector('.modal-overlay, .qs-overlay')) return;
          let idx = -1;
          if (e.key >= '1' && e.key <= '6') idx = parseInt(e.key, 10) - 1;
          else if (/^[a-fA-F]$/.test(e.key)) idx = e.key.toUpperCase().charCodeAt(0) - 65;
          if (idx >= 0 && idx < q.choices.length) {
            const radios = form.querySelectorAll('input[name="ans"]');
            if (radios[idx]) {
              radios[idx].checked = true;
              radios[idx].focus();
              e.preventDefault();
            }
          }
        };
        document.addEventListener('keydown', onKey);
        // Detach when the question advances (qbox is rewritten on next).
        const observer = new MutationObserver(() => {
          if (!qbox.contains(form)) {
            document.removeEventListener('keydown', onKey);
            observer.disconnect();
          }
        });
        observer.observe(qbox, { childList: true, subtree: true });
      }
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
        // Tier 6 AE — mount voice recorder slot (kid records reading aloud).
        const voiceSlot = passageCard.querySelector('[data-role="voice-mount"]');
        if (voiceSlot && window.GEVoice && window.GEVoice.supported()) {
          try {
            // Destroy any prior mount to release mic + revoke blob URLs
            // when the kid moves to the next question.
            if (window._voiceMountController && typeof window._voiceMountController.destroy === 'function') {
              window._voiceMountController.destroy();
            }
            window._voiceMountController = window.GEVoice.mount(voiceSlot, { maxDurationSec: 90 });
          } catch (e) { console.warn('[voice-recorder]', e); }
        }
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
      // §103 — wire the inline scratch button to STAARScratchpad.toggle().
      // The floating bottom-right pencil is suppressed on practice.html
      // by CSS (see styles.css §103 block); this inline button is the
      // canonical entry point.
      const scratchBtnEl = qbox.querySelector('[data-act="scratch"]');
      if (scratchBtnEl && window.STAARScratchpad && typeof window.STAARScratchpad.toggle === 'function') {
        scratchBtnEl.addEventListener('click', () => {
          try { window.STAARScratchpad.toggle(); } catch (_) {}
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
          if (_streak > (window._stMaxCorrectStreak || 0)) {
            window._stMaxCorrectStreak = _streak;
          }
          // §105 Phase 6 — reset wrong-streak on any correct so the
          // trouble-spot banner doesn't surface mid-recovery.
          window._stWrongStreak = 0;
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
          // §105 Phase 6 — bump wrong-streak for trouble-spot
          // detection on the NEXT question render.
          window._stWrongStreak = (window._stWrongStreak || 0) + 1;
        }
        Stats.record(slug, stats, { unitId: q._unit?.id, unitTitle: q._unit?.title, isCorrect });
        // Achievements: track every answer + bump multi-task daily quest.
        try {
          if (window.Achievements && typeof window.Achievements.track === 'function') {
            window.Achievements.track('answer', {
              isCorrect,
              subject: SUBJECT_SLUG,
              unitId: q._unit?.id || null
            });
            if (isCorrect) {
              // Counts toward the "answer N correctly" task
              window.Achievements.bumpDailyMission('correct', 1);
              // In-session streak counts toward "get N in a row" task
              const streak = window._stCorrectStreak || 0;
              if (streak >= 2) {
                // bump to current streak value — task tracks max-in-a-row
                window.Achievements.bumpDailyMission('streak', 1);
              }
            }
            // Trying any topic counts toward the "try a topic" task once
            // per session (idempotent because the task has target=1).
            if (q._unit?.id && !window._stTopicTriedTracked) {
              window._stTopicTriedTracked = true;
              window.Achievements.bumpDailyMission('topic', 1);
            }
          }
        } catch (_) {}
        // J3 spaced-rep: schedule per-question review. Wrong → re-due in
        // 24h. Correct after a prior wrong → bump interval (3d → 7d → ...).
        // Correct without prior wrong → no entry, no scheduling needed.
        try {
          if (window.GradeEarnSpacedRep && q.id) {
            window.GradeEarnSpacedRep.record(q.id, isCorrect);
          }
        } catch (_) {}
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
      // §67 — bump session points on correct. Powers both the
      // perf-panel "+pts" tile and the guest-banner "X pts earned"
      // pressure line. _refreshSessionPts is wired by renderPerf.
      if (isCorrect && cents > 0) {
        window._sessionPoints = (window._sessionPoints || 0) + cents;
        try { if (typeof window._refreshSessionPts === 'function') window._refreshSessionPts(); } catch (_) {}
        try { renderGuestBanner(); } catch (_) {}
      }
      // §99 — today line update. The §74 two-pill strip became the
      // §99 single-line "Question N today · X right so far {🔥}". Same
      // `correct` closure as before, plus a running-streak emoji
      // (3+ → 🔥, 7+ → 🔥🔥, 12+ → 🔥🔥🔥). Streak resets on wrong
      // (handled below via the closure-local `_streak` counter).
      try {
        const liveCorrect    = document.getElementById('practice-live-correct');
        const liveCorrectNum = document.getElementById('practice-live-correct-num');
        const livePtsNum     = document.getElementById('practice-live-pts-num');
        const correctSep     = document.querySelector('.practice-today-correctsep');
        const streakEl       = document.getElementById('practice-today-streak');
        if (liveCorrectNum) liveCorrectNum.textContent = correct;
        if (livePtsNum)     livePtsNum.textContent = (window._sessionPoints || 0);
        if (liveCorrect)    liveCorrect.hidden = false;
        if (correctSep)     correctSep.hidden = false;
        // Streak emoji — read window._stCorrectStreak which is the
        // global running-streak counter maintained at line ~1803
        // (incremented on correct, reset to 0 on wrong).
        if (streakEl) {
          const s = window._stCorrectStreak || 0;
          let fire = '';
          if (s >= 12) fire = '🔥🔥🔥';
          else if (s >= 7) fire = '🔥🔥';
          else if (s >= 3) fire = '🔥';
          streakEl.textContent = fire;
          streakEl.hidden = !fire;
        }
      } catch (_) {}
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
          // §71 — split the old single-row "+5 pts earned · explanation"
          // into TWO surfaces:
          //   (a) a floating "+N pts" toast that slides in top-right,
          //       holds, slides out — does NOT push content
          //   (b) a one-line whisper-style explanation above the
          //       sticky action bar — small star icon + tutor's
          //       first sentence, truncated at 80 chars
          // The card-with-green-border chrome is gone.
          if (cents > 0) spawnPtsToast(cents);
          // §83 — varied praise line + the existing whisper-style
          // explanation. Praise is band-aware (K-2 cheerful, 3-5
          // mid-range, 6+ understated) and picked fresh from a
          // small dictionary each time so kids don't see the same
          // line back-to-back. Sits ABOVE the whisper so the
          // encouragement reads first, then the why.
          const praise = pickCorrectPraise(slug);
          const praiseLine = `<div class="q-correct-praise" role="status">${escapeHtml(praise)}</div>`;
          const whisper = (() => {
            if (!explanation) return '';
            const truncated = explanation.length > 80
              ? explanation.slice(0, 78).trimEnd() + '…'
              : explanation;
            return `<div class="q-correct-whisper"><span class="q-correct-whisper-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><polygon points="12 2 15 8 21 9 17 14 18 21 12 18 6 21 7 14 3 9 9 8"/></svg></span> <span class="q-correct-whisper-text">${escapeHtml(truncated)}</span></div>`;
          })();
          fbSlot.innerHTML = praiseLine + whisper;
          fbSlot.classList.remove('q-inline-fb--tutor');
        } else {
          // §68 — COMPRESSED wrong-answer view. The old layout injected
          // ~10 elements (header + equation reveal + Lumen badge +
          // tutor paragraphs + 5 action buttons + follow-up input +
          // breadcrumb) pushing Next below the fold on every wrong
          // answer. New default view: ONE inline tutor line + 2
          // buttons. Full dialogue + chips + follow-up live inside
          // the [Explain more] expansion below.
          //
          // Tile visual states (CSS-driven via data-attrs on the form):
          //   correct tile  → green border + check + green tint
          //   picked-wrong  → red border + X + red tint + 'your pick' (K-2)
          //   others        → 0.5 opacity
          const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
          const correctIdx = q.choices ? q.choices.indexOf(q.answer) : -1;
          const userAnswerStr = userAnswer != null ? String(userAnswer) : '';
          const pickedIdx = q.choices ? q.choices.indexOf(userAnswerStr) : -1;
          if (qCard) {
            if (correctIdx >= 0) qCard.dataset.correctLetter = LETTERS[correctIdx] || '';
            if (pickedIdx >= 0)  qCard.dataset.pickedLetter  = LETTERS[pickedIdx]  || '';
          }

          // K/1/2 only: append a small "· your pick" caption to the
          // wrong tile. Grade 3+ finds it condescending; younger kids
          // benefit from explicit labels (per §68 A3).
          const gradeBand = (typeof slug === 'string') ? slug : '';
          const isYounger = gradeBand === 'grade-k' || gradeBand === 'grade-1' || gradeBand === 'grade-2';
          if (isYounger && pickedIdx >= 0 && qCard) {
            const pickedTile = qCard.querySelector(`.choice[data-letter="${LETTERS[pickedIdx]}"] .choice-content`);
            if (pickedTile && !pickedTile.querySelector('.choice-yourpick')) {
              pickedTile.insertAdjacentHTML('beforeend', '<span class="choice-yourpick"> · your pick</span>');
            }
          }

          // Inline tutor line: starts with the stored explanation's
          // first sentence as the immediate fallback. When the AI
          // tutor's reply arrives (fireInitialTutor below), the line
          // is replaced with the tutor's first sentence.
          const explanationFirst = (() => {
            const sentences = explanation.split(/(?<=[.!?])\s+/);
            return sentences[0] || 'Take another look at this one.';
          })();
          // §93b — drop the inline "Next question" button from the
          // tutor card. The standalone .q-cta below (replaced via
          // checkBtn.replaceWith() further down) is the canonical
          // primary action across all states; an inline duplicate
          // gave kids two affordances for the same job ~80px apart.
          // .q-wrong-actions retains the single secondary action
          // [Explain more].
          fbSlot.innerHTML = `
            <p class="q-wrong-tutor-line" role="status">
              <span class="q-wrong-tutor-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><polygon points="12 2 15 8 21 9 17 14 18 21 12 18 6 21 7 14 3 9 9 8"/></svg>
              </span>
              <span id="q-wrong-tutor-text">${escapeHtml(explanationFirst)}</span>
            </p>
            <div class="q-wrong-actions">
              <button type="button" class="q-wrong-explain" data-act="explain-more" aria-expanded="false" aria-controls="q-wrong-expand">Explain more</button>
            </div>
            <div class="q-wrong-expand" id="q-wrong-expand" hidden>
              <div class="tutor-box" id="tutor-box">
                <div class="tutor-output" id="tutor-out" aria-live="polite" aria-atomic="false"></div>
              </div>
              ${q.contentId && q.poolKey ? `<button type="button" class="q-report-link" data-act="report" data-cid="${escapeHtml(q.contentId)}" data-pk="${escapeHtml(q.poolKey)}" aria-label="Report this question">Question seems wrong? Report it.</button>` : ''}
            </div>`;
          fbSlot.classList.remove('q-inline-fb--tutor');

          // Wire the [Explain more] toggle. Expanding adds a body
          // class that dims the perf sidebar (§68 A2). The
          // follow-up input + 3 chips already live inside the
          // expand container thanks to the tutor-box being there;
          // fireInitialTutor() mounts them after the first
          // successful tutor reply.
          const explainBtn = fbSlot.querySelector('[data-act="explain-more"]');
          const expandEl   = fbSlot.querySelector('#q-wrong-expand');
          if (explainBtn && expandEl) {
            explainBtn.addEventListener('click', () => {
              const isOpen = explainBtn.getAttribute('aria-expanded') === 'true';
              if (isOpen) {
                expandEl.hidden = true;
                explainBtn.setAttribute('aria-expanded', 'false');
                explainBtn.textContent = 'Explain more';
                document.body.classList.remove('q-wrong-expanded');
              } else {
                expandEl.hidden = false;
                explainBtn.setAttribute('aria-expanded', 'true');
                explainBtn.textContent = 'Hide';
                document.body.classList.add('q-wrong-expanded');
                const input = expandEl.querySelector('#tutor-q');
                if (input) setTimeout(() => { try { input.focus(); } catch (_) {} }, 220);
              }
            });
          }
        }
        fbSlot.hidden = false;

        // K3: report-this-question wiring. POSTs reportContent to the
        // lambda so we capture the kid's flag. Auth required; guests
        // get a sign-in prompt. One-shot per question (button removes
        // itself after click).
        const reportBtn = fbSlot.querySelector('[data-act="report"]');
        if (reportBtn) {
          reportBtn.addEventListener('click', async () => {
            const auth = window.STAARAuth;
            if (!auth || !auth.token || !auth.token()) {
              showToast('Sign in to report a question.');
              if (auth && auth.showLogin) auth.showLogin();
              return;
            }
            reportBtn.disabled = true;
            reportBtn.textContent = 'Reporting…';
            try {
              await fetch(TUTOR_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  action: 'reportContent',
                  token: auth.token(),
                  contentId: reportBtn.dataset.cid,
                  poolKey: reportBtn.dataset.pk,
                  reason: 'kid-flagged-wrong-or-confusing'
                })
              });
              reportBtn.outerHTML = '<span class="q-report-thanks">✓ Thanks — we’ll review.</span>';
            } catch (_) {
              reportBtn.disabled = false;
              reportBtn.textContent = 'Report failed — try again later';
            }
          });
        }
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

          // §75 (May 13) — Fun Facts removed from the practice flow.
          // User feedback: "Remove fun facts and put it as a separate
          // area under each subject." The every-5-correct trigger was
          // a context-break; kids hunting points didn't want fact
          // cards interrupting flow. Facts now live at /facts.html
          // as a browsable feed (subject- + age-filtered). The
          // catalog stays loaded on this page for backward compat
          // but no longer mounts. mountFunFactCard is dead code
          // (preserved one section below until next cleanup pass).
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
      // §98 — re-target the scroll-indicator at the new wrong-state
      // primary action (the .q-wrong-next button OR the replaced
      // .q-cta Next button above). The asking-state observer was
      // pointing at the now-gone Check answer button.
      try { installCtaIndicator(qbox); } catch (_) {}

      // §94 — old .q-meta footer is gone (was at bottom of card,
      // buried below Check answer). Topic + reward now render as a
      // .q-card-eyebrow at the TOP of the card, before the question
      // stem. The eyebrow stays static through the answer state —
      // kid keeps topic context throughout. No mutation needed
      // here.

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
          // §68 — clear sidebar-dim body class before advancing
          document.body.classList.remove('q-wrong-expanded');
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

        // Shared follow-up runner. Used by both chip clicks and the
        // free-text form submit. Bypasses the previous dispatchEvent
        // dance — synthetic submit events were unreliable on some
        // mobile browsers and the chips appeared dead. Direct call
        // keeps the flow visible (loading dots show immediately) and
        // testable.
        const submitFollowup = async (text) => {
          const t = String(text || '').trim();
          if (!t) return;
          if (tutorQ) tutorQ.value = '';
          // Remove any prior chip group so we don't double up.
          tutorOut.querySelector('.tutor-suggestions')?.remove();
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg user"><strong>You:</strong> ${escapeHtml(t)}</div>`);
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg loading">${thinkingHTML()}</div>`);
          const result = await runTutor(t, false);
          tutorOut.querySelector('.tutor-msg.loading')?.remove();
          if (result.aborted) return;
          if (result.error) {
            tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg assistant error">Try again in a moment.</div>`);
            return;
          }
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg assistant">${formatTutor(result.reply)}</div>`);
          renderChips();
        };

        // \u00a769 \u2014 mount the follow-up form + chips only after the
        // tutor's first successful reply. Markup matches the
        // previous pre-rendered version; just deferred to success.
        function mountTutorInputs() {
          if (followup) return; // idempotent
          // \u00a768 \u2014 the old form used a flex row but the send button
          // floated free of the input visually (CSS bug visible in
          // user screenshot: yellow square detached from the input
          // row). Fix: explicit single row container with input
          // (flex: 1 + min-width: 0) and a small icon button (32px,
          // flex-shrink: 0). Both rules in the \u00a768 CSS block. The
          // `tutor-followup--row` modifier scopes the new geometry
          // so the old `.tutor-followup` rules don't override.
          tutorBox.insertAdjacentHTML('beforeend', `
            <form class="tutor-followup tutor-followup--row" id="tutor-followup">
              <input type="text" id="tutor-q" placeholder="Ask a follow-up\u2026" autocomplete="off" />
              <button class="tutor-send" type="submit" aria-label="Send" title="Send">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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
          // §68 — surface the tutor's first sentence as the inline
          // "★ ..." line outside the expand panel. The kid sees a
          // real AI hint without expanding anything; the rest of the
          // dialogue lives inside Explain More.
          try {
            const inlineEl = document.getElementById('q-wrong-tutor-text');
            if (inlineEl && result.reply) {
              const plain = String(result.reply).replace(/<[^>]*>/g, '');
              const firstSentence = (plain.split(/(?<=[.!?])\s+/)[0] || plain).trim();
              if (firstSentence) inlineEl.textContent = firstSentence;
            }
          } catch (_) {}
        }

        // Auto-fire the tutor as soon as the wrong-answer panel renders.
        // The stored explanation above is the immediate fallback the kid
        // can already read while this call is in flight.
        fireInitialTutor();

        async function onFollowupSubmit(e) {
          e.preventDefault();
          if (!tutorQ) return;
          await submitFollowup(tutorQ.value);
        }
      }
    }

    function finish() {
      bar.style.width = '100%';
      if (barPulse) barPulse.style.left = '100%';
      const pct = Math.round((correct / questions.length) * 100);
      const perfect = correct === questions.length && questions.length > 0;
      // Achievements: track session-end (perfect runs, longest session,
      // login-streak update, best in-session correct streak, XP).
      try {
        if (window.Achievements && typeof window.Achievements.track === 'function') {
          window.Achievements.track('session-end', {
            correct,
            total: questions.length,
            subject: SUBJECT_SLUG,
            unitId: meta && meta.unit ? meta.unit.id : null,
            sessionStreak: window._stMaxCorrectStreak || 0
          });
          // Finishing a session counts toward the "finish a session"
          // and "practice for 2+ min" daily-quest tasks.
          window.Achievements.bumpDailyMission('session', 1);
        }
      } catch (_) {}
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
      // Mastery badge + next-topic recommendation. Only shown when the
      // kid was scoped to a specific unit (?u=...), the math subject,
      // and Mastery module loaded — out-of-scope cases (Mixed practice,
      // reading/science/SS, mock tests) skip silently.
      let masteryHtml = '';
      let nextSuggestionHtml = '';
      try {
        if (window.Mastery && unitId && SUBJECT_SLUG === 'math' && curr && Array.isArray(curr.units)) {
          const allStats = window.Mastery.loadStatsFor(slug);
          const scopedUnit = curr.units.find(u => u.id === unitId);
          if (scopedUnit && allStats) {
            const unitStats = (allStats.units && allStats.units[unitId]) || null;
            const lev = window.Mastery.levelFor(unitStats);
            masteryHtml = `
              <div class="mastery-badge mastery-badge--${lev.key}">
                <span class="mastery-badge-emoji" aria-hidden="true">${lev.emoji}</span>
                <span class="mastery-badge-text">
                  <strong>${escapeHtml(scopedUnit.title)} — ${lev.label}</strong>
                  <span class="mastery-badge-blurb">${escapeHtml(lev.blurb)}</span>
                </span>
              </div>
            `;
            // Suggest next topic only if the kid is doing well here
            // (Strong or Mastered). Don't pull a kid OUT of a topic
            // they're still building — that would feel discouraging.
            if (lev.key === 'strong' || lev.key === 'mastered') {
              const rec = window.Mastery.recommendNext(allStats, curr, unitId);
              if (rec && rec.unit) {
                const opener = window.Mastery.pickOpener(rec.reason);
                const nextUrl = `practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED || '')}&g=${encodeURIComponent(slug)}&subj=math&u=${encodeURIComponent(rec.unit.id)}`;
                const reasonBlurb = rec.reason === 'never_practiced'
                  ? 'You haven\'t practiced this one yet.'
                  : rec.reason === 'undertested'
                    ? `Only ${rec.level.blurb.toLowerCase().includes('answered') ? rec.level.blurb : '0 questions answered there'}.`
                    : `${rec.level.blurb} · let\'s build this up.`;
                nextSuggestionHtml = `
                  <a class="next-topic-card" href="${escapeHtml(nextUrl)}">
                    <div class="next-topic-card-eyebrow">${escapeHtml(opener)}</div>
                    <div class="next-topic-card-title">${escapeHtml(rec.unit.title)}</div>
                    <div class="next-topic-card-sub">${escapeHtml(reasonBlurb)}</div>
                    <div class="next-topic-card-cta">
                      <span>Try it</span>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                    </div>
                  </a>
                `;
              }
            }
          }
        }
      } catch (err) {
        // Mastery is purely additive UI; failure here must not break
        // the end-of-set screen for the kid.
        console.warn('[mastery] render failed:', err && err.message || err);
      }

      qbox.innerHTML = `
        ${banner}
        <div class="card">
          <h3>${pickEndHeader(correct, questions.length)}</h3>
          <p style="font-size:1.4rem;"><strong>${correct} / ${questions.length}</strong> correct (${pct}%)</p>
          ${masteryHtml}
          <div id="session-summary" class="session-summary tutor-output" aria-live="polite" aria-atomic="true" style="margin:14px 0;padding:10px 14px;font-size:0.95rem;color:var(--text,#374151);background:var(--bg-soft,#f9fafb);border-left:3px solid var(--border,#e5e7eb);border-radius:6px;font-style:italic;">${thinkingHTML()}</div>
          ${nextSuggestionHtml}
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
  // Texas Grade 8 social studies serving path. Mirrors startScience
  // byte-faithfully; just hits getSocialStudiesItem and renders the
  // SS passage as the reading-style stimulus.
  // ============================================================
  async function startSocialStudies() {
    const grTitle = ({
      'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
      'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
      'grade-8':'Grade 8'
    })[slug] || slug;
    const fakeCurr = { grade: slug, title: `${grTitle} Social Studies`, units: [] };
    try {
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'getSocialStudiesItem',
          token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null,
          state: STATE_SLUG_RESOLVED,
          grade: slug
        })
      });
      if (!res.ok) throw new Error('ss_item_failed_' + res.status);
      const data = await res.json();
      const passage = data.passage || null;
      const rawQuestions = data.questions || [];
      if (!passage || rawQuestions.length === 0) {
        root.innerHTML = `
          <h2>Social Studies practice</h2>
          <div class="card" style="text-align:center;padding:36px;">
            <div style="font-size:3rem;margin-bottom:12px;" aria-hidden="true">🌎</div>
            <p style="font-size:1.05rem;margin-bottom:6px;"><strong>${escapeHtml(grTitle)} Social Studies is coming soon.</strong></p>
            <p style="color:var(--muted);max-width:480px;margin:0 auto 18px;">We're building the Social Studies library one grade at a time. STAAR tests it at Grade 8; that's where we ship first.</p>
            <p>
              <a class="btn btn-primary" href="practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=math">Practice Math</a>
              <a class="btn btn-secondary" href="practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=reading" style="margin-left:8px;">Practice Reading</a>
            </p>
          </div>`;
        return;
      }
      const items = rawQuestions.map(g => ({
        id: g.contentId || g.id,
        contentId: g.contentId || null,
        poolKey: g.poolKey || null,
        type: 'multiple_choice',
        prompt: g.question || g.stem || g.prompt || '',
        choices: g.choices || [],
        answer: (Number.isFinite(g.correctIndex) && Array.isArray(g.choices)) ? g.choices[g.correctIndex] : (g.answer || ''),
        correctIndex: g.correctIndex,
        explanation: g.explanation || '',
        passage,
        _unit: { title: passage.title || 'Social Studies', id: passage.passageId },
        _lesson: { teks: g.strand || '', title: passage.title || '' }
      }));
      runQuiz(fakeCurr, items, null, { enhance: null });
    } catch (err) {
      console.warn('[social-studies] fetch failed:', err.message);
      root.innerHTML = `
        <h2>Social Studies practice</h2>
        <div class="card" style="text-align:center;padding:32px;">
          <div style="font-size:2.4rem;margin-bottom:8px;" aria-hidden="true">🌎</div>
          <p style="font-size:1.05rem;margin-bottom:6px;">We couldn't load Social Studies right now.</p>
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
  // Mock STAAR test mode (?mock=1).
  //
  // Full-length, timed test that mimics the real STAAR experience:
  //   - 40 questions (configurable via ?n=20|40|60)
  //   - Timer counting down (default 50 min for 40q, ~75s/question)
  //   - NO AI tutor on wrong answers (real test = no help)
  //   - NO scratchpad pull-out, NO fun-fact interrupts
  //   - NO auto-advance — kid clicks Next manually
  //   - Cents earning capped at 50¢ flat (test-completion reward)
  //   - End-of-test: scaled-score estimate + per-topic breakdown
  //
  // Predicted STAAR scaled-score formula (rough; calibrate later from
  // real released-test conversion tables):
  //   raw = correct / total
  //   scaled ≈ 1300 + raw * 1300   → range ~1300-2600 (matches STAAR)
  // The real conversion is non-linear and grade-specific; this is a
  // "you'd pass / you wouldn't" gut-check, not a guarantee. UI labels
  // it as "estimate" to set expectations.
  // ============================================================
  async function startMockStaar() {
    document.body.classList.add('mock-staar-mode');
    const grTitle = ({
      'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
      'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
      'grade-8':'Grade 8','algebra-1':'Algebra 1'
    })[slug] || slug;
    const subjLabel = SUBJECT_SLUG.charAt(0).toUpperCase() + SUBJECT_SLUG.slice(1).replace('-', ' ');
    const stateName = STATE_INFO ? (STATE_INFO.name || STATE_INFO.nameAbbr) : '';
    const reqN = parseInt(params.get('n'), 10);
    const N = [20, 40, 60].includes(reqN) ? reqN : 40;
    // 75 sec per question, in minutes, rounded up
    const TEST_MINUTES = Math.ceil((N * 75) / 60);

    // Intro screen — kid clicks "Begin test" to start the timer.
    root.innerHTML = `
      <div class="mock-intro card" style="text-align:center;padding:36px;max-width:560px;margin:0 auto;">
        <div style="font-size:3rem;margin-bottom:8px;" aria-hidden="true">📝</div>
        <h2 style="margin-top:0;">Mock ${escapeHtml(STATE_INFO?.testName || 'STAAR')} test</h2>
        <p style="font-size:1.05rem;color:rgba(255,255,255,0.85);margin-bottom:6px;">${escapeHtml(stateName)} ${escapeHtml(grTitle)} ${escapeHtml(subjLabel)}</p>
        <p style="color:var(--muted);max-width:440px;margin:8px auto 24px;">${N} questions · ${TEST_MINUTES} min · No AI tutor · No skipping back. Mimics real test conditions.</p>
        <p><button type="button" id="mock-begin" class="btn btn-primary btn-primary--large">Begin test</button></p>
        <p style="margin-top:18px;color:rgba(255,255,255,0.5);font-size:0.85rem;">Real STAAR doesn't show your score until later. We'll show yours immediately when you finish.</p>
      </div>`;

    document.getElementById('mock-begin').onclick = async () => {
      await loadAndRunMockTest(N, TEST_MINUTES, grTitle, subjLabel, stateName);
    };
  }

  // STAAR scaled-score cut points by (grade, subject). Sourced from
  // TEA STAAR technical reports + recent released-test conversions.
  // Each entry: [approachesGradeLevel, meetsGradeLevel, mastersGradeLevel].
  // Below 'approaches' = "did not meet". Used to anchor our raw-pct
  // approximation to real STAAR bands. Where TEA hasn't published a
  // grade/subject combo (e.g. our practice-only grades), we use the
  // nearest tested grade as a proxy.
  const STAAR_CUTS = {
    'grade-3': {
      math:    [1349, 1467, 1610],
      reading: [1345, 1468, 1596],
      science: [1349, 1467, 1610]   // proxy: math (no STAAR Sci grade-3)
    },
    'grade-4': {
      math:    [1467, 1572, 1698],
      reading: [1468, 1583, 1712],
      science: [1467, 1572, 1698]   // proxy
    },
    'grade-5': {
      math:    [1500, 1630, 1771],
      reading: [1500, 1630, 1771],
      science: [1500, 1630, 1771]
    },
    'grade-6': {
      math:    [1546, 1683, 1834],
      reading: [1551, 1683, 1834],
      science: [1546, 1683, 1834]   // proxy
    },
    'grade-7': {
      math:    [1599, 1739, 1881],
      reading: [1606, 1739, 1881],
      science: [1599, 1739, 1881]   // proxy
    },
    'grade-8': {
      math:    [1641, 1782, 1924],
      reading: [1655, 1782, 1924],
      science: [1641, 1782, 1924]
    },
    'algebra-1': {
      math:    [3550, 4000, 4500]   // STAAR EOC scale (different range)
    }
  };
  // Score-band boundaries by raw percentage. Calibrated to match
  // approximate STAAR raw→scaled conversion tables: at ~50% raw,
  // most kids land near "Approaches grade level."
  function rawPctToBand(rawPct) {
    if (rawPct >= 0.85) return 'masters';
    if (rawPct >= 0.65) return 'meets';
    if (rawPct >= 0.45) return 'approaches';
    return 'below';
  }
  function computeScaledScoreEstimate(correct, total, gradeSlug, subjSlug) {
    if (total <= 0) return null;
    const rawPct = correct / total;
    const cutsForGrade = STAAR_CUTS[gradeSlug] || STAAR_CUTS['grade-5'];
    const cuts = cutsForGrade[subjSlug] || cutsForGrade.math;
    const [approaches, meets, masters] = cuts;
    // Interpolate within band. Uses linear within-band approximation.
    if (rawPct <= 0.45) {
      // 0% - 45% raw maps to (approaches - 200) ... approaches
      return Math.round(approaches - 200 + (rawPct / 0.45) * 200);
    }
    if (rawPct <= 0.65) {
      // 45% - 65% raw maps to approaches ... meets
      return Math.round(approaches + ((rawPct - 0.45) / 0.20) * (meets - approaches));
    }
    if (rawPct <= 0.85) {
      // 65% - 85% raw maps to meets ... masters
      return Math.round(meets + ((rawPct - 0.65) / 0.20) * (masters - meets));
    }
    // 85% - 100% raw maps to masters ... (masters + 100)
    return Math.round(masters + ((rawPct - 0.85) / 0.15) * 100);
  }
  function verdictForScaled(scaled, gradeSlug, subjSlug) {
    if (!Number.isFinite(scaled)) return 'No estimate';
    const cutsForGrade = STAAR_CUTS[gradeSlug] || STAAR_CUTS['grade-5'];
    const cuts = cutsForGrade[subjSlug] || cutsForGrade.math;
    const [approaches, meets, masters] = cuts;
    if (scaled >= masters) return 'Masters grade level — strong';
    if (scaled >= meets) return 'Meets grade level';
    if (scaled >= approaches) return 'Approaches grade level';
    return 'Below grade level — more practice recommended';
  }

  async function loadAndRunMockTest(N, minutes, grTitle, subjLabel, stateName) {
    // Loading skeleton while we fetch a full pool.
    root.innerHTML = `
      <div class="ge-skel-card" aria-busy="true" aria-label="Building mock test">
        <h2 style="margin-top:0;">Building your mock test…</h2>
        <p style="color:var(--muted);margin-bottom:18px;">${N} questions for ${escapeHtml(grTitle)} ${escapeHtml(subjLabel)}.</p>
        <div class="ge-skel-stack">
          <div class="ge-skel ge-skel-block"></div>
          <div class="ge-skel ge-skel-block"></div>
          <div class="ge-skel ge-skel-block"></div>
        </div>
      </div>`;

    let items = [];
    try {
      if (SUBJECT_SLUG === 'reading' || SUBJECT_SLUG === 'science') {
        // Reading + science cluster sizes (~5q/passage). Need to pull
        // multiple clusters to reach N. Loop with a small concurrency.
        const action = SUBJECT_SLUG === 'reading' ? 'getReadingItem' : 'getScienceItem';
        let attempts = 0;
        const seenPassageIds = new Set();
        while (items.length < N && attempts < 12) {
          attempts++;
          const res = await fetch(TUTOR_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action, state: STATE_SLUG_RESOLVED, grade: slug,
              token: (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null
            })
          });
          if (!res.ok) break;
          const data = await res.json();
          const passage = data.passage || data.scenario;
          const rawQ = data.questions || [];
          if (!passage || seenPassageIds.has(passage.passageId) || rawQ.length === 0) continue;
          seenPassageIds.add(passage.passageId);
          for (const g of rawQ) {
            items.push({
              id: g.contentId || g.id,
              contentId: g.contentId || null,
              poolKey: g.poolKey || null,
              type: 'multiple_choice',
              prompt: g.stem || g.prompt || '',
              choices: g.choices || [],
              answer: (Number.isFinite(g.correctIndex) && Array.isArray(g.choices)) ? g.choices[g.correctIndex] : (g.answer || ''),
              correctIndex: g.correctIndex,
              explanation: g.explanation || '',
              passage,
              _unit: { title: passage.title || subjLabel, id: passage.passageId },
              _lesson: { teks: g.claimedTeks || g.teks || '', title: passage.title || '' }
            });
            if (items.length >= N) break;
          }
        }
      } else {
        // Math: load curriculum JSON, shuffle, take N.
        const r = await fetch(`data/${slug}-curriculum.json?v=20260514a`);
        if (!r.ok) throw new Error('curr_load_failed');
        const curr = await r.json();
        const pool = curr.units.flatMap(u => u.lessons.flatMap(l => l.questions.map(q => ({ ...q, _unit: u, _lesson: l }))));
        items = shuffle(pool.slice()).slice(0, N);
      }
    } catch (err) {
      root.innerHTML = `<div class="card" style="text-align:center;padding:32px;"><div style="font-size:2.4rem;" aria-hidden="true">📝</div><p>Couldn't build your mock test right now.</p><p><button type="button" class="btn btn-primary" onclick="location.reload()">Retry</button></p></div>`;
      return;
    }

    if (items.length < Math.min(10, N)) {
      root.innerHTML = `<div class="card" style="text-align:center;padding:36px;"><div style="font-size:3rem;" aria-hidden="true">📚</div><h2>Not enough content yet</h2><p style="color:var(--muted);">${escapeHtml(grTitle)} ${escapeHtml(subjLabel)} doesn't have enough questions for a mock test yet (${items.length} found, need ${N}). Try a different grade or subject.</p><p><a class="btn btn-primary" href="grade.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}">Back</a></p></div>`;
      return;
    }
    items = items.slice(0, N);

    // Hand off to a stripped-down quiz runner. We don't reuse runQuiz
    // because it has the AI tutor / fun-fact / cents-per-question logic
    // we explicitly want to skip in test mode.
    runMockQuiz(items, minutes, { grTitle, subjLabel, stateName });
  }

  function runMockQuiz(items, minutes, ctx) {
    const startedAt = Date.now();
    const endsAt = startedAt + minutes * 60 * 1000;
    let i = 0;
    let correct = 0;
    const perQ = []; // {idx, qId, prompt, picked, isCorrect, teks}
    let timerHandle = null;

    function timeLeft() { return Math.max(0, endsAt - Date.now()); }
    function fmtMMSS(ms) {
      const s = Math.ceil(ms / 1000);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${String(r).padStart(2, '0')}`;
    }

    function renderHeader() {
      const el = document.getElementById('mock-timer');
      if (el) el.textContent = fmtMMSS(timeLeft());
      if (timeLeft() <= 0) finishTest();
    }

    function renderShell() {
      root.innerHTML = `
        <div class="mock-staar-shell">
          <div class="mock-header">
            <div class="mock-header-left">
              <span class="mock-eyebrow">Mock test · ${escapeHtml(ctx.subjLabel)}</span>
              <span class="mock-progress">Question <strong id="mock-qnum">1</strong> of ${items.length}</span>
            </div>
            <div class="mock-header-right">
              <span class="mock-timer-label">Time left</span>
              <span class="mock-timer" id="mock-timer">${fmtMMSS(timeLeft())}</span>
            </div>
          </div>
          <div id="mock-qbox" class="mock-qbox"></div>
        </div>`;
    }

    function renderQuestion() {
      const q = items[i];
      const qnum = document.getElementById('mock-qnum');
      if (qnum) qnum.textContent = String(i + 1);
      const qbox = document.getElementById('mock-qbox');
      const passageHtml = (q.passage && q.passage.body)
        ? `<div class="mock-passage"><h3>${escapeHtml(q.passage.title || '')}</h3><div class="mock-passage-body">${q.passage.body.split(/\n+/).map(p => `<p>${escapeHtml(p)}</p>`).join('')}</div></div>`
        : '';
      const choices = (q.choices || []).map((c, j) => `
        <label class="mock-choice">
          <input type="radio" name="m${i}" value="${escapeAttr(c)}" required>
          <span class="mock-choice-letter">${'ABCD'[j] || ''}</span>
          <span class="mock-choice-text">${escapeHtml(c)}</span>
        </label>`).join('');
      qbox.innerHTML = `
        ${passageHtml}
        <div class="mock-question">
          <div class="mock-prompt">${escapeHtml(q.prompt)}</div>
          <form class="mock-form" id="mock-form">
            <div class="mock-choices">${choices}</div>
            <div class="mock-cta-row">
              <button type="submit" class="btn btn-primary mock-next-btn">${i === items.length - 1 ? 'Finish test' : 'Next →'}</button>
            </div>
          </form>
        </div>`;
      const form = document.getElementById('mock-form');
      form.onsubmit = (e) => {
        e.preventDefault();
        const sel = form.querySelector('input[name="m' + i + '"]:checked');
        if (!sel) return;
        const picked = sel.value;
        const isCorrect = picked === q.answer;
        if (isCorrect) correct++;
        // Record SR + lake event (low-key — no UI noise)
        try {
          if (window.GradeEarnSpacedRep && q.id) window.GradeEarnSpacedRep.record(q.id, isCorrect);
          if (window.GradeEarnLake && q.contentId) {
            window.GradeEarnLake.recordEvent({
              eventType: isCorrect ? 'answered-correct' : 'answered-incorrect',
              contentId: q.contentId, poolKey: q.poolKey,
              state: STATE_SLUG_RESOLVED, grade: slug, subject: SUBJECT_SLUG_RESOLVED,
              pickedChoice: picked, meta: { mockTest: true }
            });
          }
        } catch (_) {}
        perQ.push({
          idx: i, qId: q.id, prompt: q.prompt.slice(0, 80),
          picked, isCorrect, teks: q.teks || (q._lesson && q._lesson.teks) || null,
          unitTitle: q._unit && q._unit.title
        });
        i++;
        if (i >= items.length) finishTest();
        else renderQuestion();
      };
    }

    function finishTest() {
      if (timerHandle) clearInterval(timerHandle);
      const total = items.length;
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
      const elapsedMs = Date.now() - startedAt;
      const elapsedMin = Math.floor(elapsedMs / 60000);
      const elapsedSec = Math.floor((elapsedMs % 60000) / 1000);
      // STAAR scaled-score estimate. Real STAAR uses a non-linear
      // grade-and-subject-specific raw→scaled conversion published by
      // TEA. Here we use grade-specific cut scores from TEA's recent
      // released-test technical reports + our own raw-score-to-band
      // approximation. Bands follow STAAR's "Approaches / Meets /
      // Masters" performance levels. Off the official TEA conversion
      // table, our error is roughly ±50-80 points per scaled score —
      // close enough for a practice-app gut-check, never the source
      // of truth for a real STAAR result.
      const scaledEst = computeScaledScoreEstimate(correct, total, slug, SUBJECT_SLUG_RESOLVED);
      const verdict = verdictForScaled(scaledEst, slug, SUBJECT_SLUG_RESOLVED);
      // Per-unit breakdown
      const byUnit = {};
      for (const r of perQ) {
        const k = r.unitTitle || 'Other';
        if (!byUnit[k]) byUnit[k] = { c: 0, t: 0 };
        byUnit[k].t++;
        if (r.isCorrect) byUnit[k].c++;
      }
      const unitRows = Object.entries(byUnit)
        .sort((a, b) => b[1].t - a[1].t)
        .slice(0, 8)
        .map(([k, v]) => {
          const p = Math.round((v.c / v.t) * 100);
          return `<li><span class="mock-unit-name">${escapeHtml(k)}</span><span class="mock-unit-score">${v.c}/${v.t} (${p}%)</span></li>`;
        }).join('');

      root.innerHTML = `
        <div class="mock-staar-shell mock-result">
          <div class="card" style="text-align:center;padding:36px;">
            <div class="mock-result-eyebrow">Mock test complete</div>
            <h2 style="margin:6px 0 4px;">${pct}% correct</h2>
            <p class="mock-result-sub">${correct} of ${total} questions · finished in ${elapsedMin}m ${elapsedSec}s</p>
            <div class="mock-scaled">
              <div class="mock-scaled-num">${scaledEst}</div>
              <div class="mock-scaled-label">Estimated scaled score · <strong>${verdict}</strong></div>
              <div class="mock-scaled-disc">Estimate, not a real STAAR result. Calibrated to TEA's published cut scores for ${escapeHtml(ctx.grTitle)} ${escapeHtml(ctx.subjLabel)} (Approaches / Meets / Masters bands). Real STAAR uses a non-linear conversion; our error is roughly ±50-80 scaled points.</div>
            </div>
            ${unitRows ? `<div class="mock-by-unit"><h3>By topic</h3><ul>${unitRows}</ul></div>` : ''}
            <div class="mock-result-actions">
              <a class="btn btn-primary" href="practice.html?s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=${encodeURIComponent(SUBJECT_SLUG_RESOLVED)}">Practice mode</a>
              <a class="btn btn-secondary" href="practice.html?mock=1&s=${encodeURIComponent(STATE_SLUG_RESOLVED)}&g=${encodeURIComponent(slug)}&subj=${encodeURIComponent(SUBJECT_SLUG_RESOLVED)}" style="margin-left:8px;">Take another mock test</a>
            </div>
          </div>
        </div>`;
    }

    renderShell();
    renderQuestion();
    timerHandle = setInterval(renderHeader, 1000);
  }

  // ============================================================
  // Print-friendly worksheet mode (?print=1).
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
        const r = await fetch(`data/${slug}-curriculum.json?v=20260514a`);
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
        <label class="choice" data-letter="${LETTERS[cIdx] || (cIdx + 1)}">
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
    // §82 — when a passage is present (reading mode) the passage card
    // already carries its own TTS button; the question stem is short
    // enough that re-reading it is rarely useful, and a second sound
    // icon next to the first is the "two sound icons" finding from the
    // 3/10 critique. Drop the per-question speaker on reading flows.
    const hasPassage = !!(q.passage && (q.passage.body || q.passage.text));
    const readBtn = (!hasPassage && window.Speech && window.Speech._isSupported())
      ? `<button type="button" class="speech-btn q-speech-btn" data-act="read" data-role="speak" aria-label="Read question aloud" title="Read question aloud" aria-pressed="false">
          ${SPEECH_ICON_HTML}
        </button>`
      : '';
    // §103 — inline scratch-paper button next to the speaker. The
    // floating bottom-right scratchpad pencil was an unlabeled mystery
    // affordance per Hamid screenshot review. Surface it as a labeled
    // sibling of the speaker icon at the top-right of the question
    // prompt area. Toggles the existing scratchpad-inline element via
    // the public STAARScratchpad.toggle() API.
    const scratchBtn = (!hasPassage && window.STAARScratchpad)
      ? `<button type="button" class="speech-btn q-scratch-btn" data-act="scratch" aria-label="Open scratch paper" title="Scratch paper">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
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

    // §99 — institutional all-caps eyebrow removed. The kid was
    // seeing "MEASUREMENT: PERIMETER & AREA · +4 PTS" in caps-gold
    // letter-spaced font — textbook chapter heading energy. Per
    // 5:03 AM screenshot review.
    // - Topic name: dropped from the card. The question stem itself
    //   teaches the concept; an all-caps label above it adds nothing
    //   for an 8-year-old.
    // - "+N pts" stake: moves INTO the Check answer button text
    //   (line below) so the kid sees the reward attached to the
    //   action that triggers it.
    // - "⭐ Mastered" lock indicator: only renders when locked
    //   (rare path); stays as a small badge.
    const eyebrowHtml = locked
      ? `<div class="q-card-eyebrow q-card-eyebrow--locked" data-role="eyebrow">⭐ Mastered</div>`
      : '';
    const ctaLabel = locked ? 'Check answer' : `Check answer · +${cents} pts`;

    // §56 — inline feedback slot. Sits between input and primary
    // button so the kid sees outcome → explanation → next-action in
    // natural reading order. Hidden in ASKING; populated by showFeedback.
    // §82 (revised) — passage + question stay as direct children of
    // #qbox; the existing body[data-subject="reading"] #qbox grid CSS
    // (styles.css §74-era) already lays them out as two columns on
    // desktop and stacks them on phone. The earlier §82 .reading-split
    // wrapper broke that layout by inserting a single child between
    // them and the grid container — DO NOT re-wrap.
    return `
      ${passageHtml}
      <form class="question-card" data-state="asking" data-cents="${cents}">
        ${navHtml}
        ${eyebrowHtml}
        <div class="q-prompt">${readBtn}${scratchBtn}<span class="q-prompt-text">${escapeHtml(q.prompt)}</span></div>
        <div class="q-body">${body}</div>
        <div class="q-inline-fb" data-role="inline-fb" hidden></div>
        <button class="btn btn-primary q-cta" type="submit" data-role="check">${ctaLabel}</button>
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
    // Tier 6 AE — record-yourself slot (kid taps to record reading the
    // passage aloud, then plays back). Mount handled in
    // attachQuestionHandlers via [data-role="voice-mount"]; local-only,
    // no upload.
    const voiceMount = (window.GEVoice && window.GEVoice.supported && window.GEVoice.supported())
      ? '<div class="voice-recorder-slot" data-role="voice-mount"></div>'
      : '';
    // Voice slot sits ABOVE the passage body so a kid on a phone
    // doesn't have to scroll past every paragraph to find the record
    // button. While recording, the slot promotes itself to a
    // fixed-bottom bar (see voice-recorder.js + CSS) so the timer +
    // stop control are always reachable while the kid reads.
    return `
      <article class="reading-passage-card" data-state="default" data-passage-id="${escapeAttr(p.passageId || '')}">
        <header class="reading-passage-card-header">
          <h2 class="reading-passage-card-title">${escapeHtml(title)}</h2>
          ${speakerHtml}
          <button type="button" class="reading-passage-expand" data-role="expand-passage" aria-label="Expand passage" aria-pressed="false" title="Expand">⤢</button>
        </header>
        ${voiceMount}
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
          <div class="stat stat--points" id="perf-pts-tile"><div class="stat-num"><span id="perf-pts-num">${window._sessionPoints || 0}</span></div><div class="stat-label">pts earned</div></div>
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
    // Tier 7 AP — refresh the top stats pill with the same numbers.
    try { if (typeof window._refreshStatsPill === 'function') window._refreshStatsPill(s); } catch (_) {}

    // §67 — let showFeedback bump the pts tile without re-rendering
    // the entire perf panel (would lose ring transition + dot fades).
    window._refreshSessionPts = function () {
      const el = document.getElementById('perf-pts-num');
      if (el) el.textContent = String(window._sessionPoints || 0);
    };
  }

  // Track time-on-task while the practice page is open & visible.
  if (window.STAARAuth && typeof window.STAARAuth.startHeartbeat === 'function') {
    window.STAARAuth.startHeartbeat();
  }
})();
