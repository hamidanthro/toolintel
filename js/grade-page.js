/**
 * GradeEarn — GRADE PAGE RENDERER
 *
 * Reads ?s=<state>&g=<grade> from URL. Validates both.
 * Renders subject cards (Math live; Reading/Science/Social Studies coming soon).
 * Tapping Math navigates to practice.html with full context.
 */

(function () {
  const SITE_ORIGIN = location.origin;
  const STATES = window.STATES_API;

  // §117 — Gold-only design system. Per-subject color tints (teal,
  // purple, pink) violated the brand. Every subject icon now renders
  // on the same gold-tinted plate; differentiation comes from icon
  // shape, not color.
  const SUBJECTS = [
    {
      slug: 'math',
      name: 'Math',
      tagline: 'Numbers, problems, patterns.',
      icon: 'math',
      color: '#fbbf24',
      live: true
    },
    {
      slug: 'reading',
      name: 'Reading',
      tagline: 'Comprehension, vocabulary, analysis.',
      icon: 'reading',
      color: '#fbbf24',
      live: true
    },
    {
      slug: 'science',
      name: 'Science',
      tagline: 'Earth, life, physical, engineering.',
      icon: 'science',
      color: '#fbbf24',
      // Science is live for Texas grades 3-8 (Phase R+ OpenAI fork +
      // Phase J Claude pipeline for G5). All STAAR-tested + practice
      // grades have content.
      live: false,
      eta: 'Coming soon',
      liveForGrade: function (stateSlug, gradeSlug) {
        if (stateSlug !== 'texas') return false;
        return ['grade-3','grade-4','grade-5','grade-6','grade-7','grade-8'].includes(gradeSlug);
      }
    },
    {
      slug: 'social-studies',
      name: 'Social Studies',
      tagline: 'History, geography, civics, economics.',
      icon: 'globe',
      color: '#fbbf24',
      // §91 (May 14, 2026) — SS gated until USA-broad KP ships. Audit
      // found 870 active Texas SS rows in staar-content-pool, ZERO
      // judged (no _judge or _judgedAt stamps), schema mismatch
      // (rows store grade as bare '3'/'k' vs frontend's 'grade-3'
      // form), passage-tethered orphans in K-2 (questions reference a
      // passage that isn't there), AGE_FIT mismatch on G3 (Reconstruction
      // is grade-7+ TEKS), and §27 letter-prefix-in-choice-text bug on
      // G8 ('A. ...' / 'B. ...' literal letters inside choice strings).
      // Re-enable per-grade when the USA-broad SS Knowledge Pack ships
      // AND a judge sweep clears the existing rows or new content gens.
      // See docs/knowledge-packs/architecture-decisions.md §SS-USA-BROAD.
      live: false,
      eta: 'Coming soon',
      liveForGrade: function (stateSlug, gradeSlug) {
        return false;
      }
    }
  ];

  const GRADE_NAMES = {
    'grade-k': 'Kindergarten',
    'grade-1': 'Grade 1',
    'grade-2': 'Grade 2',
    'grade-3': 'Grade 3',
    'grade-4': 'Grade 4',
    'grade-5': 'Grade 5',
    'grade-6': 'Grade 6',
    'grade-7': 'Grade 7',
    'grade-8': 'Grade 8',
    'grade-9': 'Grade 9',
    'grade-10': 'Grade 10',
    'grade-11': 'Grade 11',
    'algebra-1': 'Algebra 1'
  };

  function init() {
    if (!STATES) {
      showError('Loading error', 'Please refresh the page.', 'index.html', 'Home');
      return;
    }

    try { maybeCompactBreadcrumb(); } catch (_) {}
    try { simplifyNavForSignedOut(); } catch (_) {}

    const params = new URLSearchParams(location.search);
    let stateSlug = params.get('s');
    const gradeSlug = params.get('g');

    // Texas-only product. If state slug is missing or invalid, default
    // to texas instead of showing a dead-end "state not found" error.
    // The user is here to practice; the rule from memory_texas_only.md
    // says we never serve any state but Texas.
    let state = stateSlug ? STATES.getBySlug(stateSlug) : null;
    if (!state) {
      stateSlug = 'texas';
      state = STATES.getBySlug('texas');
      // Update the URL so subsequent links / bookmarks land cleanly,
      // without forcing a navigation (history.replaceState).
      try {
        const fixed = new URLSearchParams(location.search);
        fixed.set('s', 'texas');
        const newUrl = location.pathname + '?' + fixed.toString() + location.hash;
        history.replaceState(null, '', newUrl);
      } catch (_) {}
    }
    if (!state) {
      // Catastrophic — texas record itself missing. Fall back to home.
      location.replace('index.html');
      return;
    }

    // §47 — Texas-only pivot. Inactive state records still resolve
    // (data preserved) but the grade page should redirect them home
    // rather than try to populate a hero/subject grid for a state
    // we have no content for. Active states render normally.
    if (state.active === false) {
      showError(
        `Coming soon for ${state.name}`,
        `We're focused on Texas STAAR practice right now. ${state.name} is on the roadmap.`,
        'index.html',
        'Try Texas STAAR practice'
      );
      return;
    }

    const gradeName = GRADE_NAMES[gradeSlug];
    if (!gradeName) {
      showError(
        'Grade not found',
        `Pick a grade for ${state.name}.`,
        `states/?s=${state.slug}`,
        `Back to ${state.name}`
      );
      return;
    }

    if (!state.gradesTested.includes(gradeSlug)) {
      showError(
        `${gradeName} not offered in ${state.name}`,
        `${state.testName} doesn't include ${gradeName}. Pick a different grade.`,
        `states/?s=${state.slug}`,
        `${state.name} grades`
      );
      return;
    }

    populateSEO(state, gradeSlug, gradeName);
    populateBreadcrumb(state, gradeName);
    populateHero(state, gradeSlug, gradeName);
    populateSubjects(state, gradeSlug);

    document.getElementById('grade-loading').hidden = true;
    document.getElementById('grade-content').hidden = false;
  }

  function showError(title, text, cta, ctaLabel) {
    const loading = document.getElementById('grade-loading');
    if (loading) loading.hidden = true;
    const err = document.getElementById('grade-error');
    document.getElementById('grade-error-title').textContent = title;
    document.getElementById('grade-error-text').textContent = text;
    const ctaEl = err.querySelector('.state-error-cta');
    ctaEl.setAttribute('href', cta);
    const span = ctaEl.querySelector('span');
    if (span) span.textContent = ctaLabel + ' ';
    err.hidden = false;
    document.title = `${title} — GradeEarn`;
  }

  // ============================================================
  // SEO
  // ============================================================

  function populateSEO(state, gradeSlug, gradeName) {
    const title = `${state.testName} ${gradeName} Practice — GradeEarn`;
    const description = `AI-powered ${state.testName} practice for ${gradeName} students in ${state.name}. Aligned to state standards. Real toys for correct answers. Free during beta.`;

    document.title = title;
    document.getElementById('page-title').textContent = title;
    document.getElementById('page-description').setAttribute('content', description);

    const canonical = `${SITE_ORIGIN}/grade.html?s=${state.slug}&g=${gradeSlug}`;
    document.getElementById('page-canonical').setAttribute('href', canonical);

    document.getElementById('og-title').setAttribute('content', title);
    document.getElementById('og-description').setAttribute('content', description);
    document.getElementById('og-url').setAttribute('content', canonical);

    document.getElementById('twitter-title').setAttribute('content', title);
    document.getElementById('twitter-description').setAttribute('content', description);

    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: `${state.testName} ${gradeName} Practice`,
      description: description,
      provider: {
        '@type': 'Organization',
        name: 'GradeEarn',
        url: SITE_ORIGIN
      },
      educationalLevel: gradeName,
      audience: {
        '@type': 'EducationalAudience',
        educationalRole: 'student'
      },
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD'
      }
    };
    document.getElementById('page-jsonld').textContent = JSON.stringify(jsonld);
  }

  // ============================================================
  // BREADCRUMB
  // ============================================================

  function populateBreadcrumb(state, gradeName) {
    const stateLink = document.getElementById('breadcrumb-state');
    stateLink.textContent = state.name;
    stateLink.setAttribute('href', `states/?s=${encodeURIComponent(state.slug)}`);
    document.getElementById('breadcrumb-grade').textContent = gradeName;
  }

  // ============================================================
  // HERO
  // ============================================================

  function populateHero(state, gradeSlug, gradeName) {
    // §15 minimalism pass — grade-hero block deleted from grade.html.
    // The H1 "Subjects" lives on .subject-section-title (label, not
    // instruction). Only document.title remains for SEO/tab labels.
    // STAAR-countdown pill removed; if a kid wants to see the test-day
    // countdown they can find it on /about.html.
    document.title = `${gradeName} ${state.testName} practice — ${state.name} — GradeEarn`;
  }

  // ============================================================
  // SUBJECTS
  // ============================================================

  // §119 — Home IA rebuild (May 16). populateSubjects now orchestrates
  // the entire post-login layout: greeting block + earn-today hero +
  // Continue card + 3-tile subject grid + Mind-Blower + collapsed
  // More-ways accordion. Each section is rendered into its dedicated
  // host element in grade.html (#home-greeting, #earn-hero,
  // #continue-card-wrap, #subject-grid, #mindblower-wrap,
  // #more-ways-body). Sections that can't compute meaningful content
  // (cold-start kid, no curriculum, no fact catalog) are simply left
  // hidden rather than rendering an empty placeholder.
  function populateSubjects(state, gradeSlug) {
    const offeredFor = function (subjSlug) {
      if (window.STATES_API && typeof window.STATES_API.isSubjectInGrade === 'function') {
        return window.STATES_API.isSubjectInGrade(state.slug, gradeSlug, subjSlug);
      }
      return subjSlug === 'math';
    };
    const lastSubj = readLastSubject();

    renderGreeting(state, gradeSlug);
    renderHeadline(state, gradeSlug);
    renderEarnHero(state, gradeSlug);
    renderContinueCard(state, gradeSlug, lastSubj);
    renderMindBlowerHero(state, gradeSlug);  // §121 — promoted ABOVE subjects
    renderSubjectTiles(state, gradeSlug, offeredFor, lastSubj);
    renderMoreWays(state, gradeSlug, offeredFor);
    renderSignupNudge();
    renderBreadcrumbChangeLink(state, gradeSlug);

    // ===== Reward strip + daily quest + review CTA (kept) =====
    // The earn-hero replaces the old reward strip visually, but the
    // daily-quest dialog wiring still depends on renderRewardStrip
    // installing the status bar. We render it below the greeting so
    // the streak / shield / quest chips remain accessible. The
    // earn-hero handles the "earn today" surface itself.
    try { renderRewardStrip(state, gradeSlug); } catch (e) { console.warn('[reward strip]', e); }
    try { renderDailyQuest(state, gradeSlug); } catch (e) { console.warn('[daily quest]', e); }
    try { renderReviewCta(state, gradeSlug); } catch (e) { console.warn('[review cta]', e); }

    // Cross-tab refresh hook — re-render the dynamic sections when
    // localStorage flips in another tab (kid playing on phone +
    // dashboard open on laptop).
    if (!window._gradePageV2RefreshBound) {
      window._gradePageV2RefreshBound = true;
      window.addEventListener('storage', (e) => {
        if (!e || !e.key) return;
        if (e.key.indexOf('staar.user') !== 0
          && e.key.indexOf('staar.journey.') !== 0
          && e.key.indexOf('gradeearn:achievements:') !== 0) return;
        try { renderEarnHero(state, gradeSlug); } catch (_) {}
        try { renderContinueCard(state, gradeSlug, readLastSubject()); } catch (_) {}
      });
    }
  }

  function readLastSubject() {
    try {
      const explicit = localStorage.getItem('staar.lastSubject');
      if (explicit) return explicit;
      const auth = window.STAARAuth;
      const u = auth && typeof auth.currentUser === 'function' && auth.currentUser();
      if (u && u.username) {
        const raw = localStorage.getItem(`staar.journey.${u.username}`);
        if (raw) {
          const j = JSON.parse(raw);
          return (j && j.lastSubject) || '';
        }
      }
    } catch (_) {}
    return '';
  }

  // ============================================================
  // §119 — Greeting block ("Hi {firstName} 👋" + "Texas · Grade 3")
  // ============================================================
  function renderGreeting(state, gradeSlug) {
    const host = document.getElementById('home-greeting');
    if (!host) return;
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    if (!u) {
      // Signed-out: hide the greeting; the signin CTA in the header
      // is the right affordance for a guest, not a "Hi guest 👋".
      host.hidden = true;
      return;
    }
    const display = String(u.displayName || u.username || '').trim();
    const firstName = display.split(/\s+/)[0] || display;
    const gradeName = GRADE_NAMES[gradeSlug] || gradeSlug;
    host.innerHTML = `
      <h1 class="home-greeting-title">Hi ${escapeHtml(firstName)} <span class="home-greeting-wave" aria-hidden="true">👋</span></h1>
      <p class="home-greeting-sub">${escapeHtml(state.name || 'Texas')} · ${escapeHtml(gradeName)}</p>
    `;
    host.hidden = false;
  }

  // ============================================================
  // §119 — Earn today hero (progress bar + cents math)
  // ============================================================
  // The mockup says "15¢ of 50¢ · 35¢ left · about 7 more questions".
  // We pay 15¢ per correct answer. Daily target = 50¢ (≈ 4 correct
  // answers to clear the bar). Earned today = today's correct count
  // × 15. "Questions remaining" assumes the kid's recent accuracy on
  // this grade (clamped to 50% so we don't lie low to a struggling
  // kid). For cold-start kids the band still renders, just at 0%.
  const EARN_TARGET_CENTS = 50;
  const CENTS_PER_CORRECT = 15;
  function renderEarnHero(state, gradeSlug) {
    const host = document.getElementById('earn-hero');
    if (!host) return;
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    if (!u) { host.hidden = true; return; }
    const today = todayIsoLocal();
    let correctToday = 0;
    let answeredToday = 0;
    try {
      const raw = localStorage.getItem(`staar.journey.${u.username}`);
      if (raw) {
        const j = JSON.parse(raw);
        const d = j && j.daily && j.daily[today];
        if (d) {
          correctToday = parseInt(d.correct, 10) || 0;
          answeredToday = parseInt(d.answered, 10) || 0;
        }
      }
    } catch (_) {}
    const earnedCents = Math.min(EARN_TARGET_CENTS, correctToday * CENTS_PER_CORRECT);
    const remainingCents = Math.max(0, EARN_TARGET_CENTS - earnedCents);
    const pct = Math.round((earnedCents / EARN_TARGET_CENTS) * 100);
    // Recent accuracy → questions-left estimate. Clamp to [0.4, 1.0]
    // so the projection stays helpful even for shaky days.
    let acc = 0.6;
    if (answeredToday >= 4) acc = Math.max(0.4, Math.min(1.0, correctToday / answeredToday));
    const questionsLeft = Math.max(0, Math.ceil(remainingCents / (CENTS_PER_CORRECT * acc)));
    const subText = (remainingCents === 0)
      ? "You hit today's target. Anything more is bonus."
      : `${remainingCents}¢ left · about ${questionsLeft} more question${questionsLeft === 1 ? '' : 's'}`;
    host.innerHTML = `
      <div class="earn-hero-row">
        <span class="earn-hero-label">Earn today</span>
        <span class="earn-hero-target"><span class="earn-hero-earned">${earnedCents}¢</span> of ${EARN_TARGET_CENTS}¢</span>
      </div>
      <div class="earn-hero-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${EARN_TARGET_CENTS}" aria-valuenow="${earnedCents}" aria-label="Today's earn progress">
        <div class="earn-hero-bar-fill" style="width: ${pct}%"></div>
      </div>
      <p class="earn-hero-sub">${escapeHtml(subText)}</p>
    `;
    host.hidden = false;
  }
  function todayIsoLocal() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // ============================================================
  // §119 — Continue card (last unit + 5-dot progress + CTA)
  // ============================================================
  // The continue card surfaces the most recently practiced unit.
  // Data sources, in order: (a) staar.journey.<user>.lastUnit +
  // lastUnitTitle written by practice.js at session end; (b) the
  // dominant unit pulled from mastery stats; (c) hide.
  function renderContinueCard(state, gradeSlug, lastSubj) {
    const host = document.getElementById('continue-card-wrap');
    if (!host) return;
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    if (!u || !lastSubj) { host.hidden = true; return; }
    let lastUnit = null, lastUnitTitle = null, lastResult = null;
    try {
      const raw = localStorage.getItem(`staar.journey.${u.username}`);
      if (raw) {
        const j = JSON.parse(raw);
        lastUnit = j && j.lastUnit || null;
        lastUnitTitle = j && j.lastUnitTitle || null;
        // §119 — practice.js (May 16) writes lastSessionResult on
        // finish: { correct, total, subject, unit, at }. We require
        // the subject/unit to match what we're surfacing so a kid
        // who finished reading then came back to math doesn't see
        // stale "4 of 5".
        const r = j && j.lastSessionResult;
        if (r && r.subject === lastSubj && (!lastUnit || r.unit === lastUnit)) {
          lastResult = r;
        }
      }
    } catch (_) {}

    const subjLabel = (lastSubj === 'math' ? 'Math' :
                      lastSubj === 'reading' ? 'Reading' :
                      lastSubj === 'science' ? 'Science' :
                      lastSubj === 'social-studies' ? 'Social Studies' :
                      lastSubj.charAt(0).toUpperCase() + lastSubj.slice(1));
    // Title: prefer lastUnitTitle; else "Continue practicing"
    const title = lastUnitTitle
      ? `${subjLabel} · ${lastUnitTitle}`
      : `${subjLabel} practice`;
    // Sub-line: prefer "You got X of Y last time" if we have a session
    // result; else encourage line.
    let sub = '';
    let dots = '';
    if (lastResult && lastResult.total > 0) {
      const c = Math.max(0, Math.min(lastResult.total, parseInt(lastResult.correct, 10) || 0));
      sub = `You got ${c} of ${lastResult.total} last time`;
      const dotCount = Math.min(5, lastResult.total);
      const filledShare = c / lastResult.total;
      const filled = Math.round(filledShare * dotCount);
      dots = Array.from({ length: dotCount }, (_, i) =>
        `<span class="continue-dot${i < filled ? ' continue-dot--correct' : ''}" aria-hidden="true"></span>`
      ).join('');
    } else {
      sub = 'Pick up where you left off';
    }
    // CTA target: math goes through topic picker; other subjects go
    // straight to practice.html. If we have a lastUnit, deep-link
    // directly into that unit so the kid lands on the exact set.
    const baseParams = `s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(lastSubj)}`;
    const targetUrl = (lastSubj === 'math')
      ? (lastUnit
          ? `practice.html?${baseParams}&u=${encodeURIComponent(lastUnit)}`
          : `subject.html?${baseParams}`)
      : `practice.html?${baseParams}`;

    host.innerHTML = `
      <a class="continue-card" href="${escapeHtml(targetUrl)}" aria-label="Continue ${escapeHtml(title)}">
        <span class="continue-card-eyebrow">CONTINUE</span>
        <div class="continue-card-row">
          <div class="continue-card-body">
            <h2 class="continue-card-title">${escapeHtml(title)}</h2>
            <p class="continue-card-sub">${escapeHtml(sub)}</p>
            ${dots ? `<div class="continue-card-progress" aria-hidden="true">${dots}</div>` : ''}
          </div>
          <span class="continue-card-cta">
            <span>Continue</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
          </span>
        </div>
      </a>
    `;
    host.hidden = false;
  }

  // ============================================================
  // §119 — Subject tiles (compact 3-up grid)
  // ============================================================
  // Renders the §117 subjects (Math/Reading/Science/Social Studies)
  // as a tile grid. Tiles for subjects that aren't offered or aren't
  // live get a subtle "Soon"/"Not tested" footer instead of being
  // hidden — the kid still sees the slot, just dim.
  // §121 — One-line subtitle per subject tile to give the kid a hint
  // of what each path teaches. Sourced from SUBJECTS[*].tagline,
  // shortened to ≤ 22 chars so it fits the 4-up grid on phone.
  const _SUBJECT_TILE_SUBS = {
    'math': 'Place value, fractions',
    'reading': 'Comprehension, vocab',
    'science': 'Earth, life, physical',
    'social-studies': 'History, geography'
  };
  function renderSubjectTiles(state, gradeSlug, offeredFor, lastSubj) {
    const grid = document.getElementById('subject-grid');
    if (!grid) return;
    grid.innerHTML = SUBJECTS.map(subj => {
      const offered = offeredFor(subj.slug);
      const isLive = offered && ((typeof subj.liveForGrade === 'function')
        ? subj.liveForGrade(state.slug, gradeSlug)
        : subj.live);
      const targetUrl = isLive
        ? (subj.slug === 'math'
            ? `subject.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}`
            : `practice.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}`)
        : null;
      const tag = isLive ? 'a' : 'div';
      const hrefAttr = isLive ? `href="${targetUrl}"` : '';
      let stateClass = '', footer = '';
      if (!offered) {
        stateClass = ' subject-tile--unavailable';
        footer = '<span class="subject-tile-footer">Not tested</span>';
      } else if (!isLive) {
        stateClass = ' subject-tile--soon';
        footer = `<span class="subject-tile-footer">${escapeHtml((subj.eta || 'Soon').toUpperCase())}</span>`;
      } else if (subj.slug === lastSubj) {
        stateClass = ' subject-tile--continue';
      }
      const sub = isLive ? (_SUBJECT_TILE_SUBS[subj.slug] || '') : '';
      const subHtml = sub
        ? `<span class="subject-tile-sub">${escapeHtml(sub)}</span>`
        : '';
      const ariaLabel = isLive ? `Practice ${subj.name}` : `${subj.name} — not yet available`;
      return `
        <${tag} class="subject-tile${stateClass}" ${hrefAttr} data-subject="${escapeHtml(subj.slug)}" ${isLive ? `role="button" aria-label="${escapeHtml(ariaLabel)}"` : 'aria-disabled="true"'}>
          <span class="subject-tile-icon" aria-hidden="true">${getSubjectIcon(subj.icon)}</span>
          <span class="subject-tile-name">${escapeHtml(subj.name)}</span>
          ${subHtml}
          ${footer}
        </${tag}>
      `;
    }).join('');
    grid.querySelectorAll('.subject-tile').forEach(t => {
      t.addEventListener('touchstart', () => {
        try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
      }, { passive: true });
    });
  }

  // ============================================================
  // §119 — Today's Mind-Blower teaser
  // ============================================================
  // Pulls one fact from window.FunFacts.loadCatalog(), filtered by
  // the kid's age band, deterministically picked by date so the
  // teaser is stable across navigations within a day. Tapping the
  // teaser deep-links into /facts.html?age=<band> where the kid can
  // open the Discovery Deck.
  // §121 — Mind Blower HERO. Promoted from a one-line teaser pill to
  // the visual hero of the page. Hamid explicit ask: "It should be
  // the visual hero of this page, not a tertiary pill."
  //
  // Bug fix included: the prior §119 implementation read `f.text` but
  // the actual catalog field is `f.fact` — the teaser never rendered
  // for that reason. Switched to `f.fact` with `f.text` as fallback.
  //
  // Selection logic per spec:
  //  - Filter by grade-band (k-2 / 3-4 / 5-8)
  //  - Prefer facts with `_judgedAt` set (judged content is higher
  //    quality and ready for the AI "Why?" reveal in the deck)
  //  - Session-cached: sessionStorage key
  //    `gradeearn_today_mindblower_{ageBand}` so the kid sees the
  //    same fact across page revisits in one session
  //  - Right-side category-emoji tile pulled from the Discovery
  //    Deck's CATEGORIES map (one place where emoji is allowed
  //    because it's the content of the featured card).
  const _MB_CATEGORY_EMOJI = {
    'animals': '🐾', 'space': '🪐', 'body': '🫀', 'food': '🍯',
    'texas': '⭐', 'sports': '🏀', 'inventions': '💡', 'history': '🏛',
    'math-numbers': '🔢', 'weird-funny': '✨', 'dinosaurs': '🦕',
    'music': '🎵', 'geography': '🌍', 'robots-tech': '🤖',
    'mythology': '🐉', 'all': '✨'
  };
  function renderMindBlowerHero(state, gradeSlug) {
    const host = document.getElementById('mindblower-wrap');
    if (!host || !window.FunFacts || typeof window.FunFacts.loadCatalog !== 'function') return;
    const gradeNum = (() => {
      const m = String(gradeSlug || '').match(/^grade-(\d+|k)$/);
      if (!m) return null;
      if (m[1] === 'k') return 0;
      return parseInt(m[1], 10);
    })();
    const ageBand = (gradeNum == null) ? 'all' :
                    gradeNum <= 2 ? 'k-2' :
                    gradeNum <= 4 ? '3-4' : '5-8';
    const gradeLabel = GRADE_NAMES[gradeSlug] || gradeSlug;

    window.FunFacts.loadCatalog().then(catalog => {
      if (!Array.isArray(catalog) || catalog.length === 0) return;
      const matchBand = (f) => {
        if (ageBand === 'all') return true;
        if (f.gradeLevel === ageBand) return true;
        if (Array.isArray(f.gradeLevels) && f.gradeLevels.indexOf(ageBand) >= 0) return true;
        return false;
      };
      const pool = catalog.filter(matchBand);
      const arr = pool.length > 0 ? pool : catalog;
      const factCount = pool.length;

      // Session-cached selection — keeps the same fact across page
      // navigations in one session.
      const sessKey = `gradeearn_today_mindblower_${ageBand}`;
      let fact = null;
      try {
        const cachedId = sessionStorage.getItem(sessKey);
        if (cachedId) fact = arr.find(f => f && f.id === cachedId) || null;
      } catch (_) {}

      if (!fact) {
        // Prefer judged facts; fall back to any.
        const judged = arr.filter(f => f && f._judgedAt);
        const selectFrom = judged.length > 0 ? judged : arr;
        // Deterministic pick by date so the "today" feel holds even
        // without sessionStorage (e.g. private mode).
        const d = new Date();
        const seedStr = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${ageBand}`;
        let seed = 0;
        for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) & 0x7fffffff;
        fact = selectFrom[seed % selectFrom.length];
        try { if (fact && fact.id) sessionStorage.setItem(sessKey, fact.id); } catch (_) {}
      }
      if (!fact) return;
      // Field is `fact` (not `text`) — schema verified 2026-05-17.
      const factText = String(fact.fact || fact.text || '').trim();
      if (!factText) return;
      const emoji = _MB_CATEGORY_EMOJI[fact.category] || _MB_CATEGORY_EMOJI.all;
      const factsUrl = `/facts.html?age=${ageBand}${fact.category ? '&cat=' + encodeURIComponent(fact.category) : ''}`;
      const countLabel = factCount > 0
        ? `${factCount.toLocaleString('en-US')} facts for ${escapeHtml(gradeLabel)}`
        : '';

      // Decorative sparkles (3 of them, varied sizes/positions, low
      // opacity). Anchored top-right via CSS.
      const sparklesHtml = `
        <span class="mindblower-hero-sparkles" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/></svg>
          <svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/></svg>
          <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="opacity:0.6;"><path d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"/></svg>
        </span>`;

      host.innerHTML = `
        <a class="mindblower-hero" href="${escapeHtml(factsUrl)}" aria-label="Today's mind-blower — open Mind Blowers">
          ${sparklesHtml}
          <div class="mindblower-hero-body">
            <span class="mindblower-hero-eyebrow">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 18a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2zM9 18a6 6 0 0 1 6-6 6 6 0 0 1-6-6 6 6 0 0 1-6 6 6 6 0 0 1 6 6z"/></svg>
              <span>TODAY'S MIND-BLOWER</span>
            </span>
            <p class="mindblower-hero-fact">${escapeHtml(factText)}</p>
            <div class="mindblower-hero-actions">
              <span class="mindblower-hero-cta">
                <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="14" height="16" rx="2"/><path d="M7 5V3a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2"/></svg>
                <span>Open the deck</span>
              </span>
              ${countLabel ? `<span class="mindblower-hero-count">${countLabel}</span>` : ''}
            </div>
          </div>
          <span class="mindblower-hero-emoji" aria-hidden="true">${emoji}</span>
        </a>
      `;
      host.hidden = false;
    }).catch(() => {});
  }

  // ============================================================
  // §121 — Headline block (logged-out only)
  // ============================================================
  // "You're in." + "Let's earn." (display serif with gold "earn").
  // Skipped for logged-in users — the §119 greeting + earn-hero +
  // continue-card stack carries the welcome moment for them.
  function renderHeadline(state, gradeSlug) {
    const host = document.getElementById('home-headline');
    if (!host) return;
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    if (u) { host.hidden = true; return; }
    host.innerHTML = `
      <span class="home-headline-eyebrow">You're in.</span>
      <h1 class="home-headline-title">Let's <span class="home-headline-gold">earn.</span></h1>
    `;
    host.hidden = false;
  }

  // ============================================================
  // §121 — Sign-up nudge (logged-out only)
  // ============================================================
  function renderSignupNudge() {
    const host = document.getElementById('signup-nudge');
    if (!host) return;
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null;
    if (u) { host.hidden = true; return; }
    host.innerHTML = `
      <span>Want to track your earnings?</span><a href="index.html#auth">Sign up free →</a>
    `;
    host.hidden = false;
  }

  // ============================================================
  // §121 — Breadcrumb "change" link
  // ============================================================
  // The existing breadcrumb prints "Texas · Grade 3" but offers no
  // affordance to switch. Adds a small "change" link that points
  // back to the state's grade picker.
  function renderBreadcrumbChangeLink(state, gradeSlug) {
    const last = document.getElementById('breadcrumb-grade');
    if (!last || last.querySelector('.breadcrumb-change-link')) return;
    const url = `states/?s=${encodeURIComponent(state.slug)}`;
    const link = document.createElement('a');
    link.className = 'breadcrumb-change-link';
    link.href = url;
    link.textContent = 'change';
    link.setAttribute('aria-label', 'Change state or grade');
    last.appendChild(link);
  }

  // ============================================================
  // §119 — More-ways-to-practice accordion (collapsed by default)
  // ============================================================
  // Native <details> for a11y + zero JS. The chips inside are the
  // §117 set: Mock test, Print worksheet, Review wrong answers,
  // Mind Blowers — all inline Tabler SVG, no OS emoji.
  function renderMoreWays(state, gradeSlug, offeredFor) {
    const body = document.getElementById('more-ways-body');
    if (!body) return;
    const liveSubjects = SUBJECTS.filter(s => offeredFor(s.slug)).filter(s => {
      const isLive = (typeof s.liveForGrade === 'function')
        ? s.liveForGrade(state.slug, gradeSlug)
        : s.live;
      return isLive;
    });
    if (liveSubjects.length === 0) {
      const wrap = document.getElementById('more-ways');
      if (wrap) wrap.hidden = true;
      return;
    }
    const TI_PRINTER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 17h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2"/><path d="M17 9V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2v4"/><rect x="7" y="13" width="10" height="8" rx="1"/></svg>';
    const TI_CLIPBOARD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>';
    const TI_RELOAD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19.95 11a8 8 0 1 0-.5 4m.5 5v-5h-5"/></svg>';
    const TI_SPARKLES = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 18a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2zm0-12a2 2 0 0 1 2 2 2 2 0 0 1 2-2 2 2 0 0 1-2-2 2 2 0 0 1-2 2zM9 18a6 6 0 0 1 6-6 6 6 0 0 1-6-6 6 6 0 0 1-6 6 6 6 0 0 1 6 6z"/></svg>';
    const mockChips = liveSubjects.map(subj => {
      const url = `practice.html?mock=1&s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}&n=40`;
      return `<a class="subject-extra-chip subject-extra-chip--mock" href="${url}">${TI_CLIPBOARD}<span>Mock ${escapeHtml(subj.name)} test</span></a>`;
    }).join('');
    const printChips = liveSubjects.map(subj => {
      const url = `practice.html?print=1&s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}&n=10`;
      return `<a class="subject-extra-chip" href="${url}">${TI_PRINTER}<span>Print ${escapeHtml(subj.name)} worksheet</span></a>`;
    }).join('');
    const reviewUrl = `practice.html?review=1&s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=math`;
    const reviewChip = `<a class="subject-extra-chip subject-extra-chip--review" href="${reviewUrl}">${TI_RELOAD}<span>Review your wrong answers</span></a>`;
    // §121 — Mind Blowers chip REMOVED from the accordion. It's now
    // the hero card above the subjects; surfacing it here too would
    // dilute the hierarchy. TI_SPARKLES const left untouched above —
    // unused by this function now but kept available for any future
    // consumer that wants the same outline icon.
    body.innerHTML = mockChips + printChips + reviewChip;
  }

  // ============================================================
  // STATUS BAR — §84 minimalist redesign (May 13).
  //
  // The old 3-stat-card row (`.reward-strip` with Level / streak /
  // shields cards) and the old "Today's quest" card with 3 sub-tasks
  // are both replaced by a single inline chip row that sits above
  // the subject picker. Subjects ARE the page; everything else is a
  // whisper.
  //
  // Layout:  [Texas · Kindergarten]               [🔥 N] [🛡 N] [✓ Quest D/T · +R¢]
  // Tabler-style outline SVG icons inline (no emoji). Quest chip
  // tap → opens native <dialog> popover with the 3 sub-tasks +
  // progress bars (the detail the old card always showed).
  // ============================================================

  // Tabler-style inline SVGs (outline, currentColor) used in the
  // status bar chips. Kept here so the renderer is self-contained.
  const TI_FLAME = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 12c2-2.96 0-7-1-8 0 3.038-1.773 4.741-3 6-1.226 1.26-2 3.24-2 5a6 6 0 1 0 12 0c0-1.532-1.056-3.94-2-5-1.786 3-2.791 3-4 2Z"/></svg>';
  const TI_SHIELD = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a12 12 0 0 0 8.5 3 12 12 0 0 1-8.5 15A12 12 0 0 1 3.5 6 12 12 0 0 0 12 3"/></svg>';
  const TI_CHECKLIST = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.615 20H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v6.5"/><path d="M14 19l2 2 4-4"/><path d="M9 8h4M9 12h2"/></svg>';
  const TI_CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>';

  function renderRewardStrip(state, gradeSlug) {
    if (!window.Achievements) return;
    const stats = window.Achievements.getStats();
    const lev = window.Achievements.levelFromXp(stats.xp || 0);
    const grid = document.getElementById('subject-grid');
    if (!grid) return;
    const section = grid.closest('.subject-section') || grid.parentNode;
    // §15: Hard gate. Achievements stores per-browser localStorage stats
    // even for guests (it seeds 1 XP on first page visit), so the earlier
    // hasAnyValue check still rendered "Level 1 · 1/25 XP" to signed-out
    // visitors. Root fix: signed-out users NEVER see the stat strip —
    // they haven't earned anything yet, the cards are pure noise.
    const auth = window.STAARAuth;
    const isSignedIn = !!(auth && typeof auth.currentUser === 'function' && auth.currentUser());
    // For signed-in users, still hide if all three values are zero (a
    // returning user shouldn't see "0 days · no shields yet" placeholders
    // either — the existing §10 zero-state rule applies).
    const hasAnyValue = (stats.xp || 0) > 0
      || (stats.loginStreak || 0) > 0
      || (stats.streakShields || 0) > 0;
    if (!isSignedIn || !hasAnyValue) {
      const existing = document.querySelector('.reward-strip');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      maybeRenderZeroStateTagline();
      return;
    }
    // Stash the level on the module so populateSubjects() can surface
    // it as a subtitle on the last-practiced subject row.
    _latestLevel = lev;
    // Remove any pre-§84 reward-strip card if it's still in the DOM
    // from cached markup.
    const oldStrip = document.querySelector('.reward-strip');
    if (oldStrip && oldStrip.parentNode) oldStrip.parentNode.removeChild(oldStrip);

    // (Re-)render the §84 inline status bar.
    let bar = document.querySelector('.home-status-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'home-status-bar';
      section.parentNode.insertBefore(bar, section);
    }
    bar.innerHTML = buildStatusBarHtml(stats, state, gradeSlug);
    wireStatusBar(bar);
    // Quest chip details come from renderDailyQuest() — it populates
    // the chip contents now that the big card is gone.
    maybeRenderZeroStateTagline();
  }
  // Module-scoped — populated by renderRewardStrip, read by
  // populateSubjects to print the level subtitle on the last
  // practiced subject row only.
  let _latestLevel = null;

  function buildStatusBarHtml(stats, state, gradeSlug) {
    const streak = stats.loginStreak || 0;
    const shields = stats.streakShields || 0;
    // §117 — The "Texas · Grade <N>" context chip was duplicating the
    // breadcrumb above (which already prints the same string). Removed.
    // Status bar is now chips-only; chips right-align via the parent
    // .home-status-bar (`justify-content: flex-end` override in §117 CSS).
    return `
      <div class="home-status-chips" role="group" aria-label="Today's status">
        <span class="home-status-chip home-status-chip--streak" title="${streak} day streak">
          <span class="home-status-chip-ico" aria-hidden="true">${TI_FLAME}</span>
          <span class="home-status-chip-num">${streak}</span>
        </span>
        <span class="home-status-chip home-status-chip--shields" title="${shields} shield${shields === 1 ? '' : 's'}">
          <span class="home-status-chip-ico" aria-hidden="true">${TI_SHIELD}</span>
          <span class="home-status-chip-num">${shields}</span>
        </span>
        <button type="button" class="home-status-chip home-status-chip--quest" data-quest-chip aria-haspopup="dialog">
          <span class="home-status-chip-ico" aria-hidden="true">${TI_CHECKLIST}</span>
          <span class="home-status-chip-num" data-quest-progress>—</span>
          <span class="home-status-chip-reward" data-quest-reward></span>
        </button>
      </div>`;
  }

  function wireStatusBar(bar) {
    if (!bar || bar.dataset.wired === '1') return;
    bar.dataset.wired = '1';
    // §117 — Context chip removed (was duplicating breadcrumb). The
    // breadcrumb itself is the path to switch state/grade.
    // Quest chip opens the detail dialog. Dialog is rendered into the
    // body by openQuestDialog() the first time so the bar markup
    // stays compact.
    const questChip = bar.querySelector('[data-quest-chip]');
    if (questChip) {
      questChip.addEventListener('click', openQuestDialog);
    }
  }

  function openQuestDialog() {
    if (!window.Achievements) return;
    let dlg = document.getElementById('home-quest-dialog');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'home-quest-dialog';
      dlg.className = 'home-quest-dialog';
      document.body.appendChild(dlg);
      dlg.addEventListener('click', (e) => {
        // Backdrop dismiss — close when click lands on the dialog
        // itself (not on inner content).
        if (e.target === dlg) dlg.close();
      });
    }
    const m = window.Achievements.getDailyMissionState();
    const tasksHtml = (m.tasks || []).map(t => {
      const pct = t.target > 0 ? Math.min(100, Math.round(((t.current || 0) / t.target) * 100)) : 0;
      return `
        <div class="dq-task ${t.done ? 'dq-task--done' : ''}" data-task-id="${escapeHtml(t.id)}">
          <div class="dq-task-body">
            <div class="dq-task-label">${escapeHtml(t.label)}</div>
            <div class="dq-task-progress"><div class="dq-task-progress-bar" style="width:${pct}%"></div></div>
            <div class="dq-task-sub">${t.current || 0} / ${t.target}</div>
          </div>
        </div>`;
    }).join('');
    dlg.innerHTML = `
      <div class="home-quest-dialog-head">
        <div class="home-quest-dialog-title">Today's quest</div>
        <div class="home-quest-dialog-reward">+${m.rewardCents}¢ all done</div>
        <button type="button" class="home-quest-dialog-close" aria-label="Close" data-act="close">×</button>
      </div>
      <div class="home-quest-dialog-tasks">${tasksHtml}</div>
      ${m.completed ? '<div class="home-quest-dialog-done">Quest complete.</div>' : ''}
    `;
    dlg.querySelector('[data-act="close"]').addEventListener('click', () => dlg.close());
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  // ============================================================
  // DAILY QUEST CARD — 3 sub-tasks above subject grid
  // ============================================================
  // §84 — quest card is replaced by a chip + dialog. This function
  // now ONLY populates the chip text on the status bar; the detail
  // (3 sub-tasks + progress bars) lives in the dialog opened by the
  // chip click. Quest tracking + reward computation are unchanged.
  function renderDailyQuest(state, gradeSlug) {
    if (!window.Achievements) return;
    const m = window.Achievements.getDailyMissionState();
    // Strip the legacy big-card render if it's still in the DOM from
    // cached markup.
    const legacy = document.querySelector('.daily-quest-card-grade');
    if (legacy && legacy.parentNode) legacy.parentNode.removeChild(legacy);

    const bar = document.querySelector('.home-status-bar');
    if (!bar) return;
    const chip = bar.querySelector('[data-quest-chip]');
    if (!chip) return;
    const progressEl = chip.querySelector('[data-quest-progress]');
    const rewardEl   = chip.querySelector('[data-quest-reward]');
    const tasks = Array.isArray(m.tasks) ? m.tasks : [];
    const done = tasks.filter(t => t.done).length;
    const total = tasks.length || 0;
    if (progressEl) progressEl.textContent = total ? `${done}/${total}` : '—';
    if (rewardEl)   rewardEl.textContent   = m.rewardCents ? ` · +${m.rewardCents}¢` : '';
    if (m.completed) chip.classList.add('home-status-chip--quest-done');
    else chip.classList.remove('home-status-chip--quest-done');
  }

  // ============================================================
  // REVIEW CTA — surfaces spaced-rep due-list as a first-class call
  // ============================================================
  function renderReviewCta(state, gradeSlug) {
    if (!window.GradeEarnSpacedRep) return;
    let stats;
    try { stats = window.GradeEarnSpacedRep.getStats(); } catch (_) { return; }
    if (!stats || !stats.due) return; // nothing due, hide
    const grid = document.getElementById('subject-grid');
    if (!grid) return;
    const section = grid.closest('.subject-section') || grid.parentNode;
    let card = document.querySelector('.review-cta-card');
    if (!card) {
      card = document.createElement('a');
      card.className = 'review-cta-card';
      card.href = `practice.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=math&review=1`;
      section.parentNode.insertBefore(card, section);
    }
    card.innerHTML = `
      <div class="review-cta-emoji" aria-hidden="true">↻</div>
      <div class="review-cta-body">
        <div class="review-cta-eyebrow">Spaced repetition</div>
        <div class="review-cta-title">Review your wrong answers</div>
        <div class="review-cta-sub">${stats.due} question${stats.due === 1 ? '' : 's'} ready for another shot · best way to lock in mastery</div>
      </div>
      <div class="review-cta-arrow">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
      </div>
    `;
  }

  // §117 — Tabler-style outline SVG icons, gold (currentColor). The
  // math icon is a serif "123" glyph (typographic) instead of an X+
  // line pattern — kids read it as "numbers", not "close".
  function getSubjectIcon(name) {
    const icons = {
      'math': `<span class="subject-card-icon-glyph" aria-hidden="true">123</span>`,
      'reading': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M3 19a9 9 0 0 1 9 0 9 9 0 0 1 9 0"/><path d="M3 6a9 9 0 0 1 9 0 9 9 0 0 1 9 0"/><path d="M3 6v13"/><path d="M12 6v13"/><path d="M21 6v13"/></svg>`,
      'science': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="1.5"/><path d="M12 21.5C7 19 4 16 4 12s3-7 8-9.5"/><path d="M12 21.5C17 19 20 16 20 12s-3-7-8-9.5"/><path d="M3.5 14.5c3.5 1 8 .5 12-2s7-5.5 5-7"/><path d="M3.5 9.5c3.5-1 8-.5 12 2s7 5.5 5 7"/></svg>`,
      'globe': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8"/><path d="M3.6 15h16.8"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/></svg>`
    };
    return icons[name] || icons.math;
  }

  // ============================================================
  // NAV SIMPLIFICATION — signed-out kids/parents see only Home,
  // Games, Toys + the Sign in slot. Trophies / League / How it
  // works require an account to be meaningful, so they're hidden
  // for a cleaner first-touch header.
  // ============================================================
  // §11/§19 — superseded by js/site-header.js (site-wide nav normalizer).
  // The old keep-set used relative paths that didn't match site-header's
  // absolute-path hrefs, hiding everything. Kept as no-op for back-compat.
  function simplifyNavForSignedOut() {
    return;
    // eslint-disable-next-line no-unreachable
    const auth = window.STAARAuth;
    if (auth && typeof auth.currentUser === 'function' && auth.currentUser()) return;
    const nav = document.querySelector('.site-header .nav');
    if (!nav) return;
    const keep = new Set(['index.html', 'games.html', 'marketplace.html']);
    nav.querySelectorAll('a').forEach((a) => {
      const href = (a.getAttribute('href') || '').trim();
      if (!keep.has(href)) a.hidden = true;
    });
  }

  // ============================================================
  // ZERO-STATE TAGLINE — shown only when reward strip + daily quest
  // are both hidden (brand-new kid). One-liner that sets the value
  // prop before the kid scans the subject picker.
  // ============================================================
  function maybeRenderZeroStateTagline() {
    // §90 KILL-HOME — the 'Practice. Earn real cents. Redeem toys.'
    // tagline is marketing copy. After §84 killed the reward strip
    // and quest card, this tagline started rendering on EVERY
    // grade.html (because the rewardVisible/questVisible gates
    // never returned true). It's appropriate on the unauthed
    // marketing landing, not on an authed product surface. Strip
    // any pre-existing rendering of it and never render again.
    const existing = document.querySelector('.zero-state-tagline');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.body.classList.remove('has-zero-state');
  }

  // ============================================================
  // BREADCRUMB COMPACTION — on direct deep-link visits (no
  // in-app referrer within last 5 min), shrink the breadcrumb to
  // just the current grade. Kids who navigated index → state →
  // grade see the full trail; kids who landed via search / share
  // / typed URL don't.
  // ============================================================
  function maybeCompactBreadcrumb() {
    const nav = document.querySelector('.breadcrumb-nav');
    if (!nav) return;
    const FLAG_KEY = 'ge:nav:inflow';
    const FIVE_MIN = 5 * 60 * 1000;
    let inFlow = false;
    try {
      const raw = sessionStorage.getItem(FLAG_KEY);
      if (raw) {
        const ts = parseInt(raw, 10);
        if (Number.isFinite(ts) && (Date.now() - ts) < FIVE_MIN) inFlow = true;
      }
    } catch (_) {}
    // Same-origin referrer is also a valid signal — covers first-visit
    // navigation before sessionStorage was set.
    if (!inFlow && document.referrer) {
      try {
        const refOrigin = new URL(document.referrer).origin;
        if (refOrigin === window.location.origin) inFlow = true;
      } catch (_) {}
    }
    if (inFlow) {
      // Refresh the flag so onward navigation within this session keeps it warm.
      try { sessionStorage.setItem(FLAG_KEY, String(Date.now())); } catch (_) {}
      return;
    }
    nav.classList.add('breadcrumb-nav--compact');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
