/**
 * GradeEarn — Math Showdown (game #15, May 12).
 *
 * 1v1 head-to-head math race. 10 rounds, 10s per round, fastest
 * correct answer wins the round. Match winner = highest score after
 * 10 rounds. Earns 5¢/2¢/1¢ for win/tie/loss via server-authoritative
 * crediting in the matchFinish handler.
 *
 * Layered on the shared MatchEngine (js/games/match-engine.js).
 * The engine handles matchmaking, polling, answer race-condition
 * resolution, and clock-drift sync.
 *
 * Invite deeplink: /games/showdown.html?invite=<8-char-token> joins
 * a specific match the creator started.
 */
(function () {
  'use strict';

  const root = document.getElementById('showdownRoot');
  const statusEl = document.getElementById('gameStatus');
  const scoreEl = document.getElementById('gameYourScore');
  const toastEl = document.getElementById('gameToast');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1400); }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return (g || 'Grade ?').replace('grade-', 'Grade '); }
  function avatarChar(name) { return (name || '?').trim().charAt(0).toUpperCase(); }

  let engine = null;
  let rafTimer = null;

  // ---------- howto dismiss ----------
  const HOWTO_KEY = 'sd_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  // ---------- views ----------
  function renderPickerView(grade) {
    const grades = ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5','grade-6','grade-7','grade-8','algebra-1'];
    root.innerHTML = `
      <div class="sd-card">
        <h2 class="sd-h">Math Showdown · 1v1</h2>
        <p class="sd-sub">Race a friend in real time. 10 rounds. Fastest correct answer wins each round.</p>
        <label class="sd-label">Grade band (auto-detected)</label>
        <select id="sdGradeSelect" class="sd-select">
          ${grades.map(g => `<option value="${g}" ${g === grade ? 'selected' : ''}>${gradeLabel(g)}</option>`).join('')}
        </select>
        <div class="sd-actions">
          <button type="button" id="sdMatchAnyoneBtn" class="sd-btn sd-btn--primary">⚔️ Match anyone</button>
          <button type="button" id="sdInviteBtn" class="sd-btn sd-btn--secondary">🔗 Get invite link</button>
        </div>
        <p class="sd-hint">"Match anyone" finds another kid at the same grade now. "Invite link" lets you text it to a friend.</p>
      </div>
    `;
    document.getElementById('sdMatchAnyoneBtn').addEventListener('click', () => {
      const g = document.getElementById('sdGradeSelect').value;
      startMatch(g, null);
    });
    document.getElementById('sdInviteBtn').addEventListener('click', () => {
      const g = document.getElementById('sdGradeSelect').value;
      startMatch(g, null, true);
    });
  }

  function renderQueuedView(state, opts) {
    const inviteLink = state.inviteToken ? `${location.origin}/games/showdown.html?invite=${state.inviteToken}` : '';
    const showInvite = opts && opts.showInvite;
    const me = state.me ? state.me.displayName : 'You';
    root.innerHTML = `
      <div class="sd-card">
        <div class="sd-spinner" aria-hidden="true"></div>
        <h2 class="sd-h">${showInvite ? 'Waiting for your friend…' : 'Looking for an opponent…'}</h2>
        <p class="sd-sub">${gradeLabel(state.gradeBand)} · You are <strong>${esc(me)}</strong></p>
        ${state.inviteToken ? `
          <div class="sd-invite-box">
            <label class="sd-label">Invite link</label>
            <div class="sd-invite-row">
              <input type="text" id="sdInviteUrl" class="sd-invite-input" readonly value="${esc(inviteLink)}" />
              <button type="button" id="sdCopyBtn" class="sd-btn sd-btn--small">Copy</button>
            </div>
            <p class="sd-hint">Send this to a friend. They tap it, they join your match.</p>
          </div>
        ` : ''}
        <div class="sd-actions">
          <button type="button" id="sdCancelBtn" class="sd-btn sd-btn--secondary">Cancel</button>
        </div>
      </div>
    `;
    const copyBtn = document.getElementById('sdCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inviteLink);
        toast('Link copied!', 1400);
      } catch (_) {
        const inp = document.getElementById('sdInviteUrl');
        if (inp) { inp.select(); document.execCommand('copy'); toast('Link copied!', 1400); }
      }
    });
    document.getElementById('sdCancelBtn').addEventListener('click', () => {
      if (engine) engine.destroy();
      renderPickerView(state.gradeBand);
    });
  }

  function renderLiveView(state) {
    const me = state.me || { displayName: 'You', score: 0, userId: '' };
    const opp = state.opponent || { displayName: 'Opponent', score: 0, userId: '' };
    const problem = state.problem || { stem: '…', choices: [] };
    const total = state.totalRounds || 10;
    const round = state.currentRound || 1;
    const myAnswered = state.myAnswerChoice >= 0;
    const oppAnswered = state.answeredUserIds && state.answeredUserIds.indexOf(opp.userId) >= 0;
    const resolved = state.phase === 'round-resolved';

    root.innerHTML = `
      <div class="sd-card sd-card--live">
        <div class="sd-vs">
          <div class="sd-player sd-player--me ${resolved && state.roundWinnerUserId === me.userId ? 'is-winner' : ''}">
            <div class="sd-av">${esc(avatarChar(me.displayName))}</div>
            <div class="sd-pname">${esc(me.displayName)}</div>
            <div class="sd-pscore">${me.score || 0}</div>
            ${myAnswered ? '<div class="sd-pflag">✓</div>' : ''}
          </div>
          <div class="sd-vs-mid">
            <div class="sd-round">Round ${round} / ${total}</div>
            <div class="sd-vs-divider">VS</div>
          </div>
          <div class="sd-player sd-player--opp ${resolved && state.roundWinnerUserId === opp.userId ? 'is-winner' : ''}">
            <div class="sd-av">${esc(avatarChar(opp.displayName))}</div>
            <div class="sd-pname">${esc(opp.displayName)}</div>
            <div class="sd-pscore">${opp.score || 0}</div>
            ${oppAnswered ? '<div class="sd-pflag">⚡</div>' : ''}
          </div>
        </div>

        <div class="sd-timer-bar"><div class="sd-timer-fill" id="sdTimerFill"></div></div>

        <div class="sd-stem" id="sdStem">${esc(problem.stem)}</div>

        <div class="sd-choices">
          ${problem.choices.map((c, i) => {
            const cls = ['sd-choice'];
            if (myAnswered && state.myAnswerChoice === i) cls.push('is-mine');
            if (resolved && state.lastRoundCorrectIndex === i) cls.push('is-correct');
            if (resolved && state.myAnswerChoice === i && state.lastRoundCorrectIndex !== i) cls.push('is-wrong');
            return `<button type="button" class="${cls.join(' ')}" data-i="${i}" ${myAnswered ? 'disabled' : ''}>${esc(c)}</button>`;
          }).join('')}
        </div>

        ${resolved ? `<div class="sd-round-result">${
          state.roundWinnerUserId === me.userId ? '🏆 You won this round!' :
          state.roundWinnerUserId === opp.userId ? `${esc(opp.displayName)} won this round` :
          'No one got it — next round!'
        }</div>` : ''}
      </div>
    `;

    root.querySelectorAll('.sd-choice').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.getAttribute('data-i'), 10);
        if (engine) engine.submitAnswer(i);
      });
    });
  }

  function renderDoneView(state) {
    const me = state.me || { displayName: 'You', score: 0 };
    const opp = state.opponent || { displayName: 'Opponent', score: 0 };
    const result = state.finalResult;
    const cents = result === 'win' ? 5 : result === 'tie' ? 2 : 1;
    const title = result === 'win' ? 'You won! 🏆' : result === 'loss' ? 'Good game!' : 'It\'s a tie!';
    const subtitle = result === 'win' ? `+${cents}¢ to your wallet` : `+${cents}¢ for showing up`;

    root.innerHTML = `
      <div class="sd-card sd-card--done">
        <h2 class="sd-h">${title}</h2>
        <p class="sd-sub">${subtitle}</p>
        <div class="sd-final-vs">
          <div class="sd-final-side ${result === 'win' ? 'is-winner' : ''}">
            <div class="sd-av sd-av--lg">${esc(avatarChar(me.displayName))}</div>
            <div class="sd-final-name">${esc(me.displayName)}</div>
            <div class="sd-final-score">${me.score || 0}</div>
          </div>
          <div class="sd-final-divider">—</div>
          <div class="sd-final-side ${result === 'loss' ? 'is-winner' : ''}">
            <div class="sd-av sd-av--lg">${esc(avatarChar(opp.displayName))}</div>
            <div class="sd-final-name">${esc(opp.displayName)}</div>
            <div class="sd-final-score">${opp.score || 0}</div>
          </div>
        </div>
        <div class="sd-actions">
          <button type="button" id="sdRematchBtn" class="sd-btn sd-btn--primary">Rematch</button>
          <a href="../games.html" class="sd-btn sd-btn--secondary">Back to games</a>
        </div>
      </div>
    `;
    document.getElementById('sdRematchBtn').addEventListener('click', () => {
      // For v1 rematch = new auto-match in same grade (preserved scoreline
      // across rematches is a Phase 2 nicety).
      startMatch(state.gradeBand, null);
    });
    // Update top-right wins badge based on whether THIS match was a win
    if (scoreEl) scoreEl.textContent = result === 'win' ? '+1' : (result === 'tie' ? '=' : '0');
  }

  function tickTimer(state) {
    if (rafTimer) cancelAnimationFrame(rafTimer);
    const fill = document.getElementById('sdTimerFill');
    if (!fill || !state || state.phase !== 'live' || !state.roundDeadline) return;
    const ROUND_MS = 10000;
    const step = () => {
      const now = engine ? engine.serverNow() : Date.now();
      const remaining = Math.max(0, state.roundDeadline - now);
      const pct = (remaining / ROUND_MS) * 100;
      fill.style.width = pct + '%';
      if (remaining > 0 && document.getElementById('sdTimerFill')) {
        rafTimer = requestAnimationFrame(step);
      }
    };
    step();
  }

  function onState(state) {
    if (!state) return;
    // Status text in header
    if (state.phase === 'queued') {
      statusEl.textContent = `Waiting · ${gradeLabel(state.gradeBand)}`;
      renderQueuedView(state, { showInvite: !!state.inviteToken });
    } else if (state.phase === 'live' || state.phase === 'round-resolved') {
      statusEl.textContent = `Math Showdown · Round ${state.currentRound}/${state.totalRounds}`;
      renderLiveView(state);
      tickTimer(state);
      if (scoreEl && state.me) scoreEl.textContent = String(state.me.score || 0);
    } else if (state.phase === 'done') {
      statusEl.textContent = `Match complete · ${state.finalResult}`;
      renderDoneView(state);
      if (rafTimer) cancelAnimationFrame(rafTimer);
    }
  }

  function startMatch(gradeBand, inviteToken, opts) {
    if (engine) engine.destroy();
    engine = new MatchEngine({
      mode: 'showdown',
      gradeBand,
      inviteToken: inviteToken || null,
      onStateChange: onState,
      onError: (e) => {
        const msg = (e && e.message) || 'Match error';
        toast(msg, 2200);
      }
    });
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
      statusEl.textContent = `Joining match…`;
      startMatch(grade, invite);
    } else {
      statusEl.textContent = `Math Showdown · ${gradeLabel(grade)}`;
      renderPickerView(grade);
    }
  }

  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
