/**
 * GradeEarn — Word Ladder (game #11, May 11).
 *
 * Mechanic: 3 minutes to solve as many ladders as possible. Each
 * ladder shows start word → target word. Kid types intermediate
 * words. Each step must (a) differ from previous by exactly one
 * letter, AND (b) appear in the puzzle's curated word list (acts as
 * the dictionary). Reach target = +50 + step efficiency bonus.
 */
(function () {
  'use strict';
  const GAME_ID = 'word-ladder';
  const PUZZLES_URL = '../data/games/word-ladder-puzzles.json?v=20260511a';
  const DURATION_SEC = 180;

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('wlPreStart');
  const startBtn = document.getElementById('wlStartBtn');
  const statsEl = document.getElementById('wlStats');
  const solvedEl = document.getElementById('wlSolved');
  const stepsTotalEl = document.getElementById('wlSteps');
  const timerEl = document.getElementById('wlTimer');
  const streakEl = document.getElementById('wlStreak');
  const timerStatEl = document.getElementById('wlTimerStat');
  const streakStatEl = document.getElementById('wlStreakStat');
  const boardEl = document.getElementById('wlBoard');
  const startWordEl = document.getElementById('wlStartWord');
  const endWordEl = document.getElementById('wlEndWord');
  const stepsListEl = document.getElementById('wlSteps');
  const formEl = document.getElementById('wlForm');
  const inputEl = document.getElementById('wlInput');
  const feedbackEl = document.getElementById('wlFeedback');
  const skipBtn = document.getElementById('wlSkipBtn');
  const progressEl = document.getElementById('wlProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('wlPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let bank = null;
  let puzzles = [];
  let puzzleIdx = 0;
  let currentPuzzle = null;
  let chain = []; // array of words including start
  let totalStepsUsed = 0;
  let score = 0, solved = 0, streak = 0, bestStreak = 0;
  let startedAt = null, endsAt = null;
  let tickTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1400); }
  function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }
  function fmtTime(sec) { const m = Math.floor(sec / 60); const s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }

  function oneLetterDiff(a, b) {
    a = a.toUpperCase(); b = b.toUpperCase();
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
    return diff === 1;
  }

  async function loadBank() {
    try {
      const r = await fetch(PUZZLES_URL, { cache: 'no-cache' });
      bank = await r.json();
    } catch (_) { bank = { byGrade: {} }; }
    puzzles = (bank && bank.byGrade && bank.byGrade[grade]) || [];
    if (puzzles.length === 0) {
      const fallback = Object.keys(bank.byGrade || {}).find(k => (bank.byGrade[k] || []).length > 0);
      puzzles = (bank.byGrade && bank.byGrade[fallback]) || [];
    }
    shuffleInPlace(puzzles);
    puzzleIdx = 0;
  }

  function nextPuzzle() {
    if (puzzles.length === 0) return;
    currentPuzzle = puzzles[puzzleIdx % puzzles.length];
    puzzleIdx++;
    chain = [currentPuzzle.start.toUpperCase()];
    startWordEl.textContent = currentPuzzle.start.toUpperCase();
    endWordEl.textContent = currentPuzzle.end.toUpperCase();
    renderSteps();
    feedbackEl.innerHTML = '';
    inputEl.value = '';
    inputEl.disabled = false;
    setTimeout(() => { try { inputEl.focus(); } catch (_) {} }, 50);
  }
  function renderSteps() {
    const stepsHtml = chain.slice(1).map(w => `<div class="wl-step">${esc(w)}</div>`).join('');
    stepsListEl.innerHTML = stepsHtml;
  }

  function onSubmit(e) {
    if (e) e.preventDefault();
    if (inputLocked) return;
    const raw = (inputEl.value || '').trim().toUpperCase();
    if (!raw) return;
    const prev = chain[chain.length - 1];
    if (raw === prev) { toast('Already used', 800); return; }
    if (raw.length !== prev.length) { feedbackEl.innerHTML = `<span class="sb-fb sb-fb--bad">Must be ${prev.length} letters</span>`; return; }
    if (!oneLetterDiff(raw, prev)) { feedbackEl.innerHTML = `<span class="sb-fb sb-fb--bad">Change exactly one letter from ${esc(prev)}</span>`; return; }
    const dict = (currentPuzzle.dict || []).map(s => s.toUpperCase());
    const targetUC = currentPuzzle.end.toUpperCase();
    if (!dict.includes(raw) && raw !== targetUC) { feedbackEl.innerHTML = `<span class="sb-fb sb-fb--bad">Not a word in this ladder's list</span>`; return; }
    if (chain.includes(raw)) { feedbackEl.innerHTML = `<span class="sb-fb sb-fb--bad">Already used this word</span>`; return; }

    chain.push(raw);
    totalStepsUsed++;
    stepsTotalEl.textContent = String(totalStepsUsed);
    inputEl.value = '';
    renderSteps();

    if (raw === targetUC) {
      // Solved!
      const steps = chain.length - 1;
      const bonus = Math.max(0, 30 - steps * 3) + Math.min(streak, 5) * 5;
      score += 50 + bonus;
      solved++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      feedbackEl.innerHTML = `<span class="sb-fb sb-fb--ok">Ladder solved in ${steps} steps! +${50 + bonus}</span>`;
      try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
      scoreEl.textContent = String(score);
      solvedEl.textContent = String(solved);
      streakEl.textContent = String(streak);
      if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
      inputLocked = true;
      setTimeout(() => { inputLocked = false; if (endsAt && Date.now() >= endsAt) return; nextPuzzle(); }, 1500);
      queueSubmit();
    } else {
      feedbackEl.innerHTML = `<span class="sb-fb sb-fb--ok">Good step!</span>`;
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
      queueSubmit();
    }
  }

  function onSkip() {
    if (inputLocked) return;
    streak = 0;
    streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot');
    toast('Ladder skipped', 700);
    nextPuzzle();
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

  async function startGame() {
    score = 0; solved = 0; streak = 0; bestStreak = 0; totalStepsUsed = 0;
    await loadBank();
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; solvedEl.textContent = '0'; stepsTotalEl.textContent = '0';
    timerEl.textContent = fmtTime(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Word Ladder · ${gradeLabel(grade)}`;
    nextPuzzle();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true; inputEl.disabled = true;
    completeTitle.textContent = solved >= 3 ? 'Ladder pro! 🪜' : solved >= 1 ? 'Climbed!' : 'Keep climbing!';
    completeScore.textContent = String(score);

    // §51 unified scoring: convert session score → wallet cents and
    // credit the same balanceCents that Practice tops up.
    try {
      if (window.GradeEarnReward) {
        const cents = window.GradeEarnReward.scoreToCents(score);
        if (cents > 0) {
          window.GradeEarnReward.award(cents, "word-ladder", { grade: (typeof grade !== "undefined" ? grade : "") })
            .then(function (r) { if (r && r.awarded > 0) window.GradeEarnReward.toastAward(r.awarded); });
        }
      }
    } catch (_) {}
    completeCorrect.textContent = String(solved);
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(solved).fill('LADDER'), totalWords: totalStepsUsed, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'wl-' + grade, prize: 'Word Ladder', foundPrize: solved >= 1 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">🪜</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'wl_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (formEl) formEl.addEventListener('submit', onSubmit);
  if (skipBtn) skipBtn.addEventListener('click', onSkip);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Word Ladder · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
