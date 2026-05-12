/**
 * GradeEarn — Equation Builder (game #4, May 11).
 *
 * Mechanic: 60-second sprint. A puzzle shows "a _ b _ c = result".
 * Kid taps operator buttons (+ − × ÷) to fill the two gaps so the
 * equation is true. Procedurally generated per grade: K-2 use
 * single-digit + and −; grades 3-5 add ×; 6+ adds ÷ and larger
 * numbers. Standard math precedence (× ÷ before + −).
 */
(function () {
  'use strict';
  const GAME_ID = 'equation-builder';
  const DURATION_SEC = 60;

  // DOM
  const scoreEl = document.getElementById('gameYourScore');
  const headerStat = document.getElementById('gameHeaderStat');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('ebPreStart');
  const startBtn = document.getElementById('ebStartBtn');
  const statsEl = document.getElementById('ebStats');
  const correctEl = document.getElementById('ebCorrect');
  const wrongEl = document.getElementById('ebWrong');
  const timerEl = document.getElementById('ebTimer');
  const streakEl = document.getElementById('ebStreak');
  const timerStatEl = document.getElementById('ebTimerStat');
  const streakStatEl = document.getElementById('ebStreakStat');
  const boardEl = document.getElementById('ebBoard');
  const eqEl = document.getElementById('ebEquation');
  const opsEl = document.getElementById('ebOps');
  const submitBtn = document.getElementById('ebSubmit');
  const backspaceBtn = document.getElementById('ebBackspace');
  const progressEl = document.getElementById('ebProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('ebPlayAgain');
  const toastEl = document.getElementById('gameToast');

  // State
  let grade = 'grade-k';
  let score = 0, correctCount = 0, wrongCount = 0, streak = 0, bestStreak = 0;
  let puzzle = null;
  let userOps = [null, null];
  let startedAt = null, endsAt = null;
  let tickTimer = null, nextTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1600); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }

  // ---------- math eval ----------
  function apply(a, op, b) {
    if (op === '+') return a + b;
    if (op === '−') return a - b;
    if (op === '×') return a * b;
    if (op === '÷') return b === 0 ? NaN : a / b;
    return NaN;
  }
  function isMD(op) { return op === '×' || op === '÷'; }
  function evalExpr(a, op1, b, op2, c) {
    // 3-number precedence: × ÷ first, then + −, left-to-right within same tier
    if (isMD(op1) && !isMD(op2)) {
      return apply(apply(a, op1, b), op2, c);
    } else if (!isMD(op1) && isMD(op2)) {
      return apply(a, op1, apply(b, op2, c));
    } else {
      return apply(apply(a, op1, b), op2, c);
    }
  }

  // ---------- per-grade puzzle generators ----------
  function opsFor(g) {
    if (g === 'grade-k' || g === 'grade-1') return ['+','−'];
    if (g === 'grade-2' || g === 'grade-3') return ['+','−','×'];
    return ['+','−','×','÷'];
  }
  function rangeFor(g) {
    if (g === 'grade-k' || g === 'grade-1') return [1, 9];
    if (g === 'grade-2') return [1, 12];
    if (g === 'grade-3' || g === 'grade-4') return [2, 12];
    return [2, 20];
  }
  function buildPuzzle() {
    const ops = opsFor(grade);
    const [lo, hi] = rangeFor(grade);
    for (let i = 0; i < 100; i++) {
      const a = randInt(lo, hi), b = randInt(lo, hi), c = randInt(lo, hi);
      const op1 = pick(ops), op2 = pick(ops);
      const r = evalExpr(a, op1, b, op2, c);
      if (!Number.isFinite(r) || !Number.isInteger(r)) continue;
      if (r < 0 || r > 200) continue;
      // Avoid trivial cases (all same op + all same number)
      return { a, b, c, target: r, hint: [op1, op2] };
    }
    // fallback
    return { a: 2, b: 3, c: 4, target: 14, hint: ['+', '×'] };
  }

  // ---------- render ----------
  function renderEquation() {
    if (!puzzle) return;
    const slot = (i) => userOps[i] ? `<span class="eb-slot is-filled" data-i="${i}">${userOps[i]}</span>` : `<span class="eb-slot" data-i="${i}">_</span>`;
    eqEl.innerHTML = `<span class="eb-num">${puzzle.a}</span> ${slot(0)} <span class="eb-num">${puzzle.b}</span> ${slot(1)} <span class="eb-num">${puzzle.c}</span> = <span class="eb-target">${puzzle.target}</span>`;
  }
  function renderOps() {
    const ops = opsFor(grade);
    opsEl.innerHTML = ops.map(op => `<button type="button" class="eb-op" data-op="${esc(op)}">${op}</button>`).join('');
    opsEl.querySelectorAll('.eb-op').forEach(b => b.addEventListener('click', () => onOpTap(b.getAttribute('data-op'))));
  }

  function onOpTap(op) {
    if (inputLocked) return;
    const i = userOps.indexOf(null);
    if (i < 0) return;
    userOps[i] = op;
    renderEquation();
    try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
  }
  function onBackspace() {
    if (inputLocked) return;
    // remove the last filled
    for (let i = userOps.length - 1; i >= 0; i--) {
      if (userOps[i]) { userOps[i] = null; renderEquation(); return; }
    }
  }

  function onSubmit() {
    if (inputLocked) return;
    if (!puzzle) return;
    if (userOps[0] == null || userOps[1] == null) {
      toast('Fill both gaps first', 1100);
      return;
    }
    inputLocked = true;
    const got = evalExpr(puzzle.a, userOps[0], puzzle.b, userOps[1], puzzle.c);
    const ok = Math.abs(got - puzzle.target) < 1e-9;
    eqEl.classList.add(ok ? 'is-correct' : 'is-wrong');
    if (ok) {
      const bonus = Math.min(streak, 5) * 2;
      const pts = 15 + bonus;
      score += pts;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      correctCount++;
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
    } else {
      score = Math.max(0, score - 5);
      streak = 0;
      wrongCount++;
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
    }
    scoreEl.textContent = String(score);
    correctEl.textContent = String(correctCount);
    wrongEl.textContent = String(wrongCount);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');

    nextTimer = setTimeout(() => {
      eqEl.classList.remove('is-correct', 'is-wrong');
      if (endsAt && Date.now() >= endsAt) return;
      nextPuzzle();
    }, ok ? 500 : 900);
    queueSubmit();
  }

  function nextPuzzle() {
    puzzle = buildPuzzle();
    userOps = [null, null];
    inputLocked = false;
    renderEquation();
  }

  // ---------- timer ----------
  function startTick() {
    if (tickTimer) clearInterval(tickTimer);
    tick();
    tickTimer = setInterval(tick, 100);
  }
  function tick() {
    const rem = Math.max(0, endsAt - Date.now());
    const sec = Math.ceil(rem / 1000);
    timerEl.textContent = String(sec);
    if (progressEl) progressEl.style.width = (rem / (DURATION_SEC * 1000) * 100) + '%';
    if (sec <= 10) timerStatEl.classList.add('is-danger'); else timerStatEl.classList.remove('is-danger');
    if (rem <= 0) finishGame();
  }

  // ---------- start/finish ----------
  function startGame() {
    score = 0; correctCount = 0; wrongCount = 0; streak = 0; bestStreak = 0;
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; correctEl.textContent = '0'; wrongEl.textContent = '0';
    timerEl.textContent = String(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Equation Builder · ${gradeLabel(grade)}`;
    renderOps();
    nextPuzzle();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    completeTitle.textContent = score >= 200 ? 'Equation master! 🧩' : score >= 100 ? 'Solid build!' : score >= 50 ? 'Nice run!' : 'Keep training!';
    completeScore.textContent = String(score);
    completeCorrect.textContent = String(correctCount);
    completeStreak.textContent = String(bestStreak);
    completeFriends.innerHTML = '';
    api('getGameScores', { gameId: GAME_ID, date: todayDateKey() }).then(r => {
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
      completeFriends.innerHTML = `<div class="game-complete-cmp">${beat.length ? `<div class="game-complete-cmp-line game-complete-cmp-line--win">🏆 Beat ${beat.length} ${beat.length === 1 ? 'friend' : 'friends'}: ${beat.slice(0, 3).map(f => esc(f.displayName || f.username)).join(', ')}</div>` : ''}${lost.length ? `<div class="game-complete-cmp-line game-complete-cmp-line--lost">Behind: ${lost.slice(0, 3).map(f => `${esc(f.displayName || f.username)} (${f.score || 0})`).join(', ')}</div>` : ''}</div>`;
    });
    completeEl.hidden = false;
    try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
    doSubmit();
  }

  // ---------- score submit ----------
  let submitTimer = null;
  function queueSubmit() { clearTimeout(submitTimer); submitTimer = setTimeout(doSubmit, 600); }
  async function doSubmit() {
    try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(correctCount).fill('OK'), totalWords: correctCount + wrongCount, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'eb-' + grade, prize: 'Equation Builder', foundPrize: bestStreak >= 5 }); } catch (_) {}
  }

  // ---------- opponents ----------
  function startOpponentsPoll() { refreshOpponents(); if (opponentsPollTimer) clearInterval(opponentsPollTimer); opponentsPollTimer = setInterval(refreshOpponents, 5000); }
  async function refreshOpponents() {
    try {
      const r = await api('getGameScores', { gameId: GAME_ID, date: todayDateKey() });
      if (!r || !Array.isArray(r.scores)) { renderOpponentsStrip([]); return; }
      const me = window.STAARAuth.currentUser();
      const myName = (me && me.username) || '';
      const friends = r.scores.filter(s => s.username !== myName);
      friends.sort((a, b) => (b.score || 0) - (a.score || 0));
      renderOpponentsStrip(friends.slice(0, 3));
    } catch (_) { renderOpponentsStrip([]); }
  }
  function renderOpponentsStrip(friends) {
    const friendsHtml = friends.length === 0 ? '<div class="game-opp-empty">— no friends playing yet —</div>' : friends.map(f => `<div class="game-opponent"><span class="game-opp-name">${esc(f.displayName || f.username)}</span><span class="game-opp-score">${(f.score || 0)}<span class="game-opp-score-label">pts</span></span></div>`).join('');
    opponentsEl.innerHTML = `<div class="game-opponents-label">Friends today</div><div class="game-opponents-list">${friendsHtml}</div><button type="button" class="game-challenge-btn" id="gameChallengeBtn">+ Challenge friend</button>`;
    opponentsEl.hidden = false;
    const cb = document.getElementById('gameChallengeBtn');
    if (cb) cb.addEventListener('click', openInviteSheet);
  }

  // ---------- invite flow ----------
  async function openInviteSheet() {
    const wrap = document.createElement('div');
    wrap.className = 'game-invite-sheet';
    wrap.innerHTML = `<div class="game-invite-sheet-backdrop"></div><div class="game-invite-sheet-panel" role="dialog" aria-modal="true"><div class="game-invite-sheet-grab"></div><button type="button" class="game-invite-sheet-close" aria-label="Close">✕</button><h3 class="game-invite-sheet-title">Challenge a friend</h3><p class="game-invite-sheet-sub">They'll get a banner inviting them to play.</p><div id="gameInviteFriends" class="game-invite-friends">Loading…</div></div>`;
    document.body.appendChild(wrap);
    const close = () => { try { wrap.remove(); } catch (_) {} };
    wrap.querySelector('.game-invite-sheet-backdrop').addEventListener('click', close);
    wrap.querySelector('.game-invite-sheet-close').addEventListener('click', close);
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
    try {
      const r = await api('friendList', {});
      const accepted = (r && Array.isArray(r.friends)) ? r.friends : [];
      const list = document.getElementById('gameInviteFriends');
      if (accepted.length === 0) {
        list.innerHTML = `<div class="game-invite-empty"><div class="game-invite-empty-emoji">👋</div><p>Add friends first, then come back to challenge them.</p><a class="btn btn-primary" href="../league.html">Add a friend →</a></div>`;
      } else {
        list.innerHTML = accepted.map(f => `<div class="game-invite-friend"><span class="game-invite-friend-av">${esc((f.displayName || f.peer).charAt(0).toUpperCase())}</span><span class="game-invite-friend-name">${esc(f.displayName || f.peer)}</span><button type="button" class="game-invite-ping-btn" data-target="${esc(f.peer)}" data-display="${esc(f.displayName || f.peer)}">Ping</button></div>`).join('');
        list.querySelectorAll('.game-invite-ping-btn').forEach(b => b.addEventListener('click', async () => {
          b.disabled = true; b.textContent = 'Sending…';
          try { await api('sendGameInvite', { target: b.getAttribute('data-target'), gameId: GAME_ID }); b.textContent = 'Sent ✓'; b.classList.add('is-sent'); toast(`Invited ${b.getAttribute('data-display')}!`, 1800); }
          catch (_) { b.disabled = false; b.textContent = 'Try again'; }
        }));
      }
    } catch (_) {
      document.getElementById('gameInviteFriends').innerHTML = '<p class="game-invite-empty">Could not load friends.</p>';
    }
  }
  async function checkIncomingInvites() {
    const banner = document.getElementById('gameInviteBanner');
    if (!banner) return;
    try {
      const r = await api('getGameInvites', { gameId: GAME_ID });
      const invites = (r && Array.isArray(r.invites)) ? r.invites : [];
      if (invites.length === 0) { banner.hidden = true; return; }
      const inv = invites.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))[0];
      banner.innerHTML = `<span class="game-invite-banner-icon">🧩</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  // ---------- howto + wiring ----------
  const HOWTO_KEY = 'eb_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (submitBtn) submitBtn.addEventListener('click', onSubmit);
  if (backspaceBtn) backspaceBtn.addEventListener('click', onBackspace);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Equation Builder · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
