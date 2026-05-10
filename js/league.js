/**
 * GradeEarn — friend league renderer (Tier 6 AF, May 10)
 *
 * Calls friendLeague lambda action and renders a ranked board.
 * Age-gated: K-2 kids are redirected to the home page; the league
 * is a G3+ feature per CLAUDE.md §40.
 */
(function () {
  'use strict';

  const root = document.getElementById('league-root');
  if (!root) return;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function gradeIsG3Plus(grade) {
    if (!grade) return false;
    const m = String(grade).match(/grade-(\d+)/);
    if (!m) return false;
    return parseInt(m[1], 10) >= 3;
  }

  function rankBadge(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  }

  function renderEmpty() {
    root.innerHTML = `
      <article class="card" style="max-width:680px;padding:32px 28px;text-align:center;">
        <p style="color:var(--muted);margin:0 0 18px;">No friends yet. Add some friends to start the league!</p>
        <a class="btn btn-primary" href="index.html">Back to dashboard</a>
      </article>`;
  }

  function renderLocked() {
    root.innerHTML = `
      <article class="card" style="max-width:680px;padding:32px 28px;text-align:center;">
        <p style="color:var(--muted);margin:0 0 12px;">Friend leagues unlock in Grade 3 and up.</p>
        <p style="color:var(--muted);font-size:0.92rem;margin:0 0 18px;">Keep practicing — the leaderboard will be waiting!</p>
        <a class="btn btn-primary" href="index.html">Back to dashboard</a>
      </article>`;
  }

  function renderError(msg) {
    root.innerHTML = `
      <article class="card" style="max-width:680px;padding:32px 28px;">
        <p>Couldn't load the league: ${escapeHtml(msg)}</p>
        <a class="btn btn-primary" href="index.html">Back</a>
      </article>`;
  }

  function renderLeague(rows) {
    if (!rows || rows.length === 0) return renderEmpty();
    if (rows.length === 1 && rows[0].isSelf) {
      // Only the kid themselves — no peers ranked.
      return renderEmpty();
    }
    const html = rows.map(r => {
      const youCls = r.isSelf ? ' is-self' : '';
      const rankCls = r.rank <= 3 ? ' is-medal' : '';
      return `
        <div class="league-row${youCls}">
          <div class="league-rank${rankCls}">${rankBadge(r.rank)}</div>
          <div class="league-name">
            ${escapeHtml(r.displayName)}${r.isSelf ? ' <span class="league-you-chip">you</span>' : ''}
          </div>
          <div class="league-xp">
            <span class="league-xp-num">${r.xp.toLocaleString()}</span>
            <span class="league-xp-label">xp</span>
          </div>
          <div class="league-level">L${r.level}</div>
        </div>`;
    }).join('');
    root.innerHTML = `
      <div class="league-board">${html}</div>
      <p style="color:var(--muted);font-size:0.85rem;margin:18px 0 0;text-align:center;">
        Ranked by lifetime XP. Keep practicing to climb!
      </p>`;
  }

  async function load() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser) {
      renderError('Not signed in.');
      return;
    }
    const u = window.STAARAuth.currentUser();
    if (!u) {
      renderError('Not signed in.');
      return;
    }
    if (!gradeIsG3Plus(u.grade)) {
      renderLocked();
      return;
    }
    try {
      const token = window.STAARAuth.token && window.STAARAuth.token();
      const r = await window.STAARAuth.api('friendLeague', { token });
      if (r && Array.isArray(r.league)) renderLeague(r.league);
      else renderError('Empty response.');
    } catch (e) {
      renderError(e.message || 'Network error.');
    }
  }

  // Wait for auth to initialize before loading.
  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
    load();
  } else {
    document.addEventListener('gradeearn:auth-changed', load, { once: true });
    // Fallback timer in case auth never fires (already signed in but no event).
    setTimeout(() => {
      if (root.innerHTML.indexOf('ge-skel') >= 0) load();
    }, 600);
  }
})();
