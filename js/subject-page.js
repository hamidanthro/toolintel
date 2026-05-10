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
      subjLabel.textContent = subjectName + ' topics';
    }
  }

  function setHero(state, gradeName, subjectName) {
    const eb = $('hero-eyebrow-text');
    const h1 = $('hero-title');
    const sub = $('hero-sub');
    if (eb) eb.textContent = `${state ? state.name : 'Texas'} · ${gradeName} · ${subjectName}`;
    if (h1) h1.textContent = `Pick a ${subjectName.toLowerCase()} topic`;
    if (sub) sub.textContent = 'Focused practice on one topic, or mixed practice across every topic. Both pull from the same large question pool.';
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

  // Per-user mastery — read from STAARStats if available so kids see
  // a tiny progress badge per topic. Falls back gracefully if absent.
  function masteryForUnit(unitId) {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      const who = (u && u.username) ? u.username : 'anon';
      const key = `staar.stats.${who}.${GRADE_SLUG}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const stats = JSON.parse(raw);
      if (!stats || !stats.units || !stats.units[unitId]) return null;
      const r = stats.units[unitId];
      if (!r.total) return null;
      return { total: r.total, correct: r.correct || 0, pct: Math.round((r.correct || 0) / r.total * 100) };
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

  function buildTopicCard(unit, unitIndex) {
    const qCount = unitQuestionCount(unit);
    const mastery = masteryForUnit(unit.id);
    const masteryHtml = mastery
      ? `<div class="topic-card-stat">${mastery.correct}/${mastery.total} correct · ${mastery.pct}%</div>`
      : `<div class="topic-card-stat topic-card-stat--ghost">${qCount} questions</div>`;
    const targetUrl = `practice.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(GRADE_SLUG)}&subj=${encodeURIComponent(SUBJ_SLUG)}&u=${encodeURIComponent(unit.id)}`;
    const glyph = topicGlyph(unit.title);
    return `
      <a class="subject-card subject-card--live topic-card" href="${escapeHtml(targetUrl)}" role="button" data-topic="${escapeHtml(unit.id)}">
        <div class="subject-card-icon topic-card-icon" aria-hidden="true">${escapeHtml(glyph)}</div>
        <div class="subject-card-body">
          <h3 class="subject-card-name">${escapeHtml(unit.title)}</h3>
          <p class="subject-card-tagline">${escapeHtml(unit.lessons.length)} lesson${unit.lessons.length === 1 ? '' : 's'} · pulls from every question in this topic</p>
          ${masteryHtml}
        </div>
        <div class="subject-card-action">
          <span class="subject-card-cta">Practice</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </div>
      </a>
    `;
  }

  function buildMixedCard(totalQuestions) {
    const targetUrl = `practice.html?s=${encodeURIComponent(STATE_SLUG)}&g=${encodeURIComponent(GRADE_SLUG)}&subj=${encodeURIComponent(SUBJ_SLUG)}`;
    return `
      <a class="subject-card subject-card--live topic-card topic-card--mixed" href="${escapeHtml(targetUrl)}" role="button" data-topic="mixed">
        <div class="subject-card-icon topic-card-icon" aria-hidden="true">🎲</div>
        <div class="subject-card-body">
          <h3 class="subject-card-name">Mixed practice</h3>
          <p class="subject-card-tagline">Questions from every topic, mixed together · ${totalQuestions.toLocaleString()} questions in the bank</p>
          <div class="topic-card-stat topic-card-stat--ghost">Best for review and STAAR-day prep</div>
        </div>
        <div class="subject-card-action">
          <span class="subject-card-cta">Start</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
        </div>
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
      showError('Pick a grade first', 'We need to know which grade to load topics for.');
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

    const total = curr.units.reduce((s, u) => s + unitQuestionCount(u), 0);

    const topicCards = curr.units.map((u, i) => buildTopicCard(u, i)).join('');
    grid.innerHTML = topicCards + buildMixedCard(total);

    if (loading) loading.hidden = true;
    if (content) content.hidden = false;

    // Mobile haptic on tap (matches grade-page behavior).
    document.querySelectorAll('.topic-card').forEach(c => {
      c.addEventListener('touchstart', () => {
        try { navigator.vibrate && navigator.vibrate(10); } catch (_) {}
      }, { passive: true });
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
