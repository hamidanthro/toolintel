/**
 * GradeEarn — ABOUT PAGE RENDERER
 *
 * Reads ?s=<slug> from URL (optional). If present, renders state-flavored
 * content + JSON-LD with areaServed. If absent, renders generic about with
 * an all-states preview chip list.
 *
 * Word-of-mouth optimization: when a Texas parent shares the link, the
 * recipient lands on a Texas-flavored explanation, not a generic one.
 */

(function () {
  const SITE_ORIGIN = location.origin && /^https?:/.test(location.origin)
    ? location.origin
    : 'https://gradeearn.com';
  const STATES = window.STATES_API;

  function init() {
    const params = new URLSearchParams(location.search);
    const slug = params.get('s');

    if (!slug) {
      renderStatesPreview();
      return;
    }

    const state = STATES && STATES.getBySlug && STATES.getBySlug(slug);
    if (!state) {
      // Invalid slug — fall back to generic.
      renderStatesPreview();
      return;
    }

    renderStateContext(state);
  }

  // ============================================================
  // GENERIC (no state context)
  // ============================================================
  function renderStatesPreview() {
    const list = document.getElementById('about-states-preview-list');
    if (!list || !STATES || !STATES.getAlphabetical) return;

    const states = STATES.getAlphabetical();
    const counts = {};
    states.forEach(s => {
      const k = s.testName || '—';
      counts[k] = (counts[k] || 0) + 1;
    });
    const tests = Object.keys(counts).sort();

    list.innerHTML = tests.map(testName => `
      <span class="about-state-chip">
        <span class="about-state-chip-name">${escapeHtml(testName)}</span>
        ${counts[testName] > 1 ? `<span class="about-state-chip-count">${counts[testName]} states</span>` : ''}
      </span>
    `).join('');
  }

  // ============================================================
  // STATE-AWARE (with ?s=<slug>)
  // ============================================================
  function renderStateContext(state) {
    const breadcrumb = document.getElementById('about-breadcrumb');
    if (breadcrumb) {
      breadcrumb.hidden = false;
      const stateLink = document.getElementById('breadcrumb-state');
      if (stateLink) {
        stateLink.textContent = state.name;
        stateLink.setAttribute('href', `states/?s=${encodeURIComponent(state.slug)}`);
      }
    }

    updateSEO(state);
    updateHero(state);
    updateHowItWorks(state);
    renderStateDetail(state);
    const preview = document.getElementById('about-states-preview');
    if (preview) preview.hidden = true;
    updateFinalCTA(state);
  }

  function updateSEO(state) {
    const title = `How GradeEarn works for ${state.name} families — ${state.testName} test prep`;
    const description = `${state.testName} practice for ${state.name} kids. AI-powered, aligned to ${state.name} state standards. Real toys for correct answers. Free during beta.`;

    document.title = title;
    setTextById('page-title', title);
    setAttrById('page-description', 'content', description);

    const canonical = `${SITE_ORIGIN}/about.html?s=${encodeURIComponent(state.slug)}`;
    setAttrById('page-canonical', 'href', canonical);

    setAttrById('og-title', 'content', title);
    setAttrById('og-description', 'content', description);
    setAttrById('og-url', 'content', canonical);
    setAttrById('twitter-title', 'content', title);
    setAttrById('twitter-description', 'content', description);

    const jsonld = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: title,
      description: description,
      publisher: { '@type': 'Organization', name: 'GradeEarn', url: SITE_ORIGIN },
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      about: {
        '@type': 'EducationalOrganization',
        name: state.testName,
        areaServed: { '@type': 'State', name: state.name }
      }
    };
    const tag = document.getElementById('page-jsonld');
    if (tag) tag.textContent = JSON.stringify(jsonld);
  }

  function updateHero(state) {
    setTextById('about-hero-eyebrow',
      `For ${state.name} parents who care about ${state.testName} prep, but not about being annoying about it`);

    const title = document.getElementById('about-hero-title');
    if (title) {
      title.innerHTML = `How GradeEarn works for <span class="about-hero-state">${escapeHtml(state.name)}</span> families.`;
    }

    const sub = document.getElementById('about-hero-sub');
    if (sub) {
      sub.innerHTML = `Your kid practices for the <strong>${escapeHtml(state.testName)}</strong>, the test the <strong>${escapeHtml(state.testAuthorityShort || state.name + ' DOE')}</strong> actually administers. They earn cents. When the balance hits a toy's price, you ship them one. We built it because nothing on the market actually <em>worked</em> on our kids. This does.`;
    }
  }

  function updateHowItWorks(state) {
    const step1 = document.getElementById('step-1-text');
    if (!step1) return;
    step1.innerHTML = `We tailor every question to <strong>${escapeHtml(state.testName)}</strong>, the test administered by the ${escapeHtml(state.testAuthorityShort || state.name + ' DOE')}. Aligned to the ${escapeHtml(state.name)} standards your kid's school actually teaches.`;
  }

  function renderStateDetail(state) {
    const card = document.getElementById('about-state-detail');
    if (!card) return;

    setTextById('coverage-eyebrow', `For ${state.name} families`);
    setTextById('coverage-title', `Built for the ${state.testName}.`);
    const sub = document.getElementById('coverage-sub');
    if (sub) {
      sub.innerHTML = `Every question matches the format, the rigor, and the standards of the actual ${escapeHtml(state.testName)}, the test administered by the ${escapeHtml(state.testAuthorityShort || state.name + ' DOE')}.`;
    }

    setTextById('about-state-eyebrow', `${state.name} · ${state.testAuthorityShort || ''}`);
    setTextById('about-state-title', state.testFullName || state.testName);
    setTextById('about-state-desc', state.description || '');

    setTextById('about-state-grades', formatGradesList(state.gradesTested));
    setTextById('about-state-window', state.testWindow || '—');
    setTextById('about-state-subjects', state.whatItCovers || '—');

    setTextById('about-state-cta-test-name', state.testName);
    const cta = document.getElementById('about-state-detail-cta');
    if (cta) cta.setAttribute('href', `states/?s=${encodeURIComponent(state.slug)}`);

    card.hidden = false;
  }

  function updateFinalCTA(state) {
    setTextById('about-cta-title', `Ready for ${state.testName} practice?`);
    setTextById('about-cta-sub', `Free during beta. Your ${state.name} kid picks toys. We ship them.`);
    setTextById('about-cta-btn-label', `Start ${state.testName} practice`);
    const btn = document.getElementById('about-cta-btn');
    if (btn) btn.setAttribute('href', `states/?s=${encodeURIComponent(state.slug)}`);
  }

  // ============================================================
  // UTIL
  // ============================================================
  function formatGradesList(grades) {
    if (!grades || !grades.length) return '—';
    const hasK = grades.includes('grade-k');
    const hasAlgebra = grades.includes('algebra-1');
    const nums = grades
      .map(s => {
        const m = String(s).match(/^grade-(\d+)$/);
        return m ? parseInt(m[1], 10) : null;
      })
      .filter(n => n !== null)
      .sort((a, b) => a - b);

    let display = '';
    if (nums.length > 1) display = `${nums[0]}–${nums[nums.length - 1]}`;
    else if (nums.length === 1) display = `${nums[0]}`;
    if (hasK) display = display ? `K, ${display}` : 'K';
    if (hasAlgebra) display = display ? `${display} + Algebra 1` : 'Algebra 1';
    return display || '—';
  }

  function setTextById(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setAttrById(id, attr, value) {
    const el = document.getElementById(id);
    if (el) el.setAttribute(attr, value);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
