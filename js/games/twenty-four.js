/**
 * GradeEarn — 24 Game (game #7, May 11).
 *
 * Mechanic: 90s sprint. Show target (24 for grade 3+, 10 for K-1,
 * 12 for grade 2) and 4 number cards. Kid builds an expression using
 * each number exactly once with +, −, ×, ÷, ( ). Submit checks the
 * expression evaluates to the target. +25 pts per solve plus streak
 * bonus. Skip costs 10 seconds. Puzzles are procedurally generated
 * but verified solvable by a solver before serving.
 */
(function () {
  'use strict';
  const GAME_ID = 'twenty-four';
  const DURATION_SEC = 90;
  const SKIP_PENALTY_SEC = 10;

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('tfPreStart');
  const startBtn = document.getElementById('tfStartBtn');
  const statsEl = document.getElementById('tfStats');
  const solvedEl = document.getElementById('tfSolved');
  const skippedEl = document.getElementById('tfSkipped');
  const timerEl = document.getElementById('tfTimer');
  const streakEl = document.getElementById('tfStreak');
  const timerStatEl = document.getElementById('tfTimerStat');
  const streakStatEl = document.getElementById('tfStreakStat');
  const boardEl = document.getElementById('tfBoard');
  const targetEl = document.getElementById('tfTarget');
  const numbersEl = document.getElementById('tfNumbers');
  const exprEl = document.getElementById('tfExpr');
  const opsEl = document.getElementById('tfOps');
  const submitBtn = document.getElementById('tfSubmit');
  const backBtn = document.getElementById('tfBackspace');
  const skipBtn = document.getElementById('tfSkip');
  const progressEl = document.getElementById('tfProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('tfPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let score = 0, solvedCount = 0, skippedCount = 0, streak = 0, bestStreak = 0;
  let puzzle = null;
  let tokens = []; // {type: 'num'|'op'|'lparen'|'rparen', value, cardIdx?}
  let startedAt = null, endsAt = null;
  let tickTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1400); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }

  function gradeSpec() {
    if (grade === 'grade-k' || grade === 'grade-1') return { count: 3, lo: 1, hi: 5, target: 10 };
    if (grade === 'grade-2') return { count: 4, lo: 1, hi: 6, target: 12 };
    if (grade === 'grade-3' || grade === 'grade-4') return { count: 4, lo: 1, hi: 9, target: 24 };
    return { count: 4, lo: 1, hi: 12, target: 24 };
  }

  // ---------- solver ----------
  function permute(arr) {
    if (arr.length <= 1) return [arr.slice()];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      const rest = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permute(rest)) out.push([arr[i], ...p]);
    }
    return out;
  }
  function ap(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (op === '/') return Math.abs(b) < 1e-9 ? NaN : a / b;
    return NaN;
  }
  function close(a, b) { return Number.isFinite(a) && Math.abs(a - b) < 1e-6; }
  function hasSolution3(nums, target) {
    const ops = ['+', '-', '*', '/'];
    for (const p of permute(nums)) {
      for (const o1 of ops) for (const o2 of ops) {
        if (close(ap(ap(p[0], o1, p[1]), o2, p[2]), target)) return true;
        if (close(ap(p[0], o1, ap(p[1], o2, p[2])), target)) return true;
      }
    }
    return false;
  }
  function hasSolution4(nums, target) {
    const ops = ['+', '-', '*', '/'];
    for (const p of permute(nums)) {
      for (const o1 of ops) for (const o2 of ops) for (const o3 of ops) {
        if (close(ap(ap(ap(p[0], o1, p[1]), o2, p[2]), o3, p[3]), target)) return true;
        if (close(ap(ap(p[0], o1, ap(p[1], o2, p[2])), o3, p[3]), target)) return true;
        if (close(ap(ap(p[0], o1, p[1]), o2, ap(p[2], o3, p[3])), target)) return true;
        if (close(ap(p[0], o1, ap(ap(p[1], o2, p[2]), o3, p[3])), target)) return true;
        if (close(ap(p[0], o1, ap(p[1], o2, ap(p[2], o3, p[3]))), target)) return true;
      }
    }
    return false;
  }

  // ---------- puzzle generation ----------
  function buildPuzzle() {
    const { count, lo, hi, target } = gradeSpec();
    for (let i = 0; i < 200; i++) {
      const nums = [];
      for (let k = 0; k < count; k++) nums.push(randInt(lo, hi));
      const ok = count === 3 ? hasSolution3(nums, target) : hasSolution4(nums, target);
      if (ok) return { numbers: nums, target, used: nums.map(() => false) };
    }
    // fallback
    return count === 3 ? { numbers: [2, 3, 5], target, used: [false, false, false] } : { numbers: [3, 6, 4, 2], target, used: [false, false, false, false] };
  }

  // ---------- token / expression management ----------
  function renderTokens() {
    if (tokens.length === 0) { exprEl.textContent = 'Build your equation…'; exprEl.classList.add('is-empty'); return; }
    exprEl.classList.remove('is-empty');
    exprEl.innerHTML = tokens.map(t => {
      if (t.type === 'num') return `<span class="tf-tok tf-tok--num">${t.value}</span>`;
      if (t.type === 'op') return `<span class="tf-tok tf-tok--op">${esc(t.value)}</span>`;
      return `<span class="tf-tok tf-tok--paren">${t.value}</span>`;
    }).join('');
  }
  function renderNumbers() {
    numbersEl.innerHTML = puzzle.numbers.map((n, i) => `<button type="button" class="tf-num" data-idx="${i}" ${puzzle.used[i] ? 'disabled' : ''}>${n}</button>`).join('');
    numbersEl.querySelectorAll('.tf-num').forEach(b => b.addEventListener('click', () => onNumTap(parseInt(b.getAttribute('data-idx'), 10))));
  }
  function renderOps() {
    const ops = ['+', '−', '×', '÷', '(', ')'];
    opsEl.innerHTML = ops.map(o => `<button type="button" class="tf-op" data-op="${esc(o)}">${o}</button>`).join('');
    opsEl.querySelectorAll('.tf-op').forEach(b => b.addEventListener('click', () => onOpTap(b.getAttribute('data-op'))));
  }
  function symbolToOp(s) { return s === '×' ? '*' : s === '÷' ? '/' : s === '−' ? '-' : s; }

  function onNumTap(idx) {
    if (inputLocked) return;
    if (puzzle.used[idx]) return;
    puzzle.used[idx] = true;
    tokens.push({ type: 'num', value: puzzle.numbers[idx], cardIdx: idx });
    renderTokens(); renderNumbers();
  }
  function onOpTap(sym) {
    if (inputLocked) return;
    if (sym === '(') tokens.push({ type: 'lparen', value: '(' });
    else if (sym === ')') tokens.push({ type: 'rparen', value: ')' });
    else tokens.push({ type: 'op', value: sym });
    renderTokens();
  }
  function onBackspace() {
    if (inputLocked) return;
    const t = tokens.pop();
    if (!t) return;
    if (t.type === 'num') puzzle.used[t.cardIdx] = false;
    renderTokens(); renderNumbers();
  }

  function buildExprString() {
    return tokens.map(t => t.type === 'op' ? symbolToOp(t.value) : t.value).join(' ');
  }
  function evalExpr(s) {
    if (!/^[\d+\-*/() .]+$/.test(s)) return NaN;
    try { return Function('"use strict"; return (' + s + ');')(); } catch (_) { return NaN; }
  }

  function onSubmit() {
    if (inputLocked) return;
    if (!puzzle.used.every(u => u)) { toast('Use all the number cards', 1200); return; }
    inputLocked = true;
    const s = buildExprString();
    const result = evalExpr(s);
    const ok = close(result, puzzle.target);
    if (ok) {
      const bonus = Math.min(streak, 5) * 3;
      const pts = 25 + bonus;
      score += pts;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      solvedCount++;
      exprEl.classList.add('is-correct');
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
      toast(`Solved! +${pts}`, 1100);
    } else {
      streak = 0;
      exprEl.classList.add('is-wrong');
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
      toast(`= ${Number.isFinite(result) ? result : '?'}, not ${puzzle.target}`, 1300);
    }
    scoreEl.textContent = String(score);
    solvedEl.textContent = String(solvedCount);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    setTimeout(() => {
      exprEl.classList.remove('is-correct', 'is-wrong');
      if (endsAt && Date.now() >= endsAt) return;
      if (ok) nextPuzzle();
      else inputLocked = false;
    }, ok ? 700 : 900);
    queueSubmit();
  }
  function onSkip() {
    if (inputLocked) return;
    skippedCount++;
    skippedEl.textContent = String(skippedCount);
    streak = 0;
    streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot');
    if (endsAt) endsAt = Math.max(Date.now() + 100, endsAt - SKIP_PENALTY_SEC * 1000);
    toast(`Skipped — −${SKIP_PENALTY_SEC}s`, 900);
    nextPuzzle();
  }

  function nextPuzzle() {
    puzzle = buildPuzzle();
    tokens = [];
    inputLocked = false;
    targetEl.textContent = String(puzzle.target);
    renderTokens(); renderNumbers();
  }

  // ---------- timer + start/finish ----------
  function startTick() { if (tickTimer) clearInterval(tickTimer); tick(); tickTimer = setInterval(tick, 100); }
  function tick() {
    const rem = Math.max(0, endsAt - Date.now());
    const sec = Math.ceil(rem / 1000);
    timerEl.textContent = String(sec);
    if (progressEl) progressEl.style.width = (rem / (DURATION_SEC * 1000) * 100) + '%';
    if (sec <= 15) timerStatEl.classList.add('is-danger'); else timerStatEl.classList.remove('is-danger');
    if (rem <= 0) finishGame();
  }
  function startGame() {
    score = 0; solvedCount = 0; skippedCount = 0; streak = 0; bestStreak = 0;
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; solvedEl.textContent = '0'; skippedEl.textContent = '0';
    timerEl.textContent = String(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `24 Game · ${gradeLabel(grade)}`;
    renderOps();
    nextPuzzle();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    completeTitle.textContent = solvedCount >= 5 ? 'Math wizard! 🎰' : solvedCount >= 2 ? 'Solid solver!' : 'Keep practicing!';
    completeScore.textContent = String(score);

    // §51 unified scoring: convert session score → wallet cents and
    // credit the same balanceCents that Practice tops up.
    try {
      if (window.GradeEarnReward) {
        const cents = window.GradeEarnReward.scoreToCents(score);
        if (cents > 0) {
          window.GradeEarnReward.award(cents, "twenty-four", { grade: (typeof grade !== "undefined" ? grade : "") })
            .then(function (r) { if (r && r.awarded > 0) window.GradeEarnReward.toastAward(r.awarded); });
        }
      }
    } catch (_) {}
    completeCorrect.textContent = String(solvedCount);
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(solvedCount).fill('OK'), totalWords: solvedCount + skippedCount, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: '24-' + grade, prize: '24 Game', foundPrize: bestStreak >= 3 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">🎰</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'tf_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (submitBtn) submitBtn.addEventListener('click', onSubmit);
  if (backBtn) backBtn.addEventListener('click', onBackspace);
  if (skipBtn) skipBtn.addEventListener('click', onSkip);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `24 Game · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
