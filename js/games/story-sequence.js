/**
 * GradeEarn — Story Sequence (game #12, May 11).
 *
 * Mechanic: 3-min round. A short 3-5 panel story is shown with the
 * panels in random order. Kid taps two panels to SWAP their
 * positions; keeps swapping until the order makes sense. "Check
 * order" validates. Right = +40 pts + speed bonus. Reading
 * comprehension dressed up as a puzzle.
 */
(function () {
  'use strict';
  const GAME_ID = 'story-sequence';
  const STORIES_URL = '../data/games/story-sequence-stories.json?v=20260511a';
  const DURATION_SEC = 180;

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('ssPreStart');
  const startBtn = document.getElementById('ssStartBtn');
  const statsEl = document.getElementById('ssStats');
  const solvedEl = document.getElementById('ssSolved');
  const wrongEl = document.getElementById('ssWrong');
  const timerEl = document.getElementById('ssTimer');
  const streakEl = document.getElementById('ssStreak');
  const timerStatEl = document.getElementById('ssTimerStat');
  const streakStatEl = document.getElementById('ssStreakStat');
  const boardEl = document.getElementById('ssBoard');
  const titleEl = document.getElementById('ssTitle');
  const panelsEl = document.getElementById('ssPanels');
  const checkBtn = document.getElementById('ssCheck');
  const skipBtn = document.getElementById('ssSkip');
  const progressEl = document.getElementById('ssProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('ssPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let bank = null;
  let stories = [];
  let storyIdx = 0;
  let currentStory = null;
  let order = []; // current arrangement: array of correct indexes in display position
  let selected = null;
  let storyStartedAt = null;
  let score = 0, solved = 0, wrong = 0, streak = 0, bestStreak = 0;
  let startedAt = null, endsAt = null;
  let tickTimer = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1300); }
  function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }
  function fmtTime(sec) { const m = Math.floor(sec / 60); const s = sec % 60; return `${m}:${String(s).padStart(2, '0')}`; }

  async function loadBank() {
    try {
      const r = await fetch(STORIES_URL, { cache: 'no-cache' });
      bank = await r.json();
    } catch (_) { bank = { byGrade: {} }; }
    stories = (bank && bank.byGrade && bank.byGrade[grade]) || [];
    if (stories.length === 0) {
      const fallback = Object.keys(bank.byGrade || {}).find(k => (bank.byGrade[k] || []).length > 0);
      stories = (bank.byGrade && bank.byGrade[fallback]) || [];
    }
    shuffleInPlace(stories);
    storyIdx = 0;
  }

  function nextStory() {
    if (stories.length === 0) return;
    currentStory = stories[storyIdx % stories.length];
    storyIdx++;
    // Build a shuffled order that is NOT the correct one
    const n = currentStory.panels.length;
    order = [];
    for (let i = 0; i < n; i++) order.push(i);
    do { shuffleInPlace(order); } while (order.every((v, i) => v === i));
    selected = null;
    storyStartedAt = Date.now();
    titleEl.textContent = currentStory.title;
    renderPanels();
  }

  function renderPanels() {
    if (!currentStory) return;
    panelsEl.innerHTML = order.map((origIdx, displayIdx) => {
      const cls = ['ss-panel'];
      if (selected === displayIdx) cls.push('is-sel');
      return `<button type="button" class="${cls.join(' ')}" data-pos="${displayIdx}"><span class="ss-panel-num">${displayIdx + 1}</span><span class="ss-panel-text">${esc(currentStory.panels[origIdx])}</span></button>`;
    }).join('');
    panelsEl.querySelectorAll('.ss-panel').forEach(b => b.addEventListener('click', () => onPanelTap(parseInt(b.getAttribute('data-pos'), 10))));
  }

  function onPanelTap(pos) {
    if (inputLocked) return;
    if (selected === null) {
      selected = pos;
    } else if (selected === pos) {
      selected = null;
    } else {
      // Swap
      const tmp = order[selected];
      order[selected] = order[pos];
      order[pos] = tmp;
      selected = null;
      try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
    }
    renderPanels();
  }

  function onCheck() {
    if (inputLocked) return;
    const correct = order.every((v, i) => v === i);
    if (correct) {
      const elapsed = Math.floor((Date.now() - storyStartedAt) / 1000);
      const speedBonus = Math.max(0, 40 - elapsed);
      const streakBonus = Math.min(streak, 5) * 5;
      const pts = 40 + speedBonus + streakBonus;
      score += pts;
      solved++;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      toast(`Story solved! +${pts}`, 1300);
      try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
      inputLocked = true;
      setTimeout(() => { inputLocked = false; if (endsAt && Date.now() >= endsAt) return; nextStory(); }, 1400);
    } else {
      wrong++;
      streak = 0;
      toast('Not quite — try a swap', 900);
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
    }
    scoreEl.textContent = String(score);
    solvedEl.textContent = String(solved);
    wrongEl.textContent = String(wrong);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    queueSubmit();
  }
  function onSkip() {
    if (inputLocked) return;
    streak = 0;
    streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot');
    toast('Story skipped', 700);
    nextStory();
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
    score = 0; solved = 0; wrong = 0; streak = 0; bestStreak = 0;
    await loadBank();
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; solvedEl.textContent = '0'; wrongEl.textContent = '0';
    timerEl.textContent = fmtTime(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Story Sequence · ${gradeLabel(grade)}`;
    nextStory();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    completeTitle.textContent = solved >= 3 ? 'Story master! 📖' : solved >= 1 ? 'Nicely sequenced!' : 'Read on!';
    completeScore.textContent = String(score);

    // §51 unified scoring: convert session score → wallet cents and
    // credit the same balanceCents that Practice tops up.
    try {
      if (window.GradeEarnReward) {
        const cents = window.GradeEarnReward.scoreToCents(score);
        if (cents > 0) {
          window.GradeEarnReward.award(cents, "story-sequence", { grade: (typeof grade !== "undefined" ? grade : "") })
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(solved).fill('STORY'), totalWords: solved + wrong, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'ss-' + grade, prize: 'Story Sequence', foundPrize: solved >= 1 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">📖</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'ss_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (checkBtn) checkBtn.addEventListener('click', onCheck);
  if (skipBtn) skipBtn.addEventListener('click', onSkip);
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Story Sequence · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
