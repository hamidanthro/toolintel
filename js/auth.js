// STAAR Prep — Cloud accounts (username + password)
//
// Talks to the staar-tutor Lambda (same endpoint used by the AI tutor)
// with action: signup | login | getStats | putStats.
// Stores { token, user } in localStorage so the kid stays logged in.
// Stats are still cached locally for offline-friendliness but synced
// to the cloud on each save so progress follows the student to any device.

(function () {
  const ENDPOINT = window.STAAR_TUTOR_ENDPOINT
    || 'https://4wvuw21yjl.execute-api.us-east-1.amazonaws.com/';

  const LS_SESSION = 'staar-session:v2';

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); }
    catch { return null; }
  }
  function saveSession(s) { localStorage.setItem(LS_SESSION, JSON.stringify(s)); }
  function clearSession() { localStorage.removeItem(LS_SESSION); }

  function currentUser() {
    const s = loadSession();
    return s && s.user ? s.user : null;
  }
  function token() {
    const s = loadSession();
    return s && s.token ? s.token : null;
  }

  function avatar(name) { return (name || '?').trim().charAt(0).toUpperCase() || '?'; }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  async function api(action, body) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...body })
    });
    let data = {};
    try { data = await res.json(); } catch (_) {}
    if (!res.ok) {
      const err = new Error(data.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ----- Modal helpers -----
  function openModal(html) {
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay auth-modal';
    overlay.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.addEventListener('keydown', escClose);
    return overlay;
  }
  function closeModal() {
    const m = document.querySelector('.modal-overlay.auth-modal');
    if (m) {
      m.classList.remove('open');
      setTimeout(() => m.remove(), 180);
    }
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }

  function setBusy(btn, busy, label) {
    if (!btn) return;
    if (busy) {
      btn.dataset.label = btn.dataset.label || btn.textContent;
      btn.disabled = true;
      btn.innerHTML = `<span class="rainbow-spinner small" aria-hidden="true"></span> ${label || 'Working\u2026'}`;
    } else {
      btn.disabled = false;
      btn.textContent = btn.dataset.label || 'Submit';
    }
  }

  // ----- Login screen -----
  function showLogin(prefilled) {
    const overlay = openModal(`
      <h3 class="modal-title">Sign in to STAAR Prep</h3>
      <p class="modal-message">Use your username and password to keep your progress on every device.</p>

      <label class="auth-label">Username</label>
      <input type="text" class="auth-input" id="login-user" autocomplete="username"
             autocapitalize="off" maxlength="24" placeholder="e.g. mayam" value="${escapeHtml(prefilled || '')}" />

      <label class="auth-label">Password</label>
      <input type="password" class="auth-input" id="login-pass" autocomplete="current-password" />

      <p class="auth-error" id="login-err" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="signup">Create account</button>
        <button type="button" class="btn btn-primary" data-act="login">Sign in</button>
      </div>
    `);
    const userIn = overlay.querySelector('#login-user');
    const passIn = overlay.querySelector('#login-pass');
    const err = overlay.querySelector('#login-err');
    const btn = overlay.querySelector('[data-act="login"]');
    setTimeout(() => (prefilled ? passIn : userIn).focus(), 50);

    const submit = async () => {
      err.hidden = true;
      const username = (userIn.value || '').trim();
      const password = passIn.value || '';
      if (!username || !password) {
        err.textContent = 'Please enter your username and password.';
        err.hidden = false;
        return;
      }
      setBusy(btn, true, 'Signing in\u2026');
      try {
        const res = await api('login', { username, password });
        saveSession({ token: res.token, user: res.user });
        await pullStats();
        closeModal();
        refreshHeader();
        onLoginSuccess();
      } catch (e) {
        err.textContent = e.message || 'Sign-in failed. Try again.';
        err.hidden = false;
      } finally {
        setBusy(btn, false);
      }
    };
    [userIn, passIn].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    btn.addEventListener('click', submit);
    overlay.querySelector('[data-act="signup"]').addEventListener('click', () => showSignup(userIn.value));
  }

  // ----- Signup screen -----
  function showSignup(prefilledUsername) {
    const overlay = openModal(`
      <h3 class="modal-title">Create your account</h3>
      <p class="modal-message">Pick a username and password. You can sign in from any device.</p>

      <label class="auth-label">Display name</label>
      <input type="text" class="auth-input" id="su-name" maxlength="32" placeholder="e.g. Maya" autocomplete="off" />

      <label class="auth-label">Username</label>
      <input type="text" class="auth-input" id="su-user" maxlength="24" autocomplete="username"
             autocapitalize="off" placeholder="letters, numbers, _ . -" value="${escapeHtml(prefilledUsername || '')}" />

      <label class="auth-label">Password (at least 6 characters)</label>
      <input type="password" class="auth-input" id="su-pass" autocomplete="new-password" />

      <label class="auth-label">Retype password</label>
      <input type="password" class="auth-input" id="su-pass2" autocomplete="new-password" />

      <p class="auth-error" id="su-err" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="back">Back to sign in</button>
        <button type="button" class="btn btn-primary" data-act="create">Create account</button>
      </div>
    `);
    const nameIn = overlay.querySelector('#su-name');
    const userIn = overlay.querySelector('#su-user');
    const passIn = overlay.querySelector('#su-pass');
    const pass2In = overlay.querySelector('#su-pass2');
    const err = overlay.querySelector('#su-err');
    const btn = overlay.querySelector('[data-act="create"]');
    setTimeout(() => nameIn.focus(), 50);

    overlay.querySelector('[data-act="back"]').addEventListener('click', () => showLogin(userIn.value));

    const submit = async () => {
      err.hidden = true;
      const displayName = (nameIn.value || '').trim();
      const username = (userIn.value || '').trim().toLowerCase();
      const password = passIn.value || '';
      const password2 = pass2In.value || '';

      if (!displayName) { fail('Please enter a display name.'); return; }
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
        fail('Username must be 3\u201324 characters: letters, numbers, _ . -'); return;
      }
      if (password.length < 6) { fail('Password must be at least 6 characters.'); return; }
      if (password !== password2) { fail('Passwords don\u2019t match.'); return; }

      setBusy(btn, true, 'Creating\u2026');
      try {
        const res = await api('signup', { username, password, displayName });
        saveSession({ token: res.token, user: res.user });
        await migrateLegacyStats();
        closeModal();
        refreshHeader();
        onLoginSuccess();
      } catch (e) {
        fail(e.message || 'Could not create account. Try again.');
      } finally {
        setBusy(btn, false);
      }
    };
    function fail(msg) { err.textContent = msg; err.hidden = false; }

    [nameIn, userIn, passIn, pass2In].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
    btn.addEventListener('click', submit);
  }

  // ----- Stats sync helpers -----
  async function pullStats() {
    try {
      const t = token();
      if (!t) return;
      const u = currentUser();
      if (!u) return;
      const r = await api('getStats', { token: t });
      const stats = r.stats || {};
      Object.keys(stats).forEach(slug => {
        try {
          localStorage.setItem(`staar-stats:${u.userId}:${slug}`, JSON.stringify(stats[slug]));
        } catch (_) {}
      });
    } catch (_) { /* offline-friendly: ignore */ }
  }

  async function pushStats(slug, data) {
    try {
      const t = token();
      if (!t) return;
      await api('putStats', { token: t, slug, data });
    } catch (_) { /* offline-friendly */ }
  }

  async function migrateLegacyStats() {
    const u = currentUser();
    if (!u) return;
    const keys = [];
    Object.keys(localStorage).forEach(k => {
      if (/^staar-stats:[^:]+(:[^:]+)?$/.test(k) && !k.startsWith(`staar-stats:${u.userId}:`)) {
        keys.push(k);
      }
    });
    for (const k of keys) {
      try {
        const data = JSON.parse(localStorage.getItem(k) || 'null');
        if (!data) continue;
        const parts = k.split(':');
        const slug = parts[parts.length - 1];
        localStorage.setItem(`staar-stats:${u.userId}:${slug}`, JSON.stringify(data));
        localStorage.removeItem(k);
        await pushStats(slug, data);
      } catch (_) {}
    }
  }

  function onLoginSuccess() {
    if (typeof window.onSTAARLogin === 'function') {
      try { window.onSTAARLogin(currentUser()); } catch (_) {}
    }
  }

  // ----- Header pill -----
  function formatCents(c) {
    const n = Math.max(0, parseInt(c, 10) || 0);
    if (n < 100) return `${n}\u00a2`;
    return `$${(n / 100).toFixed(2)}`;
  }

  function showCentsToast(awarded, capped) {
    if (!awarded || awarded <= 0) {
      if (capped) showToast('You hit the $100 lifetime cap! \ud83c\udfaf');
      return;
    }
    const t = document.createElement('div');
    t.className = 'cents-toast';
    t.innerHTML = `<span class="cents-toast-coin">+${awarded}\u00a2</span><span>added to your wallet</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 1600);
  }
  function showCentsLossToast(lost, flooredAtZero) {
    if (!lost || lost <= 0) {
      if (flooredAtZero) showToast('Wallet stays at 0\u00a2 \u2014 keep trying!');
      return;
    }
    const t = document.createElement('div');
    t.className = 'cents-toast cents-toast-loss';
    const tail = flooredAtZero ? ' (wallet at 0)' : '';
    t.innerHTML = `<span class="cents-toast-coin">\u2212${lost}\u00a2</span><span>oops, try again${tail}</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 1800);
  }
  function showToast(text) {
    const t = document.createElement('div');
    t.className = 'cents-toast';
    t.textContent = text;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 1800);
  }

  async function refreshWallet() {
    const t = token();
    if (!t) return null;
    try {
      const w = await api('getWallet', { token: t });
      const s = loadSession();
      if (s && s.user) {
        s.user.balanceCents = w.balanceCents;
        s.user.lifetimeCents = w.lifetimeCents;
        s.user.masteredSections = w.masteredSections || {};
        saveSession(s);
      }
      refreshHeader();
      return w;
    } catch (_) { return null; }
  }

  async function earn(cents, section) {
    const t = token();
    if (!t) return null;
    if (section && isMastered(section)) {
      return { awardedCents: 0, locked: true };
    }
    try {
      const w = await api('earn', { token: t, cents, section: section || undefined });
      const s = loadSession();
      if (s && s.user) {
        s.user.balanceCents = w.balanceCents;
        s.user.lifetimeCents = w.lifetimeCents;
        if (w.masteredSections) s.user.masteredSections = w.masteredSections;
        saveSession(s);
      }
      refreshHeader();
      if (!w.locked) showCentsToast(w.awardedCents, w.capped);
      return w;
    } catch (_) { return null; }
  }

  async function lose(cents, section) {
    const t = token();
    if (!t) return null;
    if (section && isMastered(section)) {
      return { lostCents: 0, locked: true };
    }
    try {
      const w = await api('lose', { token: t, cents, section: section || undefined });
      const s = loadSession();
      if (s && s.user) {
        s.user.balanceCents = w.balanceCents;
        s.user.lifetimeCents = w.lifetimeCents;
        if (w.masteredSections) s.user.masteredSections = w.masteredSections;
        saveSession(s);
      }
      refreshHeader();
      if (!w.locked) showCentsLossToast(w.lostCents, w.flooredAtZero);
      return w;
    } catch (_) { return null; }
  }

  function isMastered(section) {
    if (!section) return false;
    const u = currentUser();
    return !!(u && u.masteredSections && u.masteredSections[section]);
  }

  async function markMastered(section, label) {
    const t = token();
    if (!t || !section) return null;
    try {
      const w = await api('markMastered', { token: t, section, label: label || '' });
      const s = loadSession();
      if (s && s.user) {
        s.user.masteredSections = w.masteredSections || {};
        saveSession(s);
      }
      return w;
    } catch (_) { return null; }
  }

  function refreshHeader() {
    const slot = document.getElementById('user-slot');
    if (!slot) return;
    const u = currentUser();
    if (!u) {
      slot.innerHTML = `<button type="button" class="btn btn-primary user-signin">Sign in</button>`;
      slot.querySelector('.user-signin').addEventListener('click', () => showLogin());
      return;
    }
    const wallet = formatCents(u.balanceCents || 0);
    const adminBadge = u.isAdmin ? `<a href="admin.html" class="admin-badge" title="Admin panel">Admin</a>` : '';
    const adminLink = u.isAdmin ? `<a href="admin.html" class="user-menu-link">Admin panel</a>` : '';
    slot.innerHTML = `
      ${adminBadge}
      <a href="marketplace.html" class="wallet-pill" title="Toy marketplace">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 6v12M9 9h4.5a2 2 0 010 4H10a2 2 0 000 4h5"/></svg>
        <span>${wallet}</span>
      </a>
      <button type="button" class="user-pill" id="user-pill">
        <span class="profile-avatar small" style="background:${u.color || '#1e40af'}">${escapeHtml(avatar(u.displayName || u.username))}</span>
        <span class="user-pill-name">${escapeHtml(u.displayName || u.username)}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="user-menu" id="user-menu" hidden>
        <div class="user-menu-meta">@${escapeHtml(u.username)}</div>
        <a href="marketplace.html" class="user-menu-link">Toy marketplace</a>
        ${adminLink}
        <button type="button" data-act="logout">Sign out</button>
      </div>`;
    const pill = slot.querySelector('#user-pill');
    const menu = slot.querySelector('#user-menu');
    pill.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
    menu.querySelector('[data-act="logout"]').addEventListener('click', () => {
      menu.hidden = true;
      clearSession();
      refreshHeader();
      if (window.STAARAuth.requireLoginOnLoad) showLogin();
    });
  }

  // ----- Public API -----
  window.STAARAuth = Object.assign(window.STAARAuth || {}, {
    currentUser,
    token,
    showLogin,
    refreshHeader,
    pushStats,
    pullStats,
    api,
    earn,
    lose,
    markMastered,
    isMastered,
    refreshWallet,
    formatCents,
    showCentsToast,
    showToast,
    requireLoginOnLoad: window.STAARAuth ? !!window.STAARAuth.requireLoginOnLoad : false,
    statsKey(slug) {
      const u = currentUser();
      const id = u ? u.userId : 'guest';
      return `staar-stats:${id}:${slug}`;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    refreshHeader();
    if (window.STAARAuth.requireLoginOnLoad && !currentUser()) {
      showLogin();
    } else if (currentUser()) {
      pullStats();
      refreshWallet();
    }
  });
})();
