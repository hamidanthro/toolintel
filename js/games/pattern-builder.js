/**
 * GradeEarn — Pattern Builder (game #6, May 11).
 *
 * Mechanic: 60s sprint. Show a sequence with one term hidden ("?").
 * Kid picks the right answer from 4 choices. Patterns scale by
 * grade: K-1 use color/shape patterns + count-by-1s; 2-3 add
 * count-by-2s/5s/10s; 4-5 add larger arithmetic + geometric ×2;
 * 6+ add square numbers, triangular numbers, harder geometric.
 */
(function () {
  'use strict';
  const GAME_ID = 'pattern-builder';
  const DURATION_SEC = 60;

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('pbPreStart');
  const startBtn = document.getElementById('pbStartBtn');
  const statsEl = document.getElementById('pbStats');
  const correctEl = document.getElementById('pbCorrect');
  const wrongEl = document.getElementById('pbWrong');
  const timerEl = document.getElementById('pbTimer');
  const streakEl = document.getElementById('pbStreak');
  const timerStatEl = document.getElementById('pbTimerStat');
  const streakStatEl = document.getElementById('pbStreakStat');
  const boardEl = document.getElementById('pbBoard');
  const seqEl = document.getElementById('pbSequence');
  const choicesEl = document.getElementById('pbChoices');
  const progressEl = document.getElementById('pbProgress');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('pbPlayAgain');
  const toastEl = document.getElementById('gameToast');

  let grade = 'grade-k';
  let score = 0, correctCount = 0, wrongCount = 0, streak = 0, bestStreak = 0;
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
  function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }

  // ---------- pattern generators ----------
  // Each returns { sequence: [], hiddenIdx, answer, choices }
  function buildPatternArith(start, step, len, hiddenIdx) {
    const seq = [];
    for (let i = 0; i < len; i++) seq.push(start + i * step);
    const answer = seq[hiddenIdx];
    return { sequence: seq.map(String), hiddenIdx, answer: String(answer), choices: numChoices(answer) };
  }
  function buildPatternGeo(start, ratio, len, hiddenIdx) {
    const seq = [];
    for (let i = 0; i < len; i++) seq.push(start * Math.pow(ratio, i));
    const answer = seq[hiddenIdx];
    return { sequence: seq.map(String), hiddenIdx, answer: String(answer), choices: numChoices(answer) };
  }
  function buildPatternShape(symbols, period, len, hiddenIdx) {
    const seq = [];
    for (let i = 0; i < len; i++) seq.push(symbols[i % symbols.length]);
    const answer = seq[hiddenIdx];
    // Choices: each unique symbol in the period
    const choices = shuffleInPlace([...new Set(symbols)]);
    while (choices.length < 4) choices.push(pick(['🔺','🟩','🟧','🟨','🟪']));
    return { sequence: seq, hiddenIdx, answer, choices: shuffleInPlace(choices.slice(0, 4)) };
  }
  function numChoices(answer) {
    const set = new Set([String(answer)]);
    const deltas = shuffleInPlace([1, -1, 2, -2, 5, -5, 10, -10]);
    for (const d of deltas) {
      if (set.size >= 4) break;
      const c = answer + d;
      if (c >= 0) set.add(String(c));
    }
    let extra = 3;
    while (set.size < 4) { set.add(String(answer + extra++)); if (extra > 50) break; }
    return shuffleInPlace(Array.from(set));
  }

  function buildProblem() {
    const r = Math.random();
    if (grade === 'grade-k') {
      // count by 1s OR shape pattern
      if (r < 0.5) {
        const start = randInt(1, 5);
        const len = 5; const hidden = randInt(1, 3);
        return buildPatternArith(start, 1, len, hidden);
      }
      const shapes = pick([['🔴','🔵'], ['⭐','💛'], ['🐶','🐱'], ['🍎','🍌']]);
      return buildPatternShape(shapes, 2, 6, randInt(2, 4));
    }
    if (grade === 'grade-1' || grade === 'grade-2') {
      if (r < 0.4) {
        const step = pick([2, 5, 10]);
        const start = randInt(0, 5) * step;
        return buildPatternArith(start, step, 5, randInt(1, 3));
      } else if (r < 0.75) {
        const start = randInt(1, 10);
        return buildPatternArith(start, 1, 5, randInt(1, 3));
      }
      const shapes = pick([['🔴','🔵','🟢'], ['🐶','🐱','🐰']]);
      return buildPatternShape(shapes, 3, 6, randInt(2, 4));
    }
    if (grade === 'grade-3' || grade === 'grade-4') {
      if (r < 0.4) {
        const step = pick([3, 4, 6, 7]);
        const start = randInt(1, 8);
        return buildPatternArith(start, step, 5, randInt(1, 3));
      } else if (r < 0.7) {
        // geometric ×2 or ×3
        const ratio = pick([2, 3]);
        const start = pick([1, 2, 3]);
        return buildPatternGeo(start, ratio, 5, randInt(1, 3));
      } else if (r < 0.9) {
        // skip count larger
        const step = pick([10, 25, 50, 100]);
        const start = step;
        return buildPatternArith(start, step, 5, randInt(1, 3));
      }
      // squares
      const seq = [1, 4, 9, 16, 25, 36, 49, 64].slice(0, 5);
      const hidden = randInt(1, 3);
      return { sequence: seq.map(String), hiddenIdx: hidden, answer: String(seq[hidden]), choices: numChoices(seq[hidden]) };
    }
    // grade 5+
    if (r < 0.25) {
      // arithmetic with large step
      const step = pick([7, 8, 11, 12, 15, 25]);
      const start = randInt(2, 9);
      return buildPatternArith(start, step, 5, randInt(1, 3));
    } else if (r < 0.45) {
      // geometric
      const ratio = pick([2, 3, 5]);
      const start = pick([1, 2, 3, 4]);
      return buildPatternGeo(start, ratio, 5, randInt(1, 3));
    } else if (r < 0.65) {
      // square numbers
      const start = randInt(1, 6);
      const seq = []; for (let i = 0; i < 5; i++) seq.push(Math.pow(start + i, 2));
      const hidden = randInt(1, 3);
      return { sequence: seq.map(String), hiddenIdx: hidden, answer: String(seq[hidden]), choices: numChoices(seq[hidden]) };
    } else if (r < 0.8) {
      // triangular numbers
      const seq = []; let acc = 0;
      for (let i = 1; i <= 5; i++) { acc += i; seq.push(acc); }
      const hidden = randInt(1, 3);
      return { sequence: seq.map(String), hiddenIdx: hidden, answer: String(seq[hidden]), choices: numChoices(seq[hidden]) };
    } else if (r < 0.95) {
      // fibonacci-like
      const a = randInt(1, 3), b = randInt(1, 4);
      const seq = [a, b];
      for (let i = 0; i < 3; i++) seq.push(seq[seq.length - 1] + seq[seq.length - 2]);
      const hidden = randInt(2, 4);
      return { sequence: seq.map(String), hiddenIdx: hidden, answer: String(seq[hidden]), choices: numChoices(seq[hidden]) };
    }
    // negative step
    const step = pick([-2, -3, -5]);
    const start = randInt(20, 40);
    return buildPatternArith(start, step, 5, randInt(1, 3));
  }

  // ---------- render ----------
  function renderProblem() {
    if (!problem) return;
    const cells = problem.sequence.map((s, i) => {
      if (i === problem.hiddenIdx) return `<span class="pb-cell pb-cell--hidden">?</span>`;
      return `<span class="pb-cell">${esc(s)}</span>`;
    });
    seqEl.innerHTML = cells.join('<span class="pb-sep">,</span>');
    choicesEl.innerHTML = problem.choices.map(c => `<button type="button" class="ms-choice" data-val="${esc(c)}">${esc(c)}</button>`).join('');
    choicesEl.querySelectorAll('.ms-choice').forEach(b => b.addEventListener('click', () => onChoice(b.getAttribute('data-val'), b)));
    inputLocked = false;
  }

  function onChoice(val, btn) {
    if (inputLocked) return;
    inputLocked = true;
    const ok = val === problem.answer;
    if (ok) {
      const bonus = Math.min(streak, 5);
      score += 10 + bonus;
      streak++;
      bestStreak = Math.max(bestStreak, streak);
      correctCount++;
      btn.classList.add('is-correct');
      try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
    } else {
      score = Math.max(0, score - 3);
      streak = 0;
      wrongCount++;
      btn.classList.add('is-wrong');
      [...choicesEl.querySelectorAll('.ms-choice')].forEach(b2 => { if (b2.textContent === problem.answer) b2.classList.add('is-show-correct'); });
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
    }
    scoreEl.textContent = String(score);
    correctEl.textContent = String(correctCount);
    wrongEl.textContent = String(wrongCount);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    nextTimer = setTimeout(() => { if (endsAt && Date.now() >= endsAt) return; problem = buildProblem(); renderProblem(); }, ok ? 360 : 800);
    queueSubmit();
  }

  function startTick() { if (tickTimer) clearInterval(tickTimer); tick(); tickTimer = setInterval(tick, 100); }
  function tick() {
    const rem = Math.max(0, endsAt - Date.now());
    const sec = Math.ceil(rem / 1000);
    timerEl.textContent = String(sec);
    if (progressEl) progressEl.style.width = (rem / (DURATION_SEC * 1000) * 100) + '%';
    if (sec <= 10) timerStatEl.classList.add('is-danger'); else timerStatEl.classList.remove('is-danger');
    if (rem <= 0) finishGame();
  }

  function startGame() {
    score = 0; correctCount = 0; wrongCount = 0; streak = 0; bestStreak = 0;
    startedAt = Date.now(); endsAt = startedAt + DURATION_SEC * 1000;
    scoreEl.textContent = '0'; correctEl.textContent = '0'; wrongEl.textContent = '0';
    timerEl.textContent = String(DURATION_SEC); streakEl.textContent = '0';
    streakStatEl.classList.remove('is-hot'); timerStatEl.classList.remove('is-danger');
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Pattern Builder · ${gradeLabel(grade)}`;
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
    completeTitle.textContent = score >= 200 ? 'Pattern wizard! 🔁' : score >= 100 ? 'Sharp eye!' : 'Keep practicing!';
    completeScore.textContent = String(score);
    completeCorrect.textContent = String(correctCount);
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(correctCount).fill('OK'), totalWords: correctCount + wrongCount, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'pb-' + grade, prize: 'Pattern Builder', foundPrize: bestStreak >= 5 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">🔁</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'pb_howto_dismissed';
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
    statusEl.textContent = `Pattern Builder · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
