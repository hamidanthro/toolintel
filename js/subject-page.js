// GradeEarn — Subject (topic) picker page.
// URL params: ?s=<state>&g=<gradeSlug>&subj=<subject>
//
// Renders the curriculum's units as topic cards plus a "Mixed practice"
// option. Tapping a topic card navigates to practice.html with ?u=<unitId>;
// "Mixed practice" navigates without ?u= so practice.js pools every unit.
//
// Currently scoped to subject=math (only math has a unit-structured
// curriculum). Reading / science / social-studies are already pooled-
// passage delivery, so they bypass this page and link straight to
// practice.html from grade-page.js.

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const STATE_SLUG = params.get('s') || 'texas';
  const GRADE_SLUG = params.get('g') || '';
  const SUBJ_SLUG  = (params.get('subj') || 'math').toLowerCase();

  const $ = (id) => document.getElementById(id);
  const loading = $('subject-loading');
  const errBox = $('subject-error');
  const content = $('subject-content');
  const grid = $('topic-grid');

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showError(title, text) {
    if (loading) loading.hidden = true;
    if (content) content.hidden = true;
    if (errBox) {
      errBox.hidden = false;
      const t = errBox.querySelector('.state-error-title');
      const p = errBox.querySelector('.state-error-text');
      if (t && title) t.textContent = title;
      if (p && text) p.textContent = text;
    }
  }

  function gradeLabel(slug) {
    if (slug === 'grade-k') return 'Kindergarten';
    if (/^grade-\d+$/.test(slug)) return 'Grade ' + slug.slice(6);
    if (slug === 'algebra-1') return 'Algebra I';
    return slug;
  }

  function getStateRecord() {
    if (!Array.isArray(window.STATES)) return null;
    return window.STATES.find(s => s && s.slug === STATE_SLUG) || null;
  }

  function setBreadcrumbs(state, grade, subjectName) {
    const stateLink = $('breadcrumb-state');
    const gradeLink = $('breadcrumb-grade');
    const subjLabel = $('breadcrumb-subject');
    if (stateLink) {
      stateLink.textContent = (state && state.name) || STATE_SLUG;
      stateLink.href = `states/?s=${encodeURIComponent(STATE_SLUG)}`;
    }
    if (gradeLink) {
      gradeLink.textContent = gradeLabel(GRADE_SLUG);
      gradeLink.href = `grade.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(GRADE_SLUG)}`;
    }
    if (subjLabel) {
      // Minimalism pass: "Math" alone — the H1 says "Math topics", no
      // need to repeat "topics" in the breadcrumb tail.
      subjLabel.textContent = subjectName;
    }
  }

  // Compact-breadcrumb logic mirrors grade-page.js: in-app navigation
  // within the last 5 min keeps the full crumb visible; direct deep-
  // links (search results, shared URLs) collapse it to a smaller,
  // muted line so it reads as a back-anchor, not primary nav.
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
    if (!inFlow && document.referrer) {
      try {
        const refOrigin = new URL(document.referrer).origin;
        if (refOrigin === window.location.origin) inFlow = true;
      } catch (_) {}
    }
    if (inFlow) {
      try { sessionStorage.setItem(FLAG_KEY, String(Date.now())); } catch (_) {}
      return;
    }
    nav.classList.add('breadcrumb-nav--compact');
  }

  function setHero(state, gradeName, subjectName) {
    // Minimalism pass: hero block deleted from subject.html; only the
    // H1 ("Math topics") and the document.title remain.
    const h1 = $('hero-title');
    if (h1) h1.textContent = `${subjectName} topics`;
    document.title = `${subjectName} topics — ${gradeName} — GradeEarn`;
  }

  // Load curriculum JSON for the requested grade.
  async function loadCurriculum() {
    const url = `data/${encodeURIComponent(GRADE_SLUG)}-curriculum.json?v=20260510j`;
    const res = await fetch(url, { cache: 'force-cache' });
    if (!res.ok) throw new Error(`curriculum ${res.status}`);
    return res.json();
  }

  // Topic stats: total questions per unit, used to render a small badge.
  function unitQuestionCount(unit) {
    if (!unit || !Array.isArray(unit.lessons)) return 0;
    return unit.lessons.reduce((s, l) => s + ((l.questions && l.questions.length) || 0), 0);
  }

  // Per-user mastery using shared js/mastery.js. Returns the level
  // object (or null if no stats yet for that unit). Read from
  // localStorage. Mastery module gracefully handles missing stats.
  function masteryForUnit(unitId) {
    try {
      if (!window.Mastery) return null;
      const allStats = window.Mastery.loadStatsFor(GRADE_SLUG);
      if (!allStats || !allStats.units) return null;
      const unitStats = allStats.units[unitId];
      if (!unitStats || !unitStats.total) return null;
      return {
        ...window.Mastery.levelFor(unitStats),
        total: unitStats.total,
        correct: unitStats.correct || 0
      };
    } catch (_) { return null; }
  }

  // Pick an icon glyph that vaguely matches the unit by title keyword.
  // Cheap heuristic — not a strict requirement, just helps kids tell
  // topics apart at a glance.
  function topicGlyph(title) {
    const t = (title || '').toLowerCase();
    if (t.includes('count') || t.includes('number') || t.includes('place value')) return '🔢';
    if (t.includes('fraction')) return '½';
    if (t.includes('addition') || t.includes('add') || t.includes('subtract')) return '➕';
    if (t.includes('multipl')) return '✖️';
    if (t.includes('divis')) return '➗';
    if (t.includes('shape') || t.includes('geometr')) return '🔷';
    if (t.includes('measur') || t.includes('perimeter') || t.includes('area')) return '📏';
    if (t.includes('time') || t.includes('clock')) return '⏰';
    if (t.includes('money') || t.includes('financ')) return '💵';
    if (t.includes('data') || t.includes('graph')) return '📊';
    if (t.includes('algebr') || t.includes('pattern')) return '🧮';
    if (t.includes('compare') || t.includes('compar')) return '⚖️';
    if (t.includes('word')) return '📝';
    if (t.includes('volum') || t.includes('weight')) return '🥛';
    return '📘';
  }

  // Minimalism pass: a topic card is icon + title + chevron. Nothing
  // else. Pool counts, lesson counts, mastery blurbs, and the inline
  // "Practice →" button-within-a-button are all gone — the card IS
  // the button. (Mastery state still surfaces elsewhere in the app;
  // we just don't crowd the picker with it.)
  function buildTopicCard(unit, unitIndex) {
    const targetUrl = `practice.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(GRADE_SLUG)}&subj=${encodeURIComponent(SUBJ_SLUG)}&u=${encodeURIComponent(unit.id)}`;
    const glyph = topicGlyph(unit.title);
    return `
      <a class="topic-card" href="${escapeHtml(targetUrl)}" data-topic="${escapeHtml(unit.id)}" aria-label="Practice ${escapeHtml(unit.title)}">
        <span class="topic-card-icon" aria-hidden="true">${escapeHtml(glyph)}</span>
        <h3 class="topic-card-title">${escapeHtml(unit.title)}</h3>
        <span class="topic-card-chevron" aria-hidden="true">→</span>
      </a>
    `;
  }

  function buildMixedCard(_totalQuestions) {
    const targetUrl = `practice.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(GRADE_SLUG)}&subj=${encodeURIComponent(SUBJ_SLUG)}`;
    return `
      <a class="topic-card topic-card--mixed" href="${escapeHtml(targetUrl)}" data-topic="mixed" aria-label="Start mixed practice">
        <span class="topic-card-icon" aria-hidden="true">🔀</span>
        <h3 class="topic-card-title">Mixed practice</h3>
        <span class="topic-card-chevron" aria-hidden="true">→</span>
      </a>
    `;
  }

  // Subject scoping: only math has a unit-structured curriculum today.
  // Other subjects bypass this page entirely (grade-page.js links them
  // straight to practice.html). If someone navigates here for a non-
  // math subject, we redirect rather than show an empty grid.
  function redirectIfNotMath() {
    if (SUBJ_SLUG !== 'math') {
      const url = `practice.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(GRADE_SLUG)}&subj=${encodeURIComponent(SUBJ_SLUG)}`;
      location.replace(url);
      return true;
    }
    return false;
  }

  async function init() {
    if (redirectIfNotMath()) return;
    if (!GRADE_SLUG) {
      // No grade specified — send to grade picker for Texas (Texas-only
      // product, see memory_texas_only.md). Do not show a dead-end.
      location.replace(`grade.html?s=${encodeURIComponent(STATE_SLUG || 'texas')}`);
      return;
    }

    let curr;
    try { curr = await loadCurriculum(); }
    catch (err) {
      console.warn('[subject-page] curriculum load failed:', err);
      showError('Could not load topics', 'There was a problem loading the practice topics. Try refreshing.');
      return;
    }

    if (!curr || !Array.isArray(curr.units) || curr.units.length === 0) {
      showError('No topics yet', 'No topics are available for this grade. Try Mixed practice instead.');
      return;
    }

    const state = getStateRecord();
    const subjectName = SUBJ_SLUG === 'math' ? 'Math' :
                        SUBJ_SLUG === 'reading' ? 'Reading' :
                        SUBJ_SLUG === 'science' ? 'Science' :
                        SUBJ_SLUG === 'social-studies' ? 'Social Studies' :
                        SUBJ_SLUG.charAt(0).toUpperCase() + SUBJ_SLUG.slice(1);
    const gradeName = gradeLabel(GRADE_SLUG);

    setBreadcrumbs(state, GRADE_SLUG, subjectName);
    setHero(state, gradeName, subjectName);
    try { maybeCompactBreadcrumb(); } catch (_) {}

    const total = curr.units.reduce((s, u) => s + unitQuestionCount(u), 0);

    // Minimalism pass: Mixed practice goes FIRST as the lead card —
    // it's the "I don't know what to pick" fallback. Specific units
    // follow.
    const topicCards = curr.units.map((u, i) => buildTopicCard(u, i)).join('');
    grid.innerHTML = buildMixedCard(total) + topicCards;

    if (loading) loading.hidden = true;
    if (content) content.hidden = false;

    // §75 — wire the "Browse fun facts" link to deep-link into
    // /facts.html with subject + age-band pre-selected. Maps the
    // user's grade slug to the catalog's gradeLevel bands.
    try {
      const factsLink = document.getElementById('subject-facts-link');
      if (factsLink) {
        const gradeNum = (() => {
          const m = String(slug || '').match(/^grade-(\d+|k)$/);
          if (!m) return null;
          if (m[1] === 'k') return 0;
          return parseInt(m[1], 10);
        })();
        const ageBand = (gradeNum == null || gradeNum < 0) ? 'all' :
                        gradeNum <= 2 ? 'k-2' :
                        gradeNum <= 4 ? '3-4' : '5-8';
        const subj = (subject || 'math').toLowerCase();
        const subjParam = (subj === 'math' || subj === 'reading' || subj === 'science') ? subj : 'all';
        factsLink.setAttribute('href', '/facts.html?subj=' + subjParam + '&age=' + ageBand);
      }
    } catch (_) {}

    // Mobile haptic on tap (matches grade-page behavior).
    document.querySelectorAll('.topic-card').forEach(c => {
      c.addEventListener('touchstart', () => {
        try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
      }, { passive: true });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
