// StarTest — interactive practice runner
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

  // ---- Guest free-trial: 100 questions across all grades, no login required.
  const GUEST_LIMIT = 100;
  const GUEST_KEY = 'staar.guest.answered';
  function isGuest() {
    return !(window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser());
  }

  // ---- Local "Your journey" tracker: streak, today's correct, best run-in-a-row.
  // Stored locally per-user so it stays kid-friendly and zero-cost.
  function todayKeyJ() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function yesterdayKeyJ() {
    const d = new Date(); d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function recordJourney(isCorrect) {
    try {
      const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
      if (!u || !u.username) return;
      const key = `staar.journey.${u.username}`;
      const j = JSON.parse(localStorage.getItem(key) || '{}');
      const tk = todayKeyJ();
      j.daily = j.daily || {};
      j.daily[tk] = j.daily[tk] || { correct: 0, answered: 0 };
      j.daily[tk].answered += 1;
      if (isCorrect) j.daily[tk].correct += 1;
      // Streak: bump if first activity today; reset if last activity wasn't today/yesterday.
      const last = j.lastActiveDay;
      if (last !== tk) {
        if (last === yesterdayKeyJ()) j.streak = (parseInt(j.streak, 10) || 0) + 1;
        else j.streak = 1;
        j.lastActiveDay = tk;
        const best = parseInt(j.bestStreak, 10) || 0;
        if (j.streak > best) j.bestStreak = j.streak;
      }
      // Best run in a row of correct answers.
      if (isCorrect) {
        j.currentRun = (parseInt(j.currentRun, 10) || 0) + 1;
        const pb = parseInt(j.bestRunInARow, 10) || 0;
        if (j.currentRun > pb) j.bestRunInARow = j.currentRun;
      } else {
        j.currentRun = 0;
      }
      // Trim daily history to last ~60 days.
      const keys = Object.keys(j.daily).sort();
      if (keys.length > 60) {
        for (const k of keys.slice(0, keys.length - 60)) delete j.daily[k];
      }
      localStorage.setItem(key, JSON.stringify(j));
      // Detect milestones to celebrate.
      const dailyGoal = (window.STAARPrefs && window.STAARPrefs.get().dailyGoal) || 5;
      const todayCorrect = j.daily[tk].correct;
      const out = {};
      if (isCorrect && todayCorrect === dailyGoal) out.dailyGoalHit = true;
      if (isCorrect && [5, 10, 15, 25, 50, 100].includes(j.currentRun)) out.streakMilestone = j.currentRun;
      // Streak day milestone: only fire once per day, on the first activity of the day that bumped the streak.
      const streakKey = `${key}.streakDayCelebrated.${tk}`;
      if ([3, 5, 7, 14, 30, 60, 100].includes(j.streak) && !localStorage.getItem(streakKey)) {
        out.streakDayMilestone = j.streak;
        try { localStorage.setItem(streakKey, '1'); } catch (_) {}
      }
      return out;
    } catch (_) { /* localStorage unavailable */ }
    return null;
  }
  function guestCount() {
    try { return parseInt(localStorage.getItem(GUEST_KEY), 10) || 0; } catch (_) { return 0; }
  }
  function guestIncrement() {
    try { localStorage.setItem(GUEST_KEY, String(guestCount() + 1)); } catch (_) {}
  }
  function guestRemaining() { return Math.max(0, GUEST_LIMIT - guestCount()); }
  function renderGuestBanner() {
    if (!isGuest()) {
      const old = document.getElementById('guest-banner');
      if (old) old.remove();
      return;
    }
    let bar = document.getElementById('guest-banner');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'guest-banner';
      bar.style.cssText = 'background:#fef3c7;border:1px solid #fcd34d;color:#78350f;padding:10px 14px;border-radius:8px;margin-bottom:12px;font-size:0.92rem;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;';
      const root = document.getElementById('practice-root');
      if (root && root.firstChild) root.insertBefore(bar, root.firstChild);
      else if (root) root.appendChild(bar);
    }
    const remaining = guestRemaining();
    bar.innerHTML = `<span><strong>Guest mode:</strong> ${remaining} of ${GUEST_LIMIT} free practice questions remaining. Sign up to save progress, earn points, and unlock unlimited practice.</span>
      <button type="button" class="btn btn-primary" style="padding:6px 14px;font-size:0.88rem;" id="guest-signup-btn">Sign up free</button>`;
    const btn = document.getElementById('guest-signup-btn');
    if (btn) btn.onclick = () => { if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
  }
  function maybeBlockGuest() {
    if (!isGuest()) return false;
    if (guestCount() < GUEST_LIMIT) return false;
    // Hit the cap: lock the practice area behind a sign-up wall.
    const root = document.getElementById('practice-root');
    if (root) {
      root.innerHTML = `
        <div class="card" style="text-align:center;padding:36px;">
          <h2 style="margin-top:0;">You answered ${GUEST_LIMIT} questions! 🎉</h2>
          <p style="color:var(--muted);max-width:520px;margin:8px auto 20px;">
            Sign up free to keep practicing, save your progress to any device, earn points
            you can spend on toys in the marketplace, and climb the leaderboard.
          </p>
          <p><button type="button" class="btn btn-primary" id="guest-cap-signup">Create your free account</button></p>
          <p style="font-size:0.88rem;margin-top:14px;"><a href="#" id="guest-cap-signin">Already have an account? Sign in</a></p>
        </div>`;
      const sup = document.getElementById('guest-cap-signup');
      const sin = document.getElementById('guest-cap-signin');
      if (sup) sup.onclick = () => { if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
      if (sin) sin.onclick = (e) => { e.preventDefault(); if (window.STAARAuth && window.STAARAuth.showLogin) window.STAARAuth.showLogin(); };
    }
    return true;
  }
  if (maybeBlockGuest()) return;
  renderGuestBanner();

  // When a guest signs in mid-practice, reload so they continue with full progress tracking.
  window.onSTAARLogin = function () { try { location.reload(); } catch (_) {} };

  // Gate: kids can only practice their own grade or higher (set at signup).
  const Auth = window.STAARAuth || {};
  if (Auth.userGradeLevel && Auth.gradeLevel) {
    const userLvl = Auth.userGradeLevel();
    const reqLvl = Auth.gradeLevel(slug);
    if (userLvl > -Infinity && reqLvl < userLvl) {
      root.innerHTML = `
        <h2>That grade is below your level</h2>
        <div class="card">
          <p style="color:var(--muted);">You're set to a higher grade, so practice for lower grades is locked. Pick your grade or higher from the home page.</p>
          <p><a class="btn btn-primary" href="index.html">Back to your dashboard</a></p>
        </div>`;
      return;
    }
  }

  fetch(`data/${slug}-curriculum.json?v=20260426m`)
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

    // Start instantly with a curriculum-only set so the kid never waits,
    // then swap in fresh AI-generated questions in the background.
    const initial = buildInitialSet(questions);
    runQuiz(curr, initial, lessonMeta, {
      enhance: cb => fetchGeneratedAsync(curr, questions, lessonMeta, cb)
    });
  }

  // ---- No-repeat tracking ----------------------------------------------
  // Per student + grade, remember which question ids have been served so the
  // kid never sees the same item twice until the bank is exhausted.
  function seenKey() {
    const u = (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser());
    const who = (u && u.username) ? u.username : 'anon';
    return `staar.seen.${who}.${slug}`;
  }
  function loadSeen() {
    try {
      const raw = localStorage.getItem(seenKey());
      if (!raw) return new Set();
      return new Set(JSON.parse(raw));
    } catch (_) { return new Set(); }
  }
  function saveSeen(set) {
    try { localStorage.setItem(seenKey(), JSON.stringify(Array.from(set))); } catch (_) {}
  }
  function markSeen(id) {
    if (!id) return;
    const s = loadSeen();
    if (!s.has(id)) {
      s.add(id);
      saveSeen(s);
    }
  }

  // Build a 25-question curriculum-only set immediately, preferring unseen.
  function buildInitialSet(pool) {
    const TARGET = 25;
    const seen = loadSeen();
    const unseen = pool.filter(q => q.id && !seen.has(q.id));
    const seenPool = pool.filter(q => q.id && seen.has(q.id));
    const noId = pool.filter(q => !q.id);

    let merged = shuffle(unseen.slice()).slice(0, TARGET);

    // If unseen is fully exhausted, recycle from the seen pool and tell the kid.
    if (merged.length === 0 && (seenPool.length || noId.length)) {
      try { localStorage.removeItem(seenKey()); } catch (_) {}
      showToast('Nice — you\u2019ve answered every question we have here! Recycling for review.');
      return shuffle(pool.slice()).slice(0, TARGET);
    }

    // Top up if we don't have enough unseen questions yet.
    if (merged.length < TARGET) {
      const filler = shuffle(seenPool.concat(noId));
      for (const q of filler) {
        if (merged.length >= TARGET) break;
        merged.push(q);
      }
    }
    return shuffle(merged).slice(0, TARGET);
  }

  // Background fetch of AI-generated questions. Calls back with the list.
  async function fetchGeneratedAsync(curr, pool, meta, onReady) {
    const GENERATE = 20;
    const topics = buildTopicSpec(pool, meta);
    try {
      const seed = `${slug}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate',
          grade: curr.grade,
          count: GENERATE,
          seed,
          topics
        })
      });
      if (!res.ok) return;
      const data = await res.json();
      const generated = (data.questions || []).map(g => normalizeGenerated(g, curr));
      if (generated.length) onReady(generated);
    } catch (_) { /* silently keep curriculum-only */ }
  }

  function pickRandom(arr, n) {
    return shuffle(arr.slice()).slice(0, n);
  }

  // Build the topic spec the LLM uses to target TEKS.
  function buildTopicSpec(pool, meta) {
    const byTeks = new Map();
    for (const q of pool) {
      const teks = q._lesson?.teks || '';
      if (!teks) continue;
      if (byTeks.has(teks)) continue;
      byTeks.set(teks, {
        teks,
        title: q._unit?.title || '',
        objective: q._lesson?.objective || q._lesson?.title || '',
        sample: q.prompt || ''
      });
    }
    const list = Array.from(byTeks.values());
    // If we're scoped to a unit/lesson, the pool is already narrow;
    // otherwise cap at 12 topics so the prompt stays focused.
    return list.slice(0, 12);
  }

  // Convert a generator result into the shape the renderer expects.
  function normalizeGenerated(g, curr) {
    const unit = curr.units.find(u => u.title === g.unitTitle)
      || curr.units.find(u => u.lessons.some(l => l.teks === g.teks))
      || { title: g.unitTitle || 'Practice' };
    const lesson = (unit.lessons || []).find(l => l.teks === g.teks)
      || { teks: g.teks || '', title: g.lessonTitle || '' };
    return {
      id: g.id,
      type: g.type,
      prompt: g.prompt,
      choices: g.choices,
      answer: g.answer,
      explanation: g.explanation,
      _unit: unit,
      _lesson: lesson,
      _generated: true
    };
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function sectionKey(meta) {
    // Build a stable key for the practice scope: grade | unit | lesson.
    const parts = [slug];
    if (meta?.unit?.id) parts.push(meta.unit.id);
    if (meta?.lesson?.id) parts.push(meta.lesson.id);
    if (parts.length < 2) return null; // don't lock full-grade mixes
    return parts.join('|').replace(/[^A-Za-z0-9_\-|:.]/g, '_');
  }

  function sectionLabel(curr, meta) {
    const bits = [curr.title];
    if (meta?.unit) bits.push(`Unit ${meta.unit.order}: ${meta.unit.title}`);
    if (meta?.lesson) bits.push(meta.lesson.title);
    return bits.join(' › ');
  }

  function runQuiz(curr, questions, meta, opts) {
    let i = 0;
    let correct = 0;
    const sKey = sectionKey(meta);
    const isLocked = !!(sKey && window.STAARAuth?.isMastered?.(sKey));

    const titleBits = [curr.title];
    if (meta?.unit) titleBits.push(`Unit ${meta.unit.order}: ${meta.unit.title}`);
    if (meta?.lesson) titleBits.push(meta.lesson.title);

    const stats = Stats.load(slug);

    const lockedBanner = isLocked ? `
      <div class="mastered-banner">
        <span class="mastered-star">⭐</span>
        <div>
          <div class="mastered-title">You've mastered this section!</div>
          <div class="mastered-sub">Practice freely for review — no points earned or lost here. Try a different section to keep earning.</div>
        </div>
      </div>` : '';

    root.innerHTML = `
      <div class="practice-layout">
        <div class="practice-main">
          ${lockedBanner}
          <div class="practice-header">
            <a class="back-link" href="grade.html?g=${slug}">← Back to ${curr.title}</a>
            <div class="practice-title-row">
              <h2>${titleBits.join(' › ')}</h2>
              <button type="button" class="btn-restart" id="restart-btn" title="Start this practice over">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
                <span>Restart</span>
              </button>
            </div>
            <div class="progress-bar"><div class="progress-track"><div class="progress-fill" id="bar"></div></div><div class="progress-pulse" id="bar-pulse"></div></div>
            <div class="progress-text"><span id="progress-num">1</span> / ${questions.length}</div>
          </div>
          <div id="qbox"></div>
          <div id="scratchpad-mount"></div>
        </div>
        <aside class="performance-panel" id="perf-panel"></aside>
      </div>`;

    const qbox = document.getElementById('qbox');
    const bar = document.getElementById('bar');
    const barPulse = document.getElementById('bar-pulse');
    const progressNum = document.getElementById('progress-num');
    const perfPanel = document.getElementById('perf-panel');
    const restartBtn = document.getElementById('restart-btn');

    restartBtn.addEventListener('click', async () => {
      const answered = i + (qbox.querySelector('.feedback') ? 1 : 0);
      if (answered > 0) {
        const ok = await confirmModal({
          title: 'Restart practice?',
          message: 'You\u2019ll get a fresh set of 25 questions. Your overall performance stats will stay.',
          confirmText: 'Yes, restart',
          cancelText: 'Keep going'
        });
        if (!ok) return;
      }
      // Show a brief toast then reload to get a freshly shuffled 25.
      showToast('Loading a fresh set\u2026');
      setTimeout(() => location.reload(), 350);
    });

    renderPerf(perfPanel, curr, stats);
    show();

    // Background enhance: when AI questions arrive, splice them into upcoming slots
    // so the kid doesn't see the same curriculum-only items repeated.
    if (opts && typeof opts.enhance === 'function') {
      opts.enhance(generated => {
        // Replace upcoming positions (strictly after current index) with generated items.
        // Shuffle generated and slot them in random upcoming positions to keep the mix fresh.
        const upcomingStart = i + 1; // never replace the question the kid is on
        const upcomingSlots = [];
        for (let k = upcomingStart; k < questions.length; k++) upcomingSlots.push(k);
        if (upcomingSlots.length === 0) return;
        const shuffledSlots = shuffle(upcomingSlots.slice());
        const fresh = shuffle(generated.slice());
        const replaceCount = Math.min(fresh.length, shuffledSlots.length);
        for (let k = 0; k < replaceCount; k++) {
          questions[shuffledSlots[k]] = fresh[k];
        }
      });
    }

    function show() {
      if (i >= questions.length) {
        return finish();
      }
      // Reset the scratchpad between questions so kids don't see prior scribbles.
      try { window.STAARScratchpad?.reset(); } catch (_) {}
      progressNum.textContent = i + 1;
      const pct = (i / questions.length) * 100;
      bar.style.width = `${pct}%`;
      if (barPulse) barPulse.style.left = `${pct}%`;
      const q = questions[i];
      markSeen(q.id);
      qbox.innerHTML = renderQuestion(q, isLocked);
      attachQuestionHandlers(q);
    }

    function attachQuestionHandlers(q) {
      const form = qbox.querySelector('form');
      // Esc clears the typed answer (free-response only).
      const numInput = form.querySelector('.num-input');
      if (numInput) {
        numInput.addEventListener('keydown', e => {
          if (e.key === 'Escape') { e.preventDefault(); numInput.value = ''; }
        });
        // Auto-focus the input so kids can just type.
        setTimeout(() => { try { numInput.focus(); } catch (_) {} }, 50);
      }
      // Read-aloud button (shown only when pref is on).
      const readBtn = qbox.querySelector('[data-act="read"]');
      if (readBtn && window.STAARFx) {
        readBtn.addEventListener('click', () => {
          const choices = (q.type === 'multiple_choice' && Array.isArray(q.choices))
            ? '. Choices: ' + q.choices.join(', ')
            : '';
          window.STAARFx.speak(q.prompt + choices);
        });
        // Auto-speak the prompt when a new question loads, so kids who can't read keep flowing.
        setTimeout(() => window.STAARFx.speak(q.prompt), 250);
      }
      form.addEventListener('submit', e => {
        e.preventDefault();
        const userAnswer = getAnswerFromForm(q, form);
        if (userAnswer == null || userAnswer === '') {
          showToast(q.type === 'multiple_choice' ? 'Pick an answer first.' : 'Type your answer first.');
          return;
        }
        const isCorrect = checkAnswer(q, userAnswer);
        if (isCorrect) correct++;
        if (isCorrect) spawnPointsPop(qbox, difficultyCents(q));
        Stats.record(slug, stats, { unitId: q._unit?.id, unitTitle: q._unit?.title, isCorrect });
        const milestones = recordJourney(isCorrect);
        if (window.STAARFx) {
          if (isCorrect) { window.STAARFx.playCorrect(); window.STAARFx.vibrate(20); }
          else { window.STAARFx.playWrong(); window.STAARFx.vibrate([40, 50, 40]); }
          if (milestones && milestones.dailyGoalHit) {
            window.STAARFx.confetti({ count: 90, duration: 1800 });
            window.STAARFx.playMilestone();
            window.STAARFx.toast('Daily mission complete! 🌟', { kind: 'win' });
          } else if (milestones && milestones.streakMilestone) {
            window.STAARFx.confetti({ count: 60, duration: 1400 });
            window.STAARFx.playMilestone();
            window.STAARFx.toast(`${milestones.streakMilestone}-in-a-row! 🔥`, { kind: 'win' });
          } else if (milestones && milestones.streakDayMilestone) {
            window.STAARFx.confetti({ count: 70, duration: 1600 });
            window.STAARFx.playMilestone();
            window.STAARFx.toast(`${milestones.streakDayMilestone}-day streak! 🔥`, { kind: 'win' });
          }
        }
        if (isGuest()) {
          guestIncrement();
          renderGuestBanner();
        }
        renderPerf(perfPanel, curr, stats);
        showFeedback(q, userAnswer, isCorrect);
        if (isCorrect && window.STAARAuth && typeof window.STAARAuth.earn === 'function') {
          window.STAARAuth.earn(difficultyCents(q), sKey);
        } else if (!isCorrect && window.STAARAuth && typeof window.STAARAuth.lose === 'function') {
          window.STAARAuth.lose(difficultyCents(q), sKey);
        }
        // After feedback, if guest hit the cap, lock the page on the next question advance.
        if (isGuest() && guestCount() >= GUEST_LIMIT) {
          setTimeout(() => { maybeBlockGuest(); }, 1500);
        }
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
        if (window.STAARFx) window.STAARFx.stopSpeak();
        i++;
        show();
      });

      if (!isCorrect) {
        const tutorBtn = document.getElementById('tutor-btn');
        const tutorOut = document.getElementById('tutor-out');
        const followup = document.getElementById('tutor-followup');
        const tutorQ = document.getElementById('tutor-q');
        let history = [];

        // Build full tutor context once.
        const tutorCtx = buildTutorContext(q, stats, curr);

        const submitFollowup = (text) => {
          if (!text) return;
          tutorQ.value = text;
          followup.dispatchEvent(new Event('submit', { cancelable: true }));
        };

        const renderChips = () => {
          const wrap = document.createElement('div');
          wrap.className = 'tutor-suggestions';
          ['I still don\u2019t get it', 'Give me a hint', 'Show me the answer'].forEach(label => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tutor-chip';
            btn.textContent = label;
            btn.addEventListener('click', () => { submitFollowup(label); });
            wrap.appendChild(btn);
          });
          tutorOut.appendChild(wrap);
        };

        tutorBtn.addEventListener('click', async () => {
          tutorBtn.disabled = true;
          tutorBtn.innerHTML = `${spinnerHTML()} <span>Thinking…</span>`;
          tutorOut.hidden = false;
          tutorOut.innerHTML = thinkingHTML();
          try {
            const reply = await callTutor(Object.assign({}, tutorCtx, {
              question: q.prompt,
              correctAnswer: q.answer,
              studentAnswer: userAnswer,
              explanation: q.explanation,
              teks: q._lesson?.teks,
              topic: q._unit?.title,
              history: []
            }));
            history.push({ role: 'user', content: 'Help me understand this problem.' });
            history.push({ role: 'assistant', content: reply });
            tutorOut.innerHTML = `<div class="tutor-msg assistant">${formatTutor(reply)}</div>`;
            renderChips();
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
          // Remove any old chips before adding a new turn.
          tutorOut.querySelector('.tutor-suggestions')?.remove();
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg user"><strong>You:</strong> ${escapeHtml(text)}</div>`);
          tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg loading">${thinkingHTML()}</div>`);
          history.push({ role: 'user', content: text });
          try {
            const reply = await callTutor(Object.assign({}, tutorCtx, {
              question: q.prompt,
              correctAnswer: q.answer,
              studentAnswer: userAnswer,
              explanation: q.explanation,
              teks: q._lesson?.teks,
              topic: q._unit?.title,
              history
            }));
            history.push({ role: 'assistant', content: reply });
            tutorOut.querySelector('.tutor-msg.loading')?.remove();
            tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg assistant">${formatTutor(reply)}</div>`);
            renderChips();
          } catch (err) {
            tutorOut.querySelector('.tutor-msg.loading')?.remove();
            tutorOut.insertAdjacentHTML('beforeend', `<div class="tutor-msg assistant" style="color:var(--error);">AI tutor unavailable.</div>`);
          }
        });
      }
    }

    function finish() {
      bar.style.width = '100%';
      if (barPulse) barPulse.style.left = '100%';
      const pct = Math.round((correct / questions.length) * 100);
      const perfect = correct === questions.length && questions.length > 0;
      const justMastered = perfect && sKey && !isLocked;
      if (justMastered && window.STAARAuth?.markMastered) {
        window.STAARAuth.markMastered(sKey, sectionLabel(curr, meta));
      }
      const banner = perfect
        ? `<div class="mastered-banner mastered-celebrate">
             <span class="mastered-star">⭐</span>
             <div>
               <div class="mastered-title">Excellent! Section ${justMastered ? 'mastered' : 'already mastered'}.</div>
               <div class="mastered-sub">You've nailed every question. This section is locked from earning so you can explore new ones.</div>
             </div>
           </div>`
        : '';
      qbox.innerHTML = `
        ${banner}
        <div class="card">
          <h3>Great work!</h3>
          <p style="font-size:1.4rem;"><strong>${correct} / ${questions.length}</strong> correct (${pct}%)</p>
          <a class="btn btn-primary" href="practice.html?${new URLSearchParams(Object.fromEntries([...params])).toString()}">Try again</a>
          <a class="btn btn-secondary" href="grade.html?g=${slug}" style="margin-left:8px;color:var(--blue);border-color:var(--blue);">Back to ${curr.title}</a>
        </div>`;
    }
  }

  function difficultyCents(q) {
    if (q && Number.isFinite(q.cents) && q.cents >= 1 && q.cents <= 5) return q.cents;
    if (q && q._cents) return q._cents;
    // Deterministic 1–5 from question prompt so the same question always pays the same.
    const s = String((q && q.prompt) || '');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    const v = ((h % 5) + 5) % 5 + 1; // 1..5
    if (q) q._cents = v;
    return v;
  }

  function renderChoiceLabel(c) {
    // For tiny comparison-symbol choices, also show a plain-language helper
    // so 3rd graders can clearly tell ">", "<", and "=" apart.
    const SYMBOL_HINTS = {
      '<': 'less than',
      '>': 'greater than',
      '=': 'equal to',
      '≤': 'less than or equal',
      '≥': 'greater than or equal',
      '≠': 'not equal to'
    };
    const hint = SYMBOL_HINTS[String(c).trim()];
    if (hint) {
      return `<span class="choice-symbol">${escapeHtml(c)}</span><span class="choice-hint"> (${hint})</span>`;
    }
    return `<span>${escapeHtml(c)}</span>`;
  }

  function spawnPointsPop(qbox, points) {
    if (!qbox) return;
    const main = qbox.closest('.practice-main') || qbox.parentElement;
    if (!main) return;
    if (getComputedStyle(main).position === 'static') main.style.position = 'relative';
    const pop = document.createElement('div');
    pop.className = 'points-pop';
    pop.textContent = `+${points}`;
    main.appendChild(pop);
    setTimeout(() => { try { pop.remove(); } catch (_) {} }, 1300);
  }

  function renderQuestion(q, locked) {
    let body = '';
    if (q.type === 'multiple_choice') {
      body = q.choices.map((c, idx) => `
        <label class="choice">
          <input type="radio" name="ans" value="${escapeAttr(c)}" required />
          ${renderChoiceLabel(c)}
        </label>
      `).join('');
    } else {
      body = `<input class="num-input" type="text" name="ans" autocomplete="off" placeholder="Your answer" required />`;
    }
    const cents = difficultyCents(q);
    const reward = locked
      ? `<span class="q-reward q-reward-locked" title="Section mastered — review only">⭐ Mastered</span>`
      : `<span class="q-reward" title="Correct: +${cents} pts  •  Wrong: −${cents} pts">±${cents} pts</span>`;
    const readBtn = (window.STAARFx && window.STAARFx.readAloudEnabled())
      ? `<button type="button" class="q-read-btn" data-act="read" aria-label="Read question aloud" title="Read aloud">🔊</button>`
      : '';
    return `
      <form class="question-card">
        <div class="q-meta">
          <span>${escapeHtml(q._unit?.title || '')} · TEKS ${escapeHtml(q._lesson?.teks || '')}</span>
          ${reward}
        </div>
        <div class="q-prompt">${readBtn}<span class="q-prompt-text">${escapeHtml(q.prompt)}</span></div>
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
    const a = norm(userAnswer);
    if (a === norm(q.answer)) return true;
    if (Array.isArray(q.acceptable) && q.acceptable.some(x => norm(x) === a)) return true;
    // Numeric equivalence (handles "$27" vs "27", "5.0" vs "5", etc.)
    const numUser = parseFloat(String(userAnswer).replace(/[^0-9.\-]/g, ''));
    const numAns  = parseFloat(String(q.answer).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(numUser) && Number.isFinite(numAns) && numUser === numAns) return true;
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
    let t = String(text).replace(/\r\n/g, '\n');

    // Extract fenced code blocks first so their content isn't touched by other rules.
    const fences = [];
    t = t.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, _lang, code) => {
      const idx = fences.length;
      fences.push(code.replace(/^\n+|\n+$/g, ''));
      return `\u0000FENCE${idx}\u0000`;
    });

    // Strip markdown headings (## Heading)
    t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');

    const lines = t.split('\n');
    const html = [];
    let listType = null; // 'ol' | 'ul' | null
    let para = [];
    let olCounter = 0;

    const flushPara = () => {
      if (para.length) {
        html.push(`<p>${para.join(' ')}</p>`);
        para = [];
      }
    };
    const closeList = () => {
      if (listType) { html.push(`</${listType}>`); listType = null; olCounter = 0; }
    };

    for (const raw of lines) {
      const line = raw.trim();

      const ol = line.match(/^(\d+)[.)]\s+(.*)$/);
      const ul = line.match(/^[-*•]\s+(.*)$/);

      if (!line) {
        // Blank line: end the current paragraph but keep an open list open,
        // so consecutive numbered/bulleted items separated by blank lines
        // stay in the same <ol>/<ul> instead of restarting numbering.
        flushPara();
        continue;
      }

      if (ol) {
        flushPara();
        if (listType !== 'ol') { closeList(); html.push('<ol>'); listType = 'ol'; olCounter = 0; }
        olCounter += 1;
        // Use <li value="N"> with sequential N so we never repeat "1." even if
        // the model sent "1." for every step.
        html.push(`<li value="${olCounter}">${inline(ol[2])}</li>`);
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
    let out = html.join('');
    // Restore fenced code blocks as monospace pre.code blocks.
    out = out.replace(/\u0000FENCE(\d+)\u0000/g, (_, n) => {
      const code = fences[Number(n)] || '';
      return `<pre class="tutor-code"><code>${escapeHtml(code)}</code></pre>`;
    });
    return out;
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

  function thinkingHTML() {
    return `<div class="tutor-thinking" aria-label="Thinking"><span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span></div>`;
  }

  // Map grade slug -> numeric grade. e.g., 'grade-3' -> 3, 'kindergarten' -> 0
  function gradeNumberFromSlug(slug) {
    if (slug == null) return null;
    const s = String(slug).toLowerCase();
    if (s.includes('kinder') || s === 'k' || s === 'grade-k') return 0;
    const m = s.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // Builds the personalization context the new system prompt expects.
  function buildTutorContext(q, stats, curr) {
    let studentName = '', studentGrade = null, studentState = '', testName = 'STAAR';
    try {
      const u = window.STAARAuth?.currentUser?.();
      if (u) {
        studentName = String(u.displayName || u.username || '').split(/\s+/)[0] || '';
        studentState = u.state || '';
        const gn = gradeNumberFromSlug(u.grade);
        if (gn != null) studentGrade = gn;
      }
    } catch (_) {}
    if (studentGrade == null) studentGrade = gradeNumberFromSlug(curr?.slug || curr?.grade);

    // Topic accuracy & weak areas from in-session Stats.
    let accuracyToDate = null;
    const weakAreas = [];
    try {
      if (q?._unit?.id && stats?.units?.[q._unit.id]) {
        const us = stats.units[q._unit.id];
        if (us.total > 0) accuracyToDate = `${Math.round((us.correct / us.total) * 100)}%`;
      }
      Object.values(stats?.units || {}).forEach(u => {
        if (u && u.total >= 4 && (u.correct / u.total) < 0.7 && u.title) {
          weakAreas.push(u.title);
        }
      });
    } catch (_) {}

    return {
      grade: studentGrade,
      studentName,
      studentGrade,
      studentState,
      testName,
      accuracyToDate,
      weakAreas
    };
  }

  // Branded confirmation modal. Returns a Promise<boolean>.
  function confirmModal({ title, message, confirmText = 'Confirm', cancelText = 'Cancel' }) {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.innerHTML = `
        <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <h3 id="modal-title" class="modal-title">${escapeHtml(title)}</h3>
          <p class="modal-message">${escapeHtml(message)}</p>
          <div class="modal-actions">
            <button type="button" class="btn btn-ghost" data-act="cancel">${escapeHtml(cancelText)}</button>
            <button type="button" class="btn btn-primary" data-act="confirm">${escapeHtml(confirmText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      // Allow CSS transition
      requestAnimationFrame(() => overlay.classList.add('open'));

      const close = (result) => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 180);
        document.removeEventListener('keydown', onKey);
        resolve(result);
      };
      const onKey = e => {
        if (e.key === 'Escape') close(false);
        if (e.key === 'Enter') close(true);
      };
      document.addEventListener('keydown', onKey);

      overlay.addEventListener('click', e => {
        if (e.target === overlay) close(false);
      });
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => close(false));
      overlay.querySelector('[data-act="confirm"]').addEventListener('click', () => close(true));
      overlay.querySelector('[data-act="confirm"]').focus();
    });
  }

  function showToast(text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 250);
    }, 2000);
  }

  function flashRestart() {
    const main = document.querySelector('.practice-main');
    if (!main) return;
    main.classList.remove('flash');
    // Reflow to retrigger animation
    void main.offsetWidth;
    main.classList.add('flash');
    setTimeout(() => main.classList.remove('flash'), 700);
  }

  // ---- Performance tracking ----
  const Stats = {
    key(slug) {
      // If the auth module is loaded, namespace stats per user so multiple
      // students on one device don't share progress. Otherwise fall back
      // to the legacy single-user key for backward compatibility.
      if (window.STAARAuth && typeof window.STAARAuth.statsKey === 'function') {
        return window.STAARAuth.statsKey(slug);
      }
      return `staar-stats:${slug}`;
    },
    load(slug) {
      try {
        const raw = localStorage.getItem(this.key(slug));
        if (raw) return JSON.parse(raw);
      } catch {}
      return { total: 0, correct: 0, streak: 0, bestStreak: 0, recent: [], units: {} };
    },
    save(slug, s) {
      try { localStorage.setItem(this.key(slug), JSON.stringify(s)); } catch {}
      // Sync to the cloud so progress follows the student to any device.
      if (window.STAARAuth && typeof window.STAARAuth.pushStats === 'function'
          && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
        window.STAARAuth.pushStats(slug, s);
      }
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
    const ringRadius = 70;
    const ringCirc = 2 * Math.PI * ringRadius;
    const ringOffset = ringCirc - (acc / 100) * ringCirc;
    const ringColor = acc >= 80 ? '#16a34a' : acc >= 60 ? '#f59e0b' : acc >= 1 ? '#dc2626' : '#cbd5e1';
    const useGoldGrad = acc >= 1;

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
          <svg class="perf-ring" viewBox="0 0 160 160" width="160" height="160">
            <defs>
              <linearGradient id="accuracyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#fde68a"/>
                <stop offset="55%" stop-color="#fbbf24"/>
                <stop offset="100%" stop-color="#f59e0b"/>
              </linearGradient>
              <filter id="accuracyGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <circle cx="80" cy="80" r="${ringRadius}" stroke="rgba(255,255,255,0.08)" stroke-width="12" fill="none"/>
            <circle cx="80" cy="80" r="${ringRadius}" stroke="${useGoldGrad ? 'url(#accuracyGrad)' : ringColor}" stroke-width="12" fill="none"
                    stroke-dasharray="${ringCirc}" stroke-dashoffset="${ringOffset}"
                    stroke-linecap="round" transform="rotate(-90 80 80)"
                    filter="${useGoldGrad ? 'url(#accuracyGlow)' : ''}"
                    style="transition: stroke-dashoffset 0.5s ease, stroke 0.3s ease;"/>
            <text class="accuracy-value" x="80" y="82" text-anchor="middle" font-size="38" font-weight="700">${acc}<tspan class="accuracy-suffix" font-size="22">%</tspan></text>
            <text class="accuracy-label" x="80" y="106" text-anchor="middle" font-size="11">accuracy</text>
          </svg>
        </div>
        <div class="perf-stats">
          <div class="stat"><div class="stat-num">${s.correct}</div><div class="stat-label">correct</div></div>
          <div class="stat"><div class="stat-num">${s.total}</div><div class="stat-label">answered</div></div>
          <div class="stat ${s.streak > 0 ? 'has-streak' : ''}"><div class="stat-num">${s.streak}${s.streak > 0 ? '<span class="streak-emoji">🔥</span>' : ''}</div><div class="stat-label">streak</div></div>
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

  // Track time-on-task while the practice page is open & visible.
  if (window.STAARAuth && typeof window.STAARAuth.startHeartbeat === 'function') {
    window.STAARAuth.startHeartbeat();
  }
})();
