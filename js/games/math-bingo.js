/**
 * GradeEarn — Math Bingo (game #8, May 11).
 *
 * Mechanic: 5×5 bingo card filled with possible answers. A math
 * problem pops up; kid taps the answer cell on the card to mark it.
 * Wrong tap → −5 pts. Mark 5-in-a-row (any direction) → BINGO +50 pts.
 * Multiple BINGOs allowed in one round. Card answers are picked
 * fresh each game from a per-grade pool, and every called problem
 * is guaranteed to have its answer on the card.
 */
(function () {
  'use strict';
  const GAME_ID = 'math-bingo';
  const DURATION_SEC = 90;

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('mbPreStart');
  const startBtn = document.getElementById('mbStartBtn');
  const statsEl = document.getElementById('mbStats');
  const marksEl = document.getElementById('mbMarks');
  const bingosEl = document.getElementById('mbBingos');
  const timerEl = document.getElementById('mbTimer');
  const streakEl = document.getElementById('mbStreak');
  const timerStatEl = document.getElementById('mbTimerStat');
  const streakStatEl = document.getElementById('mbStreakStat');
  const boardEl = document.getElementById('mbBoard');
  const callEl = document.getElementById('mbCall');
  const cardEl = document.getElementById('mbCard');
  const progressEl = document.getElementById('mbProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('mbPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let score = 0, marks = 0, bingos = 0, streak = 0, bestStreak = 0;
  let cardNumbers = []; // 25 numbers
  let cardMarked = []; // 25 bools
  let bingoLines = new Set();
  let currentAnswer = null;
  let currentQuestion = null;
  let startedAt = null, endsAt = null;
  let tickTimer = null, nextTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1400); }
  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }

  // ---------- per-grade answer pool ----------
  function answerPool() {
    if (grade === 'grade-k') return Array.from({length: 10}, (_, i) => i + 1);
    if (grade === 'grade-1') return Array.from({length: 20}, (_, i) => i + 1);
    if (grade === 'grade-2') return Array.from({length: 30}, (_, i) => i + 1);
    if (grade === 'grade-3') return Array.from({length: 60}, (_, i) => i + 1);
    if (grade === 'grade-4') return Array.from({length: 100}, (_, i) => i + 1);
    return Array.from({length: 144}, (_, i) => i + 1);
  }

  function pickCardNumbers() {
    const pool = answerPool();
    shuffleInPlace(pool);
    return pool.slice(0, 24).concat(['FREE']); // 25th slot = FREE
  }

  function generateQuestionForAnswer(ans) {
    const a = Number(ans);
    if (!Number.isFinite(a)) return { q: 'Free!', a: 'FREE' };
    if (grade === 'grade-k' || grade === 'grade-1') {
      if (a <= 5) { const b = randInt(0, a); return { q: `${a - b} + ${b}`, a: String(a) }; }
      const b = randInt(0, Math.min(9, a)); return { q: `${a - b} + ${b}`, a: String(a) };
    }
    if (grade === 'grade-2') {
      if (Math.random() < 0.5 && a <= 18) { const b = randInt(1, a - 1); return { q: `${b} + ${a - b}`, a: String(a) }; }
      const x = randInt(a + 1, a + 20); return { q: `${x} − ${x - a}`, a: String(a) };
    }
    if (grade === 'grade-3') {
      // multiplication or add/sub
      const r = Math.random();
      if (r < 0.5) {
        for (let b = 2; b <= 9; b++) if (a % b === 0 && a / b <= 9 && a / b >= 2) { return { q: `${b} × ${a / b}`, a: String(a) }; }
        const b = randInt(1, a - 1); return { q: `${b} + ${a - b}`, a: String(a) };
      }
      const b = randInt(1, Math.max(1, a - 1)); return { q: `${b} + ${a - b}`, a: String(a) };
    }
    if (grade === 'grade-4') {
      // larger mult, division
      const r = Math.random();
      if (r < 0.55) {
        for (let b = 2; b <= 12; b++) if (a % b === 0 && a / b <= 12 && a / b >= 2) { return { q: Math.random() < 0.5 ? `${b} × ${a / b}` : `${a * 2} ÷ 2`, a: String(a) }; }
      }
      const b = randInt(10, Math.max(11, a)); return { q: `${b + a} − ${b}`, a: String(a) };
    }
    // grade 5+
    const r = Math.random();
    if (r < 0.6) {
      for (let b = 2; b <= 12; b++) if (a % b === 0 && a / b <= 12 && a / b >= 2) { return { q: `${b} × ${a / b}`, a: String(a) }; }
    }
    if (r < 0.85) {
      const x = randInt(a + 1, a + 100); return { q: `${x} − ${x - a}`, a: String(a) };
    }
    const b = randInt(2, 12); return { q: `${a * b} ÷ ${b}`, a: String(a) };
  }

  function callNext() {
    if (endsAt && Date.now() >= endsAt) return;
    // Pick from UNMARKED cells (excluding FREE which is auto-marked) so kid can always score
    const unmarkedIdx = [];
    for (let i = 0; i < cardNumbers.length; i++) if (!cardMarked[i] && cardNumbers[i] !== 'FREE') unmarkedIdx.push(i);
    if (unmarkedIdx.length === 0) { finishGame(); return; }
    const idx = pick(unmarkedIdx);
    currentAnswer = String(cardNumbers[idx]);
    currentQuestion = generateQuestionForAnswer(cardNumbers[idx]);
    callEl.textContent = currentQuestion.q;
  }

  function renderCard() {
    cardEl.innerHTML = cardNumbers.map((n, i) => {
      const isFree = n === 'FREE';
      const cls = ['mb-cell'];
      if (cardMarked[i]) cls.push('is-marked');
      if (isFree) cls.push('is-free');
      return `<button type="button" class="${cls.join(' ')}" data-idx="${i}" ${isFree ? 'disabled' : ''}>${esc(String(n))}</button>`;
    }).join('');
    cardEl.querySelectorAll('.mb-cell').forEach(b => b.addEventListener('click', () => onCellTap(parseInt(b.getAttribute('data-idx'), 10))));
  }

  function onCellTap(idx) {
    if (inputLocked) return;
    if (cardMarked[idx]) { toast('Already marked', 800); return; }
    const val = String(cardNumbers[idx]);
    if (val === currentAnswer) {
      cardMarked[idx] = true;
      marks++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      const bonus = Math.min(streak, 5);
      const pts = 10 + bonus;
      score += pts;
      const newBingo = checkBingo();
      if (newBingo > 0) {
        bingos += newBingo;
        score += 50 * newBingo;
        toast(`BINGO! +${50 * newBingo}`, 1200);
        try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
      }
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
    } else {
      score = Math.max(0, score - 5);
      streak = 0;
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
      toast(`Wrong cell. The answer was ${currentAnswer}.`, 1300);
    }
    scoreEl.textContent = String(score);
    marksEl.textContent = String(marks);
    bingosEl.textContent = String(bingos);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    renderCard();
    queueSubmit();
    callNext();
  }

  function checkBingo() {
    // 5 rows, 5 cols, 2 diags
    const lines = [];
    for (let r = 0; r < 5; r++) lines.push([r*5, r*5+1, r*5+2, r*5+3, r*5+4]);
    for (let c = 0; c < 5; c++) lines.push([c, c+5, c+10, c+15, c+20]);
    lines.push([0, 6, 12, 18, 24]);
    lines.push([4, 8, 12, 16, 20]);
    let newOnes = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const full = line.every(i => cardMarked[i] || cardNumbers[i] === 'FREE');
      if (full && !bingoLines.has(li)) { bingoLines.add(li); newOnes++; }
    }
    return newOnes;
  }

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
    score = 0; marks = 0; bingos = 0; streak = 0; bestStreak = 0;
    bingoLines = new Set();
    cardNumbers = pickCardNumbers();
    shuffleInPlace(cardNumbers);
    cardMarked = cardNumbers.map(n => n === 'FREE');
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; marksEl.textContent = '0'; bingosEl.textContent = '0';
    timerEl.textContent = String(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Math Bingo · ${gradeLabel(grade)}`;
    renderCard();
    callNext();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    completeTitle.textContent = bingos >= 3 ? 'BINGO master! 🎯' : bingos >= 1 ? 'BINGO!' : 'Keep marking!';
    completeScore.textContent = String(score);
    completeCorrect.textContent = String(bingos);
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(bingos).fill('BINGO'), totalWords: marks, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'mb-' + grade, prize: 'Math Bingo', foundPrize: bingos >= 1 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">🎯</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'mb_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.textContent = 'Please sign in to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Math Bingo · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); setTimeout(boot, 600); }
})();
