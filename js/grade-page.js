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
      color: '#818cf8',
      live: true
    },
    {
      slug: 'science',
      name: 'Science',
      tagline: 'Earth, life, physical, engineering.',
      icon: 'science',
      color: '#34d399',
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
      color: '#f472b6',
      // Texas social studies live for K-8: K-3 practice (Texas symbols,
      // heroes, geography), G4-G7 middle-grade (US history overview,
      // world cultures, detailed Texas history), G8 STAAR-tested
      // (US history 1763-1877, Constitution).
      live: false,
      eta: 'Coming soon',
      liveForGrade: function (stateSlug, gradeSlug) {
        if (stateSlug !== 'texas') return false;
        return ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5','grade-6','grade-7','grade-8'].includes(gradeSlug);
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

  function populateSubjects(state, gradeSlug) {
    const grid = document.getElementById('subject-grid');

    // R1: per-state-per-grade subject availability. Falls back to true for math
    // if the helper is missing (back-compat).
    const offeredFor = function (subjSlug) {
      if (window.STATES_API && typeof window.STATES_API.isSubjectInGrade === 'function') {
        return window.STATES_API.isSubjectInGrade(state.slug, gradeSlug, subjSlug);
      }
      return subjSlug === 'math';
    };

    // §15 minimalism pass — subject cards become the same .list-card
    // shape as topic cards on subject.html: [icon] [title] [chevron].
    // Descriptor taglines and inline "Start →" buttons removed; the
    // whole card is the button. Unavailable subjects keep a small
    // muted badge in place of the chevron so kids see they're not
    // tappable (but at much lower visual weight than before).
    grid.innerHTML = SUBJECTS.map(subj => {
      const offered = offeredFor(subj.slug);
      const isLive = offered && ((typeof subj.liveForGrade === 'function')
        ? subj.liveForGrade(state.slug, gradeSlug)
        : subj.live);

      // Math has a unit-structured curriculum, so we route through the
      // topic picker (subject.html). Reading / science / social-studies
      // go straight to practice.html.
      const targetUrl = isLive
        ? (subj.slug === 'math'
            ? `subject.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}`
            : `practice.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}`)
        : null;

      const tag = isLive ? 'a' : 'div';
      const hrefAttr = isLive ? `href="${targetUrl}"` : '';
      let stateClass, trailing;
      if (!offered) {
        stateClass = 'list-card--unavailable subject-card--unavailable';
        trailing = `<span class="list-card-badge">Not tested</span>`;
      } else if (!isLive) {
        stateClass = 'list-card--soon subject-card--soon';
        trailing = `<span class="list-card-badge">${escapeHtml(subj.eta || 'Soon')}</span>`;
      } else {
        stateClass = 'list-card--live subject-card--live';
        trailing = `<span class="list-card-chevron" aria-hidden="true">→</span>`;
      }
      const ariaLabel = isLive ? `Practice ${subj.name}` : `${subj.name} — not yet available`;

      return `
        <${tag} class="list-card subject-card ${stateClass}" ${hrefAttr} data-subject="${escapeHtml(subj.slug)}" ${isLive ? `role="button" aria-label="${escapeHtml(ariaLabel)}"` : 'aria-disabled="true"'}>
          <span class="list-card-icon" style="--subject-color: ${subj.color}" aria-hidden="true">
            ${getSubjectIcon(subj.icon)}
          </span>
          <h3 class="list-card-title">${escapeHtml(subj.name)}</h3>
          ${trailing}
        </${tag}>
      `;
    }).join('');

    // H6: tap haptic on mobile when a kid presses a live subject card.
    const cards = document.querySelectorAll('.subject-card--live');
    cards.forEach(c => {
      c.addEventListener('touchstart', () => {
        try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
      }, { passive: true });
    });

    // ===== Reward strip + daily quest + review CTA on grade.html =====
    // Renders directly above the subject picker so kids see their
    // status (level, streak, shields) and today's quest before they
    // pick a subject. Level/streak/shield strip is tiny; daily quest
    // is a card; review CTA shows only when there are due items.
    try { renderRewardStrip(state, gradeSlug); } catch (e) { console.warn('[reward strip]', e); }
    try { renderDailyQuest(state, gradeSlug); } catch (e) { console.warn('[daily quest]', e); }
    try { renderReviewCta(state, gradeSlug); } catch (e) { console.warn('[review cta]', e); }

    // Cross-tab + within-page refresh: when localStorage changes
    // (kid playing in another tab bumps progress), re-render the
    // reward strip + daily quest so the dashboard reflects current
    // state. Listening to the storage event covers other-tab edits;
    // Achievements.onUnlock covers same-tab updates.
    if (!window._gradePageRefreshBound) {
      window._gradePageRefreshBound = true;
      window.addEventListener('storage', (e) => {
        if (!e || !e.key) return;
        const interesting = (
          e.key.indexOf('gradeearn:achievements:') === 0 ||
          e.key.indexOf('staar.stats.') === 0 ||
          e.key.indexOf('staar.user') === 0
        );
        if (!interesting) return;
        try { renderRewardStrip(state, gradeSlug); } catch (_) {}
        try { renderDailyQuest(state, gradeSlug); } catch (_) {}
        try { renderReviewCta(state, gradeSlug); } catch (_) {}
      });
      if (window.Achievements && window.Achievements.onUnlock) {
        window.Achievements.onUnlock(() => {
          try { renderRewardStrip(state, gradeSlug); } catch (_) {}
          try { renderDailyQuest(state, gradeSlug); } catch (_) {}
        });
      }
    }

    // J1: surface F10 print worksheets + F5 wrong-answer review.
    // Render a small "Practice extras" row below the subject grid.
    // Only shows live (offered) subjects so we don't print a
    // worksheet for content that doesn't exist for the kid's grade.
    const liveSubjects = SUBJECTS.filter(subj => offeredFor(subj.slug)).filter(subj => {
      const isLive = (typeof subj.liveForGrade === 'function')
        ? subj.liveForGrade(state.slug, gradeSlug)
        : subj.live;
      return isLive;
    });
    if (liveSubjects.length > 0) {
      const extras = document.createElement('div');
      extras.className = 'subject-extras';
      const printChips = liveSubjects.map(subj => {
        const url = `practice.html?print=1&s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}&n=10`;
        return `<a class="subject-extra-chip" href="${url}">🖨 Print ${escapeHtml(subj.name)} worksheet</a>`;
      }).join('');
      // Mock test chips — one per LIVE subject. Mock STAAR is a real
      // marketable feature: full-length timed test with predicted-score readout.
      const mockChips = liveSubjects.map(subj => {
        const url = `practice.html?mock=1&s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}&n=40`;
        return `<a class="subject-extra-chip subject-extra-chip--mock" href="${url}">📝 Mock ${escapeHtml(subj.name)} test (40q)</a>`;
      }).join('');
      const reviewUrl = `practice.html?review=1&s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=math`;
      const reviewChip = `<a class="subject-extra-chip subject-extra-chip--review" href="${reviewUrl}">↻ Review your wrong answers</a>`;
      extras.innerHTML = `
        <div class="subject-extras-label">More ways to practice</div>
        <div class="subject-extras-row">${mockChips}${printChips}${reviewChip}</div>
      `;
      grid.parentNode.insertBefore(extras, grid.nextSibling);
    }
  }

  // ============================================================
  // REWARD STRIP — level + streak + shields above subject grid
  // ============================================================
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
    if (!section || section.previousElementSibling && section.previousElementSibling.classList && section.previousElementSibling.classList.contains('reward-strip')) {
      // Already rendered — refresh contents
      const old = section.previousElementSibling;
      old.innerHTML = buildRewardStripHtml(stats, lev);
      return;
    }
    const strip = document.createElement('section');
    strip.className = 'reward-strip';
    strip.innerHTML = buildRewardStripHtml(stats, lev);
    section.parentNode.insertBefore(strip, section);
    maybeRenderZeroStateTagline();
  }
  function buildRewardStripHtml(stats, lev) {
    const shields = stats.streakShields || 0;
    const streak = stats.loginStreak || 0;
    const shieldRow = shields > 0
      ? Array.from({length: shields}).map(()=>'🛡').join('')
      : '<span class="reward-strip-shield-empty">no shields yet</span>';
    return `
      <a class="reward-strip-tile reward-strip-level" href="achievements.html" aria-label="Level ${lev.level}, ${lev.inLevelXp} of ${lev.levelSpan} XP toward next level">
        <div class="reward-strip-icon">⚡</div>
        <div class="reward-strip-body">
          <div class="reward-strip-label">Level ${lev.level}</div>
          <div class="reward-strip-progress"><div class="reward-strip-progress-bar" style="width:${lev.pct}%"></div></div>
          <div class="reward-strip-sub">${lev.inLevelXp} / ${lev.levelSpan} XP</div>
        </div>
      </a>
      <a class="reward-strip-tile reward-strip-streak" href="achievements.html" aria-label="${streak} day streak">
        <div class="reward-strip-icon">🔥</div>
        <div class="reward-strip-body">
          <div class="reward-strip-label">${streak} day${streak === 1 ? '' : 's'}</div>
          <div class="reward-strip-sub">streak</div>
        </div>
      </a>
      <a class="reward-strip-tile reward-strip-shields" href="achievements.html" aria-label="${shields} streak shields held">
        <div class="reward-strip-icon">🛡</div>
        <div class="reward-strip-body">
          <div class="reward-strip-label">${shields} shield${shields === 1 ? '' : 's'}</div>
          <div class="reward-strip-sub">${shieldRow}</div>
        </div>
      </a>
    `;
  }

  // ============================================================
  // DAILY QUEST CARD — 3 sub-tasks above subject grid
  // ============================================================
  function renderDailyQuest(state, gradeSlug) {
    if (!window.Achievements) return;
    const m = window.Achievements.getDailyMissionState();
    const grid = document.getElementById('subject-grid');
    if (!grid) return;
    const section = grid.closest('.subject-section') || grid.parentNode;
    // §15: same hard gate as renderRewardStrip — signed-out users never
    // see the daily quest card.
    const auth = window.STAARAuth;
    const isSignedIn = !!(auth && typeof auth.currentUser === 'function' && auth.currentUser());
    const hasAnyProgress = m.completed
      || (Array.isArray(m.tasks) && m.tasks.some(t => (t.current || 0) > 0));
    if (!isSignedIn || !hasAnyProgress) {
      const existing = document.querySelector('.daily-quest-card-grade');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      maybeRenderZeroStateTagline();
      return;
    }
    // Insert AFTER reward strip but BEFORE subject section
    let card = document.querySelector('.daily-quest-card-grade');
    if (!card) {
      card = document.createElement('section');
      card.className = 'daily-quest-card-grade';
      // Insert it just before the subject section
      section.parentNode.insertBefore(card, section);
    }
    const tasksHtml = m.tasks.map(t => {
      const pct = t.target > 0 ? Math.min(100, Math.round((t.current / t.target) * 100)) : 0;
      return `
        <div class="dq-task ${t.done ? 'dq-task--done' : ''}" data-task-id="${escapeHtml(t.id)}">
          <div class="dq-task-emoji" aria-hidden="true">${t.done ? '✅' : escapeHtml(t.emoji || '🎯')}</div>
          <div class="dq-task-body">
            <div class="dq-task-label">${escapeHtml(t.label)}</div>
            <div class="dq-task-progress"><div class="dq-task-progress-bar" style="width:${pct}%"></div></div>
            <div class="dq-task-sub">${t.current} / ${t.target}</div>
          </div>
        </div>
      `;
    }).join('');
    const completedHtml = m.completed
      ? `<div class="dq-completed">✨ Today's quest complete · +${m.rewardCents}¢ earned</div>`
      : '';
    card.innerHTML = `
      <div class="dq-head">
        <div class="dq-head-title">Today's quest</div>
        <div class="dq-head-reward">+${m.rewardCents}¢ all done</div>
      </div>
      <div class="dq-tasks">${tasksHtml}</div>
      ${completedHtml}
    `;
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

  function getSubjectIcon(name) {
    const icons = {
      'math': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="5" y1="19" x2="19" y2="5"/></svg>`,
      'reading': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>`,
      'science': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M9 2v6L4 18a2 2 0 002 3h12a2 2 0 002-3l-5-10V2"/><line x1="9" y1="2" x2="15" y2="2"/></svg>`,
      'globe': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`
    };
    return icons[name] || icons.math;
  }

  // ============================================================
  // NAV SIMPLIFICATION — signed-out kids/parents see only Home,
  // Games, Toys + the Sign in slot. Trophies / League / How it
  // works require an account to be meaningful, so they're hidden
  // for a cleaner first-touch header.
  // ============================================================
  function simplifyNavForSignedOut() {
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
    const grid = document.getElementById('subject-grid');
    if (!grid) return;
    const section = grid.closest('.subject-section');
    if (!section) return;
    const rewardVisible = !!document.querySelector('.reward-strip');
    const questVisible = !!document.querySelector('.daily-quest-card-grade');
    const existing = document.querySelector('.zero-state-tagline');
    if (rewardVisible || questVisible) {
      // Returning kid — drop tagline if it was previously rendered, drop the body
      // marker too so the subject-picker margin returns to its default rhythm.
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      document.body.classList.remove('has-zero-state');
      return;
    }
    document.body.classList.add('has-zero-state');
    if (existing) return;
    const tagline = document.createElement('div');
    tagline.className = 'zero-state-tagline';
    tagline.textContent = 'Practice. Earn real cents. Redeem toys.';
    section.parentNode.insertBefore(tagline, section);
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
