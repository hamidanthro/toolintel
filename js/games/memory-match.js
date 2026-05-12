/**
 * GradeEarn — Memory Match (game #2, May 11).
 *
 * Mechanic: grid of face-down cards. Tap two — if they match, both
 * stay revealed. K-1 use pure emoji pairs (pre-reading). Grades 2+
 * pair a math fact with its answer (3+4 ↔ 7, 1/2 ↔ 0.5, x²+5x+6 ↔
 * (x+2)(x+3) etc) so the game doubles as fact-retrieval practice.
 *
 * Scoring: base 10 per match + escalating streak bonus + end-of-game
 * time bonus. Daily puzzle is deterministic per grade (same as Word
 * Connect) so same-grade friends race against the same board.
 *
 * Multiplayer (async race) — opponents strip polls getGameScores
 * every 5s. + Challenge friend opens the invite sheet.
 */
(function () {
  'use strict';

  const PUZZLES_URL = '../data/games/memory-match-puzzles.json?v=20260511a';
  const GAME_ID = 'memory-match';

  // DOM
  const gridEl       = document.getElementById('memoryGrid');
  const statsEl      = document.getElementById('memoryStats');
  const pairsFoundEl = document.getElementById('memoryPairsFound');
  const flipsEl      = document.getElementById('memoryFlips');
  const timeEl       = document.getElementById('memoryTime');
  const streakEl     = document.getElementById('memoryStreak');
  const scoreEl      = document.getElementById('gameYourScore');
  const headerStat   = document.getElementById('gameHeaderStat');
  const opponentsEl  = document.getElementById('gameOpponents');
  const statusEl     = document.getElementById('gameStatus');
  const reshuffleBtn = document.getElementById('memoryReshuffle');
  const completeEl   = document.getElementById('gameComplete');
  const completeTitle  = document.getElementById('gameCompleteTitle');
  const completeScore  = document.getElementById('gameCompleteScore');
  const completePairs  = document.getElementById('gameCompletePairs');
  const completeTime   = document.getElementById('gameCompleteTime');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const toastEl      = document.getElementById('gameToast');

  // State
  let puzzle = null;
  let cards = [];      // [{ id, value, pairId, flipped, matched }]
  let selected = [];   // indexes of currently revealed (0,1,2) cards
  let pairsFound = 0;
  let flips = 0;
  let streak = 0;
  let score = 0;
  let startedAt = null;
  let timeTick = null;
  let inputLocked = false;
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
  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function shuffleInPlace(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  }

  // ---------- puzzle selection ----------
  // Same-grade kids on the same day get the same puzzle. Grades
  // without a bank entry fall back to the first grade with content.
  async function loadPuzzle() {
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    const grade = (me && me.grade) || 'grade-k';
    let bank = null;
    try {
      const r = await fetch(PUZZLES_URL, { cache: 'no-cache' });
      bank = await r.json();
    } catch (e) {
      statusEl.textContent = "Couldn't load today's puzzle — check your connection.";
      return;
    }
    const byGrade = (bank && bank.byGrade) || {};
    let bucket = byGrade[grade];
    if (!bucket || bucket.length === 0) {
      const fallback = Object.keys(byGrade).find(k => (byGrade[k] || []).length > 0);
      bucket = byGrade[fallback] || [];
    }
    if (bucket.length === 0) {
      statusEl.textContent = 'No puzzles available — check back tomorrow.';
      return;
    }
    const idx = dayOfYear() % bucket.length;
    puzzle = bucket[idx];
    puzzle._grade = grade;
    initGame();
  }

  // ---------- build the board ----------
  function initGame() {
    // Build cards: each pair → 2 cards with the same pairId.
    cards = [];
    puzzle.pairs.forEach((pair, pid) => {
      cards.push({ id: cards.length, value: pair[0], pairId: pid, flipped: false, matched: false });
      cards.push({ id: cards.length, value: pair[1], pairId: pid, flipped: false, matched: false });
    });
    shuffleInPlace(cards);
    cards.forEach((c, i) => { c.id = i; });

    selected = [];
    pairsFound = 0;
    flips = 0;
    streak = 0;
    score = 0;
    inputLocked = false;
    startedAt = Date.now();

    scoreEl.textContent = '0';
    pairsFoundEl.textContent = '0';
    flipsEl.textContent = '0';
    streakEl.textContent = '0';
    timeEl.textContent = '0:00';
    statusEl.textContent = `${puzzle.theme} · ${puzzle.pairs.length} pairs`;
    headerStat.textContent = `${puzzle.theme} · ${gradeLabel(puzzle._grade)}`;
    statsEl.hidden = false;
    completeEl.hidden = true;

    renderGrid();
    startTimer();
    startOpponentsPoll();
  }

  function gradeLabel(g) {
    if (!g) return '';
    if (g === 'grade-k') return 'Kindergarten';
    if (g === 'algebra-1') return 'Algebra I';
    return g.replace('grade-', 'Grade ');
  }

  function renderGrid() {
    gridEl.innerHTML = '';
    const cols = colCountFor(cards.length);
    gridEl.style.setProperty('--memory-cols', String(cols));
    gridEl.dataset.cardCount = String(cards.length);

    cards.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'memory-card';
      btn.dataset.idx = String(i);
      btn.setAttribute('role', 'gridcell');
      btn.setAttribute('aria-label', c.matched || c.flipped ? `Card ${i+1}, ${c.value}` : `Card ${i+1}, face down`);
      btn.innerHTML = `
        <span class="memory-card-inner">
          <span class="memory-card-face memory-card-back" aria-hidden="${c.flipped || c.matched ? 'true' : 'false'}">
            <span class="memory-card-back-mark">★</span>
          </span>
          <span class="memory-card-face memory-card-front" aria-hidden="${c.flipped || c.matched ? 'false' : 'true'}">${esc(c.value)}</span>
        </span>`;
      if (c.matched) btn.classList.add('is-matched');
      if (c.flipped) btn.classList.add('is-flipped');
      btn.addEventListener('click', () => onCardTap(i));
      gridEl.appendChild(btn);
    });
    // Tune front-face font based on the longest value in the puzzle
    const longest = cards.reduce((m, c) => Math.max(m, String(c.value).length), 0);
    let fontScale = '1.6rem';
    if (longest >= 10) fontScale = '0.85rem';
    else if (longest >= 7) fontScale = '1rem';
    else if (longest >= 5) fontScale = '1.2rem';
    else if (longest >= 3) fontScale = '1.5rem';
    gridEl.style.setProperty('--memory-front-font', fontScale);
  }

  function colCountFor(n) {
    if (n <= 12) return 3;       // 4 rows × 3 cols
    if (n <= 16) return 4;       // 4 × 4
    if (n <= 20) return 4;       // 5 × 4
    return 4;                    // 6 × 4 (24 cards)
  }

  // ---------- core gameplay ----------
  function onCardTap(idx) {
    if (inputLocked) return;
    const c = cards[idx];
    if (!c || c.matched || c.flipped) return;

    // Can't tap a 3rd before the previous mismatch resolves
    if (selected.length >= 2) return;

    flipCard(idx, true);
    flips++;
    flipsEl.textContent = String(flips);
    try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {}
    try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic('light'); } catch (_) {}

    selected.push(idx);
    if (selected.length < 2) return;

    // Evaluate the pair
    const [aIdx, bIdx] = selected;
    const a = cards[aIdx], b = cards[bIdx];
    if (a.pairId === b.pairId) {
      // Match
      inputLocked = true;
      setTimeout(() => {
        a.matched = true;
        b.matched = true;
        markMatched(aIdx);
        markMatched(bIdx);
        pairsFound++;
        streak++;
        const streakBonus = (streak - 1) * 2;
        const pts = 10 + streakBonus;
        score += pts;
        scoreEl.textContent = String(score);
        pairsFoundEl.textContent = String(pairsFound);
        streakEl.textContent = String(streak);
        try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {}
        try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic('medium'); } catch (_) {}
        showFloatingPoints(aIdx, pts, streak >= 3);
        selected = [];
        inputLocked = false;
        queueSubmit();
        if (pairsFound >= puzzle.pairs.length) {
          setTimeout(finishGame, 600);
        }
      }, 280);
    } else {
      // Mismatch — flip both back after a beat
      inputLocked = true;
      streak = 0;
      streakEl.textContent = '0';
      try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {}
      try { window.STAARFx && window.STAARFx.haptic && window.STAARFx.haptic('light'); } catch (_) {}
      setTimeout(() => {
        flipCard(aIdx, false);
        flipCard(bIdx, false);
        selected = [];
        inputLocked = false;
      }, 850);
    }
  }

  function flipCard(idx, faceUp) {
    const c = cards[idx];
    c.flipped = !!faceUp;
    const el = gridEl.querySelector(`[data-idx="${idx}"]`);
    if (!el) return;
    el.classList.toggle('is-flipped', !!faceUp);
    // a11y update for screen readers
    const front = el.querySelector('.memory-card-front');
    const back = el.querySelector('.memory-card-back');
    if (front) front.setAttribute('aria-hidden', faceUp ? 'false' : 'true');
    if (back)  back.setAttribute('aria-hidden',  faceUp ? 'true' : 'false');
    el.setAttribute('aria-label', faceUp || c.matched ? `Card ${idx+1}, ${c.value}` : `Card ${idx+1}, face down`);
  }

  function markMatched(idx) {
    const el = gridEl.querySelector(`[data-idx="${idx}"]`);
    if (!el) return;
    el.classList.add('is-matched');
    el.classList.remove('is-flipped');
    // Brief celebration pulse handled in CSS via .is-matched-pulse
    el.classList.add('is-match-pulse');
    setTimeout(() => el.classList.remove('is-match-pulse'), 600);
  }

  function showFloatingPoints(idx, pts, hot) {
    const el = gridEl.querySelector(`[data-idx="${idx}"]`);
    if (!el) return;
    const f = document.createElement('div');
    f.className = 'game-float-pts' + (hot ? ' game-float-pts--prize' : '');
    f.textContent = '+' + pts;
    const rect = el.getBoundingClientRect();
    f.style.left = (rect.left + rect.width / 2) + 'px';
    f.style.top  = (rect.top  + rect.height / 2) + 'px';
    document.body.appendChild(f);
    setTimeout(() => { try { f.remove(); } catch (_) {} }, 900);
  }

  // ---------- timer ----------
  function startTimer() {
    if (timeTick) clearInterval(timeTick);
    timeTick = setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt) / 1000);
      timeEl.textContent = fmtTime(sec);
    }, 250);
  }
  function stopTimer() {
    if (timeTick) { clearInterval(timeTick); timeTick = null; }
  }

  // ---------- end of round ----------
  function finishGame() {
    stopTimer();
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    // Time bonus: max(0, 90 - elapsed) * 2  → 180 max if completed in <30s
    const timeBonus = Math.max(0, 90 - elapsed) * 2;
    // Efficiency bonus: fewer extra flips = better. min flips = 2*pairs.
    const minFlips = puzzle.pairs.length * 2;
    const extra = Math.max(0, flips - minFlips);
    const efficiencyBonus = Math.max(0, 50 - extra * 3);
    score += timeBonus + efficiencyBonus;
    scoreEl.textContent = String(score);

    completeTitle.textContent = elapsed < 30 ? 'Memory champ! ⚡' : (flips <= minFlips + 4 ? 'Eagle eye! 🦅' : 'Nice run!');
    completeScore.textContent = String(score);

    // §51 unified scoring: convert session score → wallet cents and
    // credit the same balanceCents that Practice tops up.
    try {
      if (window.GradeEarnReward) {
        const cents = window.GradeEarnReward.scoreToCents(score);
        if (cents > 0) {
          window.GradeEarnReward.award(cents, "memory-match", { grade: (typeof grade !== "undefined" ? grade : "") })
            .then(function (r) { if (r && r.awarded > 0) window.GradeEarnReward.toastAward(r.awarded); });
        }
      }
    } catch (_) {}
    completePairs.textContent = `${pairsFound}/${puzzle.pairs.length}`;
    completeTime.textContent  = fmtTime(elapsed);

    // Friend comparison block
    completeFriends.innerHTML = '';
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
    try { window.STAARFx && window.STAARFx.celebrate && window.STAARFx.celebrate(); } catch (_) {}
    doSubmit();
  }

  // ---------- server score submission (debounced) ----------
  let submitTimer = null;
  function queueSubmit() {
    clearTimeout(submitTimer);
    submitTimer = setTimeout(doSubmit, 500);
  }
  async function doSubmit() {
    if (!puzzle) return;
    const payload = {
      gameId: GAME_ID,
      date: todayDateKey(),
      score,
      // Reuse `wordsFound` slot for matched pair count so the existing
      // lambda schema can serve us without a schema change. Memory
      // doesn't have words; storing pairsFound here keeps the
      // dashboard rendering ("3/8 pairs") symmetric with word games.
      wordsFound: new Array(pairsFound).fill('PAIR'),
      totalWords: puzzle.pairs.length,
      durationSec: Math.floor((Date.now() - startedAt) / 1000),
      puzzleId: puzzle.id,
      prize: puzzle.theme,
      foundPrize: pairsFound >= puzzle.pairs.length
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
      if (!r || !Array.isArray(r.scores)) { renderOpponentsStrip([]); return; }
      const me = window.STAARAuth.currentUser();
      const myName = (me && me.username) || '';
      const friends = r.scores.filter(s => s.username !== myName);
      friends.sort((a, b) => (b.score || 0) - (a.score || 0));
      renderOpponentsStrip(friends.slice(0, 3));
    } catch (_) { renderOpponentsStrip([]); }
  }
  function renderOpponentsStrip(friends) {
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

  // ---------- INVITE FLOW ----------
  async function openInviteSheet() {
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

  async function checkIncomingInvites() {
    const inviteBanner = document.getElementById('gameInviteBanner');
    if (!inviteBanner) return;
    try {
      const r = await api('getGameInvites', { gameId: GAME_ID });
      const invites = (r && Array.isArray(r.invites)) ? r.invites : [];
      if (invites.length === 0) { inviteBanner.hidden = true; return; }
      const inv = invites.sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0))[0];
      inviteBanner.innerHTML = `
        <span class="game-invite-banner-icon" aria-hidden="true">🧠</span>
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

  // ---------- How to play card ----------
  const HOWTO_DISMISSED_KEY = 'mm_howto_dismissed';
  const howToCard = document.getElementById('howToPlay');
  const howToDismiss = document.getElementById('howToDismiss');
  if (howToCard) {
    // Hide if previously dismissed
    try {
      if (localStorage.getItem(HOWTO_DISMISSED_KEY) === '1') {
        howToCard.hidden = true;
      }
    } catch (_) {}
  }
  if (howToDismiss) {
    howToDismiss.addEventListener('click', () => {
      if (howToCard) howToCard.hidden = true;
      try { localStorage.setItem(HOWTO_DISMISSED_KEY, '1'); } catch (_) {}
    });
  }

  // ---------- wiring ----------
  if (reshuffleBtn) {
    reshuffleBtn.addEventListener('click', () => {
      if (!puzzle) return;
      if (pairsFound < puzzle.pairs.length && pairsFound > 0) {
        if (!confirm('Start over from the beginning? Progress will reset.')) return;
      }
      initGame();
    });
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
