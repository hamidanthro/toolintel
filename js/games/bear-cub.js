/**
 * GradeEarn — Bear & Cub (game #17, May 12).
 *
 * Cross-grade tutoring. Older kid (Bear) gets the same problem as a
 * younger kid (Cub) at the Cub's grade — and is shown the correct
 * answer. Bear types a 10-100 char hint that the server validates
 * won't give away the answer letter / number / phrase. Cub sees the
 * hint and answers.
 *
 * Asymmetric: same match, two roles, different views.
 * Pairing: Bear must be 2-4 grades above Cub. Two matchmaking queues
 * (Bear-by-target-grade, Cub-by-own-grade) — first matching pair wins.
 *
 * Payouts:
 *   per correct round → Cub +1¢, Bear +2¢
 *   completion bonus → Cub +1¢, Bear +2¢
 *   same-family bonus (parentEmail match) → both +2¢
 *
 * Uses the shared MatchEngine. Adds a sendHint helper.
 */
(function () {
  'use strict';

  const root = document.getElementById('bcRoot');
  const statusEl = document.getElementById('gameStatus');
  const rankEl = document.getElementById('gameYourScore');
  const toastEl = document.getElementById('gameToast');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function toast(m, ms) { if (!toastEl) return; toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.hidden = true, ms || 1600); }
  function gradeLabel(g) { if (g === 'grade-k') return 'Kindergarten'; if (g === 'algebra-1') return 'Algebra I'; return (g || 'Grade ?').replace('grade-', 'Grade '); }
  function avatarChar(name) { return (name || '?').trim().charAt(0).toUpperCase(); }
  function gradeOrd(g) { const m = {'grade-k':0,'grade-1':1,'grade-2':2,'grade-3':3,'grade-4':4,'grade-5':5,'grade-6':6,'grade-7':7,'grade-8':8,'algebra-1':9}; return m[g] != null ? m[g] : 3; }
  function gradeFromOrd(n) { return ['grade-k','grade-1','grade-2','grade-3','grade-4','grade-5','grade-6','grade-7','grade-8','algebra-1'][n]; }

  let engine = null;
  let rafTimer = null;
  let lastSnapshot = null;

  // howto dismiss
  const HOWTO_KEY = 'bc_howto_dismissed';
  const howTo = document.getElementById('howToPlay');
  const howToBtn = document.getElementById('howToDismiss');
  if (howTo) { try { if (localStorage.getItem(HOWTO_KEY) === '1') howTo.hidden = true; } catch (_) {} }
  if (howToBtn) howToBtn.addEventListener('click', () => { if (howTo) howTo.hidden = true; try { localStorage.setItem(HOWTO_KEY, '1'); } catch (_) {} });

  function meId() { try { const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser(); return u && u.username; } catch (_) { return null; } }

  function targetGradeOptions(myGrade) {
    // Bear can pick a Cub grade 2-4 below their own (matches lambda's BC_MIN/MAX_GRADE_GAP).
    const myOrd = gradeOrd(myGrade);
    const opts = [];
    for (let gap = 2; gap <= 4; gap++) {
      const ord = myOrd - gap;
      if (ord >= 0) opts.push(gradeFromOrd(ord));
    }
    return opts;
  }

  // ---------- views ----------
  function renderPickerView(myGrade) {
    const bearOptions = targetGradeOptions(myGrade);
    root.innerHTML = `
      <div class="sd-card">
        <h2 class="sd-h">🐻🐯 Bear &amp; Cub</h2>
        <p class="sd-sub">Pick a role. Bear teaches the younger Cub; Cub solves the problems with Bear's hint.</p>

        <div class="bc-role-grid">
          <div class="bc-role-card bc-role--bear">
            <div class="bc-role-emoji">🐻</div>
            <div class="bc-role-title">Be the BEAR</div>
            <p class="bc-role-desc">You're older — coach a younger kid through 5 problems at their grade.</p>
            <p class="bc-role-cents">Earn up to <strong>+14¢</strong> per match</p>
            ${bearOptions.length > 0 ? `
              <label class="sd-label" style="text-align:left">Pick a Cub grade to tutor</label>
              <select id="bcBearTarget" class="sd-select">
                ${bearOptions.map(g => `<option value="${g}">${gradeLabel(g)}</option>`).join('')}
              </select>
              <button type="button" id="bcBearStartBtn" class="sd-btn sd-btn--primary" style="margin-top:10px;width:100%">🐻 Find a Cub</button>
            ` : `<p class="sd-hint">You'd need to be 2+ grades above ${gradeLabel('grade-k')} to play as Bear. Try Cub instead.</p>`}
          </div>

          <div class="bc-role-card bc-role--cub">
            <div class="bc-role-emoji">🐯</div>
            <div class="bc-role-title">Be the CUB</div>
            <p class="bc-role-desc">You'll get problems at your grade with hints from an older Bear.</p>
            <p class="bc-role-cents">Earn up to <strong>+8¢</strong> per match</p>
            <p class="sd-hint" style="text-align:left">Your grade: <strong>${gradeLabel(myGrade)}</strong></p>
            <button type="button" id="bcCubStartBtn" class="sd-btn sd-btn--primary" style="margin-top:10px;width:100%">🐯 Find a Bear</button>
          </div>
        </div>

        <p class="sd-hint">🏠 If you and your Bear/Cub share a parent email, you both earn an extra <strong>+2¢</strong>.</p>
      </div>
    `;
    const bearBtn = document.getElementById('bcBearStartBtn');
    if (bearBtn) bearBtn.addEventListener('click', () => {
      const tg = document.getElementById('bcBearTarget').value;
      startMatch({ role: 'bear', targetGrade: tg, myGrade });
    });
    const cubBtn = document.getElementById('bcCubStartBtn');
    if (cubBtn) cubBtn.addEventListener('click', () => {
      startMatch({ role: 'cub', myGrade });
    });
  }

  function renderQueuedView(state, role, myGrade) {
    const inviteLink = state.inviteToken ? `${location.origin}/games/bear-cub.html?invite=${state.inviteToken}` : '';
    const players = state.players || [];
    const isBear = role === 'bear';
    root.innerHTML = `
      <div class="sd-card bc-queued">
        <div class="sd-spinner" aria-hidden="true"></div>
        <h2 class="sd-h">${isBear ? `Waiting for a Cub at ${gradeLabel(state.cubGrade)}…` : 'Waiting for a Bear to help you…'}</h2>
        <p class="sd-sub">${isBear ? `You'll coach a kid in ${gradeLabel(state.cubGrade)}. Up to <strong>+14¢</strong> if all 5 rounds correct.` : `A kid 2–4 grades older will coach you. Up to <strong>+8¢</strong> if all 5 rounds correct.`}</p>
        <div class="bc-queued-roster">
          ${players.map(p => `<div class="bc-queued-chip"><span class="br-av">${esc(avatarChar(p.displayName))}</span><span>${esc(p.displayName)}</span></div>`).join('')}
        </div>
        ${state.inviteToken ? `
          <div class="sd-invite-box">
            <label class="sd-label">Or share an invite link</label>
            <div class="sd-invite-row">
              <input type="text" id="bcInviteUrl" class="sd-invite-input" readonly value="${esc(inviteLink)}" />
              <button type="button" id="bcCopyBtn" class="sd-btn sd-btn--small">Copy</button>
            </div>
            <p class="sd-hint">Send to a ${isBear ? 'younger sibling or friend' : 'older sibling, cousin, or babysitter'}.</p>
          </div>` : ''}
        <div class="sd-actions">
          <button type="button" id="bcCancelBtn" class="sd-btn sd-btn--secondary">Cancel</button>
        </div>
      </div>
    `;
    const copyBtn = document.getElementById('bcCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(inviteLink); toast('Link copied!', 1400); }
      catch (_) { const inp = document.getElementById('bcInviteUrl'); if (inp) { inp.select(); document.execCommand('copy'); toast('Link copied!', 1400); } }
    });
    document.getElementById('bcCancelBtn').addEventListener('click', async () => {
      if (engine) await engine.leaveQueue();
      renderPickerView(myGrade);
    });
  }

  function renderLiveView(state) {
    const mine = meId();
    const isBear = state.role === 'bear';
    const isCub = state.role === 'cub';
    const problem = state.problem || { stem: '…', choices: [] };
    const bearPlayer = (state.players || []).find(p => p.userId === state.bearUserId) || { displayName: '?' };
    const cubPlayer = (state.players || []).find(p => p.userId === state.cubUserId) || { displayName: '?' };
    const myAnswered = state.myAnswerChoice >= 0;
    const resolved = state.phase === 'round-resolved';
    const totalRounds = state.totalRounds || 5;
    const round = state.currentRound || 1;
    const hint = state.currentHint;
    const hintSent = state.hintSent;

    root.innerHTML = `
      <div class="sd-card bc-live">
        <div class="bc-banner ${isBear ? 'bc-banner--bear' : 'bc-banner--cub'}">
          ${isBear ? '🐻 You\'re the BEAR' : '🐯 You\'re the CUB'} — Round ${round} of ${totalRounds}
        </div>

        <div class="bc-vs">
          <div class="bc-vs-side ${isBear ? 'is-me' : ''}">
            <div class="br-av">🐻</div>
            <div class="bc-vs-name">${esc(bearPlayer.displayName)}</div>
            <div class="bc-vs-grade">${gradeLabel(state.bearGrade)}</div>
          </div>
          <div class="bc-vs-mid">helping</div>
          <div class="bc-vs-side ${isCub ? 'is-me' : ''}">
            <div class="br-av">🐯</div>
            <div class="bc-vs-name">${esc(cubPlayer.displayName)}</div>
            <div class="bc-vs-grade">${gradeLabel(state.cubGrade)}</div>
          </div>
        </div>

        <div class="sd-timer-bar"><div class="sd-timer-fill" id="bcTimerFill"></div></div>

        <div class="sd-stem">${esc(problem.stem)}</div>

        ${isBear ? `
          <div class="bc-choices bc-choices--bear">
            ${problem.choices.map((c, i) => {
              const isCorrect = state.correctIndex === i;
              return `<div class="bc-choice-display ${isCorrect ? 'is-correct' : ''}">
                <span class="bc-choice-letter">${String.fromCharCode(65 + i)}</span>
                <span class="bc-choice-text">${esc(c)}</span>
                ${isCorrect ? '<span class="bc-choice-flag">CORRECT</span>' : ''}
              </div>`;
            }).join('')}
          </div>
          ${hintSent ? `
            <div class="bc-hint-display bc-hint-display--sent">
              <strong>Your hint:</strong> ${esc(hint)}
            </div>
            <p class="sd-hint">Waiting for ${esc(cubPlayer.displayName)} to answer…</p>
          ` : `
            <label class="sd-label">Type a hint (no letters, no numbers giving it away)</label>
            <textarea id="bcHintInput" class="bc-hint-input" maxlength="100" placeholder="e.g. 'Think of 7 × 7, then add 7 more'"></textarea>
            <div class="bc-hint-actions">
              <span id="bcHintCount" class="bc-hint-count">0 / 100</span>
              <button type="button" id="bcSendHintBtn" class="sd-btn sd-btn--primary">Send hint →</button>
            </div>
            <div id="bcHintError" class="bc-hint-error" hidden></div>
          `}
        ` : `
          <div class="sd-choices">
            ${problem.choices.map((c, i) => {
              const cls = ['sd-choice'];
              if (myAnswered && state.myAnswerChoice === i) cls.push('is-mine');
              if (resolved && state.lastRoundCorrectIndex === i) cls.push('is-correct');
              if (resolved && state.myAnswerChoice === i && state.lastRoundCorrectIndex !== i) cls.push('is-wrong');
              return `<button type="button" class="${cls.join(' ')}" data-i="${i}" ${myAnswered ? 'disabled' : ''}><span class="bc-choice-letter">${String.fromCharCode(65 + i)}</span>${esc(c)}</button>`;
            }).join('')}
          </div>
          <div class="bc-hint-display ${hint ? 'bc-hint-display--shown' : 'bc-hint-display--waiting'}">
            ${hint ? `🐻 <strong>${esc(bearPlayer.displayName)}'s hint:</strong> ${esc(hint)}` : `🐻 ${esc(bearPlayer.displayName)} is thinking…`}
          </div>
        `}

        ${resolved ? `
          <div class="bc-round-result ${state.lastRoundCorrectIndex === state.myAnswerChoice && isCub ? 'is-good' : isBear && state.players && state.players.find(p => p.userId === state.cubUserId && p.score) ? 'is-good' : 'is-bad'}">
            ${(() => {
              const cubAnsweredCorrect = state.lastRoundAnswers && state.lastRoundAnswers[state.cubUserId] && state.lastRoundAnswers[state.cubUserId].correct;
              if (cubAnsweredCorrect) return `🎉 ${esc(cubPlayer.displayName)} got it! +1¢ Cub, +2¢ Bear`;
              return `Try again next round. Correct answer: <strong>${esc(problem.choices[state.lastRoundCorrectIndex])}</strong>`;
            })()}
          </div>
        ` : ''}
      </div>
    `;

    // Wire bear hint input
    if (isBear && !hintSent) {
      const input = document.getElementById('bcHintInput');
      const count = document.getElementById('bcHintCount');
      const sendBtn = document.getElementById('bcSendHintBtn');
      const err = document.getElementById('bcHintError');
      if (input) input.addEventListener('input', () => {
        if (count) count.textContent = `${input.value.length} / 100`;
        if (err) err.hidden = true;
      });
      if (sendBtn) sendBtn.addEventListener('click', async () => {
        const text = (input && input.value) || '';
        sendBtn.disabled = true;
        sendBtn.textContent = 'Sending…';
        try {
          const r = await engine.sendHint(round, text);
          if (r && r.rejected) {
            if (err) { err.hidden = false; err.textContent = r.reason || 'Hint rejected — try again.'; }
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send hint →';
          } else if (r && r.ok) {
            // Engine will pick up sent hint on next poll; nothing more here
            toast('Hint sent!', 1200);
          } else {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Send hint →';
          }
        } catch (e) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send hint →';
        }
      });
    }

    // Wire cub choices
    if (isCub) {
      root.querySelectorAll('.sd-choice').forEach(btn => {
        btn.addEventListener('click', () => {
          if (myAnswered) return;
          const i = parseInt(btn.getAttribute('data-i'), 10);
          if (engine) engine.submitAnswer(i);
        });
      });
    }

    if (rankEl) rankEl.textContent = isBear ? '🐻' : '🐯';
  }

  function renderDoneView(state) {
    const isBear = state.role === 'bear';
    const isCub = state.role === 'cub';
    const bearPlayer = (state.players || []).find(p => p.userId === state.bearUserId) || { displayName: '?' };
    const cubPlayer = (state.players || []).find(p => p.userId === state.cubUserId) || { displayName: '?' };
    const cubScore = state.cubScore || (cubPlayer.score || 0);
    const total = state.totalRounds || 5;
    const family = !!state.sameFamily;
    const cubCents = state.cubCentsEarned || 0;
    const bearCents = state.bearCentsEarned || 0;
    const myCents = isBear ? bearCents : cubCents;

    root.innerHTML = `
      <div class="sd-card bc-done">
        ${family ? '<div class="bc-family-badge">🏠 Family match! Bonus applied</div>' : ''}
        <h2 class="sd-h">${isBear ? `You taught ${esc(cubPlayer.displayName)}!` : `You learned with ${esc(bearPlayer.displayName)}!`}</h2>
        <p class="sd-sub">Cub got <strong>${cubScore} of ${total}</strong> right. <strong>+${myCents}¢</strong> added to your wallet.</p>

        <div class="bc-final-grid">
          <div class="bc-final-card ${isBear ? 'is-me' : ''}">
            <div class="bc-final-emoji">🐻</div>
            <div class="bc-final-name">${esc(bearPlayer.displayName)}</div>
            <div class="bc-final-role">${gradeLabel(state.bearGrade)} · Bear</div>
            <div class="bc-final-cents">+${bearCents}¢</div>
          </div>
          <div class="bc-final-divider">—</div>
          <div class="bc-final-card ${isCub ? 'is-me' : ''}">
            <div class="bc-final-emoji">🐯</div>
            <div class="bc-final-name">${esc(cubPlayer.displayName)}</div>
            <div class="bc-final-role">${gradeLabel(state.cubGrade)} · Cub</div>
            <div class="bc-final-cents">+${cubCents}¢</div>
          </div>
        </div>

        <div class="sd-actions">
          <button type="button" id="bcPlayAgainBtn" class="sd-btn sd-btn--primary">Play again</button>
          <button type="button" id="bcShareBtn" class="sd-btn sd-btn--secondary">📣 Share</button>
          <a href="../games.html" class="sd-btn sd-btn--secondary">Back to games</a>
        </div>
      </div>
    `;
    document.getElementById('bcPlayAgainBtn').addEventListener('click', () => renderPickerView(meGrade()));
    const shareBtn = document.getElementById('bcShareBtn');
    if (shareBtn) shareBtn.addEventListener('click', async () => {
      const shareUrl = `${location.origin}/games/bear-cub.html`;
      const text = isBear
        ? `I just tutored a younger kid through 5 math problems on GradeEarn 🐻 You try: ${shareUrl}`
        : `I just got tutored by an older kid on GradeEarn — 5 problems with hints 🐯 Try: ${shareUrl}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Bear & Cub', text, url: shareUrl });
        else { await navigator.clipboard.writeText(text); toast('Copied — paste to a friend!', 1800); }
      } catch (_) {}
    });
    if (rankEl) rankEl.textContent = isBear ? '🐻' : '🐯';
  }

  function meGrade() { try { const u = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser(); return (u && u.grade) || 'grade-3'; } catch (_) { return 'grade-3'; } }

  function tickTimer(state) {
    if (rafTimer) cancelAnimationFrame(rafTimer);
    const fill = document.getElementById('bcTimerFill');
    if (!fill || !state || state.phase !== 'live' || !state.roundDeadline) return;
    const total = state.roundDeadline - state.roundStartedAt || 30000;
    const step = () => {
      const now = engine ? engine.serverNow() : Date.now();
      const remaining = Math.max(0, state.roundDeadline - now);
      const pct = (remaining / total) * 100;
      fill.style.width = pct + '%';
      if (remaining > 0 && document.getElementById('bcTimerFill')) rafTimer = requestAnimationFrame(step);
    };
    step();
  }

  function onState(state) {
    if (!state) return;
    lastSnapshot = state;
    const role = state.role;
    if (state.phase === 'queued') {
      statusEl.textContent = role === 'bear' ? `Bear · waiting for a Cub at ${gradeLabel(state.cubGrade)}` : `Cub · waiting for a Bear`;
      renderQueuedView(state, role, meGrade());
      return;
    }
    if (state.phase === 'live' || state.phase === 'round-resolved') {
      statusEl.textContent = `${role === 'bear' ? '🐻 Bear' : '🐯 Cub'} · Round ${state.currentRound}/${state.totalRounds}`;
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

  function startMatch(opts) {
    if (engine) engine.destroy();
    const initPayload = {
      mode: 'bear-cub',
      gradeBand: opts.myGrade,
      role: opts.role,
      targetGrade: opts.targetGrade
    };
    engine = new MatchEngine({
      mode: 'bear-cub',
      gradeBand: opts.myGrade,
      inviteToken: opts.inviteToken || null,
      onStateChange: onState,
      onError: (e) => { const msg = (e && e.message) || 'Match error'; toast(msg, 2200); }
    });
    // Engine.start sends matchmake — patch start() to include role/targetGrade
    engine.extraMatchmakePayload = { role: opts.role, targetGrade: opts.targetGrade };
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
      // Joiner doesn't pick role — the existing match dictates it.
      statusEl.textContent = 'Joining match…';
      if (engine) engine.destroy();
      engine = new MatchEngine({
        mode: 'bear-cub', gradeBand: grade, inviteToken: invite,
        onStateChange: onState,
        onError: (e) => toast((e && e.message) || 'Match error', 2200)
      });
      engine.start();
    } else {
      renderPickerView(grade);
    }
  }

  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) boot();
  else { document.addEventListener('gradeearn:auth-changed', boot, { once: true }); (function(){let n=0;const p=()=>{if(window.STAARAuth&&window.STAARAuth.currentUser&&window.STAARAuth.currentUser()){boot();return;}if(++n<25)setTimeout(p,200);else boot();};p();})(); }
})();
