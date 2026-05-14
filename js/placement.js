/**
 * GradeEarn — placement test
 *
 * 12-question diagnostic that samples 2 questions from each of K-5 and
 * reports per-grade accuracy → recommended grade. Result stored in
 * localStorage as `gradeearn:placement:result:<username>` and (best-
 * effort) synced to staar-users via setGrade.
 *
 * V1 is non-adaptive: a uniform sweep across grades K-5. Adaptive
 * branching (advance/retreat per-streak) is a future enhancement.
 */
(function () {
  'use strict';

  const GRADES = [
    { slug: 'grade-k', label: 'Kindergarten', display: 'K' },
    { slug: 'grade-1', label: 'Grade 1',      display: '1' },
    { slug: 'grade-2', label: 'Grade 2',      display: '2' },
    { slug: 'grade-3', label: 'Grade 3',      display: '3' },
    { slug: 'grade-4', label: 'Grade 4',      display: '4' },
    { slug: 'grade-5', label: 'Grade 5',      display: '5' }
  ];
  const QUESTIONS_PER_GRADE = 2;
  const PASS_THRESHOLD = 0.7; // >= 70% to "pass" a grade

  const root = document.getElementById('placement-root');
  if (!root) return;

  // ---------- helpers ----------
  function pick(arr, n) {
    const copy = arr.slice();
    const out = [];
    while (copy.length && out.length < n) {
      const i = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(i, 1)[0]);
    }
    return out;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function userScope() {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      return (u && u.username) ? u.username : 'anon';
    } catch (_) { return 'anon'; }
  }

  function storeResult(result) {
    try {
      localStorage.setItem(
        `gradeearn:placement:result:${userScope()}`,
        JSON.stringify(Object.assign({}, result, { savedAt: Date.now() }))
      );
    } catch (_) {}
    // Best-effort server sync — write the recommended grade as the kid's grade.
    try {
      if (window.STAARAuth && window.STAARAuth.api && result.recommendedGrade) {
        const token = window.STAARAuth.token && window.STAARAuth.token();
        if (token) {
          window.STAARAuth.api('setGrade', { token, grade: result.recommendedGrade }).catch(() => {});
        }
      }
    } catch (_) {}
  }

  // ---------- data load ----------
  async function loadGradeQuestions(slug) {
    const r = await fetch(`data/${slug}-curriculum.json?v=20260514a`);
    if (!r.ok) throw new Error(`failed to load ${slug}`);
    const data = await r.json();
    // Flatten all multiple-choice questions across all units / lessons.
    const out = [];
    for (const unit of (data.units || [])) {
      for (const lesson of (unit.lessons || [])) {
        for (const q of (lesson.questions || [])) {
          if (q.type === 'multiple_choice' && Array.isArray(q.choices) && q.choices.length === 4) {
            out.push({
              id: q.id,
              prompt: q.prompt,
              choices: q.choices.slice(),
              correctIndex: q.correctIndex,
              explanation: q.explanation || '',
              gradeSlug: slug
            });
          }
        }
      }
    }
    return out;
  }

  // ---------- state ----------
  let questions = [];
  let answers = []; // [{gradeSlug, correct}]
  let i = 0;

  // ---------- views ----------
  function renderIntro() {
    root.innerHTML = `
      <article class="card" style="max-width:680px;margin:24px auto;padding:32px 28px;">
        <h1 style="margin:0 0 12px;font-size:1.8rem;">Find your level</h1>
        <p style="color:var(--muted);line-height:1.6;margin:0 0 20px;">
          Quick 12-question math check. We'll figure out which grade fits you best.
          No score is shared — this is just to help us pick the right questions.
        </p>
        <ul style="color:var(--muted);line-height:1.7;padding-left:20px;margin:0 0 24px;">
          <li>2 questions each from grades K–5</li>
          <li>Takes about 4 minutes</li>
          <li>You can leave any time</li>
        </ul>
        <button type="button" class="btn btn-primary" id="placement-start">Start the check</button>
        <p style="margin:18px 0 0;font-size:0.85rem;color:var(--muted);">
          <a href="index.html" style="color:inherit;text-decoration:underline;">Skip — I already know my grade</a>
        </p>
      </article>`;
    document.getElementById('placement-start').addEventListener('click', start);
  }

  function renderLoading() {
    root.innerHTML = `
      <article class="card" style="max-width:680px;margin:24px auto;padding:32px 28px;text-align:center;">
        <p style="color:var(--muted);">Loading questions…</p>
      </article>`;
  }

  function renderQuestion() {
    const q = questions[i];
    const total = questions.length;
    const choicesHtml = q.choices.map((c, idx) => `
      <label class="choice" data-idx="${idx}">
        <input type="radio" name="placement-ans" value="${idx}" />
        <span class="choice-symbol">${String.fromCharCode(65 + idx)}</span>
        <span class="choice-text">${escapeHtml(c)}</span>
      </label>
    `).join('');
    root.innerHTML = `
      <div style="max-width:680px;margin:24px auto;">
        <div class="practice-meta" style="margin-bottom:14px;color:var(--muted);font-size:0.9rem;">
          Question <strong>${i + 1}</strong> of ${total}
        </div>
        <article class="question-card placement-card" data-state="asking">
          <div class="q-prompt"><span class="q-prompt-text">${escapeHtml(q.prompt)}</span></div>
          <div class="q-body">
            <div class="choices choices-vertical">${choicesHtml}</div>
          </div>
          <button type="button" class="btn btn-primary q-cta" id="placement-check" disabled>Check answer</button>
        </article>
      </div>`;
    let picked = -1;
    root.querySelectorAll('input[name="placement-ans"]').forEach(r => {
      r.addEventListener('change', () => {
        picked = parseInt(r.value, 10);
        document.getElementById('placement-check').disabled = false;
      });
    });
    document.getElementById('placement-check').addEventListener('click', () => {
      if (picked < 0) return;
      const correct = picked === q.correctIndex;
      answers.push({ gradeSlug: q.gradeSlug, correct });
      i++;
      if (i >= questions.length) renderResult();
      else renderQuestion();
    });
  }

  function computeRecommendation() {
    // Per-grade accuracy.
    const byGrade = {};
    for (const g of GRADES) byGrade[g.slug] = { correct: 0, total: 0 };
    for (const a of answers) {
      const g = byGrade[a.gradeSlug];
      if (!g) continue;
      g.total++;
      if (a.correct) g.correct++;
    }
    // Find the highest grade where the kid passed PASS_THRESHOLD.
    let highestPassed = null;
    for (const g of GRADES) {
      const s = byGrade[g.slug];
      const pct = s.total > 0 ? s.correct / s.total : 0;
      if (pct >= PASS_THRESHOLD) highestPassed = g;
    }
    // Recommended is one grade higher than the highest passed (challenge target),
    // but never higher than grade-5 in V1 (we cap at the highest grade we sampled).
    let recommended;
    if (highestPassed) {
      const idx = GRADES.findIndex(g => g.slug === highestPassed.slug);
      recommended = GRADES[Math.min(idx + 1, GRADES.length - 1)] || highestPassed;
    } else {
      // Didn't pass any grade — recommend the lowest one (K).
      recommended = GRADES[0];
    }
    const totalCorrect = answers.filter(a => a.correct).length;
    return {
      totalCorrect,
      totalAnswered: answers.length,
      perGrade: byGrade,
      highestPassedGrade: highestPassed ? highestPassed.slug : null,
      recommendedGrade: recommended.slug,
      recommendedLabel: recommended.label
    };
  }

  function renderResult() {
    const r = computeRecommendation();
    storeResult(r);
    const rows = GRADES.map(g => {
      const s = r.perGrade[g.slug];
      const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
      const pass = pct >= PASS_THRESHOLD * 100;
      return `
        <div class="placement-grade-row">
          <div class="placement-grade-label">${escapeHtml(g.label)}</div>
          <div class="placement-grade-bar"><div class="placement-grade-fill" style="width:${pct}%;background:${pass ? 'var(--gold)' : 'rgba(255,255,255,0.18)'};"></div></div>
          <div class="placement-grade-score">${s.correct}/${s.total}</div>
        </div>`;
    }).join('');
    root.innerHTML = `
      <article class="card" style="max-width:680px;margin:24px auto;padding:32px 28px;">
        <h1 style="margin:0 0 8px;font-size:1.7rem;">Your placement</h1>
        <p style="color:var(--muted);margin:0 0 22px;">Got <strong style="color:var(--gold);">${r.totalCorrect} of ${r.totalAnswered}</strong>. Here's how it broke down:</p>
        <div class="placement-grades">${rows}</div>
        <div style="margin:24px 0 6px;padding:18px 20px;background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.22);border-radius:12px;">
          <div style="font-size:0.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;">Recommended</div>
          <div style="font-size:1.3rem;font-weight:600;color:var(--gold);">${escapeHtml(r.recommendedLabel)} math</div>
          <p style="margin:8px 0 0;color:var(--muted);font-size:0.92rem;line-height:1.5;">Start here — challenging but within reach. You can always switch grades from your home page.</p>
        </div>
        <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
          <a class="btn btn-primary" href="index.html">Go to my dashboard</a>
          <button type="button" class="btn btn-secondary" id="placement-retake">Retake the check</button>
        </div>
      </article>`;
    document.getElementById('placement-retake').addEventListener('click', () => {
      answers = []; i = 0; questions = [];
      start();
    });
  }

  // ---------- flow ----------
  async function start() {
    renderLoading();
    try {
      const buckets = await Promise.all(GRADES.map(g => loadGradeQuestions(g.slug)));
      questions = [];
      buckets.forEach((bucket, idx) => {
        pick(bucket, QUESTIONS_PER_GRADE).forEach(q => questions.push(q));
      });
      // Shuffle so kids don't see a monotone difficulty progression.
      questions.sort(() => Math.random() - 0.5);
      i = 0;
      answers = [];
      renderQuestion();
    } catch (e) {
      root.innerHTML = `
        <article class="card" style="max-width:680px;margin:24px auto;padding:32px 28px;">
          <h1>Couldn't load the check</h1>
          <p style="color:var(--muted);">${escapeHtml(e.message)}</p>
          <a class="btn btn-primary" href="index.html">Back to home</a>
        </article>`;
    }
  }

  // ---------- boot ----------
  renderIntro();
})();
