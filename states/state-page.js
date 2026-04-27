/**
 * StarTest — STATE PAGE RENDERER
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
      showError();
      return;
    }

    const params = new URLSearchParams(location.search);
    const slug = params.get('s');

    if (!slug) {
      showError();
      return;
    }

    const state = STATES.getBySlug(slug);
    if (!state) {
      showError();
      return;
    }

    // Persist this choice
    try { localStorage.setItem('startest.state', slug); } catch (_) {}

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

  function showError() {
    const loading = document.getElementById('state-loading');
    if (loading) { loading.hidden = true; loading.style.display = 'none'; }
    const err = document.getElementById('state-error');
    if (err) err.hidden = false;
    document.title = 'State not found — StarTest';
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
      name: 'StarTest',
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
    document.getElementById('hero-eyebrow-text').textContent = state.name;

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

    document.getElementById('grade-sub-test').textContent = state.testName;

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
