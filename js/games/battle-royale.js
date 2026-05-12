/**
 * GradeEarn — Math Battle Royale (game #16, May 12).
 *
 * 2-8 player elimination. Same gradeBand auto-matches; 8 fills the
 * lobby immediately, otherwise auto-starts at 30s with ≥4 players
 * or 60s with ≥2. Each round: wrong / no-answer = eliminated. All
 * correct = slowest half eliminated. Round timer tightens 8s→6s→4s.
 *
 * Eliminated kids get a spectator view (board frozen, watch the
 * remaining players finish, see the final podium).
 *
 * Layered on the shared MatchEngine. Reuses staar-matches +
 * staar-match-history. No new lambda actions; extends matchmake /
 * matchState / matchAnswer / matchFinish with mode='battle-royale'.
 *
 * Payouts (server-authoritative, $100 lifetime cap respected):
 *   Rank 1: 25¢   Rank 2: 5¢   Rank 3+: 1¢
 */
(function () {
  'use strict';

  const root = document.getElementById('brRoot');
  const statusEl = document.getElementById('gameStatus');
  const rankEl = document.getElementById('gameYourScore');
  const toastEl = document.getElementById('gameToast');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1400); }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return (g || 'Grade ?').replace('grade-', 'Grade '); }
  function avatarChar(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
  function fmtMs(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `0:${String(s).padStart(2, '0')}`; }

  let engine = null;
  let rafTimer = null;

  // howto dismiss
  const HOWTO_KEY = 'br_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  function meId() {
    try { const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser(); return u && u.username; }
    catch (_) { return null; }
  }
  function isAlive(player) { return player && player.alive !== false; }

  // ---------- views ----------

  function renderPickerView(grade) {
    const grades = ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5','grade-6','grade-7','grade-8','algebra-1'];
    root.innerHTML = `
      <div class="sd-card">
        <h2 class="sd-h">👑 Math Battle Royale</h2>
        <p class="sd-sub">2–8 players. Slowest correct or any wrong answer gets eliminated. Last kid standing wins <strong>25¢</strong>.</p>
        <label class="sd-label">Grade band</label>
        <select id="brGradeSelect" class="sd-select">
          ${grades.map(g => `<option value="${g}" ${g === grade ? 'selected' : ''}>${gradeLabel(g)}</option>`).join('')}
        </select>
        <div class="sd-actions">
          <button type="button" id="brMatchBtn" class="sd-btn sd-btn--primary">⚔️ Find a match</button>
          <button type="button" id="brInviteBtn" class="sd-btn sd-btn--secondary">🔗 Get invite link</button>
        </div>
        <p class="sd-hint">Lobby auto-starts when 8 kids join — or after 30s once 4 are in.</p>
      </div>
    `;
    document.getElementById('brMatchBtn').addEventListener('click', () => startMatch(document.getElementById('brGradeSelect').value, null));
    document.getElementById('brInviteBtn').addEventListener('click', () => startMatch(document.getElementById('brGradeSelect').value, null, true));
  }

  function renderLobbyView(state, opts) {
    const players = state.players || [];
    const need = state.maxPlayers || 8;
    const inviteLink = state.inviteToken ? `${location.origin}/games/battle-royale.html?invite=${state.inviteToken}` : '';
    const queuedSince = state.queuedSince || (engine && engine.serverNow ? engine.serverNow() : Date.now());
    const elapsedMs = (engine ? engine.serverNow() : Date.now()) - queuedSince;
    let countdownText = '';
    let countdownSec = 0;
    if (players.length >= 4) countdownSec = Math.max(0, Math.ceil((30000 - elapsedMs) / 1000));
    else if (players.length >= 2) countdownSec = Math.max(0, Math.ceil((60000 - elapsedMs) / 1000));
    else countdownSec = Math.max(0, Math.ceil((90000 - elapsedMs) / 1000));

    if (players.length >= 4) countdownText = `Auto-start in ${countdownSec}s`;
    else if (players.length >= 2) countdownText = `Auto-start in ${countdownSec}s (or wait for more)`;
    else countdownText = `Need 2+ players · cancels in ${countdownSec}s if no one joins`;

    root.innerHTML = `
      <div class="sd-card br-lobby">
        <div class="sd-spinner" aria-hidden="true"></div>
        <h2 class="sd-h">${players.length} of ${need} joined</h2>
        <p class="sd-sub">${gradeLabel(state.gradeBand)} · ${esc(countdownText)}</p>
        <div class="br-lobby-roster">
          ${Array.from({ length: need }, (_, i) => {
            const p = players[i];
            if (!p) return `<div class="br-slot br-slot--empty">empty</div>`;
            return `<div class="br-slot br-slot--filled"><span class="br-av">${esc(avatarChar(p.displayName))}</span><span class="br-slot-name">${esc(p.displayName)}</span></div>`;
          }).join('')}
        </div>
        ${state.inviteToken ? `
          <div class="sd-invite-box">
            <label class="sd-label">Invite link</label>
            <div class="sd-invite-row">
              <input type="text" id="brInviteUrl" class="sd-invite-input" readonly value="${esc(inviteLink)}" />
              <button type="button" id="brCopyBtn" class="sd-btn sd-btn--small">Copy</button>
            </div>
            <p class="sd-hint">Text it to friends to fill the lobby faster.</p>
          </div>
        ` : ''}
        <div class="sd-actions">
          <button type="button" id="brCancelBtn" class="sd-btn sd-btn--secondary">Leave lobby</button>
        </div>
      </div>
    `;
    const copyBtn = document.getElementById('brCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(inviteLink); toast('Link copied!', 1400); }
      catch (_) { const inp = document.getElementById('brInviteUrl'); if (inp) { inp.select(); document.execCommand('copy'); toast('Link copied!', 1400); } }
    });
    document.getElementById('brCancelBtn').addEventListener('click', async () => {
      if (engine) await engine.leaveQueue();
      renderPickerView(state.gradeBand);
    });
  }

  function renderRoster(state, mineId) {
    const players = state.players || [];
    return players.map(p => {
      const dead = !isAlive(p);
      const me = p.userId === mineId;
      const cls = ['br-roster-cell'];
      if (dead) cls.push('is-dead');
      if (me) cls.push('is-me');
      const answered = state.answeredUserIds && state.answeredUserIds.indexOf(p.userId) >= 0;
      const pip = dead ? `#${p.eliminationRound || '?'}` : (answered ? '⚡' : '·');
      return `<div class="${cls.join(' ')}" title="${esc(p.displayName)}">
        <div class="br-av">${esc(avatarChar(p.displayName))}</div>
        <div class="br-roster-name">${esc(p.displayName)}</div>
        <div class="br-roster-pip">${pip}</div>
      </div>`;
    }).join('');
  }

  function renderLiveView(state) {
    const mine = meId();
    const myPlayer = (state.players || []).find(p => p.userId === mine);
    const iAmAlive = isAlive(myPlayer);
    const aliveCount = (state.players || []).filter(isAlive).length;
    const total = state.totalRounds || 3;
    const round = state.currentRound || 1;
    const myAnswered = state.myAnswerChoice >= 0;
    const resolved = state.phase === 'round-resolved';
    const problem = state.problem || { stem: '…', choices: [] };
    const eliminatedThisRound = state.eliminatedThisRound || [];

    const tier = round >= 3 ? 3 : round >= 2 ? 2 : 1;
    root.innerHTML = `
      <div class="sd-card br-live" data-tier="${tier}">
        <div class="br-header">
          <div class="br-round-tag">ROUND ${round} / ~${total}</div>
          <div class="br-alive-count"><strong>${aliveCount}</strong> alive of ${(state.players || []).length}</div>
        </div>

        <div class="sd-timer-bar"><div class="sd-timer-fill" id="brTimerFill"></div></div>

        <div class="sd-stem">${esc(problem.stem)}</div>

        <div class="sd-choices">
          ${problem.choices.map((c, i) => {
            const cls = ['sd-choice'];
            if (!iAmAlive) cls.push('is-spectator');
            if (myAnswered && state.myAnswerChoice === i) cls.push('is-mine');
            if (resolved && state.lastRoundCorrectIndex === i) cls.push('is-correct');
            if (resolved && state.myAnswerChoice === i && state.lastRoundCorrectIndex !== i) cls.push('is-wrong');
            return `<button type="button" class="${cls.join(' ')}" data-i="${i}" ${(!iAmAlive || myAnswered) ? 'disabled' : ''}>${esc(c)}</button>`;
          }).join('')}
        </div>

        ${!iAmAlive ? `<div class="br-spectator-band">👀 You were eliminated in round ${myPlayer && myPlayer.eliminationRound || '?'} (rank #${myPlayer && myPlayer.finalRank || '?'}). Watching to the end…</div>` : ''}

        ${resolved && eliminatedThisRound.length > 0 ? `<div class="br-eliminated-banner">Eliminated this round: ${eliminatedThisRound.map(id => esc(((state.players || []).find(p => p.userId === id) || {}).displayName || id)).join(', ')}</div>` : ''}

        <div class="br-roster">
          ${renderRoster(state, mine)}
        </div>
      </div>
    `;

    root.querySelectorAll('.sd-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!iAmAlive) return;
        const i = parseInt(btn.getAttribute('data-i'), 10);
        if (engine) engine.submitAnswer(i);
      });
    });

    // Top-right rank display
    if (rankEl) {
      if (!iAmAlive && myPlayer && myPlayer.eliminationRound) {
        rankEl.textContent = `#?`;
      } else {
        rankEl.textContent = iAmAlive ? '🛡️' : '✗';
      }
    }
  }

  function renderDoneView(state) {
    const mine = meId();
    const players = (state.players || []).slice().sort((a, b) => {
      const ar = a.finalRank || 999;
      const br = b.finalRank || 999;
      return ar - br;
    });
    const myPlayer = players.find(p => p.userId === mine) || {};
    const myRank = myPlayer.finalRank || (players.findIndex(p => p.userId === mine) + 1);
    const cents = myRank === 1 ? 25 : myRank === 2 ? 5 : 1;
    const title = myRank === 1 ? '👑 Champion!' : myRank === 2 ? '🥈 Runner-up!' : myRank === 3 ? '🥉 Top 3' : `#${myRank} of ${players.length}`;

    const podium = players.slice(0, Math.min(3, players.length));
    const rest = players.slice(3);

    root.innerHTML = `
      <div class="sd-card br-done">
        <h2 class="sd-h">${title}</h2>
        <p class="sd-sub">+${cents}¢ added to your wallet</p>

        <div class="br-podium">
          ${podium.map((p, i) => `
            <div class="br-podium-slot br-podium-${i + 1}">
              <div class="br-podium-rank">#${i + 1}</div>
              <div class="br-av br-av--lg">${esc(avatarChar(p.displayName))}</div>
              <div class="br-podium-name">${esc(p.displayName)}</div>
              <div class="br-podium-cents">+${i === 0 ? 25 : i === 1 ? 5 : 1}¢</div>
            </div>
          `).join('')}
        </div>

        ${rest.length > 0 ? `<div class="br-results-list">
          ${rest.map((p) => `<div class="br-results-row">
            <span class="br-results-rank">#${p.finalRank || '?'}</span>
            <span class="br-results-name">${esc(p.displayName)}</span>
            <span class="br-results-cents">+1¢</span>
          </div>`).join('')}
        </div>` : ''}

        <div class="sd-actions">
          <button type="button" id="brPlayAgainBtn" class="sd-btn sd-btn--primary">Play again</button>
          <button type="button" id="brShareBtn" class="sd-btn sd-btn--secondary">📣 Share</button>
          <a href="../games.html" class="sd-btn sd-btn--secondary">Back to games</a>
        </div>
      </div>
    `;
    document.getElementById('brPlayAgainBtn').addEventListener('click', () => startMatch(state.gradeBand, null));
    const shareBtn = document.getElementById('brShareBtn');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const shareUrl = `${location.origin}/games/battle-royale.html`;
      const text = myRank === 1
        ? `I just won Math Battle Royale on GradeEarn! 👑 Beat me: ${shareUrl}`
        : `I just played Math Battle Royale on GradeEarn — finished #${myRank}. You try: ${shareUrl}`;
      try {
        if (navigator.share) {
          await navigator.share({ title: 'Math Battle Royale', text, url: shareUrl });
        } else {
          await navigator.clipboard.writeText(text);
          toast('Copied — paste to a friend!', 1800);
        }
      } catch (_) { /* user cancelled share */ }
    });
    if (rankEl) rankEl.textContent = `#${myRank}`;
  }

  function tickTimer(state) {
    if (rafTimer) cancelAnimationFrame(rafTimer);
    const fill = document.getElementById('brTimerFill');
    if (!fill || !state || state.phase !== 'live' || !state.roundDeadline) return;
    const total = (state.roundDeadline - state.roundStartedAt) || 8000;
    const step = () => {
      const now = engine ? engine.serverNow() : Date.now();
      const remaining = Math.max(0, state.roundDeadline - now);
      const pct = (remaining / total) * 100;
      fill.style.width = pct + '%';
      if (remaining > 0 && document.getElementById('brTimerFill')) {
        rafTimer = requestAnimationFrame(step);
      }
    };
    step();
  }

  function onState(state) {
    if (!state) return;
    if (state.phase === 'queued') {
      statusEl.textContent = `Lobby · ${gradeLabel(state.gradeBand)}`;
      renderLobbyView(state);
      if (rankEl) rankEl.textContent = '—';
      return;
    }
    if (state.phase === 'live' || state.phase === 'round-resolved') {
      statusEl.textContent = `Battle Royale · Round ${state.currentRound}`;
      renderLiveView(state);
      tickTimer(state);
      return;
    }
    if (state.phase === 'done') {
      statusEl.textContent = `Match complete`;
      renderDoneView(state);
      if (rafTimer) cancelAnimationFrame(rafTimer);
      return;
    }
  }

  function startMatch(gradeBand, inviteToken) {
    if (engine) engine.destroy();
    engine = new MatchEngine({
      mode: 'battle-royale',
      gradeBand,
      inviteToken: inviteToken || null,
      onStateChange: onState,
      onError: (e) => { const msg = (e && e.message) || 'Match error'; toast(msg, 2200); }
    });
    engine.pollIntervalMs = 600; // BR rounds are short (4s late game) — poll faster
    engine.start();
  }

  function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser || !window.STAARAuth.currentUser()) {
      statusEl.innerHTML = 'Please <a href="../index.html" style="color:#fde68a;font-weight:700;text-decoration:underline">sign in</a> to play.';
      return;
    }
    const params = new URLSearchParams(location.search);
    const invite = params.get('invite');
    const me = window.STAARAuth.currentUser();
    const grade = (me && me.grade) || 'grade-3';
    if (invite) {
      statusEl.textContent = 'Joining match…';
      startMatch(grade, invite);
    } else {
      statusEl.textContent = `Battle Royale · ${gradeLabel(grade)}`;
      renderPickerView(grade);
    }
  }

  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
