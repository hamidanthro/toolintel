/**
 * GradeEarn — Sudoku Mini (game #9, May 11).
 *
 * Mechanic: 4×4 (K-3) or 6×6 (4+) sudoku boards. Tap an empty cell,
 * then tap a number 1-N. Correct = +5 pts, locked. Wrong = −2 pts,
 * cell stays empty. Complete board = +50 bonus, fresh board appears.
 * 5-minute round; count boards solved + cells correct.
 *
 * Boards are generated from a small bank of solutions with random
 * digit permutation + random cell removal. Always solvable.
 */
(function () {
  'use strict';
  const GAME_ID = 'sudoku-mini';
  const DURATION_SEC = 300;

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('skPreStart');
  const startBtn = document.getElementById('skStartBtn');
  const statsEl = document.getElementById('skStats');
  const cellsEl = document.getElementById('skCells');
  const boardsEl = document.getElementById('skBoards');
  const timerEl = document.getElementById('skTimer');
  const streakEl = document.getElementById('skStreak');
  const timerStatEl = document.getElementById('skTimerStat');
  const streakStatEl = document.getElementById('skStreakStat');
  const boardEl = document.getElementById('skBoard');
  const gridEl = document.getElementById('skGrid');
  const paletteEl = document.getElementById('skPalette');
  const progressEl = document.getElementById('skProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('skPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let score = 0, cells = 0, boards = 0, streak = 0, bestStreak = 0;
  let size = 4, boxR = 2, boxC = 2;
  let solution = []; // 2D
  let board = []; // 2D, 0 = empty
  let locked = []; // 2D
  let selectedCell = null;
  let startedAt = null, endsAt = null;
  let tickTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1200); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }
  function fmtTime(sec) { const m = Math.floor(sec / 60); const s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }

  // ---------- size + base solutions ----------
  function gradeSpec() {
    if (grade === 'grade-k' || grade === 'grade-1' || grade === 'grade-2' || grade === 'grade-3') return { size: 4, boxR: 2, boxC: 2, blanks: grade === 'grade-k' ? 4 : grade === 'grade-1' ? 6 : grade === 'grade-2' ? 8 : 10 };
    return { size: 6, boxR: 2, boxC: 3, blanks: grade === 'grade-4' ? 12 : grade === 'grade-5' ? 16 : 20 };
  }
  // Valid 4×4 base solution (one canonical)
  const BASE_4X4 = [
    [1,2,3,4],
    [3,4,1,2],
    [2,1,4,3],
    [4,3,2,1]
  ];
  // Valid 6×6 base solution
  const BASE_6X6 = [
    [1,2,3,4,5,6],
    [4,5,6,1,2,3],
    [2,3,1,5,6,4],
    [5,6,4,2,3,1],
    [3,1,2,6,4,5],
    [6,4,5,3,1,2]
  ];

  function genSolution() {
    const base = size === 4 ? BASE_4X4 : BASE_6X6;
    // Permute digits 1..size randomly
    const perm = []; for (let i = 1; i <= size; i++) perm.push(i); shuffleInPlace(perm);
    const map = {}; for (let i = 0; i < size; i++) map[i + 1] = perm[i];
    const sol = base.map(row => row.map(v => map[v]));
    return sol;
  }

  function genBoard() {
    solution = genSolution();
    board = solution.map(row => row.slice());
    locked = solution.map(row => row.map(() => true));
    const total = size * size;
    const blanksTarget = gradeSpec().blanks;
    const positions = []; for (let i = 0; i < total; i++) positions.push(i);
    shuffleInPlace(positions);
    for (let i = 0; i < blanksTarget; i++) {
      const p = positions[i]; const r = Math.floor(p / size); const c = p % size;
      board[r][c] = 0;
      locked[r][c] = false;
    }
  }

  function renderGrid() {
    gridEl.style.setProperty('--sk-size', String(size));
    gridEl.dataset.size = String(size);
    let html = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const v = board[r][c];
        const isLocked = locked[r][c];
        const isSel = selectedCell && selectedCell.r === r && selectedCell.c === c;
        const isBoxRBreak = r % boxR === 0 && r > 0;
        const isBoxCBreak = c % boxC === 0 && c > 0;
        const cls = ['sk-cell'];
        if (isLocked) cls.push('is-locked');
        if (isSel) cls.push('is-sel');
        if (isBoxRBreak) cls.push('is-rbreak');
        if (isBoxCBreak) cls.push('is-cbreak');
        html += `<button type="button" class="${cls.join(' ')}" data-r="${r}" data-c="${c}" ${isLocked ? 'disabled' : ''}>${v || ''}</button>`;
      }
    }
    gridEl.innerHTML = html;
    gridEl.querySelectorAll('.sk-cell').forEach(b => b.addEventListener('click', () => onCellTap(parseInt(b.getAttribute('data-r'), 10), parseInt(b.getAttribute('data-c'), 10))));
  }

  function renderPalette() {
    let html = '';
    for (let i = 1; i <= size; i++) {
      html += `<button type="button" class="sk-num" data-n="${i}">${i}</button>`;
    }
    html += `<button type="button" class="sk-num sk-num--erase" data-n="0">✕</button>`;
    paletteEl.innerHTML = html;
    paletteEl.querySelectorAll('.sk-num').forEach(b => b.addEventListener('click', () => onNumberTap(parseInt(b.getAttribute('data-n'), 10))));
  }

  function onCellTap(r, c) {
    if (inputLocked) return;
    if (locked[r][c]) return;
    selectedCell = { r, c };
    renderGrid();
  }

  function onNumberTap(n) {
    if (inputLocked) return;
    if (!selectedCell) { toast('Tap an empty cell first', 900); return; }
    const { r, c } = selectedCell;
    if (locked[r][c]) return;
    if (n === 0) { board[r][c] = 0; renderGrid(); return; }
    const correct = solution[r][c];
    if (n === correct) {
      board[r][c] = n;
      locked[r][c] = true;
      cells++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      const bonus = Math.min(streak, 5);
      score += 5 + bonus;
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
      // Check if board complete
      if (board.every(row => row.every(v => v !== 0))) {
        boards++;
        score += 50;
        toast('Board solved! +50', 1300);
        try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
        setTimeout(() => { if (endsAt && Date.now() >= endsAt) return; genBoard(); selectedCell = null; renderGrid(); }, 900);
      }
      selectedCell = null;
    } else {
      score = Math.max(0, score - 2);
      streak = 0;
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
      toast(`Not ${n} here`, 700);
    }
    scoreEl.textContent = String(score);
    cellsEl.textContent = String(cells);
    boardsEl.textContent = String(boards);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    renderGrid();
    queueSubmit();
  }

  function startTick() { if (tickTimer) clearInterval(tickTimer); tick(); tickTimer = setInterval(tick, 200); }
  function tick() {
    const rem = Math.max(0, endsAt - Date.now());
    const sec = Math.ceil(rem / 1000);
    timerEl.textContent = fmtTime(sec);
    if (progressEl) progressEl.style.width = (rem / (DURATION_SEC * 1000) * 100) + '%';
    if (sec <= 30) timerStatEl.classList.add('is-danger'); else timerStatEl.classList.remove('is-danger');
    if (rem <= 0) finishGame();
  }

  function startGame() {
    const spec = gradeSpec(); size = spec.size; boxR = spec.boxR; boxC = spec.boxC;
    score = 0; cells = 0; boards = 0; streak = 0; bestStreak = 0;
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; cellsEl.textContent = '0'; boardsEl.textContent = '0';
    timerEl.textContent = fmtTime(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Sudoku Mini · ${size}×${size} · ${gradeLabel(grade)}`;
    selectedCell = null;
    genBoard();
    renderGrid();
    renderPalette();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    completeTitle.textContent = boards >= 3 ? 'Logic legend! 🔢' : boards >= 1 ? 'Solved!' : 'Keep training!';
    completeScore.textContent = String(score);
    completeCorrect.textContent = String(boards);
    completeStreak.textContent = String(bestStreak);
    completeFriends.innerHTML = '';
    api('getGameScores', { gameId: GAME_ID, date: todayDateKey() }).then(r => {
      if (!r || !Array.isArray(r.scores)) return;
      const me = window.STAARAuth.currentUser();
      const myName = me && me.username;
      const friends = r.scores.filter(s => s.username !== myName);
      if (friends.length === 0) { completeFriends.innerHTML = '<p class="game-complete-empty">No friends have played today yet — invite them on the league page!</p>'; return; }
      friends.sort((a, b) => (b.score || 0) - (a.score || 0));
      const beat = friends.filter(f => (f.score || 0) < score);
      const lost = friends.filter(f => (f.score || 0) > score);
      completeFriends.innerHTML = `<div class="game-complete-cmp">${beat.length ? `<div class="game-complete-cmp-line game-complete-cmp-line--win">🏆 Beat ${beat.length} ${beat.length === 1 ? 'friend' : 'friends'}: ${beat.slice(0, 3).map(f => esc(f.displayName || f.username)).join(', ')}</div>` : ''}${lost.length ? `<div class="game-complete-cmp-line game-complete-cmp-line--lost">Behind: ${lost.slice(0, 3).map(f => `${esc(f.displayName || f.username)} (${f.score || 0})`).join(', ')}</div>` : ''}</div>`;
    });
    completeEl.hidden = false;
    try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
    doSubmit();
  }

  let submitTimer = null;
  function queueSubmit() { clearTimeout(submitTimer); submitTimer = setTimeout(doSubmit, 600); }
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(boards).fill('BOARD'), totalWords: cells, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'sk-' + grade, prize: 'Sudoku Mini', foundPrize: boards >= 1 }); } catch (_) {} }

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
        list.innerHTML = `<div class="game-invite-empty"><div class="game-invite-empty-emoji">👋</div><p>Add friends first.</p><a class="btn btn-primary" href="../league.html">Add a friend →</a></div>`;
      } else {
        list.innerHTML = accepted.map(f => `<div class="game-invite-friend"><span class="game-invite-friend-av">${esc((f.displayName || f.peer).charAt(0).toUpperCase())}</span><span class="game-invite-friend-name">${esc(f.displayName || f.peer)}</span><button type="button" class="game-invite-ping-btn" data-target="${esc(f.peer)}" data-display="${esc(f.displayName || f.peer)}">Ping</button></div>`).join('');
        list.querySelectorAll('.game-invite-ping-btn').forEach(b => b.addEventListener('click', async () => {
          b.disabled = true; b.textContent = 'Sending…';
          try { await api('sendGameInvite', { target: b.getAttribute('data-target'), gameId: GAME_ID }); b.textContent = 'Sent ✓'; b.classList.add('is-sent'); toast(`Invited ${b.getAttribute('data-display')}!`, 1800); }
          catch (_) { b.disabled = false; b.textContent = 'Try again'; }
        }));
      }
    } catch (_) { document.getElementById('gameInviteFriends').innerHTML = '<p class="game-invite-empty">Could not load friends.</p>'; }
  }
  async function checkIncomingInvites() {
    const banner = document.getElementById('gameInviteBanner');
    if (!banner) return;
    try {
      const r = await api('getGameInvites', { gameId: GAME_ID });
      const invites = (r && Array.isArray(r.invites)) ? r.invites : [];
      if (invites.length === 0) { banner.hidden = true; return; }
      const inv = invites.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))[0];
      banner.innerHTML = `<span class="game-invite-banner-icon">🔢</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'sk_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Sudoku Mini · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
