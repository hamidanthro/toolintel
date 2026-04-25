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

    root.innerHTML = `
      <div class="practice-header">
        <a class="back-link" href="grade.html?g=${slug}">← Back to ${curr.title}</a>
        <h2>${titleBits.join(' › ')}</h2>
        <div class="progress-bar"><div class="progress-fill" id="bar"></div></div>
        <div class="progress-text"><span id="progress-num">1</span> / ${questions.length}</div>
      </div>
      <div id="qbox"></div>`;

    const qbox = document.getElementById('qbox');
    const bar = document.getElementById('bar');
    const progressNum = document.getElementById('progress-num');

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
          tutorBtn.textContent = 'Thinking…';
          tutorOut.hidden = false;
          tutorOut.textContent = '';
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
          tutorOut.innerHTML += `<div class="tutor-msg loading">Thinking…</div>`;
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
    // basic markdown-ish: paragraphs & line breaks
    const safe = escapeHtml(text);
    return safe
      .split(/\n\n+/)
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s); }
})();
