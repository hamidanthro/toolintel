/**
 * GradeEarn — TOPIC EXPLANATION PAGE (§78 May 13)
 *
 * Reads ?g=<gradeSlug>&u=<unitId>&subj=<subject>&s=<stateSlug> from the
 * URL and renders an internal explanation page for that practice
 * topic. The kid lands here from a "Read about this topic" link on
 * subject.html (or from the practice page mid-session).
 *
 * Renders:
 *   - Topic eyebrow (grade + subject) + title
 *   - Unit summary (one-sentence headline)
 *   - "What you'll learn" — bulleted list of lesson objectives
 *   - "Try these two" — two worked examples (prompt + answer +
 *     explanation revealed inline; not interactive — these are
 *     teaching examples, not practice questions)
 *   - "Back to practice" CTA (reconstructs the practice URL from
 *     params, with subject + unit if applicable)
 */
(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const gradeSlug   = (params.get('g') || '').trim();
  const unitId      = (params.get('u') || '').trim();
  const subjectSlug = (params.get('subj') || 'math').trim().toLowerCase();
  const stateSlug   = (params.get('s') || 'texas').trim().toLowerCase();

  const $ = (id) => document.getElementById(id);
  const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');

  function showError() {
    const loading = $('topic-loading');
    const error   = $('topic-error');
    if (loading) loading.hidden = true;
    if (error)   error.hidden = false;
    const eback = $('topic-error-back');
    if (eback) eback.setAttribute('href', practiceUrl());
  }

  // Construct the URL that takes the kid back into practice for this
  // exact grade + subject + unit. Mirrors the wirePracticeCTAs router
  // in index.html: subject.html for math (topic picker), practice.html
  // for reading/science (single-question flow).
  function practiceUrl() {
    // If we know the unit, deep-link directly to practice for that unit
    if (unitId) {
      return `practice.html?s=${encodeURIComponent(stateSlug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subjectSlug)}&u=${encodeURIComponent(unitId)}`;
    }
    // No unit — return to the topic picker for math, otherwise practice
    if (subjectSlug === 'math') {
      return `subject.html?s=${encodeURIComponent(stateSlug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subjectSlug)}`;
    }
    return `practice.html?s=${encodeURIComponent(stateSlug)}&g=${encodeURIComponent(gradeSlug)}&subj=${encodeURIComponent(subjectSlug)}`;
  }

  function wireCloseLinks() {
    const url = practiceUrl();
    ['topic-back', 'topic-close', 'topic-cta-bottom', 'topic-error-back'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.setAttribute('href', url);
      // If history is available, prefer history.back so the kid lands
      // EXACTLY where they came from (preserves practice progress).
      el.addEventListener('click', (e) => {
        // Allow command-click / middle-click to open in new tab as usual
        if (e.metaKey || e.ctrlKey || e.button === 1) return;
        // If there's a referrer on the same origin, use history.back
        if (document.referrer && document.referrer.indexOf(location.origin) === 0) {
          e.preventDefault();
          history.back();
        }
        // Otherwise fall through to the href
      });
    });
  }

  function curriculumUrl(grade) {
    // Map gradeSlug to the data filename
    const norm = String(grade).toLowerCase();
    if (norm === 'algebra-1') return '/data/algebra-1-curriculum.json';
    return `/data/${norm}-curriculum.json`;
  }

  async function loadCurriculum(grade) {
    const res = await fetch(curriculumUrl(grade), { cache: 'force-cache' });
    if (!res.ok) throw new Error('curriculum ' + res.status);
    return res.json();
  }

  function gradeDisplay(slug) {
    const map = {
      'grade-k': 'Kindergarten', 'grade-1': 'Grade 1', 'grade-2': 'Grade 2',
      'grade-3': 'Grade 3', 'grade-4': 'Grade 4', 'grade-5': 'Grade 5',
      'grade-6': 'Grade 6', 'grade-7': 'Grade 7', 'grade-8': 'Grade 8',
      'algebra-1': 'Algebra 1'
    };
    return map[slug] || slug;
  }

  function subjectDisplay(s) {
    return s === 'reading' ? 'Reading' : s === 'science' ? 'Science' : 'Math';
  }

  function pickExamples(unit, count) {
    // Walk lessons, take the first valid question from each. This
    // gives us topic-diverse worked examples rather than 2 from the
    // same lesson. If we run out of lessons before hitting `count`,
    // pull additional examples from the most-question-rich lesson.
    const out = [];
    if (!unit || !Array.isArray(unit.lessons)) return out;
    for (const lesson of unit.lessons) {
      if (out.length >= count) break;
      if (!Array.isArray(lesson.questions) || lesson.questions.length === 0) continue;
      // Prefer multiple_choice questions for cleaner worked examples
      const q = lesson.questions.find(q => q.type === 'multiple_choice' && q.answer) || lesson.questions[0];
      if (q && q.prompt) out.push({ q, lesson });
    }
    // Top up if needed from the first lesson's later questions
    if (out.length < count) {
      const first = unit.lessons.find(l => l.questions && l.questions.length > 1);
      if (first) {
        for (let i = 1; i < first.questions.length && out.length < count; i++) {
          out.push({ q: first.questions[i], lesson: first });
        }
      }
    }
    return out.slice(0, count);
  }

  function renderExample({ q, lesson }, idx) {
    const isChoice = q.type === 'multiple_choice' && Array.isArray(q.choices);
    const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
    const correctIdx = isChoice ? q.choices.indexOf(q.answer) : -1;
    const choicesHtml = isChoice
      ? q.choices.map((c, i) => {
          const isAns = i === correctIdx;
          return `<li class="topic-ex-choice${isAns ? ' topic-ex-choice--correct' : ''}">
            <span class="topic-ex-choice-letter">${LETTERS[i] || (i + 1)}</span>
            <span class="topic-ex-choice-text">${escHtml(c)}</span>
            ${isAns ? '<span class="topic-ex-choice-check" aria-hidden="true">✓</span>' : ''}
          </li>`;
        }).join('')
      : '';

    return `<article class="topic-example">
      <header class="topic-example-head">
        <span class="topic-example-eyebrow">Example ${idx + 1} · ${escHtml(lesson.title || 'Worked example')}</span>
      </header>
      <p class="topic-example-prompt">${escHtml(q.prompt)}</p>
      ${isChoice ? `<ul class="topic-ex-choices">${choicesHtml}</ul>` : ''}
      ${!isChoice && q.answer ? `<p class="topic-example-answer"><strong>Answer:</strong> ${escHtml(q.answer)}</p>` : ''}
      ${q.explanation ? `<div class="topic-example-explain"><span class="topic-example-explain-icon" aria-hidden="true">★</span> ${escHtml(q.explanation)}</div>` : ''}
    </article>`;
  }

  async function init() {
    wireCloseLinks();

    if (!gradeSlug || !unitId) {
      showError();
      return;
    }

    let curr;
    try {
      curr = await loadCurriculum(gradeSlug);
    } catch (e) {
      console.warn('[topic] curriculum load failed:', e && e.message);
      showError();
      return;
    }

    const unit = (curr && Array.isArray(curr.units))
      ? curr.units.find(u => u.id === unitId)
      : null;
    if (!unit) {
      showError();
      return;
    }

    // Populate
    const eyebrow = $('topic-eyebrow');
    const title   = $('topic-title');
    const summary = $('topic-summary');
    if (eyebrow) eyebrow.textContent = `${gradeDisplay(gradeSlug)} · ${subjectDisplay(subjectSlug)} · Unit ${unit.order || ''}`;
    if (title)   title.textContent = unit.title || 'Topic';
    if (summary) summary.textContent = unit.summary || '';

    // Objectives — bullets from each lesson
    const objList = $('topic-objectives');
    if (objList && Array.isArray(unit.lessons)) {
      const items = unit.lessons
        .filter(l => l.objective || l.title)
        .map(l => `<li>${escHtml(l.objective || l.title)}</li>`);
      if (items.length) {
        objList.innerHTML = items.join('');
        const sec = $('topic-objectives-section');
        if (sec) sec.hidden = false;
      }
    }

    // Two worked examples
    const examples = pickExamples(unit, 2);
    if (examples.length) {
      const ex = $('topic-examples');
      if (ex) ex.innerHTML = examples.map(renderExample).join('');
      const sec = $('topic-examples-section');
      if (sec) sec.hidden = false;
    }

    // Document title for tab + screen-reader users
    try { document.title = `${unit.title} — GradeEarn`; } catch (_) {}

    // Reveal content, hide loading
    const loading = $('topic-loading');
    const content = $('topic-content');
    if (loading) loading.hidden = true;
    if (content) content.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
