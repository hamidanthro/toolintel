/**
 * GradeEarn — Texas Map Quest (game #13, May 11).
 *
 * Mechanic: 10 stops across a simplified SVG of Texas. Each stop
 * asks the kid to TAP a specific place (city, river, landmark, state
 * symbol). Distance scoring: bullseye (within 6 viewport units) = 30
 * pts, close (≤12 units) = 15, near (≤20 units) = 5, off = 0.
 *
 * Texas-only product per CLAUDE.md memory — this is the geography
 * game. Landmarks scale by grade: K-2 focus on the four biggest
 * cities; 3-5 add rivers and state symbols; 6+ include border
 * cities, regions, and lesser landmarks.
 */
(function () {
  'use strict';
  const GAME_ID = 'texas-map';

  const scoreEl = document.getElementById('gameYourScore');
  const opponentsEl = document.getElementById('gameOpponents');
  const statusEl = document.getElementById('gameStatus');
  const preStartEl = document.getElementById('txPreStart');
  const startBtn = document.getElementById('txStartBtn');
  const statsEl = document.getElementById('txStats');
  const correctEl = document.getElementById('txCorrect');
  const stopEl = document.getElementById('txStop');
  const timerEl = document.getElementById('txTimer');
  const streakEl = document.getElementById('txStreak');
  const streakStatEl = document.getElementById('txStreakStat');
  const boardEl = document.getElementById('txBoard');
  const questionEl = document.getElementById('txQuestion');
  const mapEl = document.getElementById('txMap');
  const userMarkEl = document.getElementById('txUserMark');
  const targetMarkEl = document.getElementById('txTargetMark');
  const completeEl = document.getElementById('gameComplete');
  const completeTitle = document.getElementById('gameCompleteTitle');
  const completeScore = document.getElementById('gameCompleteScore');
  const completeCorrect = document.getElementById('gameCompleteCorrect');
  const completeStreak = document.getElementById('gameCompleteStreak');
  const completeFriends = document.getElementById('gameCompleteFriends');
  const playAgainBtn = document.getElementById('txPlayAgain');
  const toastEl = document.getElementById('gameToast');

  const TOTAL_STOPS = 10;
  let grade = 'grade-k';
  let stops = [];
  let stopIdx = 0;
  let score = 0, bullseyes = 0, streak = 0, bestStreak = 0;
  let startedAt = null;
  let inputLocked = false;
  let opponentsPollTimer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function token() { try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; } }
  async function api(action, payload) { if (!window.STAARAuth || !window.STAARAuth.api) return null; return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {})); }
  function todayDateKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1300); }
  function shuffleInPlace(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return g.replace('grade-', 'Grade '); }

  // ---------- Texas landmarks ----------
  // Coordinates are in the SVG viewBox 0..100. Hand-tuned to the
  // simplified outline; close enough for educational use.
  const LANDMARKS = {
    cities: [
      { name: 'Austin (state capital)', x: 55, y: 65 },
      { name: 'Houston', x: 70, y: 75 },
      { name: 'San Antonio', x: 50, y: 73 },
      { name: 'Dallas', x: 62, y: 38 },
      { name: 'Fort Worth', x: 57, y: 38 },
      { name: 'El Paso', x: 10, y: 50 },
      { name: 'Lubbock', x: 33, y: 32 },
      { name: 'Amarillo', x: 33, y: 14 },
      { name: 'Corpus Christi', x: 55, y: 86 },
      { name: 'Galveston', x: 72, y: 78 },
      { name: 'Brownsville', x: 50, y: 92 },
      { name: 'Waco', x: 56, y: 50 }
    ],
    landmarks: [
      { name: 'Big Bend National Park', x: 22, y: 70 },
      { name: 'Padre Island National Seashore', x: 58, y: 88 },
      { name: 'Palo Duro Canyon', x: 34, y: 20 },
      { name: 'Enchanted Rock', x: 48, y: 67 },
      { name: 'Texas State Capitol (Austin)', x: 55, y: 65 },
      { name: 'The Alamo (San Antonio)', x: 50, y: 73 }
    ],
    rivers: [
      { name: 'Rio Grande (Big Bend stretch)', x: 22, y: 72 },
      { name: 'Trinity River (Dallas area)', x: 62, y: 42 },
      { name: 'Colorado River (Austin area)', x: 53, y: 66 },
      { name: 'Brazos River (Waco area)', x: 56, y: 53 },
      { name: 'Sabine River (East Texas border)', x: 80, y: 55 }
    ],
    regions: [
      { name: 'The Panhandle', x: 32, y: 16 },
      { name: 'The Hill Country', x: 48, y: 65 },
      { name: 'The Piney Woods (East Texas)', x: 76, y: 58 },
      { name: 'The Gulf Coast', x: 65, y: 82 },
      { name: 'The Rio Grande Valley', x: 50, y: 90 }
    ]
  };

  function pickStops() {
    const all = [];
    if (grade === 'grade-k' || grade === 'grade-1') {
      all.push(...LANDMARKS.cities.slice(0, 5));
      all.push(...LANDMARKS.landmarks.slice(0, 2));
    } else if (grade === 'grade-2' || grade === 'grade-3') {
      all.push(...LANDMARKS.cities.slice(0, 8));
      all.push(...LANDMARKS.landmarks);
    } else if (grade === 'grade-4' || grade === 'grade-5') {
      all.push(...LANDMARKS.cities);
      all.push(...LANDMARKS.landmarks);
      all.push(...LANDMARKS.rivers.slice(0, 3));
      all.push(...LANDMARKS.regions.slice(0, 3));
    } else {
      all.push(...LANDMARKS.cities);
      all.push(...LANDMARKS.landmarks);
      all.push(...LANDMARKS.rivers);
      all.push(...LANDMARKS.regions);
    }
    shuffleInPlace(all);
    return all.slice(0, TOTAL_STOPS);
  }

  function svgCoordsFromEvent(e) {
    const rect = mapEl.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX);
    const cy = (e.touches ? e.touches[0].clientY : e.clientY);
    // map client coords to viewBox 0..100
    const x = ((cx - rect.left) / rect.width) * 100;
    const y = ((cy - rect.top) / rect.height) * 100;
    return { x, y };
  }

  function showStop() {
    if (stopIdx >= stops.length) { finishGame(); return; }
    const s = stops[stopIdx];
    questionEl.textContent = `Tap ${s.name}`;
    stopEl.textContent = `${stopIdx + 1}/${TOTAL_STOPS}`;
    userMarkEl.hidden = true;
    targetMarkEl.hidden = true;
    inputLocked = false;
  }

  function onMapTap(e) {
    if (inputLocked) return;
    e.preventDefault();
    const { x, y } = svgCoordsFromEvent(e);
    const target = stops[stopIdx];
    const dx = x - target.x, dy = y - target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    inputLocked = true;
    userMarkEl.setAttribute('cx', String(x));
    userMarkEl.setAttribute('cy', String(y));
    userMarkEl.hidden = false;
    targetMarkEl.setAttribute('cx', String(target.x));
    targetMarkEl.setAttribute('cy', String(target.y));
    targetMarkEl.hidden = false;

    let pts = 0, label = '';
    if (dist <= 6) { pts = 30 + Math.min(streak, 5) * 3; bullseyes++; streak++; bestStreak = Math.max(bestStreak, streak); label = `🎯 BULLSEYE! +${pts}`; try { window.STAARFx && window.STAARFx.playCorrect && window.STAARFx.playCorrect(); } catch (_) {} }
    else if (dist <= 12) { pts = 15; streak = 0; label = `Close! +${pts}`; try { window.STAARFx && window.STAARFx.playClick && window.STAARFx.playClick(); } catch (_) {} }
    else if (dist <= 20) { pts = 5; streak = 0; label = `Near. +${pts}`; }
    else { pts = 0; streak = 0; label = `Way off. The pin is here.`; try { window.STAARFx && window.STAARFx.playWrong && window.STAARFx.playWrong(); } catch (_) {} }

    score += pts;
    scoreEl.textContent = String(score);
    correctEl.textContent = String(bullseyes);
    streakEl.textContent = String(streak);
    if (streak >= 3) streakStatEl.classList.add('is-hot'); else streakStatEl.classList.remove('is-hot');
    toast(label, 1100);
    queueSubmit();
    setTimeout(() => { stopIdx++; if (stopIdx >= stops.length) finishGame(); else showStop(); }, 1300);
  }

  function startGame() {
    score = 0; bullseyes = 0; streak = 0; bestStreak = 0; stopIdx = 0;
    stops = pickStops();
    startedAt = Date.now();
    scoreEl.textContent = '0'; correctEl.textContent = '0'; stopEl.textContent = '1/' + TOTAL_STOPS;
    streakEl.textContent = '0'; streakStatEl.classList.remove('is-hot');
    timerEl.textContent = '—';
    preStartEl.hidden = true; statsEl.hidden = false; boardEl.hidden = false; completeEl.hidden = true;
    statusEl.textContent = `Texas Map Quest · ${gradeLabel(grade)}`;
    showStop();
    startOpponentsPoll();
  }

  function finishGame() {
    if (opponentsPollTimer) clearInterval(opponentsPollTimer);
    inputLocked = true;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    timerEl.textContent = `${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
    completeTitle.textContent = bullseyes >= 8 ? 'Texan native! 🌵' : bullseyes >= 5 ? 'Solid map sense!' : bullseyes >= 2 ? 'Getting there!' : 'Study the map a little!';
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
  async function doSubmit() { try { await api('submitGameScore', { gameId: GAME_ID, date: todayDateKey(), score, wordsFound: new Array(bullseyes).fill('PIN'), totalWords: stops.length, durationSec: Math.floor((Date.now() - (startedAt || Date.now())) / 1000), puzzleId: 'tx-' + grade, prize: 'Texas Map Quest', foundPrize: bullseyes >= 5 }); } catch (_) {} }

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
      banner.innerHTML = `<span class="game-invite-banner-icon">🌵</span><span class="game-invite-banner-text"><strong>${esc(inv.fromDisplay || inv.from)}</strong> invited you to race</span><button type="button" class="game-invite-banner-dismiss" aria-label="Dismiss">✕</button>`;
      banner.hidden = false;
      banner.querySelector('.game-invite-banner-dismiss').addEventListener('click', async () => { banner.hidden = true; try { await api('clearGameInvite', { from: inv.from, gameId: GAME_ID }); } catch (_) {} });
    } catch (_) {}
  }

  const HOWTO_KEY = 'tx_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  if (startBtn) startBtn.addEventListener('click', startGame);
  if (mapEl) {
    mapEl.addEventListener('click', onMapTap);
    mapEl.addEventListener('touchstart', onMapTap, { passive: false });
  }
  if (playAgainBtn) playAgainBtn.addEventListener('click', () => { completeEl.hidden = true; startGame(); });

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) { statusEl.textContent = 'Please sign in to play.'; preStartEl.hidden = true; return; }
    const me = window.STAARAuth.currentUser();
    grade = (me && me.grade) || 'grade-k';
    statusEl.textContent = `Texas Map Quest · ${gradeLabel(grade)}`;
    refreshOpponents();
    checkIncomingInvites();
  }
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); setTimeout(boot, 600); }
})();
