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

    // §84 minimalism — subject cards become two-line rows:
    //   [icon] {Name}                                        [→ / badge]
    //          Level N · M/T XP   (only on last-practiced)
    // The level subtitle surfaces the GLOBAL level (Achievements
    // doesn't track per-subject XP yet) only on the subject the kid
    // most recently practiced, so it reads as "Continue here" rather
    // than duplicating the same number on every row.
    const lastSubj = (function () {
      try {
        const explicit = localStorage.getItem('staar.lastSubject');
        if (explicit) return explicit;
        // Fall back to the per-user journey record practice.js writes.
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
    })();
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
        trailing = `<span class="list-card-chevron" aria-hidden="true">${TI_CHEVRON}</span>`;
      }
      const ariaLabel = isLive ? `Practice ${subj.name}` : `${subj.name} — not yet available`;
      const isContinue = isLive && subj.slug === lastSubj;
      const continueClass = isContinue ? ' subject-card--continue' : '';
      const levelSub = (isLive && isContinue && _latestLevel)
        ? `<div class="subject-card-sub">Level ${_latestLevel.level} · ${_latestLevel.inLevelXp}/${_latestLevel.levelSpan} XP</div>`
        : '';

      return `
        <${tag} class="list-card subject-card ${stateClass}${continueClass}" ${hrefAttr} data-subject="${escapeHtml(subj.slug)}" ${isLive ? `role="button" aria-label="${escapeHtml(ariaLabel)}"` : 'aria-disabled="true"'}>
          <span class="list-card-icon" style="--subject-color: ${subj.color}" aria-hidden="true">
            ${getSubjectIcon(subj.icon)}
          </span>
          <span class="subject-card-text">
            <h3 class="list-card-title">${escapeHtml(subj.name)}</h3>
            ${levelSub}
          </span>
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
    const gradeName = (function () {
      const map = {
        'grade-k':'Kindergarten','grade-1':'Grade 1','grade-2':'Grade 2','grade-3':'Grade 3',
        'grade-4':'Grade 4','grade-5':'Grade 5','grade-6':'Grade 6','grade-7':'Grade 7',
        'grade-8':'Grade 8'
      };
      return map[gradeSlug] || gradeSlug;
    })();
    // Quest chip — count + reward come from Achievements; chip body
    // is populated/refreshed by renderDailyQuest() via [data-quest-chip].
    return `
      <button type="button" class="home-status-context" data-action="switch-state" aria-label="Change state or grade">
        <span>${escapeHtml(state.name || 'Texas')}</span>
        <span class="home-status-sep" aria-hidden="true">·</span>
        <span>${escapeHtml(gradeName)}</span>
      </button>
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
    // Context chip (state · grade). Switcher not yet wired — TODO §84.
    // For now: route to state-picker on home so the kid has a path
    // forward instead of a dead tap.
    const ctx = bar.querySelector('[data-action="switch-state"]');
    if (ctx) {
      ctx.addEventListener('click', () => {
        window.location.href = 'index.html#state-picker';
      });
    }
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
