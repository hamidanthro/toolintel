/**
 * STAAR Prep — Friends + safe chat
 *
 * Safe-mode only: users exchange canned phrases / emoji reactions, never
 * free text. The chat code is validated server-side too.
 *
 * Public API:
 *   STAARFriends.openPanel()                 // open the slide-in panel
 *   STAARFriends.openConversation(peer)
 *   STAARFriends.requestFriend(peer, displayName)
 *
 * Listens for window event `staar:open-friends` (fired from the header bell).
 */
(function () {
  if (window.STAARFriends && window.STAARFriends.__loaded) return;

  const POLL_MS = 25_000;
  const HISTORY_POLL_MS = 6_000;

  let panelEl = null;
  let activePeer = null;
  let activePeerName = null;
  let lastInboxTs = 0;
  let pollTimer = null;
  let convPollTimer = null;
  let convCache = {};   // peer -> { messages: [], phrases, reactions, reactionBase }
  let listCache = { friends: [], incoming: [], outgoing: [] };

  function api(action, body) {
    return window.STAARAuth.api(action, body);
  }
  function token() {
    return window.STAARAuth.token();
  }
  function me() {
    return window.STAARAuth.currentUser();
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }
  function avatarLetter(name) {
    const s = String(name || '').trim();
    return (s[0] || '?').toUpperCase();
  }
  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function ensurePanel() {
    if (panelEl) return panelEl;
    panelEl = document.createElement('div');
    panelEl.className = 'sf-panel';
    panelEl.hidden = true;
    panelEl.innerHTML = `
      <div class="sf-backdrop" data-act="close"></div>
      <aside class="sf-card" role="dialog" aria-label="Friends and chat">
        <header class="sf-head">
          <button type="button" class="sf-back" data-act="back" hidden aria-label="Back">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h3 class="sf-title">Friends</h3>
          <button type="button" class="sf-close" data-act="close" aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </header>
        <div class="sf-body" id="sf-body"></div>
      </aside>`;
    document.body.appendChild(panelEl);

    panelEl.addEventListener('click', e => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      const a = t.getAttribute('data-act');
      if (a === 'close') closePanel();
      if (a === 'back') showList();
    });
    return panelEl;
  }

  function openPanel() {
    if (!me()) {
      window.STAARAuth.showLogin && window.STAARAuth.showLogin();
      return;
    }
    ensurePanel();
    panelEl.hidden = false;
    document.body.classList.add('sf-open');
    showList();
  }
  function closePanel() {
    if (!panelEl) return;
    panelEl.hidden = true;
    document.body.classList.remove('sf-open');
    stopConvPoll();
    activePeer = null;
    activePeerName = null;
  }

  async function showList() {
    activePeer = null;
    activePeerName = null;
    stopConvPoll();
    const body = panelEl.querySelector('#sf-body');
    panelEl.querySelector('.sf-back').hidden = true;
    panelEl.querySelector('.sf-title').textContent = 'Friends';
    body.innerHTML = '<div class="sf-empty">Loading…</div>';
    try {
      const r = await api('friendList', { token: token() });
      listCache = r;
      renderList();
    } catch (_) {
      body.innerHTML = '<div class="sf-empty">Could not load friends.</div>';
    }
  }

  function renderList() {
    const body = panelEl.querySelector('#sf-body');
    const { friends, incoming, outgoing } = listCache;

    let html = '';
    if (incoming && incoming.length) {
      html += `<div class="sf-section-title">Friend requests</div>`;
      html += `<ul class="sf-list">${incoming.map(r => `
        <li class="sf-row sf-row-req">
          <span class="sf-avatar" style="background:#1e3a8a">${escapeHtml(avatarLetter(r.displayName))}</span>
          <span class="sf-name">${escapeHtml(r.displayName)}</span>
          <span class="sf-actions">
            <button type="button" class="sf-btn sf-btn-accept" data-respond="${escapeHtml(r.peer)}" data-decision="accept">Accept</button>
            <button type="button" class="sf-btn sf-btn-decline" data-respond="${escapeHtml(r.peer)}" data-decision="decline">Decline</button>
          </span>
        </li>`).join('')}</ul>`;
    }

    html += `<div class="sf-section-title">Friends${friends.length ? ` (${friends.length})` : ''}</div>`;
    if (!friends.length) {
      html += `<div class="sf-empty">No friends yet. Tap a player on the leaderboard to send a request.</div>`;
    } else {
      html += `<ul class="sf-list">${friends.map(f => `
        <li class="sf-row sf-row-friend" data-open-chat="${escapeHtml(f.peer)}" data-name="${escapeHtml(f.displayName)}">
          <span class="sf-avatar" style="background:#0ea5e9">${escapeHtml(avatarLetter(f.displayName))}</span>
          <span class="sf-name">${escapeHtml(f.displayName)}</span>
          <svg class="sf-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </li>`).join('')}</ul>`;
    }

    if (outgoing && outgoing.length) {
      html += `<div class="sf-section-title">Sent requests</div>`;
      html += `<ul class="sf-list">${outgoing.map(r => `
        <li class="sf-row">
          <span class="sf-avatar" style="background:#94a3b8">${escapeHtml(avatarLetter(r.displayName))}</span>
          <span class="sf-name">${escapeHtml(r.displayName)}</span>
          <span class="sf-pending">Waiting…</span>
        </li>`).join('')}</ul>`;
    }

    body.innerHTML = html;

    body.querySelectorAll('[data-respond]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const peer = btn.getAttribute('data-respond');
        const decision = btn.getAttribute('data-decision');
        btn.disabled = true;
        try {
          await api('friendRespond', { token: token(), target: peer, decision });
          await showList();
          updateBell();
        } catch (err) {
          window.STAARAuth.showToast && window.STAARAuth.showToast('Could not update request.');
          btn.disabled = false;
        }
      });
    });
    body.querySelectorAll('[data-open-chat]').forEach(row => {
      row.addEventListener('click', () => {
        openConversation(row.getAttribute('data-open-chat'), row.getAttribute('data-name'));
      });
    });
  }

  async function openConversation(peer, displayName) {
    if (!me()) return;
    ensurePanel();
    panelEl.hidden = false;
    document.body.classList.add('sf-open');
    activePeer = peer;
    activePeerName = displayName || peer;
    panelEl.querySelector('.sf-back').hidden = false;
    panelEl.querySelector('.sf-title').textContent = activePeerName;

    const body = panelEl.querySelector('#sf-body');
    body.innerHTML = `
      <div class="sf-conv">
        <div class="sf-conv-msgs" id="sf-conv-msgs">
          <div class="sf-empty">Loading…</div>
        </div>
        <div class="sf-conv-pad">
          <div class="sf-pad-label">Quick messages</div>
          <div class="sf-phrase-grid" id="sf-phrase-grid"></div>
          <div class="sf-pad-label">Reactions</div>
          <div class="sf-react-row" id="sf-react-row"></div>
        </div>
      </div>`;

    try {
      const r = await api('chatHistory', { token: token(), target: peer });
      convCache[peer] = r;
      renderConversation();
      startConvPoll();
    } catch (_) {
      body.innerHTML = '<div class="sf-empty">Could not load chat.</div>';
    }
  }

  function renderConversation() {
    if (!activePeer) return;
    const c = convCache[activePeer];
    if (!c) return;
    const meName = me() && me().username;
    const meDisplay = me() && (me().displayName || me().username);

    const msgsEl = panelEl.querySelector('#sf-conv-msgs');
    if (!c.messages.length) {
      msgsEl.innerHTML = `<div class="sf-empty">Say hi 👋</div>`;
    } else {
      msgsEl.innerHTML = c.messages.map(m => {
        const isMe = m.from === meName;
        const text = renderCode(c, m.code);
        const isReact = m.code >= c.reactionBase;
        return `<div class="sf-msg ${isMe ? 'sf-msg-me' : 'sf-msg-them'} ${isReact ? 'sf-msg-react' : ''}">
          <div class="sf-msg-bubble">${escapeHtml(text)}</div>
          <div class="sf-msg-time">${escapeHtml(isMe ? 'You' : activePeerName)} · ${fmtTime(m.ts)}</div>
        </div>`;
      }).join('');
      msgsEl.scrollTop = msgsEl.scrollHeight;
    }

    const grid = panelEl.querySelector('#sf-phrase-grid');
    grid.innerHTML = c.phrases.map((p, i) =>
      `<button type="button" class="sf-phrase" data-code="${i}">${escapeHtml(p)}</button>`
    ).join('');
    grid.querySelectorAll('[data-code]').forEach(btn => {
      btn.addEventListener('click', () => sendCode(parseInt(btn.getAttribute('data-code'), 10)));
    });

    const row = panelEl.querySelector('#sf-react-row');
    row.innerHTML = c.reactions.map((r, i) =>
      `<button type="button" class="sf-react" data-code="${c.reactionBase + i}">${escapeHtml(r)}</button>`
    ).join('');
    row.querySelectorAll('[data-code]').forEach(btn => {
      btn.addEventListener('click', () => sendCode(parseInt(btn.getAttribute('data-code'), 10)));
    });
  }

  function renderCode(c, code) {
    if (code >= c.reactionBase) return c.reactions[code - c.reactionBase] || '?';
    return c.phrases[code] || '?';
  }

  async function sendCode(code) {
    if (!activePeer) return;
    try {
      const r = await api('chatSend', { token: token(), target: activePeer, code });
      const c = convCache[activePeer];
      if (c) {
        c.messages.push({ id: r.id, ts: r.ts, from: me().username, code });
        renderConversation();
      }
    } catch (e) {
      window.STAARAuth.showToast && window.STAARAuth.showToast(
        e && e.message && /Slow down/i.test(e.message) ? 'Easy! Slow down a bit.' : 'Could not send.'
      );
    }
  }

  function startConvPoll() {
    stopConvPoll();
    convPollTimer = setInterval(async () => {
      if (!activePeer) return;
      const c = convCache[activePeer];
      const since = c && c.messages.length ? c.messages[c.messages.length - 1].ts : 0;
      try {
        const r = await api('chatHistory', { token: token(), target: activePeer, since });
        if (r.messages && r.messages.length) {
          c.messages.push(...r.messages);
          renderConversation();
        }
      } catch (_) { /* keep trying */ }
    }, HISTORY_POLL_MS);
  }
  function stopConvPoll() {
    if (convPollTimer) { clearInterval(convPollTimer); convPollTimer = null; }
  }

  // ===== Bell badge polling =====

  async function updateBell() {
    const dot = document.getElementById('chat-bell-dot');
    if (!dot || !me()) return;
    try {
      const r = await api('chatInbox', { token: token(), since: lastInboxTs });
      const total = (r.pendingRequests || 0) +
        Object.values(r.unread || {}).reduce((a, b) => a + b, 0);
      if (total > 0) {
        dot.hidden = false;
        dot.textContent = total > 9 ? '9+' : String(total);
      } else {
        dot.hidden = true;
      }
    } catch (_) { /* offline */ }
  }
  function startBellPoll() {
    if (pollTimer) return;
    updateBell();
    pollTimer = setInterval(() => {
      if (!document.hidden) updateBell();
    }, POLL_MS);
  }

  // ===== Friend request from arbitrary entry points =====

  async function requestFriend(peer, displayName) {
    if (!me()) {
      window.STAARAuth.showLogin && window.STAARAuth.showLogin();
      return null;
    }
    if (!peer || peer === (me().username)) return null;
    try {
      const r = await api('friendRequest', { token: token(), target: peer });
      if (r.status === 'accepted') {
        window.STAARAuth.showToast && window.STAARAuth.showToast(`You're now friends with ${displayName || peer} 🎉`);
      } else {
        window.STAARAuth.showToast && window.STAARAuth.showToast(`Friend request sent to ${displayName || peer}`);
      }
      updateBell();
      return r;
    } catch (e) {
      window.STAARAuth.showToast && window.STAARAuth.showToast(
        (e && e.message) ? e.message : 'Could not send request.'
      );
      return null;
    }
  }

  // ===== Init =====

  window.addEventListener('staar:open-friends', openPanel);
  // Mark inbox "read" when the panel is open (best-effort: bumps lastInboxTs)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) updateBell();
  });

  function init() {
    // Wait until auth is loaded, then start polling.
    const tryStart = () => {
      if (window.STAARAuth && me()) {
        // First open of inbox uses now() so unread = anything from now on.
        lastInboxTs = Date.now() - 24 * 60 * 60 * 1000; // count last 24h as unread
        startBellPoll();
      }
    };
    tryStart();
    // Also retry shortly after page load for slow auth bootstraps.
    setTimeout(tryStart, 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.STAARFriends = {
    __loaded: true,
    openPanel,
    openConversation,
    requestFriend,
    updateBell
  };
})();
