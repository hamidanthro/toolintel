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
      // Texas Grade 8 has 14 STAAR-aligned passages live (US history
      // 1763-1877, Constitution, Civil War + Reconstruction). Other
      // grades stay 'Coming soon'. STAAR only tests SS at Grade 8.
      live: false,
      eta: 'Coming soon',
      liveForGrade: function (stateSlug, gradeSlug) {
        return stateSlug === 'texas' && gradeSlug === 'grade-8';
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

    const params = new URLSearchParams(location.search);
    const stateSlug = params.get('s');
    const gradeSlug = params.get('g');

    const state = stateSlug ? STATES.getBySlug(stateSlug) : null;
    if (!state) {
      showError(
        'State not found',
        "We're focused on Texas STAAR practice right now.",
        'index.html',
        'Try Texas STAAR practice'
      );
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
    document.getElementById('hero-eyebrow-text').textContent =
      `${state.name} · ${state.testName} · ${gradeName}`;

    document.getElementById('hero-title').innerHTML =
      `<span class="grade-hero-grade">${escapeHtml(gradeName)}</span> <span class="grade-hero-test">${escapeHtml(state.testName)}</span> practice`;

    document.getElementById('hero-sub').textContent =
      `Practice questions aligned to the ${state.testName}, the test administered by the ${state.testAuthorityShort}.`;
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

    grid.innerHTML = SUBJECTS.map(subj => {
      const offered = offeredFor(subj.slug);
      if (!offered) {
        const gradeLabel = (GRADE_NAMES[gradeSlug] || gradeSlug);
        return `
          <div class="subject-card subject-card--unavailable" data-subject="${escapeHtml(subj.slug)}" aria-disabled="true">
            <div class="subject-card-icon" style="--subject-color: ${subj.color}" aria-hidden="true">
              ${getSubjectIcon(subj.icon)}
            </div>
            <div class="subject-card-body">
              <h3 class="subject-card-name">${escapeHtml(subj.name)}</h3>
              <p class="subject-card-tagline">Not tested in ${escapeHtml(gradeLabel)} for ${escapeHtml(state.testName)}</p>
            </div>
          </div>
        `;
      }

      // Phase K — per-(state, grade) liveness override. Defaults to
      // subj.live for math/reading; science returns true only where
      // we have content seeded.
      const isLive = (typeof subj.liveForGrade === 'function')
        ? subj.liveForGrade(state.slug, gradeSlug)
        : subj.live;

      const targetUrl = isLive
        ? `practice.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}`
        : null;

      const tag = isLive ? 'a' : 'div';
      const hrefAttr = isLive ? `href="${targetUrl}"` : '';
      const liveClass = isLive ? 'subject-card--live' : 'subject-card--soon';

      return `
        <${tag} class="subject-card ${liveClass}" ${hrefAttr} data-subject="${escapeHtml(subj.slug)}" ${isLive ? 'role="button"' : 'aria-disabled="true"'}>
          <div class="subject-card-icon" style="--subject-color: ${subj.color}" aria-hidden="true">
            ${getSubjectIcon(subj.icon)}
          </div>
          <div class="subject-card-body">
            <h3 class="subject-card-name">${escapeHtml(subj.name)}</h3>
            <p class="subject-card-tagline">${escapeHtml(subj.tagline)}</p>
          </div>
          ${isLive
            ? `<div class="subject-card-action">
                 <span class="subject-card-cta">Start</span>
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
               </div>`
            : `<div class="subject-card-badge">${escapeHtml(subj.eta || 'Coming soon')}</div>`
          }
        </${tag}>
      `;
    }).join('');

    // H6: tap haptic on mobile when a kid presses a live subject card.
    // 10ms is the lightest possible — feels like a button click, not
    // a notification buzz. Touchstart fires before navigation so the
    // kid feels the response right when their finger lands.
    const cards = document.querySelectorAll('.subject-card--live');
    cards.forEach(c => {
      c.addEventListener('touchstart', () => {
        try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
      }, { passive: true });
    });

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

  function getSubjectIcon(name) {
    const icons = {
      'math': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="5" y1="19" x2="19" y2="5"/></svg>`,
      'reading': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>`,
      'science': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M9 2v6L4 18a2 2 0 002 3h12a2 2 0 002-3l-5-10V2"/><line x1="9" y1="2" x2="15" y2="2"/></svg>`,
      'globe': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`
    };
    return icons[name] || icons.math;
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
