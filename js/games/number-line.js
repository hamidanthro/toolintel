/**
 * GradeEarn — Number Line (game #5, May 11).
 *
 * Mechanic: 60s sprint. A target value (fraction, decimal, or
 * integer) appears above a horizontal number line. Tap the line
 * exactly where the value lives. Bullseye (within 2% of range) =
 * 15 pts, close (within 8%) = 7 pts. Streak +2 per consecutive
 * bullseye. Targets ramp per grade: K-1 integers 0-10; 2-3 mixed
 * integers/halves; 4-5 fractions/decimals 0-1; 6+ negatives,
 * decimals to hundredths.
 */
(function () {
  'use strict';
  const GAME_ID = 'number-line';
  const DURATION_SEC = 60;

  const scoreEl = document.getElementById('gameYourScore');
  const headerStat = document.getElementById('gameHeaderStat');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('nlPreStart');
  const startBtn = document.getElementById('nlStartBtn');
  const statsEl = document.getElementById('nlStats');
  const correctEl = document.getElementById('nlCorrect');
  const closeEl = document.getElementById('nlClose');
  const timerEl = document.getElementById('nlTimer');
  const streakEl = document.getElementById('nlStreak');
  const timerStatEl = document.getElementById('nlTimerStat');
  const streakStatEl = document.getElementById('nlStreakStat');
  const boardEl = document.getElementById('nlBoard');
  const targetEl = document.getElementById('nlTarget');
  const lineEl = document.getElementById('nlLine');
  const ticksEl = document.getElementById('nlTicks');
  const userMarkEl = document.getElementById('nlUserMark');
  const targetMarkEl = document.getElementById('nlTargetMark');
  const minLabelEl = document.getElementById('nlMinLabel');
  const maxLabelEl = document.getElementById('nlMaxLabel');
  const progressEl = document.getElementById('nlProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('nlPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let score = 0, bullseyes = 0, closes = 0, missed = 0, streak = 0, bestStreak = 0;
  let problem = null;
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
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }

  // ---------- per-grade problem builders ----------
  // Each returns { min, max, target, label, ticks } where label is the
  // displayed target ("3/4", "2.5", "−3"), target is the numeric value,
  // and ticks is an array of {pos, label} to render along the line.
  function buildProblem() {
    const r = Math.random();
    if (grade === 'grade-k' || grade === 'grade-1') {
      const min = 0, max = 10;
      const target = randInt(1, 9);
      return { min, max, target, label: String(target), ticks: tickArray(min, max, 1) };
    }
    if (grade === 'grade-2' || grade === 'grade-3') {
      if (r < 0.6) {
        const min = 0, max = 100;
        const target = randInt(5, 95);
        return { min, max, target, label: String(target), ticks: tickArray(min, max, 10) };
      }
      // halves on 0-10
      const min = 0, max = 10;
      const whole = randInt(0, 9);
      const target = whole + 0.5;
      return { min, max, target, label: `${whole}½`, ticks: tickArray(min, max, 1) };
    }
    if (grade === 'grade-4' || grade === 'grade-5') {
      if (r < 0.45) {
        // fraction 0-1
        const d = pick([2, 3, 4, 5, 8, 10]);
        const n = randInt(1, d - 1);
        const min = 0, max = 1;
        return { min, max, target: n / d, label: `${n}/${d}`, ticks: tickArrayFractional(d) };
      } else if (r < 0.75) {
        // decimal 0-1
        const target = Math.round(Math.random() * 100) / 100;
        if (target < 0.05 || target > 0.95) return buildProblem();
        return { min: 0, max: 1, target, label: target.toFixed(2), ticks: tickArrayFractional(10) };
      }
      // integer 0-1000
      const min = 0, max = 1000;
      const target = randInt(50, 950);
      return { min, max, target, label: String(target), ticks: tickArray(min, max, 100) };
    }
    // grade 6+: negatives, larger ranges, more precise decimals
    if (r < 0.35) {
      // negative integers
      const min = -10, max = 10;
      let target = randInt(-9, 9);
      if (target === 0) target = 1;
      return { min, max, target, label: target < 0 ? `−${Math.abs(target)}` : String(target), ticks: tickArray(min, max, 1) };
    } else if (r < 0.65) {
      // fraction 0-1 advanced denominators
      const d = pick([3, 4, 5, 6, 8, 10, 12]);
      const n = randInt(1, d - 1);
      return { min: 0, max: 1, target: n / d, label: `${n}/${d}`, ticks: tickArrayFractional(d) };
    } else if (r < 0.9) {
      // decimal 0-10 with hundredths
      const target = Math.round(Math.random() * 1000) / 100;
      return { min: 0, max: 10, target, label: target.toFixed(2), ticks: tickArray(0, 10, 1) };
    }
    // percentage 0-100
    const target = randInt(5, 95);
    return { min: 0, max: 100, target, label: `${target}%`, ticks: tickArray(0, 100, 10) };
  }

  function tickArray(min, max, step) {
    const arr = [];
    for (let v = min; v <= max + 1e-9; v += step) {
      arr.push({ pos: (v - min) / (max - min), label: Number.isInteger(v) ? String(v) : v.toFixed(1) });
    }
    return arr;
  }
  function tickArrayFractional(d) {
    const arr = [{ pos: 0, label: '0' }];
    for (let i = 1; i < d; i++) arr.push({ pos: i / d, label: '' });
    arr.push({ pos: 1, label: '1' });
    return arr;
  }

  // ---------- render ----------
  function renderProblem() {
    if (!problem) return;
    targetEl.textContent = `Tap where ${problem.label} lives`;
    minLabelEl.textContent = String(problem.min < 0 ? `−${Math.abs(problem.min)}` : problem.min);
    maxLabelEl.textContent = String(problem.max);
    ticksEl.innerHTML = problem.ticks.map(t => `<div class="nl-tick" style="left:${(t.pos * 100).toFixed(2)}%">${t.label ? `<span class="nl-tick-label">${esc(t.label)}</span>` : ''}</div>`).join('');
    userMarkEl.hidden = true;
    targetMarkEl.hidden = true;
    inputLocked = false;
  }

  // ---------- input ----------
  function onLineTap(e) {
    if (inputLocked || !problem) return;
    const rect = lineEl.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const pos = Math.max(0, Math.min(1, x / rect.width));
    const value = problem.min + pos * (problem.max - problem.min);
    const targetPos = (problem.target - problem.min) / (problem.max - problem.min);
    const errPos = Math.abs(pos - targetPos);

    inputLocked = true;
    userMarkEl.style.left = (pos * 100) + '%';
    userMarkEl.hidden = false;
    targetMarkEl.style.left = (targetPos * 100) + '%';
    targetMarkEl.hidden = false;

    let pts = 0, label = '';
    if (errPos < 0.02) { pts = 15 + Math.min(streak, 5) * 2; bullseyes++; streak++; bestStreak = Math.max(bestStreak, streak); label = `🎯 BULLSEYE! +${pts}`; userMarkEl.classList.add('is-bullseye'); try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {} }
    else if (errPos < 0.08) { pts = 7; closes++; streak = 0; label = `So close! +${pts}`; userMarkEl.classList.remove('is-bullseye'); try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {} }
    else { pts = 0; missed++; streak = 0; label = `Off by a bit. +0`; userMarkEl.classList.remove('is-bullseye'); try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {} }

    score += pts;
    scoreEl.textContent = String(score);
    correctEl.textContent = String(bullseyes);
    closeEl.textContent = String(closes);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    toast(label, 900);

    nextTimer = setTimeout(() => {
      userMarkEl.classList.remove('is-bullseye');
      if (endsAt && Date.now() >= endsAt) return;
      problem = buildProblem();
      renderProblem();
    }, 900);
    queueSubmit();
  }

  // ---------- timer ----------
  function startTick() { if (tickTimer) clearInterval(tickTimer); tick(); tickTimer = setInterval(tick, 100); }
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
    score = 0; bullseyes = 0; closes = 0; missed = 0; streak = 0; bestStreak = 0;
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; correctEl.textContent = '0'; closeEl.textContent = '0';
    timerEl.textContent = String(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Number Line · ${gradeLabel(grade)}`;
    problem = buildProblem();
    renderProblem();
    startTick();
    startOpponentsPoll();
  }
  function finishGame() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    completeTitle.textContent = bullseyes >= 8 ? 'Eagle eye! 🎯' : bullseyes >= 4 ? 'Sharp shooter!' : 'Keep aiming!';
    completeScore.textContent = String(score);
    completeCorrect.textContent = String(bullseyes);
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(bullseyes).fill('OK'), totalWords: bullseyes + closes + missed, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'nl-' + grade, prize: 'Number Line', foundPrize: bestStreak >= 5 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">📏</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'nl_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (lineEl) {
    lineEl.addEventListener('click', onLineTap);
    lineEl.addEventListener('touchstart', (e) => { e.preventDefault(); onLineTap(e); }, { passive: false });
  }
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.textContent = 'Please sign in to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Number Line · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); setTimeout(boot, 600); }
})();
