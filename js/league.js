/**
 * GradeEarn — friend league page (Tier 6 AF, full build).
 *
 * Three tabs:
 *   Standings — ranked board (kid + accepted friends) by lifetimeCorrect,
 *               with this-week column and level badge
 *   Add friend — search by username, send request, share your code
 *   Requests — incoming (Accept/Decline) + outgoing (Cancel)
 *
 * Age-gated to grade-3+ on the client; K-2 see a locked state.
 *
 * Lambda actions used:
 *   friendLeague  → ranked board + weeklyCorrect + grade + avatar
 *   friendList    → accepted / incoming / outgoing
 *   friendRequest → send a request by username
 *   friendRespond → accept or decline an incoming request
 *   friendUnfriend → remove a friend
 */
(function () {
  'use strict';

  const root = document.getElementById('league-root');
  const tabsEl = document.querySelector('.league-tabs');
  if (!root) return;

  const TABS = ['standings', 'add', 'requests'];
  let activeTab = 'standings';
  let cache = { league: null, friendList: null };

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function gradeIsG3Plus(grade) {
    if (!grade) return false;
    const m = String(grade).match(/grade-(\d+)/);
    if (!m) return false;
    return parseInt(m[1], 10) >= 3;
  }
  function gradeLabel(slug) {
    if (!slug) return '';
    if (slug === 'grade-k') return 'K';
    const m = String(slug).match(/grade-(\d+)/);
    if (m) return 'G' + m[1];
    if (slug === 'algebra-1') return 'Alg 1';
    return slug;
  }
  function rankBadge(rank) {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `${rank}`;
  }
  function avatar(row) {
    if (row.avatarEmoji) return row.avatarEmoji;
    return (row.displayName || '?').charAt(0).toUpperCase();
  }
  function token() {
    try { return window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token(); } catch (_) { return null; }
  }
  async function api(action, payload) {
    return await window.STAARAuth.api(action, Object.assign({ token: token() }, payload || {}));
  }
  function notify(msg, kind) {
    try {
      if (window.STAARFx && window.STAARFx.toast) {
        window.STAARFx.toast(msg, { kind: kind || 'info' });
      }
    } catch (_) {}
  }

  // ---------- tabs ----------
  function setTab(name) {
    if (TABS.indexOf(name) < 0) return;
    activeTab = name;
    if (tabsEl) {
      tabsEl.querySelectorAll('.league-tab').forEach(b => {
        b.classList.toggle('league-tab--active', b.getAttribute('data-tab') === name);
      });
    }
    render();
  }
  if (tabsEl) {
    tabsEl.addEventListener('click', (e) => {
      const b = e.target.closest('.league-tab');
      if (!b) return;
      setTab(b.getAttribute('data-tab'));
    });
  }
  function updateTabCounts() {
    const lg = cache.league, fl = cache.friendList;
    const sc = document.getElementById('tab-count-standings');
    if (sc) sc.textContent = lg && Array.isArray(lg.league) ? lg.league.length : '';
    const rc = document.getElementById('tab-count-requests');
    const incoming = fl && Array.isArray(fl.incoming) ? fl.incoming.length : 0;
    if (rc) {
      rc.textContent = incoming > 0 ? String(incoming) : '';
      rc.style.display = incoming > 0 ? '' : 'none';
    }
  }

  // ---------- standings tab ----------
  function renderStandings() {
    const r = cache.league;
    if (!r || !Array.isArray(r.league)) {
      root.innerHTML = `<div class="card" style="max-width:680px;padding:24px;color:var(--muted);">Loading…</div>`;
      return;
    }
    const rows = r.league;
    if (rows.length === 0 || (rows.length === 1 && rows[0].isSelf)) {
      root.innerHTML = `
        <div class="league-empty">
          <div class="league-empty-emoji" aria-hidden="true">👋</div>
          <h2 class="league-empty-title">No friends yet</h2>
          <p class="league-empty-sub">Add a friend to start a league. They'll see your rank and you'll see theirs — friendly competition that keeps everyone practicing.</p>
          <button type="button" class="btn btn-primary" data-go-add>Add your first friend</button>
        </div>`;
      const btn = root.querySelector('[data-go-add]');
      if (btn) btn.addEventListener('click', () => setTab('add'));
      return;
    }
    const tableHtml = rows.map(row => {
      const youCls = row.isSelf ? ' is-self' : '';
      const medalCls = row.rank <= 3 ? ' is-medal' : '';
      const grade = row.grade ? `<span class="league-grade-chip">${esc(gradeLabel(row.grade))}</span>` : '';
      return `
        <div class="league-row${youCls}" data-username="${esc(row.username)}">
          <div class="league-rank${medalCls}">${rankBadge(row.rank)}</div>
          <div class="league-avatar">${esc(avatar(row))}</div>
          <div class="league-identity">
            <div class="league-name-row">
              <span class="league-name">${esc(row.displayName)}</span>
              ${row.isSelf ? '<span class="league-you-chip">you</span>' : ''}
              ${grade}
            </div>
            <div class="league-meta">
              <span class="league-meta-week">+${row.weeklyCorrect} this week</span>
              ${row.streak > 1 ? `<span class="league-meta-streak">🔥 ${row.streak}d</span>` : ''}
            </div>
          </div>
          <div class="league-score">
            <div class="league-score-num">${(row.lifetimeCorrect || 0).toLocaleString()}</div>
            <div class="league-score-label">correct</div>
          </div>
          <div class="league-level">L${row.level}</div>
        </div>`;
    }).join('');
    root.innerHTML = `
      <div class="league-board">${tableHtml}</div>
      <p class="league-foot">Ranked by lifetime correct answers. Keep practicing to climb!</p>`;
  }

  // ---------- add-friend tab ----------
  function renderAdd() {
    const me = window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser();
    const myUsername = (me && me.username) || '';
    root.innerHTML = `
      <div class="league-add">
        <form class="league-add-form" id="league-add-form" autocomplete="off">
          <label class="league-add-label" for="league-add-input">Add a friend by username</label>
          <div class="league-add-row">
            <input type="text" id="league-add-input" class="league-add-input" placeholder="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="40" required />
            <button type="submit" class="btn btn-primary league-add-btn">Send</button>
          </div>
          <p class="league-add-hint">Lowercase letters, numbers, underscores, dots, and dashes. Case-insensitive.</p>
          <p class="league-add-status" id="league-add-status"></p>
        </form>

        <div class="league-share">
          <div class="league-share-label">Your username — share it so friends can add you</div>
          <div class="league-share-row">
            <code class="league-share-code">${esc(myUsername || '— sign in —')}</code>
            <button type="button" class="btn btn-secondary league-share-copy" data-copy="${esc(myUsername)}" ${myUsername ? '' : 'disabled'}>Copy</button>
          </div>
        </div>
      </div>`;

    const form = document.getElementById('league-add-form');
    const input = document.getElementById('league-add-input');
    const status = document.getElementById('league-add-status');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const target = (input.value || '').trim().toLowerCase();
        if (!target) return;
        if (target === myUsername.toLowerCase()) {
          status.textContent = "That's your own username!";
          status.className = 'league-add-status league-add-status--err';
          return;
        }
        status.textContent = 'Sending…';
        status.className = 'league-add-status';
        try {
          const r = await api('friendRequest', { target });
          if (r && r.status === 'accepted') {
            status.textContent = "You're now friends!";
            status.className = 'league-add-status league-add-status--ok';
            input.value = '';
            // Refresh data
            await Promise.all([loadLeague(), loadFriendList()]);
            updateTabCounts();
            notify("Friend added!", 'win');
          } else if (r && r.status === 'pending_out') {
            status.textContent = `Request sent to ${target}. They'll see it next time they sign in.`;
            status.className = 'league-add-status league-add-status--ok';
            input.value = '';
            await loadFriendList();
            updateTabCounts();
          } else if (r && r.error) {
            status.textContent = r.error;
            status.className = 'league-add-status league-add-status--err';
          } else {
            status.textContent = 'Done.';
            status.className = 'league-add-status league-add-status--ok';
          }
        } catch (err) {
          status.textContent = (err && err.message) || 'User not found, or network error.';
          status.className = 'league-add-status league-add-status--err';
        }
      });
    }

    const copyBtn = root.querySelector('.league-share-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        const val = copyBtn.getAttribute('data-copy') || '';
        if (!val) return;
        try {
          await navigator.clipboard.writeText(val);
          copyBtn.textContent = 'Copied ✓';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1800);
        } catch (_) {
          // Fallback: select the code element so the kid can long-press → copy
          const code = root.querySelector('.league-share-code');
          if (code && window.getSelection) {
            const range = document.createRange();
            range.selectNodeContents(code);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      });
    }
  }

  // ---------- requests tab ----------
  function renderRequests() {
    const fl = cache.friendList;
    if (!fl) {
      root.innerHTML = `<div class="card" style="max-width:680px;padding:24px;color:var(--muted);">Loading…</div>`;
      return;
    }
    const incoming = Array.isArray(fl.incoming) ? fl.incoming : [];
    const outgoing = Array.isArray(fl.outgoing) ? fl.outgoing : [];
    const accepted = Array.isArray(fl.friends) ? fl.friends : [];

    const incomingHtml = incoming.length === 0
      ? `<p class="league-section-empty">No incoming requests.</p>`
      : incoming.map(row => `
          <div class="league-req-row" data-username="${esc(row.peer)}">
            <div class="league-avatar">${esc((row.displayName || row.peer).charAt(0).toUpperCase())}</div>
            <div class="league-identity">
              <div class="league-name">${esc(row.displayName || row.peer)}</div>
              <div class="league-meta-thin">@${esc(row.peer)}</div>
            </div>
            <div class="league-req-actions">
              <button type="button" class="btn btn-primary league-req-accept" data-target="${esc(row.peer)}">Accept</button>
              <button type="button" class="btn btn-secondary league-req-decline" data-target="${esc(row.peer)}">Decline</button>
            </div>
          </div>`).join('');

    const outgoingHtml = outgoing.length === 0
      ? `<p class="league-section-empty">No outgoing requests waiting.</p>`
      : outgoing.map(row => `
          <div class="league-req-row league-req-row--out" data-username="${esc(row.peer)}">
            <div class="league-avatar">${esc((row.displayName || row.peer).charAt(0).toUpperCase())}</div>
            <div class="league-identity">
              <div class="league-name">${esc(row.displayName || row.peer)}</div>
              <div class="league-meta-thin">Waiting for them to accept</div>
            </div>
            <button type="button" class="btn btn-secondary league-req-cancel" data-target="${esc(row.peer)}">Cancel</button>
          </div>`).join('');

    const acceptedHtml = accepted.length === 0
      ? `<p class="league-section-empty">No friends yet.</p>`
      : accepted.map(row => `
          <div class="league-friend-row" data-username="${esc(row.peer)}">
            <div class="league-avatar">${esc((row.displayName || row.peer).charAt(0).toUpperCase())}</div>
            <div class="league-identity">
              <div class="league-name">${esc(row.displayName || row.peer)} ${row.online ? '<span class="league-online-dot" title="Online now"></span>' : ''}</div>
              <div class="league-meta-thin">@${esc(row.peer)}</div>
            </div>
            <button type="button" class="btn btn-link league-friend-remove" data-target="${esc(row.peer)}" aria-label="Remove friend">Unfriend</button>
          </div>`).join('');

    root.innerHTML = `
      <div class="league-requests">
        <section class="league-section">
          <h3 class="league-section-title">Incoming <span class="league-section-count">${incoming.length}</span></h3>
          ${incomingHtml}
        </section>
        <section class="league-section">
          <h3 class="league-section-title">Outgoing <span class="league-section-count">${outgoing.length}</span></h3>
          ${outgoingHtml}
        </section>
        <section class="league-section">
          <h3 class="league-section-title">Your friends <span class="league-section-count">${accepted.length}</span></h3>
          ${acceptedHtml}
        </section>
      </div>`;

    // Wire actions.
    root.querySelectorAll('.league-req-accept').forEach(b => {
      b.addEventListener('click', async () => {
        const target = b.getAttribute('data-target');
        b.disabled = true;
        try {
          await api('friendRespond', { target, decision: 'accept' });
          await Promise.all([loadLeague(), loadFriendList()]);
          updateTabCounts();
          render();
          notify(`You and ${target} are now friends!`, 'win');
        } catch (e) {
          b.disabled = false;
          notify('Could not accept — try again.', 'err');
        }
      });
    });
    root.querySelectorAll('.league-req-decline, .league-req-cancel, .league-friend-remove').forEach(b => {
      b.addEventListener('click', async () => {
        const target = b.getAttribute('data-target');
        const isUnfriend = b.classList.contains('league-friend-remove');
        if (isUnfriend && !confirm(`Remove ${target} from your friends?`)) return;
        b.disabled = true;
        try {
          if (isUnfriend) {
            await api('friendUnfriend', { target });
          } else if (b.classList.contains('league-req-decline')) {
            await api('friendRespond', { target, decision: 'decline' });
          } else {
            // Cancel outgoing — same backend path as unfriend
            await api('friendUnfriend', { target });
          }
          await Promise.all([loadLeague(), loadFriendList()]);
          updateTabCounts();
          render();
        } catch (e) {
          b.disabled = false;
          notify('Could not complete — try again.', 'err');
        }
      });
    });
  }

  // ---------- locked state for K-2 ----------
  function renderLocked() {
    root.innerHTML = `
      <div class="league-empty">
        <div class="league-empty-emoji" aria-hidden="true">🔒</div>
        <h2 class="league-empty-title">Friend leagues unlock in Grade 3</h2>
        <p class="league-empty-sub">Younger kids practice on their own pace. Once your kid is in Grade 3 or above, leagues, friend requests, and weekly rankings unlock automatically.</p>
        <a class="btn btn-primary" href="index.html">Back to dashboard</a>
      </div>`;
    if (tabsEl) tabsEl.style.display = 'none';
  }

  // ---------- error / unauth states ----------
  function renderError(msg) {
    root.innerHTML = `
      <div class="card" style="max-width:680px;padding:24px;">
        <p>${esc(msg)}</p>
        <p><a class="btn btn-primary" href="index.html">Back to home</a></p>
      </div>`;
  }

  // ---------- top-level render dispatcher ----------
  function render() {
    if (activeTab === 'standings') return renderStandings();
    if (activeTab === 'add')       return renderAdd();
    if (activeTab === 'requests')  return renderRequests();
  }

  // ---------- data loaders ----------
  async function loadLeague() {
    try {
      const r = await api('friendLeague', {});
      cache.league = r;
    } catch (e) {
      cache.league = { league: [], count: 0 };
    }
  }
  async function loadFriendList() {
    try {
      const r = await api('friendList', {});
      cache.friendList = r;
    } catch (e) {
      cache.friendList = { friends: [], incoming: [], outgoing: [] };
    }
  }

  // ---------- boot ----------
  async function boot() {
    if (!window.STAARAuth || !window.STAARAuth.currentUser) {
      renderError('Please sign in first.');
      return;
    }
    const me = window.STAARAuth.currentUser();
    if (!me) {
      renderError('Please sign in first.');
      return;
    }
    if (!gradeIsG3Plus(me.grade)) {
      renderLocked();
      return;
    }
    // Load both data sets in parallel, then render.
    await Promise.all([loadLeague(), loadFriendList()]);
    updateTabCounts();
    render();
    // Re-pull friend data when the kid returns to the tab (e.g. after
    // signing in on another device or accepting a request elsewhere).
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') {
        await loadFriendList();
        if (activeTab === 'requests' || activeTab === 'standings') {
          await loadLeague();
        }
        updateTabCounts();
        render();
      }
    });
  }

  if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
    boot();
  } else {
    document.addEventListener('gradeearn:auth-changed', boot, { once: true });
    setTimeout(() => {
      if (root.innerHTML.indexOf('ge-skel') >= 0) boot();
    }, 600);
  }
})();
