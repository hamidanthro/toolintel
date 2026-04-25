// STAAR Prep — interactive practice runner
// URL params:  ?g=<gradeSlug>&u=<unitId>&l=<lessonId>
// Loads data/<gradeSlug>-curriculum.json, builds a question queue, checks answers,
// and on incorrect answers calls the AI tutor endpoint for an interactive explanation.

(function () {
  const TUTOR_ENDPOINT = window.STAAR_TUTOR_ENDPOINT
    || 'https://api.toolintel.ai/tutor'; // override via window.STAAR_TUTOR_ENDPOINT before this script

  const root = document.getElementById('practice-root');
  const params = new URLSearchParams(location.search);
  const slug = params.get('g');
  const unitId = params.get('u');
  const lessonId = params.get('l');

  if (!slug) {
    return renderHome();
  }

  fetch(`data/${slug}-curriculum.json`)
    .then(r => r.ok ? r.json() : Promise.reject('not-found'))
    .then(curr => start(curr))
    .catch(() => {
      root.innerHTML = `
        <h2>Practice</h2>
        <div class="card">
          <p style="color:var(--muted);">Practice for this grade is coming soon.</p>
          <p><a href="grades.html">Back to grades</a></p>
        </div>`;
    });

  function renderHome() {
    root.innerHTML = `
      <h2>Choose a grade to practice</h2>
      <div class="grade-grid" id="grid"></div>`;
    const grid = document.getElementById('grid');
    window.STAAR_GRADES.forEach(g => {
      const a = document.createElement('a');
      a.href = `practice.html?g=${g.slug}`;
      a.className = 'grade-card';
      a.innerHTML = `
        <div class="label">STAAR Math</div>
        <div class="title">${g.title}</div>
        <div class="desc">Start practicing</div>`;
      grid.appendChild(a);
    });
  }

  function start(curr) {
    let questions = [];
    let lessonMeta = null;

    if (lessonId) {
      for (const u of curr.units) {
        const l = u.lessons.find(l => l.id === lessonId);
        if (l) {
          questions = l.questions.map(q => ({ ...q, _unit: u, _lesson: l }));
          lessonMeta = { unit: u, lesson: l };
          break;
        }
      }
    } else if (unitId) {
      const u = curr.units.find(u => u.id === unitId);
      if (u) {
        questions = u.lessons.flatMap(l => l.questions.map(q => ({ ...q, _unit: u, _lesson: l })));
        lessonMeta = { unit: u };
      }
    } else {
      questions = curr.units.flatMap(u =>
        u.lessons.flatMap(l => l.questions.map(q => ({ ...q, _unit: u, _lesson: l })))
      );
    }

    if (questions.length === 0) {
      root.innerHTML = `<h2>Nothing to practice yet</h2><p><a href="grade.html?g=${slug}">Back</a></p>`;
      return;
    }

    runQuiz(curr, questions, lessonMeta);
  }

  function runQuiz(curr, questions, meta) {
    let i = 0;
    let correct = 0;

    const titleBits = [curr.title];
    if (meta?.unit) titleBits.push(`Unit ${meta.unit.order}: ${meta.unit.title}`);
    if (meta?.lesson) titleBits.push(meta.lesson.title);

    const stats = Stats.load(slug);

    root.innerHTML = `
      <div class="practice-layout">
        <div class="practice-main">
          <div class="practice-header">
            <a class="back-link" href="grade.html?g=${slug}">← Back to ${curr.title}</a>
            <div class="practice-title-row">
              <h2>${titleBits.join(' › ')}</h2>
              <button type="button" class="btn-restart" id="restart-btn" title="Start this practice over">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                <span>Restart</span>
              </button>
            </div>
            <div class="progress-bar"><div class="progress-fill" id="bar"></div></div>
            <div class="progress-text"><span id="progress-num">1</span> / ${questions.length}</div>
          </div>
          <div id="qbox"></div>
        </div>
        <aside class="performance-panel" id="perf-panel"></aside>
      </div>`;

    const qbox = document.getElementById('qbox');
    const bar = document.getElementById('bar');
    const progressNum = document.getElementById('progress-num');
    const perfPanel = document.getElementById('perf-panel');
    const restartBtn = document.getElementById('restart-btn');

    restartBtn.addEventListener('click', () => {
      const answered = i + (qbox.querySelector('.feedback') ? 1 : 0);
      if (answered > 0 && !confirm('Start this practice over? Your progress in this session will be reset.')) return;
      i = 0;
      correct = 0;
      show();
    });

    renderPerf(perfPanel, curr, stats);
    show();

    function show() {
      if (i >= questions.length) {
        return finish();
      }
      progressNum.textContent = i + 1;
      bar.style.width = `${(i / questions.length) * 100}%`;
      const q = questions[i];
      qbox.innerHTML = renderQuestion(q);
      attachQuestionHandlers(q);
    }

    function attachQuestionHandlers(q) {
      const form = qbox.querySelector('form');
      form.addEventListener('submit', e => {
        e.preventDefault();
        const userAnswer = getAnswerFromForm(q, form);
        if (userAnswer == null || userAnswer === '') return;
        const isCorrect = checkAnswer(q, userAnswer);
        if (isCorrect) correct++;
        Stats.record(slug, stats, { unitId: q._unit?.id, unitTitle: q._unit?.title, isCorrect });
        renderPerf(perfPanel, curr, stats);
        showFeedback(q, userAnswer, isCorrect);
      });
    }

    function showFeedback(q, userAnswer, isCorrect) {
      const fb = document.createElement('div');
      fb.className = `feedback ${isCorrect ? 'correct' : 'incorrect'}`;
      fb.innerHTML = `
        <div class="feedback-head">${isCorrect ? '✓ Correct!' : '✗ Not quite.'}</div>
        <div class="feedback-body">
          ${isCorrect
            ? `<p>${escapeHtml(q.explanation || '')}</p>`
            : `<p><strong>Correct answer:</strong> ${escapeHtml(q.answer)}</p>
               <p>${escapeHtml(q.explanation || '')}</p>
               <div class="tutor-box">
                 <button class="btn btn-primary" id="tutor-btn">Ask AI tutor for help</button>
                 <div class="tutor-output" id="tutor-out" hidden></div>
                 <form class="tutor-followup" id="tutor-followup" hidden>
                   <input type="text" id="tutor-q" placeholder="Ask a follow-up question…" />
                   <button class="tutor-send" type="submit" aria-label="Send">
                     <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                   </button>
                 </form>
               </div>`
          }
        </div>
        <div class="feedback-actions">
          <button class="btn btn-primary" id="next-btn">${i + 1 >= questions.length ? 'See results' : 'Next question'}</button>
        </div>`;
      qbox.appendChild(fb);

      // Disable inputs in the original question card only (not the feedback/tutor controls)
      const qCard = qbox.querySelector('.question-card');
      if (qCard) {
        qCard.querySelectorAll('input,button').forEach(el => el.disabled = true);
      }

      document.getElementById('next-btn').addEventListener('click', () => {
        i++;
        show();
      });

      if (!isCorrect) {
        const tutorBtn = document.getElementById('tutor-btn');
        const tutorOut = document.getElementById('tutor-out');
        const followup = document.getElementById('tutor-followup');
        const tutorQ = document.getElementById('tutor-q');
        let history = [];

        tutorBtn.addEventListener('click', async () => {
          tutorBtn.disabled = true;
          tutorBtn.innerHTML = `${spinnerHTML()} <span>Thinking…</span>`;
          tutorOut.hidden = false;
          tutorOut.innerHTML = `<div class="tutor-msg loading">${spinnerHTML()}<span>Thinking…</span></div>`;
          try {
            const reply = await callTutor({
              grade: curr.grade,
              question: q.prompt,
              correctAnswer: q.answer,
              studentAnswer: userAnswer,
              explanation: q.explanation,
              teks: q._lesson?.teks,
              topic: q._unit?.title,
              history: []
            });
            history.push({ role: 'user', content: 'Help me understand this problem.' });
            history.push({ role: 'assistant', content: reply });
            tutorOut.innerHTML = formatTutor(reply);
            followup.hidden = false;
            tutorBtn.style.display = 'none';
          } catch (err) {
            tutorOut.innerHTML = `<p style="color:var(--error);">AI tutor unavailable right now. Try again later.</p>`;
            tutorBtn.disabled = false;
            tutorBtn.textContent = 'Ask AI tutor for help';
          }
        });

        followup.addEventListener('submit', async e => {
          e.preventDefault();
          const text = tutorQ.value.trim();
          if (!text) return;
          tutorQ.value = '';
          tutorOut.innerHTML += `<div class="tutor-msg user"><strong>You:</strong> ${escapeHtml(text)}</div>`;
          tutorOut.innerHTML += `<div class="tutor-msg loading">${spinnerHTML()}<span>Thinking…</span></div>`;
          history.push({ role: 'user', content: text });
          try {
            const reply = await callTutor({
              grade: curr.grade,
              question: q.prompt,
              correctAnswer: q.answer,
              studentAnswer: userAnswer,
              explanation: q.explanation,
              teks: q._lesson?.teks,
              topic: q._unit?.title,
              history
            });
            history.push({ role: 'assistant', content: reply });
            tutorOut.querySelector('.tutor-msg.loading')?.remove();
            tutorOut.innerHTML += `<div class="tutor-msg assistant">${formatTutor(reply)}</div>`;
          } catch (err) {
            tutorOut.querySelector('.tutor-msg.loading')?.remove();
            tutorOut.innerHTML += `<div class="tutor-msg assistant" style="color:var(--error);">AI tutor unavailable.</div>`;
          }
        });
      }
    }

    function finish() {
      bar.style.width = '100%';
      const pct = Math.round((correct / questions.length) * 100);
      qbox.innerHTML = `
        <div class="card">
          <h3>Great work!</h3>
          <p style="font-size:1.4rem;"><strong>${correct} / ${questions.length}</strong> correct (${pct}%)</p>
          <a class="btn btn-primary" href="practice.html?${new URLSearchParams(Object.fromEntries([...params])).toString()}">Try again</a>
          <a class="btn btn-secondary" href="grade.html?g=${slug}" style="margin-left:8px;color:var(--blue);border-color:var(--blue);">Back to ${curr.title}</a>
        </div>`;
    }
  }

  function renderQuestion(q) {
    let body = '';
    if (q.type === 'multiple_choice') {
      body = q.choices.map((c, idx) => `
        <label class="choice">
          <input type="radio" name="ans" value="${escapeAttr(c)}" required />
          <span>${escapeHtml(c)}</span>
        </label>
      `).join('');
    } else {
      body = `<input class="num-input" type="text" name="ans" autocomplete="off" placeholder="Your answer" required />`;
    }
    return `
      <form class="question-card">
        <div class="q-meta">${escapeHtml(q._unit?.title || '')} · TEKS ${escapeHtml(q._lesson?.teks || '')}</div>
        <div class="q-prompt">${escapeHtml(q.prompt)}</div>
        <div class="q-body">${body}</div>
        <button class="btn btn-primary" type="submit">Check answer</button>
      </form>`;
  }

  function getAnswerFromForm(q, form) {
    if (q.type === 'multiple_choice') {
      const sel = form.querySelector('input[name="ans"]:checked');
      return sel ? sel.value : null;
    }
    return form.querySelector('input[name="ans"]').value.trim();
  }

  function checkAnswer(q, userAnswer) {
    const norm = s => String(s).trim().toLowerCase().replace(/\s+/g, '').replace(/,/g, '');
    if (norm(userAnswer) === norm(q.answer)) return true;
    if (Array.isArray(q.acceptable) && q.acceptable.some(a => norm(a) === norm(userAnswer))) return true;
    return false;
  }

  async function callTutor(payload) {
    const res = await fetch(TUTOR_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Tutor request failed');
    const data = await res.json();
    return data.reply || data.message || '';
  }

  function formatTutor(text) {
    if (!text) return '';
    // Strip markdown headings (## Heading)
    let t = String(text).replace(/^\s{0,3}#{1,6}\s+/gm, '');
    // Normalize line endings
    t = t.replace(/\r\n/g, '\n');

    const lines = t.split('\n');
    const html = [];
    let listType = null; // 'ol' | 'ul' | null
    let para = [];

    const flushPara = () => {
      if (para.length) {
        html.push(`<p>${para.join(' ')}</p>`);
        para = [];
      }
    };
    const closeList = () => {
      if (listType) { html.push(`</${listType}>`); listType = null; }
    };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushPara(); closeList(); continue; }

      const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
      const ul = line.match(/^[-*•]\s+(.*)$/);

      if (ol) {
        flushPara();
        if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; }
        html.push(`<li>${inline(ol[2])}</li>`);
      } else if (ul) {
        flushPara();
        if (listType !== 'ul') { closeList(); html.push('<ul>'); listType = 'ul'; }
        html.push(`<li>${inline(ul[1])}</li>`);
      } else {
        closeList();
        para.push(inline(line));
      }
    }
    flushPara();
    closeList();
    return html.join('');
  }

  // Inline markdown: **bold**, *italic*, `code`. Escapes HTML first.
  function inline(s) {
    let out = escapeHtml(s);
    // bold **text**
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    // italic *text* (single star, not part of **)
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    // inline code `text`
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    return out;
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function spinnerHTML() {
    return `<span class="rainbow-spinner" aria-hidden="true"></span>`;
  }

  // ---- Performance tracking ----
  const Stats = {
    key(slug) { return `staar-stats:${slug}`; },
    load(slug) {
      try {
        const raw = localStorage.getItem(this.key(slug));
        if (raw) return JSON.parse(raw);
      } catch {}
      return { total: 0, correct: 0, streak: 0, bestStreak: 0, recent: [], units: {} };
    },
    save(slug, s) {
      try { localStorage.setItem(this.key(slug), JSON.stringify(s)); } catch {}
    },
    record(slug, s, { unitId, unitTitle, isCorrect }) {
      s.total += 1;
      if (isCorrect) {
        s.correct += 1;
        s.streak += 1;
        if (s.streak > s.bestStreak) s.bestStreak = s.streak;
      } else {
        s.streak = 0;
      }
      s.recent.push(isCorrect ? 1 : 0);
      if (s.recent.length > 20) s.recent.shift();
      if (unitId) {
        if (!s.units[unitId]) s.units[unitId] = { title: unitTitle || unitId, total: 0, correct: 0 };
        s.units[unitId].total += 1;
        if (isCorrect) s.units[unitId].correct += 1;
      }
      this.save(slug, s);
    }
  };

  function renderPerf(panel, curr, s) {
    const acc = s.total === 0 ? 0 : Math.round((s.correct / s.total) * 100);
    const ringRadius = 52;
    const ringCirc = 2 * Math.PI * ringRadius;
    const ringOffset = ringCirc - (acc / 100) * ringCirc;
    const ringColor = acc >= 80 ? '#16a34a' : acc >= 60 ? '#f59e0b' : acc >= 1 ? '#dc2626' : '#cbd5e1';

    const dots = (() => {
      const cells = [];
      for (let n = 0; n < 20; n++) {
        const v = s.recent[n];
        const cls = v === 1 ? 'dot correct' : v === 0 ? 'dot incorrect' : 'dot empty';
        cells.push(`<span class="${cls}"></span>`);
      }
      return cells.join('');
    })();

    const unitRows = curr.units
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(u => {
        const us = s.units[u.id];
        if (!us || us.total === 0) {
          return `
            <div class="unit-row dim">
              <div class="unit-row-title">${escapeHtml(u.title)}</div>
              <div class="unit-row-bar"><div class="unit-row-fill" style="width:0%"></div></div>
              <div class="unit-row-pct">—</div>
            </div>`;
        }
        const pct = Math.round((us.correct / us.total) * 100);
        const color = pct >= 80 ? 'var(--success)' : pct >= 60 ? 'var(--accent)' : 'var(--error)';
        return `
          <div class="unit-row">
            <div class="unit-row-title">${escapeHtml(u.title)}</div>
            <div class="unit-row-bar"><div class="unit-row-fill" style="width:${pct}%;background:${color};"></div></div>
            <div class="unit-row-pct">${us.correct}/${us.total}</div>
          </div>`;
      }).join('');

    panel.innerHTML = `
      <div class="perf-card">
        <div class="perf-title">Your performance</div>
        <div class="perf-ring-wrap">
          <svg class="perf-ring" viewBox="0 0 120 120" width="120" height="120">
            <circle cx="60" cy="60" r="${ringRadius}" stroke="#e2e8f0" stroke-width="10" fill="none"/>
            <circle cx="60" cy="60" r="${ringRadius}" stroke="${ringColor}" stroke-width="10" fill="none"
                    stroke-dasharray="${ringCirc}" stroke-dashoffset="${ringOffset}"
                    stroke-linecap="round" transform="rotate(-90 60 60)"
                    style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"/>
            <text x="60" y="58" text-anchor="middle" font-size="22" font-weight="700" fill="var(--navy)">${acc}%</text>
            <text x="60" y="78" text-anchor="middle" font-size="10" fill="var(--muted)">accuracy</text>
          </svg>
        </div>
        <div class="perf-stats">
          <div class="stat"><div class="stat-num">${s.correct}</div><div class="stat-label">correct</div></div>
          <div class="stat"><div class="stat-num">${s.total}</div><div class="stat-label">answered</div></div>
          <div class="stat"><div class="stat-num">${s.streak}🔥</div><div class="stat-label">streak</div></div>
        </div>
      </div>

      <div class="perf-card">
        <div class="perf-section-title">Last 20 answers</div>
        <div class="recent-dots">${dots}</div>
      </div>

      <div class="perf-card">
        <div class="perf-section-title">Mastery by unit</div>
        <div class="unit-rows">${unitRows}</div>
      </div>
    `;
  }
})();
