/**
 * GradeEarn — Word Connect (game #1, May 11).
 *
 * Mechanic: 6 letters in a hex layout. Kid drags a finger through them
 * to spell a word. Valid words fill the discovered-words grid above.
 * Score: 5/10/20/40 per 3/4/5/6-letter word, +25 bonus for the prize
 * word. Daily puzzle is the same for kids in the same grade so they
 * can race; different grades get their own age-appropriate puzzle.
 *
 * Multiplayer (async race) — each kid plays on their own screen, but
 * the header shows live scores of any friend who's playing the same
 * puzzle today. Polls every 5s via getGameScores.
 *
 * Backend: submitGameScore + getGameScores lambda actions persist
 * per-(gameId, date, username) score on staar-users.gameScores.
 */
(function () {
  'use strict';

  const PUZZLES_URL = '../data/games/word-connect-puzzles.json?v=20260511f';
  const GAME_ID = 'word-connect';

  // DOM
  const wheelEl     = document.getElementById('gameWheel');
  const wheelCanvas = document.getElementById('gameWheelCanvas');
  const wordsEl     = document.getElementById('gameWords');
  const spellEl     = document.getElementById('gameSpellPreview');
  const scoreEl     = document.getElementById('gameYourScore');
  const headerStat  = document.getElementById('gameHeaderStat');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl    = document.getElementById('gameStatus');
  const shuffleBtn  = document.getElementById('gameShuffle');
  const completeEl  = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeWords = document.getElementById('gameCompleteWords');
  const completeTime  = document.getElementById('gameCompleteTime');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const toastEl     = document.getElementById('gameToast');

  // State
  // Match-length timer for sessions. 3 minutes per spec.
  const GAME_DURATION_MS = 3 * 60 * 1000;

  let puzzle = null;
  let bucket = [];           // all puzzles in this grade band, cached
  let puzzleIdx = 0;         // current puzzle index in bucket
  let letters = [];          // randomized order for rendering
  let found = new Set();     // uppercase strings of words found IN CURRENT puzzle
  let totalFound = 0;        // across all puzzles played this session
  let path = [];             // [{idx, letter}] currently drag-selected
  let pointerDown = false;
  let score = 0;
  let startedAt = null;
  let endsAt = null;
  let timerTick = null;
  let isOver = false;
  let lastSubmitAt = 0;
  let opponentsPollTimer = null;

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function token() {
    try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; }
  }
  async function api(action, payload) {
    if (!window.STAARAuth || !window.STAARAuth.api) return null;
    return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {}));
  }
  function todayDateKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function dayOfYear() {
    const d = new Date();
    const start = new Date(d.getFullYear(), 0, 0);
    return Math.floor((d - start) / 86400000);
  }
  function toast(msg, ms) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toastEl.hidden = true; }, ms || 1600);
  }
  function pointsForWord(w) {
    const n = w.length;
    if (n === 3) return 5;
    if (n === 4) return 10;
    if (n === 5) return 20;
    if (n === 6) return 40;
    return 80; // 7+
  }
  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  // ---------- puzzle selection ----------
  // Pick today's puzzle. Same-grade kids on the same day get the SAME
  // puzzle — hash(dayOfYear) % puzzles[gradeBand].length. Different
  // grades draw from their own bank.
  async function loadPuzzle() {
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    if (!me) {
      statusEl.textContent = 'Please sign in first.';
      return;
    }
    const grade = me.grade || 'grade-3';
    let bank = null;
    try {
      const r = await fetch(PUZZLES_URL);
      bank = await r.json();
    } catch (e) {
      statusEl.textContent = 'Could not load today\'s puzzle.';
      return;
    }
    const byGrade = (bank && bank.byGrade) || {};
    let b = byGrade[grade];
    // Fallback: if no puzzles for this exact grade, walk up/down nearest.
    if (!b || b.length === 0) {
      const allKeys = Object.keys(byGrade);
      const fallback = allKeys.find(k => (byGrade[k] || []).length > 0);
      b = byGrade[fallback] || [];
    }
    if (!b.length) {
      statusEl.textContent = 'No puzzles available for your grade yet.';
      return;
    }
    bucket = b;
    puzzleIdx = dayOfYear() % bucket.length;
    loadPuzzleAtIdx(puzzleIdx, grade);
    startedAt = Date.now();
    endsAt = startedAt + GAME_DURATION_MS;
    isOver = false;
    if (timerTick) clearInterval(timerTick);
    timerTick = setInterval(tickTimer, 200);
    startOpponentsPoll();
  }

  function loadPuzzleAtIdx(idx, grade) {
    puzzle = bucket[idx % bucket.length];
    // Normalize words to uppercase + dedupe
    puzzle.words = Array.from(new Set((puzzle.words || []).map(w => w.toUpperCase()))).sort((a, b) => a.length - b.length || a.localeCompare(b));
    statusEl.hidden = true;
    const gradeLabel = grade ? grade.replace('grade-', 'Grade ').replace('Grade k', 'Kindergarten') : '';
    headerStat.innerHTML = `<span id="wcTimer" class="wc-timer">3:00</span> · ${puzzle.words.length} words ${gradeLabel ? '· ' + gradeLabel : ''}`;
    letters = (puzzle.letters || []).slice();
    found = new Set();
    path = [];
    shuffleLetters(false);
    renderWords();
    renderWheel();
  }

  function tickTimer() {
    if (isOver || !endsAt) return;
    const rem = Math.max(0, endsAt - Date.now());
    const sec = Math.ceil(rem / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const timerEl = document.getElementById('wcTimer');
    if (timerEl) {
      timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
      if (sec <= 30) timerEl.classList.add('is-danger');
      else timerEl.classList.remove('is-danger');
    }
    if (rem <= 0) {
      isOver = true;
      if (timerTick) clearInterval(timerTick);
      showComplete();
    }
  }

  // Shuffle now ADVANCES to the next puzzle in the bucket — new letters,
  // new word list. Score carries over. Found-words list resets per puzzle.
  function shuffleLetters(animate) {
    if (!bucket || bucket.length === 0) {
      // Initial render of current letters — just Fisher-Yates the array
      for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
      }
      if (animate) renderWheel();
      return;
    }
    if (!animate) {
      // First render — just shuffle in place
      for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
      }
      return;
    }
    // User-triggered shuffle → next puzzle (new letters, new words).
    if (isOver) return;
    // Carry forward the count of words found in the current puzzle before
    // the load wipes `found`. Score already accumulated as kid found them.
    totalFound += found.size;
    puzzleIdx = (puzzleIdx + 1) % bucket.length;
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    loadPuzzleAtIdx(puzzleIdx, me && me.grade);
    toast('New puzzle — new letters!', 1200);
  }

  // ---------- discovered-words display ----------
  // Compact version (Wordscapes pattern): show progress count + only
  // the words actually FOUND so the wheel always has room on screen.
  // Showing 24 blank placeholders ate the whole viewport on phones.
  function renderWords() {
    const all = puzzle.words || [];
    const total = all.length;
    const foundList = all.filter(w => found.has(w));
    const pct = total > 0 ? Math.round((found.size / total) * 100) : 0;

    // Group found words by length descending — prize first if found,
    // then 6-letter, then 5-letter, etc. Limits visual sprawl.
    const sorted = foundList.slice().sort((a, b) => {
      if (a === puzzle.prize) return -1;
      if (b === puzzle.prize) return 1;
      return b.length - a.length || a.localeCompare(b);
    });

    const chipsHtml = sorted.length === 0
      ? `<div class="game-words-empty">Drag through the letters below to spell your first word</div>`
      : sorted.map(w => {
          const isPrize = w === puzzle.prize;
          return `<div class="game-word${isPrize ? ' game-word--prize' : ''}">${esc(w)}</div>`;
        }).join('');

    wordsEl.innerHTML = `
      <div class="game-progress">
        <div class="game-progress-stat">
          <span class="game-progress-num">${found.size}</span>
          <span class="game-progress-sep">/</span>
          <span class="game-progress-total">${total}</span>
          <span class="game-progress-label">words found</span>
        </div>
        <div class="game-progress-bar"><div class="game-progress-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="game-words-chips">${chipsHtml}</div>`;
  }

  // ---------- letter wheel ----------
  function renderWheel() {
    if (!wheelEl) return;
    // Read actual wheel dimensions so heights adapt to CSS sizing
    // (260px on phone, could be 280px on desktop with media query).
    const W = wheelEl.offsetWidth || 260;
    const H = wheelEl.offsetHeight || 260;
    const n = letters.length;
    const letterSize = W <= 270 ? 50 : 56;
    const cx = W / 2;
    const cy = H / 2;
    const r = Math.min(W, H) / 2 - letterSize / 2 - 6; // hug edges
    wheelEl.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * 2 * Math.PI - Math.PI / 2; // start at top
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'game-letter';
      btn.dataset.idx = String(i);
      btn.dataset.letter = letters[i];
      btn.style.width  = letterSize + 'px';
      btn.style.height = letterSize + 'px';
      btn.style.fontSize = (letterSize * 0.55) + 'px';
      btn.style.left = (x - letterSize / 2) + 'px';
      btn.style.top  = (y - letterSize / 2) + 'px';
      btn.textContent = letters[i];
      wheelEl.appendChild(btn);
    }
    redrawPath();
  }

  function redrawPath() {
    if (!wheelCanvas) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wheelEl.offsetWidth || 280;
    const H = wheelEl.offsetHeight || 280;
    wheelCanvas.width = W * dpr;
    wheelCanvas.height = H * dpr;
    wheelCanvas.style.width = W + 'px';
    wheelCanvas.style.height = H + 'px';
    const ctx = wheelCanvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    if (path.length < 1) return;
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.75)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach((step, i) => {
      const btn = wheelEl.querySelector(`.game-letter[data-idx="${step.idx}"]`);
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const wheelRect = wheelEl.getBoundingClientRect();
      const x = rect.left - wheelRect.left + rect.width / 2;
      const y = rect.top  - wheelRect.top  + rect.height / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function updateSpellPreview() {
    const word = path.map(p => p.letter).join('');
    spellEl.textContent = word || ' ';
    spellEl.className = 'game-spell-preview' + (word.length >= 3 ? ' is-active' : '');
  }

  function clearPath() {
    path = [];
    wheelEl.querySelectorAll('.game-letter').forEach(b => b.classList.remove('is-selected'));
    redrawPath();
    updateSpellPreview();
  }

  // ---------- drag mechanic ----------
  function hitTestLetter(clientX, clientY) {
    const btns = wheelEl.querySelectorAll('.game-letter');
    let best = null;
    let bestDist = 38; // px — touch tolerance; bigger = easier drag
    btns.forEach(btn => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top  + rect.height / 2;
      const dx = clientX - cx;
      const dy = clientY - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; best = btn; }
    });
    return best;
  }

  // Each tile can appear up to twice in a single word path (so words
  // like BATTLE, LITTLE, KEEPER work on a 6-tile wheel). During an
  // active drag, the same tile won't auto-repeat on hover (line 289
  // logic preserved). To intentionally double a letter, kid taps the
  // "×2" repeat button which calls repeatLastLetter().
  const MAX_USES_PER_TILE = 2;
  function addLetterToPath(btn) {
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx, 10);
    // Don't re-add the SAME letter index when drag hovers over it again
    if (path.length > 0 && path[path.length - 1].idx === idx) return;
    // Backtrack: if going BACK onto second-to-last index, pop last
    if (path.length >= 2 && path[path.length - 2].idx === idx) {
      const popped = path.pop();
      const popBtn = wheelEl.querySelector(`.game-letter[data-idx="${popped.idx}"]`);
      if (popBtn) {
        const remaining = path.filter(p => p.idx === popped.idx).length;
        if (remaining === 0) popBtn.classList.remove('is-selected');
      }
      redrawPath();
      updateSpellPreview();
      return;
    }
    // Cap re-uses at MAX_USES_PER_TILE (drag only — explicit ×2 path below)
    const usesOfIdx = path.filter(p => p.idx === idx).length;
    if (usesOfIdx >= MAX_USES_PER_TILE) return;
    path.push({ idx, letter: btn.dataset.letter });
    btn.classList.add('is-selected');
    redrawPath();
    updateSpellPreview();
  }

  // Explicitly double the most-recently-added letter. Used for words
  // with adjacent doubled letters (BATTLE: B-A-T-[×2]-L-E).
  function repeatLastLetter() {
    if (path.length === 0) return;
    const last = path[path.length - 1];
    const usesOfIdx = path.filter(p => p.idx === last.idx).length;
    if (usesOfIdx >= MAX_USES_PER_TILE) {
      toast(`That letter is already doubled`, 900);
      return;
    }
    path.push({ idx: last.idx, letter: last.letter });
    redrawPath();
    updateSpellPreview();
  }

  function onPointerDown(e) {
    const t = e.touches ? e.touches[0] : e;
    const btn = hitTestLetter(t.clientX, t.clientY);
    if (!btn) return;
    pointerDown = true;
    clearPath();
    addLetterToPath(btn);
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!pointerDown) return;
    const t = e.touches ? e.touches[0] : e;
    const btn = hitTestLetter(t.clientX, t.clientY);
    if (btn) addLetterToPath(btn);
    e.preventDefault();
  }
  function onPointerUp(e) {
    if (!pointerDown) return;
    pointerDown = false;
    submitWord();
    e && e.preventDefault && e.preventDefault();
  }

  // ---------- word submission ----------
  function submitWord() {
    const word = path.map(p => p.letter).join('');
    if (word.length < 3) { clearPath(); return; }
    const fx = window.STAARFx || {};
    if (found.has(word)) {
      toast(`Already found ${word}`, 1200);
      try { fx.playClick && fx.playClick(); } catch (_) {}
      try { fx.vibrate && fx.vibrate(10); } catch (_) {}
      clearPath();
      return;
    }
    const allWords = puzzle.words;
    if (!allWords.includes(word)) {
      // Wrong word — sound + haptic shake + visual flash
      try { fx.playWrong && fx.playWrong(); } catch (_) {}
      try { fx.vibrate && fx.vibrate([40, 30, 40]); } catch (_) {}
      wheelEl.querySelectorAll('.game-letter.is-selected').forEach(b => b.classList.add('is-wrong'));
      setTimeout(() => {
        wheelEl.querySelectorAll('.game-letter').forEach(b => b.classList.remove('is-wrong'));
        clearPath();
      }, 380);
      return;
    }
    // VALID! Score + celebrate.
    found.add(word);
    let pts = pointsForWord(word);
    const isPrize = word === puzzle.prize;
    if (isPrize) pts += 25;
    score += pts;
    scoreEl.textContent = String(score);

    // Sound + haptic + visual feedback scaled to word importance
    if (isPrize) {
      try { fx.playMilestone && fx.playMilestone(); } catch (_) {}
      try { fx.confetti && fx.confetti({ count: 120, duration: 2200 }); } catch (_) {}
      try { fx.vibrate && fx.vibrate([30, 40, 30, 40, 60]); } catch (_) {}
    } else if (word.length >= 5) {
      try { fx.playCorrect && fx.playCorrect(); } catch (_) {}
      try { fx.confetti && fx.confetti({ count: 40, duration: 1200 }); } catch (_) {}
      try { fx.vibrate && fx.vibrate(28); } catch (_) {}
    } else {
      try { fx.playCorrect && fx.playCorrect(); } catch (_) {}
      try { fx.vibrate && fx.vibrate(20); } catch (_) {}
    }

    showFloatingPoints(pts, isPrize);
    toast(`+${pts} ${isPrize ? '· PRIZE!' : ''}`, 1400);
    renderWords();
    clearPath();
    queueSubmit();
    if (found.size >= allWords.length) {
      // Final flourish — bigger confetti burst before complete modal
      try { fx.confetti && fx.confetti({ count: 180, duration: 2800 }); } catch (_) {}
      try { fx.playMilestone && fx.playMilestone(); } catch (_) {}
      setTimeout(showComplete, 900);
    }
  }

  // Floating "+N pts" that drifts up from the spell-preview area
  function showFloatingPoints(pts, isPrize) {
    const float = document.createElement('div');
    float.className = 'game-float-pts' + (isPrize ? ' game-float-pts--prize' : '');
    float.textContent = '+' + pts + (isPrize ? ' 👑' : '');
    const rect = spellEl.getBoundingClientRect();
    float.style.left = (rect.left + rect.width / 2) + 'px';
    float.style.top  = rect.top + 'px';
    document.body.appendChild(float);
    setTimeout(() => { try { float.remove(); } catch (_) {} }, 1400);
  }

  // ---------- server score submission (debounced) ----------
  let submitTimer = null;
  function queueSubmit() {
    clearTimeout(submitTimer);
    submitTimer = setTimeout(doSubmit, 500);
  }
  async function doSubmit() {
    const payload = {
      gameId: GAME_ID,
      date: todayDateKey(),
      score,
      wordsFound: Array.from(found),
      totalWords: puzzle.words.length,
      durationSec: Math.floor((Date.now() - startedAt) / 1000),
      puzzleId: puzzle.id,
      prize: puzzle.prize,
      foundPrize: found.has(puzzle.prize)
    };
    try { await api('submitGameScore', payload); }
    catch (_) {}
  }

  // ---------- opponents poll ----------
  function startOpponentsPoll() {
    refreshOpponents();
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    opponentsPollTimer = setInterval(refreshOpponents, 5000);
  }
  async function refreshOpponents() {
    try {
      const r = await api('getGameScores', { gameId: GAME_ID, date: todayDateKey() });
      if (!r || !Array.isArray(r.scores)) {
        renderOpponentsStrip([]);
        return;
      }
      const me = window.STAARAuth.currentUser();
      const myName = (me && me.username) || '';
      const friends = r.scores.filter(s => s.username !== myName);
      friends.sort((a, b) => (b.score || 0) - (a.score || 0));
      renderOpponentsStrip(friends.slice(0, 3));
    } catch (_) { renderOpponentsStrip([]); }
  }
  function renderOpponentsStrip(friends) {
    // Always show the strip, even with zero friends — it now hosts
    // the "Challenge a friend" button. Without that we lose the
    // entry point to the invite flow.
    const friendsHtml = friends.length === 0
      ? '<div class="game-opp-empty">— no friends playing yet —</div>'
      : friends.map(f => `
          <div class="game-opponent">
            <span class="game-opp-name">${esc(f.displayName || f.username)}</span>
            <span class="game-opp-score">${(f.score || 0)}<span class="game-opp-score-label">pts</span></span>
          </div>`).join('');
    opponentsEl.innerHTML = `
      <div class="game-opponents-label">Friends today</div>
      <div class="game-opponents-list">${friendsHtml}</div>
      <button type="button" class="game-challenge-btn" id="gameChallengeBtn">+ Challenge friend</button>`;
    opponentsEl.hidden = false;
    const cb = document.getElementById('gameChallengeBtn');
    if (cb) cb.addEventListener('click', openInviteSheet);
  }

  // ---------- complete screen ----------
  function showComplete() {
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    if (timerTick) { clearInterval(timerTick); timerTick = null; }
    isOver = true;
    const durationSec = Math.floor((Date.now() - startedAt) / 1000);
    // Add current puzzle's found-words to totalFound (only on time-up since
    // shuffle already moves on without crediting via completion).
    totalFound += found.size;
    completeTitle.textContent = totalFound >= 20 ? 'Word machine! ⚡' : totalFound >= 10 ? 'Great run!' : totalFound >= 4 ? 'Nice run!' : 'Try again!';
    completeScore.textContent = String(score);
    completeWords.textContent = `${totalFound} words`;
    completeTime.textContent = fmtTime(durationSec);
    // Friend comparison
    api('getGameScores', { gameId: GAME_ID, date: todayDateKey() })
      .then(r => {
        if (!r || !Array.isArray(r.scores)) return;
        const me = window.STAARAuth.currentUser();
        const myName = me && me.username;
        const friends = r.scores.filter(s => s.username !== myName);
        if (friends.length === 0) {
          completeFriends.innerHTML = '<p class="game-complete-empty">No friends have played today yet — invite them on the league page!</p>';
          return;
        }
        friends.sort((a, b) => (b.score || 0) - (a.score || 0));
        const beat = friends.filter(f => (f.score || 0) < score);
        const lost = friends.filter(f => (f.score || 0) > score);
        completeFriends.innerHTML = `
          <div class="game-complete-cmp">
            ${beat.length > 0 ? `<div class="game-complete-cmp-line game-complete-cmp-line--win">🏆 Beat ${beat.length} ${beat.length === 1 ? 'friend' : 'friends'}: ${beat.slice(0, 3).map(f => esc(f.displayName || f.username)).join(', ')}</div>` : ''}
            ${lost.length > 0 ? `<div class="game-complete-cmp-line game-complete-cmp-line--lost">Behind: ${lost.slice(0, 3).map(f => `${esc(f.displayName || f.username)} (${f.score || 0})`).join(', ')}</div>` : ''}
          </div>`;
      });
    completeEl.hidden = false;
    // Final submit
    doSubmit();
  }

  // ---------- wiring ----------
  if (shuffleBtn) shuffleBtn.addEventListener('click', () => shuffleLetters(true));
  const doubleBtn = document.getElementById('gameDouble');
  if (doubleBtn) doubleBtn.addEventListener('click', () => repeatLastLetter());
  if (wheelEl) {
    wheelEl.addEventListener('pointerdown', onPointerDown);
    wheelEl.addEventListener('pointermove', onPointerMove);
    wheelEl.addEventListener('pointerup', onPointerUp);
    wheelEl.addEventListener('pointercancel', onPointerUp);
    wheelEl.addEventListener('pointerleave', (e) => { if (pointerDown) onPointerUp(e); });
    // Touch fallback for older browsers that don't unify pointer events
    wheelEl.addEventListener('touchstart', onPointerDown, { passive: false });
    wheelEl.addEventListener('touchmove', onPointerMove, { passive: false });
    wheelEl.addEventListener('touchend', onPointerUp);
  }
  window.addEventListener('resize', () => { renderWheel(); });

  // ---------- INVITE FLOW ----------
  // Kid taps "+ Challenge friend" → bottom sheet lists their accepted
  // friends → tap a friend → pingGameInvite lambda action → friend
  // sees a banner at the top of the game page the next time they
  // open it ("Saad invited you to play! Join").
  async function openInviteSheet() {
    // Build a sheet inline (no shared component for v1)
    const wrap = document.createElement('div');
    wrap.id = 'gameInviteSheet';
    wrap.className = 'game-invite-sheet';
    wrap.innerHTML = `
      <div class="game-invite-sheet-backdrop"></div>
      <div class="game-invite-sheet-panel" role="dialog" aria-modal="true">
        <div class="game-invite-sheet-grab" aria-hidden="true"></div>
        <button type="button" class="game-invite-sheet-close" aria-label="Close">✕</button>
        <h3 class="game-invite-sheet-title">Challenge a friend</h3>
        <p class="game-invite-sheet-sub">They'll get a banner on the game page inviting them to race you.</p>
        <div id="gameInviteFriends" class="game-invite-friends">Loading…</div>
      </div>`;
    document.body.appendChild(wrap);
    const closeSheet = () => { try { wrap.remove(); } catch (_) {} };
    wrap.querySelector('.game-invite-sheet-backdrop').addEventListener('click', closeSheet);
    wrap.querySelector('.game-invite-sheet-close').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function escClose(e) {
      if (e.key === 'Escape') { closeSheet(); document.removeEventListener('keydown', escClose); }
    });

    try {
      const r = await api('friendList', {});
      const accepted = (r && Array.isArray(r.friends)) ? r.friends : [];
      const list = document.getElementById('gameInviteFriends');
      if (accepted.length === 0) {
        list.innerHTML = `
          <div class="game-invite-empty">
            <div class="game-invite-empty-emoji" aria-hidden="true">👋</div>
            <p>Add friends first, then come back to challenge them.</p>
            <a class="btn btn-primary" href="../league.html">Add a friend →</a>
          </div>`;
      } else {
        list.innerHTML = accepted.map(f => `
          <div class="game-invite-friend" data-username="${esc(f.peer)}">
            <span class="game-invite-friend-av">${esc((f.displayName || f.peer).charAt(0).toUpperCase())}</span>
            <span class="game-invite-friend-name">${esc(f.displayName || f.peer)}</span>
            <button type="button" class="game-invite-ping-btn" data-target="${esc(f.peer)}" data-display="${esc(f.displayName || f.peer)}">Ping</button>
          </div>
        `).join('');
        list.querySelectorAll('.game-invite-ping-btn').forEach(b => {
          b.addEventListener('click', async () => {
            const target = b.getAttribute('data-target');
            const display = b.getAttribute('data-display');
            b.disabled = true;
            b.textContent = 'Sending…';
            try {
              await api('sendGameInvite', { target, gameId: GAME_ID });
              b.textContent = 'Sent ✓';
              b.classList.add('is-sent');
              toast(`Invited ${display}!`, 1800);
              try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
            } catch (e) {
              b.disabled = false;
              b.textContent = 'Try again';
            }
          });
        });
      }
    } catch (e) {
      document.getElementById('gameInviteFriends').innerHTML =
        '<p class="game-invite-empty"><span class="game-invite-empty-emoji">⚠️</span>Could not load friends.</p>';
    }
  }

  // Incoming invite banner — shown at top when a friend has pinged
  // the current kid. Auto-clears server-side on dismiss.
  async function checkIncomingInvites() {
    const inviteBanner = document.getElementById('gameInviteBanner');
    if (!inviteBanner) return;
    try {
      const r = await api('getGameInvites', { gameId: GAME_ID });
      const invites = (r && Array.isArray(r.invites)) ? r.invites : [];
      if (invites.length === 0) { inviteBanner.hidden = true; return; }
      // Show the most recent invite (deduped by sender server-side)
      const inv = invites.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))[0];
      inviteBanner.innerHTML = `
        <span class="game-invite-banner-icon" aria-hidden="true">🔥</span>
        <span class="game-invite-banner-text">
          <strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race
        </span>
        <button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      inviteBanner.hidden = false;
      inviteBanner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => {
        inviteBanner.hidden = true;
        try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {}
      });
      try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
    } catch (_) {}
  }

  // ---------- boot ----------
  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) {
      statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.';
      return;
    }
    loadPuzzle();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
    boot();
  } else {
    document.addEventListener('gradeearn:auth-changed', boot, { once: true });
    (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})();
  }
})();
