/**
 * GradeEarn — STATE PAGE RENDERER
 *
 * Reads ?s=<slug> from URL, looks up state metadata,
 * and populates the page with state-specific content.
 *
 * Also updates SEO meta tags dynamically for crawlers
 * that execute JavaScript (Googlebot does).
 */

(function () {
  const SITE_ORIGIN = location.origin;
  const STATES = window.STATES_API;

  // Hard kill: no matter what, hide the loading spinner after 10s.
  setTimeout(function () {
    const loading = document.getElementById('state-loading');
    if (loading) { loading.hidden = true; loading.style.display = 'none'; }
  }, 10000);

  function init() {
    if (!STATES) {
      // STATES_API not loaded — likely a script-load problem. Send home.
      location.replace('../index.html');
      return;
    }

    const params = new URLSearchParams(location.search);
    let slug = params.get('s');

    // Texas-only product (per memory_texas_only.md). Missing or
    // invalid slug → default to texas; do not surface a dead-end
    // error. The user is here to practice.
    if (!slug || !STATES.getBySlug(slug)) {
      const fixed = new URLSearchParams(location.search);
      fixed.set('s', 'texas');
      try {
        history.replaceState(null, '', location.pathname + '?' + fixed.toString() + location.hash);
      } catch (_) {}
      slug = 'texas';
    }

    const state = STATES.getBySlug(slug);
    if (!state) {
      // Catastrophic — texas record missing. Send home.
      location.replace('../index.html');
      return;
    }

    // §47 — Texas-only pivot. If the state record exists but is
    // marked active:false in states-data.js, render the
    // "Coming soon" fallback rather than a populated state page.
    // All routing + per-state data preserved; flip active:true to
    // re-activate. SEO meta tags get noindex on inactive states.
    if (state.active === false) {
      showInactive(state);
      return;
    }

    // Persist this choice
    try { localStorage.setItem('gradeearn.state', slug); } catch (_) {}

    // Populate
    populateSEO(state);
    populateBreadcrumb(state);
    populateHero(state);
    populateGradeGrid(state);
    populateTrust(state);
    populateCTA(state);

    // Show
    const loading = document.getElementById('state-loading');
    if (loading) { loading.hidden = true; loading.style.display = 'none'; }
    document.getElementById('state-content').hidden = false;
  }

  // §47 — Inactive-state fallback. Reuses the existing #state-error
  // shell with rewritten copy + a Texas redirect button. Adds a
  // <meta name="robots" content="noindex"> tag so Google doesn't
  // index 50 stub pages. Sets Texas-aligned SEO so any social
  // share preview from these URLs reads sensibly.
  // §65 (May 13) — DISABLED-STATE BEHAVIOR.
  // When a state has `active: false` in js/states-data.js (anything
  // other than Texas today), we now silently redirect home instead
  // of rendering a "Coming soon for X" page. The page-load barely
  // flashes; the kid lands on /index.html.
  //
  // GROWTH PATH — when Hamid is ready to launch California (or any
  // other state), the workflow is ONE LINE: flip `active: true` on
  // that state's record in `js/states-data.js`. The populate*
  // machinery below is fully wired and will render the same surface
  // Texas uses today. No edits to this file, no edits to markup,
  // no router changes. The full state-detail rendering pipeline
  // (populateSEO + populateBreadcrumb + populateHero + populateGradeGrid
  // + populateTrust + populateCTA) stays armed.
  //
  // The old `showInactive` body — which painted a "Coming soon for
  // {state}" surface — is preserved below the early-return for git
  // history and future use if we ever want a real waitlist page.
  function showInactive(state) {
    // Single source of truth: a disabled state means redirect home.
    try { sessionStorage.setItem('gradeearn.attemptedState', state.slug); } catch (_) {}
    location.replace('../index.html');
    return;

    // ----- preserved dead code (kept per "don't delete" rule) -----
    // To re-enable a real "Coming soon" surface in the future:
    // remove the redirect above. The block below renders the
    // §47-era waitlist page.
    /* eslint-disable */
    const loading = document.getElementById('state-loading');
    if (loading) { loading.hidden = true; loading.style.display = 'none'; }

    const inactiveTitle = `Coming soon for ${state.name} — GradeEarn`;
    const inactiveDesc = `GradeEarn is currently focused on Texas. ${state.name} support is coming.`;

    document.title = inactiveTitle;
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = inactiveTitle;
    const descEl = document.getElementById('page-description');
    if (descEl) descEl.setAttribute('content', inactiveDesc);
    const ogt = document.getElementById('og-title'); if (ogt) ogt.setAttribute('content', inactiveTitle);
    const ogd = document.getElementById('og-description'); if (ogd) ogd.setAttribute('content', inactiveDesc);
    const twt = document.getElementById('twitter-title'); if (twt) twt.setAttribute('content', inactiveTitle);
    const twd = document.getElementById('twitter-description'); if (twd) twd.setAttribute('content', inactiveDesc);

    // noindex — don't let Google rank stub pages.
    if (!document.querySelector('meta[name="robots"]')) {
      const robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      robots.setAttribute('content', 'noindex');
      document.head.appendChild(robots);
    }

    // Reuse #state-error shell with Texas-redirect copy.
    const err = document.getElementById('state-error');
    if (err) {
      const titleNode = err.querySelector('.state-error-title');
      const textNode = err.querySelector('.state-error-text');
      const ctaNode = err.querySelector('.state-error-cta');
      if (titleNode) titleNode.textContent = `Coming soon for ${state.name}`;
      if (textNode) textNode.textContent = `We're focused on Texas right now. ${state.name} is on the roadmap.`;
      if (ctaNode) {
        ctaNode.setAttribute('href', '../index.html');
        ctaNode.childNodes.forEach(n => { if (n.nodeType === 3) n.textContent = ''; });
        ctaNode.insertBefore(document.createTextNode('Practice now '), ctaNode.firstChild);
      }
      err.hidden = false;
    }

    const breadcrumb = document.getElementById('breadcrumb-state');
    if (breadcrumb) breadcrumb.textContent = `${state.name} · Coming soon`;
    /* eslint-enable */
  }

  function showError() {
    // Retained for legacy callers but no longer reachable from init().
    // The init() flow now always defaults to texas if the slug is missing
    // or invalid (Texas-only product, per memory_texas_only.md).
    const loading = document.getElementById('state-loading');
    if (loading) { loading.hidden = true; loading.style.display = 'none'; }
    location.replace('../index.html');
  }

  // ============================================================
  // SEO — title, meta, canonical, JSON-LD
  // ============================================================

  function populateSEO(state) {
    document.title = state.seoTitle;
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = state.seoTitle;

    document.getElementById('page-description').setAttribute('content', state.seoDescription);

    const canonical = `${SITE_ORIGIN}/states/?s=${state.slug}`;
    document.getElementById('page-canonical').setAttribute('href', canonical);

    document.getElementById('og-title').setAttribute('content', state.seoTitle);
    document.getElementById('og-description').setAttribute('content', state.seoDescription);
    document.getElementById('og-url').setAttribute('content', canonical);

    document.getElementById('twitter-title').setAttribute('content', state.seoTitle);
    document.getElementById('twitter-description').setAttribute('content', state.seoDescription);

    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'EducationalOrganization',
      name: 'GradeEarn',
      url: SITE_ORIGIN,
      description: state.seoDescription,
      areaServed: {
        '@type': 'State',
        name: state.name
      },
      offers: {
        '@type': 'Offer',
        name: `${state.testName} Test Prep`,
        description: state.description,
        price: '0',
        priceCurrency: 'USD',
        availability: 'https://schema.org/InStock'
      }
    };
    document.getElementById('page-jsonld').textContent = JSON.stringify(jsonld);
  }

  // ============================================================
  // BREADCRUMB
  // ============================================================

  function populateBreadcrumb(state) {
    document.getElementById('breadcrumb-state').textContent = `${state.name} · ${state.testName}`;
  }

  // ============================================================
  // HERO
  // ============================================================

  function populateHero(state) {
    document.getElementById('hero-title').innerHTML =
      `<span class="hero-test-name">${escapeHtml(state.testName)}</span> test prep, built for <span class="hero-state-name">${escapeHtml(state.name)}</span> families.`;

    document.getElementById('hero-sub').textContent = state.description;

    document.getElementById('hero-grades').textContent = formatGradesList(state.gradesTested);
    document.getElementById('hero-window').textContent = state.testWindow;
    document.getElementById('hero-authority').textContent = state.testAuthorityShort;

    if (state.customNotes) {
      document.getElementById('hero-note-text').textContent = state.customNotes;
      document.getElementById('hero-note').hidden = false;
    }
  }

  function formatGradesList(grades) {
    if (!grades || !grades.length) return '—';

    const hasK = grades.includes('grade-k');
    const hasAlgebra = grades.includes('algebra-1');

    const nums = grades
      .map(slug => {
        const m = slug.match(/^grade-(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter(g => g !== null)
      .sort((a, b) => a - b);

    let display = '';
    if (nums.length > 1) {
      display = `${nums[0]}–${nums[nums.length - 1]}`;
    } else if (nums.length === 1) {
      display = `${nums[0]}`;
    }

    if (hasK) display = display ? `K, ${display}` : 'K';
    if (hasAlgebra) display = display ? `${display} + Algebra 1` : 'Algebra 1';

    return display || '—';
  }

  // ============================================================
  // GRADE GRID
  // ============================================================

  function populateGradeGrid(state) {
    const grid = document.getElementById('state-grade-grid');

    // §41 (commit 9593091) removed the <span id="grade-sub-test"> from
    // states/index.html when stripping the "Each grade has its own
    // bank of practice questions, aligned to <test>" subhead. The
    // setter that lived here threw TypeError on every state-detail
    // page load, blocking populateGradeGrid before any grade buttons
    // rendered. Line removed in §43 (this commit).

    const gradeNames = {
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

    const shortLabels = {
      'grade-k': 'K',
      'algebra-1': 'A1'
    };

    grid.innerHTML = state.gradesTested.map(slug => {
      const m = slug.match(/grade-(\d+)/);
      const shortLabel = shortLabels[slug] || (m ? m[1] : '—');
      const fullName = gradeNames[slug] || slug;
      const targetUrl = `../grade.html?s=${encodeURIComponent(state.slug)}&g=${encodeURIComponent(slug)}`;

      return `
        <a class="state-grade-card" href="${targetUrl}" role="listitem" data-grade="${escapeHtml(slug)}">
          <span class="state-grade-card-name">${escapeHtml(fullName)}</span>
        </a>
      `;
    }).join('');
  }

  // ============================================================
  // TRUST CARDS
  // ============================================================

  function populateTrust(state) {
    document.getElementById('trust-test-name').textContent = state.testName;

    document.getElementById('trust-standards').textContent =
      `Practice questions match the format and rigor of the ${state.testName}, the test administered by the ${state.testAuthorityShort}.`;

    document.getElementById('trust-subjects').textContent = state.whatItCovers;

    document.getElementById('trust-window').textContent =
      `${state.testName} is administered ${state.testWindow.toLowerCase()}. Practicing year-round builds the deepest mastery.`;

    document.getElementById('trust-authority').textContent = state.testAuthority;
    document.getElementById('trust-authority-link').setAttribute('href', state.testAuthorityUrl);
  }

  // ============================================================
  // CTA STRIP
  // ============================================================

  function populateCTA(state) {
    document.getElementById('cta-strip-test').textContent = state.testName;

    document.getElementById('cta-strip-scroll').addEventListener('click', () => {
      document.getElementById('state-grade-section').scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }

  // ============================================================
  // UTIL
  // ============================================================

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
