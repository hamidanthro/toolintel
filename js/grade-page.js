/**
 * StarTest — GRADE PAGE RENDERER
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
      live: false,
      eta: 'Coming soon'
    },
    {
      slug: 'science',
      name: 'Science',
      tagline: 'Earth, life, physical, engineering.',
      icon: 'science',
      color: '#34d399',
      live: false,
      eta: 'Coming soon'
    },
    {
      slug: 'social-studies',
      name: 'Social Studies',
      tagline: 'History, geography, civics, economics.',
      icon: 'globe',
      color: '#f472b6',
      live: false,
      eta: 'Coming soon'
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
      showError('Loading error', 'Please refresh the page.', 'index.html#state-picker', 'Home');
      return;
    }

    const params = new URLSearchParams(location.search);
    const stateSlug = params.get('s');
    const gradeSlug = params.get('g');

    const state = stateSlug ? STATES.getBySlug(stateSlug) : null;
    if (!state) {
      showError(
        'State not found',
        "We need to know which state you're in to tailor practice.",
        'index.html#state-picker',
        'Pick your state'
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
    document.title = `${title} — StarTest`;
  }

  // ============================================================
  // SEO
  // ============================================================

  function populateSEO(state, gradeSlug, gradeName) {
    const title = `${state.testName} ${gradeName} Practice — StarTest`;
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
        name: 'StarTest',
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

    grid.innerHTML = SUBJECTS.map(subj => {
      const targetUrl = subj.live
        ? `practice.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subj.slug)}`
        : null;

      const tag = subj.live ? 'a' : 'div';
      const hrefAttr = subj.live ? `href="${targetUrl}"` : '';
      const liveClass = subj.live ? 'subject-card--live' : 'subject-card--soon';

      return `
        <${tag} class="subject-card ${liveClass}" ${hrefAttr} data-subject="${escapeHtml(subj.slug)}" ${subj.live ? 'role="button"' : 'aria-disabled="true"'}>
          <div class="subject-card-icon" style="--subject-color: ${subj.color}" aria-hidden="true">
            ${getSubjectIcon(subj.icon)}
          </div>
          <div class="subject-card-body">
            <h3 class="subject-card-name">${escapeHtml(subj.name)}</h3>
            <p class="subject-card-tagline">${escapeHtml(subj.tagline)}</p>
          </div>
          ${subj.live
            ? `<div class="subject-card-action">
                 <span class="subject-card-cta">Start</span>
                 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
               </div>`
            : `<div class="subject-card-badge">${escapeHtml(subj.eta || 'Coming soon')}</div>`
          }
        </${tag}>
      `;
    }).join('');
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
