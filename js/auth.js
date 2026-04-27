// StarTest — Cloud accounts (username + password)
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
    overlay.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true">
      <button type="button" class="modal-close" aria-label="Close" data-act="close">&times;</button>
      ${html}
    </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) dismissModal(); });
    overlay.querySelector('[data-act="close"]').addEventListener('click', dismissModal);
    document.addEventListener('keydown', escClose);
    return overlay;
  }
  function dismissModal() {
    closeModal();
    // If this page requires login and the user bailed out, send them home.
    if (window.STAARAuth && window.STAARAuth.requireLoginOnLoad && !currentUser()) {
      location.href = 'index.html';
    }
  }
  function closeModal() {
    const m = document.querySelector('.modal-overlay.auth-modal');
    if (m) {
      m.classList.remove('open');
      setTimeout(() => m.remove(), 180);
    }
    document.removeEventListener('keydown', escClose);
  }
  function escClose(e) { if (e.key === 'Escape') dismissModal(); }

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
    closeModal();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay auth-modal signin-overlay';
    overlay.innerHTML = `
      <div class="signin-modal" role="dialog" aria-modal="true" aria-labelledby="signin-title">
        <div class="signin-modal-accent"></div>
        <button type="button" class="signin-modal-close" aria-label="Close" data-act="close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
        <div class="signin-modal-brand">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <path d="M20 4L25 14L36 15.5L28 23L30 34L20 28.5L10 34L12 23L4 15.5L15 14L20 4Z"
              fill="url(#modalStarGrad)"
              stroke="rgba(251, 191, 36, 0.4)" stroke-width="0.5"/>
            <defs>
              <linearGradient id="modalStarGrad" x1="4" y1="4" x2="36" y2="34" gradientUnits="userSpaceOnUse">
                <stop stop-color="#fde68a"/><stop offset="0.5" stop-color="#fbbf24"/><stop offset="1" stop-color="#f59e0b"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2 id="signin-title" class="signin-modal-title">Welcome back</h2>
        <p class="signin-modal-subtitle">Sign in to keep your progress, streaks, and points across every device.</p>

        <div class="signin-sso-buttons">
          <button type="button" class="signin-sso-btn" data-sso="google" data-comingsoon="true">
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </button>
          <button type="button" class="signin-sso-btn" data-sso="apple" data-comingsoon="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            Continue with Apple
          </button>
        </div>

        <div class="signin-divider"><span class="signin-divider-text">or sign in with username</span></div>

        <form class="signin-form" novalidate>
          <div class="signin-field">
            <label for="login-user" class="signin-label">Username</label>
            <input id="login-user" type="text" class="signin-input"
              autocomplete="username" autocapitalize="off" maxlength="24"
              placeholder="your-username" value="${escapeHtml(prefilled || '')}" />
          </div>
          <div class="signin-field">
            <div class="signin-label-row">
              <label for="login-pass" class="signin-label">Password</label>
              <a href="#" class="signin-forgot" data-act="forgot">Forgot?</a>
            </div>
            <div class="signin-input-wrapper">
              <input id="login-pass" type="password" class="signin-input"
                autocomplete="current-password" placeholder="••••••••••" />
              <button type="button" class="signin-password-toggle" aria-label="Show password" data-act="toggle-pass">
                <svg class="eye-on" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"/><circle cx="8" cy="8" r="2"/>
                </svg>
                <svg class="eye-off" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true" style="display:none">
                  <path d="M1 1l14 14"/><path d="M3.5 3.5C2 4.7 1 8 1 8s2.5 5 7 5c1.5 0 2.8-.4 3.9-1"/><path d="M14 11c.6-.7 1-1.5 1-1.5s-2.5-5-7-5c-.7 0-1.4.1-2 .3"/>
                </svg>
              </button>
            </div>
          </div>

          <p class="auth-error signin-error" id="login-err" hidden></p>

          <button type="button" class="signin-submit" data-act="login">
            <span class="signin-submit-label">Sign in</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </form>

        <div class="signin-modal-footer">
          <span class="signin-footer-text">New to StarTest?</span>
          <a href="#" class="signin-footer-link" data-act="signup">Create an account</a>
        </div>

        <div class="signin-trust">
          <span class="trust-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            Secure
          </span>
          <span class="trust-divider">·</span>
          <span class="trust-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            COPPA-compliant
          </span>
          <span class="trust-divider">·</span>
          <span class="trust-item">No ads · ever</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) dismissModal(); });
    overlay.querySelector('[data-act="close"]').addEventListener('click', dismissModal);
    document.addEventListener('keydown', escClose);

    const userIn = overlay.querySelector('#login-user');
    const passIn = overlay.querySelector('#login-pass');
    const err = overlay.querySelector('#login-err');
    const btn = overlay.querySelector('[data-act="login"]');
    setTimeout(() => (prefilled ? passIn : userIn).focus(), 50);

    // Password visibility toggle
    const toggleBtn = overlay.querySelector('[data-act="toggle-pass"]');
    toggleBtn.addEventListener('click', () => {
      const hidden = passIn.type === 'password';
      passIn.type = hidden ? 'text' : 'password';
      toggleBtn.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
      toggleBtn.querySelector('.eye-on').style.display = hidden ? 'none' : '';
      toggleBtn.querySelector('.eye-off').style.display = hidden ? '' : 'none';
    });

    // SSO coming-soon
    overlay.querySelectorAll('[data-comingsoon="true"]').forEach(b => {
      b.addEventListener('click', () => {
        if (window.STAARAuth && window.STAARAuth.showToast) {
          window.STAARAuth.showToast('Coming soon — sign in with username for now.');
        }
      });
    });

    overlay.querySelector('[data-act="forgot"]').addEventListener('click', e => {
      e.preventDefault();
      if (window.STAARAuth && window.STAARAuth.showToast) {
        window.STAARAuth.showToast('Password reset is coming soon. Email support@toolintel.ai if you need help.');
      }
    });

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
    overlay.querySelector('[data-act="signup"]').addEventListener('click', e => {
      e.preventDefault();
      showSignup(userIn.value);
    });
  }

  // ----- Signup screen -----
  function showSignup(prefilledUsername) {
    const overlay = openModal(`
      <h3 class="modal-title">Create your account</h3>
      <p class="modal-message">Pick a username and password. You can sign in from any device.</p>

      <label class="auth-label">Display name</label>
      <input type="text" class="auth-input" id="su-name" maxlength="32" placeholder="e.g. Maya" autocomplete="off" />

      <label class="auth-label">Email</label>
      <input type="email" class="auth-input" id="su-email" maxlength="120" placeholder="you@example.com" autocomplete="email" inputmode="email" />

      <label class="auth-label">Username</label>
      <input type="text" class="auth-input" id="su-user" maxlength="24" autocomplete="username"
             autocapitalize="off" placeholder="letters, numbers, _ . -" value="${escapeHtml(prefilledUsername || '')}" />

      <label class="auth-label">Password (at least 6 characters)</label>
      <input type="password" class="auth-input" id="su-pass" autocomplete="new-password" />

      <label class="auth-label">Retype password</label>
      <input type="password" class="auth-input" id="su-pass2" autocomplete="new-password" />

      <label class="auth-label">Your grade right now</label>
      <select class="auth-input" id="su-grade">
        <option value="">Pick your grade…</option>
        <option value="grade-k">Kindergarten</option>
        <option value="grade-1">1st grade</option>
        <option value="grade-2">2nd grade</option>
        <option value="grade-3">3rd grade</option>
        <option value="grade-4">4th grade</option>
        <option value="grade-5">5th grade</option>
        <option value="grade-6">6th grade</option>
        <option value="grade-7">7th grade</option>
        <option value="grade-8">8th grade</option>
        <option value="algebra-1">Algebra I</option>
      </select>
      <p class="auth-hint">You'll only see questions for your grade and higher. This can't be changed later.</p>

      <p class="auth-error" id="su-err" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="back">Back to sign in</button>
        <button type="button" class="btn btn-primary" data-act="create">Create account</button>
      </div>
    `);
    const nameIn = overlay.querySelector('#su-name');
    const emailIn = overlay.querySelector('#su-email');
    const userIn = overlay.querySelector('#su-user');
    const passIn = overlay.querySelector('#su-pass');
    const pass2In = overlay.querySelector('#su-pass2');
    const gradeIn = overlay.querySelector('#su-grade');
    const err = overlay.querySelector('#su-err');
    const btn = overlay.querySelector('[data-act="create"]');
    setTimeout(() => nameIn.focus(), 50);

    overlay.querySelector('[data-act="back"]').addEventListener('click', () => showLogin(userIn.value));

    const submit = async () => {
      err.hidden = true;
      const displayName = (nameIn.value || '').trim();
      const email = (emailIn.value || '').trim().toLowerCase();
      const username = (userIn.value || '').trim().toLowerCase();
      const password = passIn.value || '';
      const password2 = pass2In.value || '';
      const grade = gradeIn.value || '';

      if (!displayName) { fail('Please enter a display name.'); return; }
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
        fail('Please enter a valid email address.'); return;
      }
      if (!/^[a-z0-9_.-]{3,24}$/.test(username)) {
        fail('Username must be 3–24 characters: letters, numbers, _ . -'); return;
      }
      if (password.length < 6) { fail('Password must be at least 6 characters.'); return; }
      if (password !== password2) { fail('Passwords don’t match.'); return; }
      if (!grade) { fail('Please pick your current grade.'); return; }

      setBusy(btn, true, 'Creating…');
      try {
        const res = await api('signup', { username, password, displayName, email, grade });
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

    [nameIn, emailIn, userIn, passIn, pass2In].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); }));
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

  // Heartbeat: bumps lifetimeSeconds on the server. Call from any page
  // where the kid is actively practicing — auth.js handles batching so
  // pages don't have to know about it.
  let _hbTimer = null;
  let _hbLastTick = Date.now();
  async function sendHeartbeat() {
    try {
      const t = token();
      if (!t) return;
      const now = Date.now();
      const elapsed = Math.round((now - _hbLastTick) / 1000);
      _hbLastTick = now;
      // Skip heartbeats while tab is hidden or on suspiciously long gaps
      // (laptop sleep, idle tab) so we count actual practice time.
      if (document.hidden) return;
      if (elapsed < 10 || elapsed > 120) return;
      await api('heartbeat', { token: t, seconds: elapsed });
    } catch (_) { /* offline */ }
  }
  function startHeartbeat() {
    if (_hbTimer) return;
    if (!currentUser()) return;
    _hbLastTick = Date.now();
    _hbTimer = setInterval(sendHeartbeat, 60 * 1000);
    // Reset baseline when tab becomes visible so hidden time isn't billed.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _hbLastTick = Date.now();
    });
  }
  function stopHeartbeat() {
    if (_hbTimer) { clearInterval(_hbTimer); _hbTimer = null; }
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
  // Display values: 1 cent = 1 point internally; we surface them as points everywhere kid-facing.
  function formatCents(c) {
    const n = Math.max(0, parseInt(c, 10) || 0);
    return `${n.toLocaleString()} pts`;
  }
  const formatPoints = formatCents;

  function showCentsToast(awarded, capped) {
    if (!awarded || awarded <= 0) {
      if (capped) showToast('You hit the 10,000 point lifetime cap! \ud83c\udfaf');
      return;
    }
    const t = document.createElement('div');
    t.className = 'cents-toast';
    t.innerHTML = `<span class="cents-toast-coin">+${awarded} pts</span><span>added to your wallet</span>`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 1600);
  }
  function showCentsLossToast(lost, flooredAtZero) {
    if (!lost || lost <= 0) {
      if (flooredAtZero) showToast('Wallet stays at 0 pts \u2014 keep trying!');
      return;
    }
    const t = document.createElement('div');
    t.className = 'cents-toast cents-toast-loss';
    const tail = flooredAtZero ? ' (wallet at 0)' : '';
    t.innerHTML = `<span class="cents-toast-coin">\u2212${lost} pts</span><span>oops, try again${tail}</span>`;
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
    } catch (e) {
      console.warn('earn failed', e);
      showToast('Could not save your reward (offline?)');
      return null;
    }
  }

  async function lose(cents, section) {
    const t = token();
    if (!t) return null;
    // NOTE: even when the section is mastered we still hit the API so the
    // server can bump lifetimeAnswered (wrong answers must always count
    // toward accuracy, even if no cents are deducted).
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
    } catch (e) {
      console.warn('lose failed', e);
      showToast('Could not update your wallet (offline?)');
      return null;
    }
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
      try { ensureMobileMenu(); } catch (_) {}
      try { ensureMobileTabBar(); } catch (_) {}
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
      <button type="button" class="chat-bell" id="chat-bell" title="Friends &amp; chat" aria-label="Friends and chat">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        <span class="chat-bell-dot" id="chat-bell-dot" hidden></span>
      </button>
      <button type="button" class="user-pill" id="user-pill">
        <span class="profile-avatar small" style="background:${u.color || '#1e40af'}">${escapeHtml(avatar(u.displayName || u.username))}</span>
        <span class="user-pill-name">${escapeHtml(u.displayName || u.username)}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="user-menu" id="user-menu" hidden>
        <div class="user-menu-meta">@${escapeHtml(u.username)}</div>
        ${adminLink}
        <a href="settings.html" class="user-menu-link">Settings</a>
        <button type="button" data-act="logout">Sign out</button>
      </div>`;
    const pill = slot.querySelector('#user-pill');
    const menu = slot.querySelector('#user-menu');
    const bell = slot.querySelector('#chat-bell');
    if (bell) {
      bell.addEventListener('click', e => {
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('staar:open-friends'));
      });
    }
    pill.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
    menu.querySelector('[data-act="logout"]').addEventListener('click', () => {
      menu.hidden = true;
      clearSession();
      // Always return to the landing page on sign-out so the dashboard
      // (or any authed view) is fully torn down — no stale state.
      try { window.location.assign('/'); } catch (_) { window.location.href = '/'; }
    });
    try { ensureMobileMenu(); } catch (_) {}
    try { ensureMobileTabBar(); } catch (_) {}
    // Live-update tab bar balance badge if present.
    try {
      const badge = document.querySelector('[data-tab-balance]');
      if (badge) badge.textContent = String(u.balanceCents || 0);
    } catch (_) {}
  }

  // Compare grade levels. Returns numeric rank: 0 for K, 1..8 for grade-N, 9 for algebra-1, -Infinity if unknown.
  function gradeLevel(slug) {
    if (!slug) return -Infinity;
    if (slug === 'algebra-1') return 9;
    if (slug === 'grade-k') return 0;
    const m = String(slug).match(/^grade-(\d+)$/);
    return m ? parseInt(m[1], 10) : -Infinity;
  }
  function userGradeLevel() {
    const u = currentUser();
    return u && u.grade ? gradeLevel(u.grade) : -Infinity;
  }
  async function setGrade(grade) {
    const t = token();
    if (!t) throw new Error('Not signed in');
    const res = await api('setGrade', { token: t, grade });
    const u = currentUser();
    if (u) saveSession({ token: t, user: { ...u, grade: res.grade } });
    return res.grade;
  }

  // ============================================================
  // MOBILE HAMBURGER MENU (Prompt 26)
  // ============================================================
  function ensureMobileMenu() {
    const u = currentUser();
    const stamp = u ? `u:${u.userId || u.username}:${u.balanceCents || 0}:${u.isAdmin ? 1 : 0}` : 'guest';
    const existing = document.querySelector('.mobile-menu-toggle');
    if (existing && existing.dataset.staarStamp === stamp) return;
    // Rebuild: tear down stale UI first.
    if (existing) existing.remove();
    document.querySelectorAll('.mobile-menu-panel, .mobile-menu-scrim').forEach(n => n.remove());
    const headerContainer = document.querySelector('.site-header .container');
    if (!headerContainer) return;

    const isAdmin = !!(u && u.isAdmin);
    const path = (location.pathname || '').toLowerCase();
    const currentPage = (() => {
      if (path.endsWith('index.html') || path === '/' || path === '') return 'home';
      if (path.indexOf('marketplace') !== -1) return 'toys';
      if (path.indexOf('about') !== -1) return 'about';
      if (path.indexOf('practice') !== -1) return 'practice';
      if (path.indexOf('grades') !== -1 || path.indexOf('grade.html') !== -1) return 'grades';
      if (path.indexOf('admin') !== -1) return 'admin';
      if (path.indexOf('settings') !== -1) return 'settings';
      return null;
    })();
    const isActive = (k) => currentPage === k ? 'aria-current="page"' : '';

    const toggle = document.createElement('button');
    toggle.className = 'mobile-menu-toggle';
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Open menu');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'mobile-menu-panel');
    toggle.dataset.staarStamp = stamp;
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>';
    headerContainer.appendChild(toggle);

    const scrim = document.createElement('div');
    scrim.className = 'mobile-menu-scrim';
    document.body.appendChild(scrim);

    const panel = document.createElement('nav');
    panel.id = 'mobile-menu-panel';
    panel.className = 'mobile-menu-panel';
    panel.setAttribute('aria-hidden', 'true');

    const userBlock = u ? `
      <div class="mobile-menu-user">
        <div class="avatar" style="background:${u.color || '#1e40af'}">${escapeHtml(avatar(u.displayName || u.username))}</div>
        <div class="info">
          <span class="name">${escapeHtml(u.displayName || u.username)}</span>
          <span class="username">@${escapeHtml(u.username)}</span>
        </div>
      </div>` : '';

    const wallet = u ? formatCents(u.balanceCents || 0) : '';

    panel.innerHTML = `
      ${userBlock}
      <a class="mobile-menu-row" href="index.html" ${isActive('home')}>
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
        Home
      </a>
      <a class="mobile-menu-row" href="marketplace.html" ${isActive('toys')}>
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg></span>
        Toy marketplace
        ${u ? `<span class="meta">${wallet} pts</span>` : ''}
      </a>
      <a class="mobile-menu-row" href="about.html" ${isActive('about')}>
        <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg></span>
        How it works
      </a>
      ${isAdmin ? `
        <div class="mobile-menu-divider"></div>
        <a class="mobile-menu-row" href="admin.html" ${isActive('admin')}>
          <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
          Admin panel
        </a>` : ''}
      ${u ? `
        <div class="mobile-menu-divider"></div>
        <a class="mobile-menu-row" href="settings.html" ${isActive('settings')}>
          <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 005.6 15a1.65 1.65 0 00-1.51-1H4a2 2 0 010-4h.09A1.65 1.65 0 005.6 9 1.65 1.65 0 005.27 7.18l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
          Settings
        </a>
        <button class="mobile-menu-row mobile-menu-row--signout" type="button" data-act="signout">
          <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg></span>
          Sign out
        </button>
      ` : `
        <div class="mobile-menu-divider"></div>
        <button class="mobile-menu-row" type="button" data-act="signin">
          <span class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg></span>
          Sign in
        </button>
      `}
    `;
    document.body.appendChild(panel);

    function open() {
      panel.dataset.open = 'true';
      scrim.dataset.open = 'true';
      panel.setAttribute('aria-hidden', 'false');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Close menu');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      panel.dataset.open = 'false';
      scrim.dataset.open = 'false';
      panel.setAttribute('aria-hidden', 'true');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open menu');
      document.body.style.overflow = '';
    }
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.dataset.open === 'true' ? close() : open();
    });
    scrim.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && panel.dataset.open === 'true') close();
    });
    panel.addEventListener('click', (e) => {
      const link = e.target.closest('a.mobile-menu-row');
      if (link) close(); // close before navigation
    });
    const signinBtn = panel.querySelector('[data-act="signin"]');
    if (signinBtn) signinBtn.addEventListener('click', () => { close(); showLogin(); });
    const signoutBtn = panel.querySelector('[data-act="signout"]');
    if (signoutBtn) signoutBtn.addEventListener('click', () => {
      close();
      clearSession();
      try { window.location.assign('/'); } catch (_) { window.location.href = '/'; }
    });
  }

  // ============================================================
  // MOBILE BOTTOM TAB BAR (Prompt 27)
  // Replaces hamburger as primary nav on mobile.
  // Hidden on practice.html (full-screen mode).
  // ============================================================
  function gradeShortLabel(slug) {
    if (!slug) return '—';
    if (slug === 'grade-k') return 'K';
    if (slug === 'algebra-1') return 'A1';
    const m = String(slug).match(/grade-(\d+)/);
    return m ? m[1] : '—';
  }

  function ensureMobileTabBar() {
    const path = (location.pathname || '').toLowerCase();
    // Practice runner gets full-screen mode — no tabbar.
    if (path.indexOf('practice.html') !== -1) {
      document.body.classList.add('no-mobile-tabbar');
      // If a stale tabbar exists from a prior render, remove it.
      const stale = document.querySelector('.mobile-tabbar');
      if (stale) stale.remove();
      return;
    }

    const u = currentUser();
    const stamp = u
      ? `u:${u.userId || u.username}:${u.balanceCents || 0}:${u.isAdmin ? 1 : 0}:${u.grade || ''}`
      : 'guest';
    const existing = document.querySelector('.mobile-tabbar');
    if (existing && existing.dataset.staarStamp === stamp) return;
    if (existing) existing.remove();

    const isOnHome        = path.endsWith('index.html') || path === '/' || path === '';
    const isOnMarketplace = path.indexOf('marketplace') !== -1;
    const isOnPractice    = path.indexOf('grades.html') !== -1 || path.indexOf('grade.html') !== -1;
    const isOnAbout       = path.indexOf('about') !== -1;
    const isOnSettings    = path.indexOf('settings') !== -1 || path.indexOf('admin') !== -1;

    const practiceHref = (u && u.grade) ? `practice.html?g=${encodeURIComponent(u.grade)}` : 'grades.html';
    const balance = u ? (u.balanceCents || 0) : 0;

    const tabBar = document.createElement('nav');
    tabBar.className = 'mobile-tabbar';
    tabBar.setAttribute('role', 'navigation');
    tabBar.setAttribute('aria-label', 'Primary');
    tabBar.dataset.staarStamp = stamp;

    const profileTabInner = u
      ? `<span class="mobile-tab-avatar" style="background:${u.color || '#1e40af'}">${escapeHtml(avatar(u.displayName || u.username))}</span>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

    // Prompt 33 — 3-tab bar: Home / Practice (gold center) / Profile (Toys folds into Profile)
    tabBar.innerHTML = `
      <a class="mobile-tab ${isOnHome ? 'is-active' : ''}" href="index.html" aria-label="Home">
        <span class="mobile-tab-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></span>
        <span class="mobile-tab-label">Home</span>
      </a>
      <a class="mobile-tab mobile-tab--center ${isOnPractice ? 'is-active' : ''}" href="${practiceHref}" aria-label="Practice">
        <span class="mobile-tab-center-button"><svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden="true"><polygon points="6 4 20 12 6 20 6 4"/></svg></span>
        <span class="mobile-tab-label mobile-tab-label--center">Practice</span>
      </a>
      <button type="button" class="mobile-tab ${(isOnSettings || isOnMarketplace) ? 'is-active' : ''}" data-action="open-profile-sheet" aria-label="Profile">
        <span class="mobile-tab-icon">${profileTabInner}</span>
        <span class="mobile-tab-label">${u ? 'Me' : 'Sign in'}</span>
      </button>
    `;
    document.body.appendChild(tabBar);

    tabBar.querySelector('[data-action="open-profile-sheet"]').addEventListener('click', () => {
      if (!currentUser()) { showLogin(); return; }
      openProfileSheet();
    });
  }

  function openProfileSheet() {
    const u = currentUser();
    if (!u) return;
    if (document.querySelector('.profile-sheet[data-open="true"]')) return;

    let scrim = document.querySelector('.profile-sheet-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'profile-sheet-scrim';
      document.body.appendChild(scrim);
    }
    let sheet = document.querySelector('.profile-sheet');
    if (sheet) sheet.remove();
    sheet = document.createElement('div');
    sheet.className = 'profile-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Profile menu');
    document.body.appendChild(sheet);

    const isAdmin = u.isAdmin === true;
    const wallet = formatCents(u.balanceCents || 0);
    const lifetime = formatCents(u.lifetimeCents || 0);

    sheet.innerHTML = `
      <div class="profile-sheet-handle" aria-hidden="true"></div>
      <header class="profile-sheet-header">
        <div class="profile-sheet-avatar" style="background:${u.color || '#1e40af'}">${escapeHtml(avatar(u.displayName || u.username))}</div>
        <div class="profile-sheet-identity">
          <div class="profile-sheet-name">${escapeHtml(u.displayName || u.username)}</div>
          <div class="profile-sheet-username">@${escapeHtml(u.username)}</div>
        </div>
        <button class="profile-sheet-close" type="button" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </header>
      <div class="profile-sheet-stats">
        <div class="profile-stat"><div class="profile-stat-value">${wallet}</div><div class="profile-stat-label">Wallet</div></div>
        <div class="profile-stat"><div class="profile-stat-value">${lifetime}</div><div class="profile-stat-label">Lifetime</div></div>
        <div class="profile-stat"><div class="profile-stat-value">${u.grade ? gradeShortLabel(u.grade) : '—'}</div><div class="profile-stat-label">Grade</div></div>
      </div>
      <nav class="profile-sheet-nav">
        <a class="profile-sheet-row profile-sheet-row--featured" href="marketplace.html">
          <span class="profile-sheet-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg></span>
          <span class="profile-sheet-row-text">Toy marketplace<span class="profile-sheet-row-meta">${wallet} available</span></span>
          <span class="profile-sheet-row-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>
        <a class="profile-sheet-row" href="settings.html">
          <span class="profile-sheet-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 005.6 15a1.65 1.65 0 00-1.51-1H4a2 2 0 010-4h.09A1.65 1.65 0 005.6 9 1.65 1.65 0 005.27 7.18l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H10a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V10a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></span>
          Settings
          <span class="profile-sheet-row-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>
        <a class="profile-sheet-row" href="about.html">
          <span class="profile-sheet-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span>
          How it works
          <span class="profile-sheet-row-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>
        ${isAdmin ? `
        <a class="profile-sheet-row" href="admin.html">
          <span class="profile-sheet-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg></span>
          Admin panel
          <span class="profile-sheet-row-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg></span>
        </a>` : ''}
        <button class="profile-sheet-row profile-sheet-row--signout" type="button" data-action="signout">
          <span class="profile-sheet-row-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/></svg></span>
          Sign out
        </button>
      </nav>
    `;

    requestAnimationFrame(() => {
      sheet.dataset.open = 'true';
      scrim.dataset.open = 'true';
      document.body.style.overflow = 'hidden';
    });

    function closeSheet() {
      sheet.dataset.open = 'false';
      scrim.dataset.open = 'false';
      document.body.style.overflow = '';
      setTimeout(() => { try { sheet.remove(); } catch (_) {} }, 280);
    }
    sheet.querySelector('.profile-sheet-close').addEventListener('click', closeSheet);
    scrim.addEventListener('click', closeSheet, { once: true });
    document.addEventListener('keydown', function escListener(e) {
      if (e.key === 'Escape') {
        closeSheet();
        document.removeEventListener('keydown', escListener);
      }
    });
    sheet.querySelector('[data-action="signout"]').addEventListener('click', () => {
      closeSheet();
      setTimeout(() => {
        clearSession();
        try { window.location.assign('/'); } catch (_) { window.location.href = '/'; }
      }, 300);
    });
  }

  // ============================================================
  // MOBILE: hide chat widget when input is focused (body class)
  // ============================================================
  function setupInputFocusedClass() {
    if (window.__staarInputFocusedBound) return;
    window.__staarInputFocusedBound = true;
    document.addEventListener('focusin', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea')) {
        document.body.classList.add('input-focused');
      }
    });
    document.addEventListener('focusout', (e) => {
      if (e.target && e.target.matches && e.target.matches('input, textarea')) {
        document.body.classList.remove('input-focused');
      }
    });
  }

  // ============================================================
  // iOS keyboard handler — shifts modal up so submit stays visible
  // ============================================================
  function setupIOSKeyboardHandler() {
    if (!window.visualViewport || window.__staarVVBound) return;
    window.__staarVVBound = true;
    function adjust() {
      const modal = document.querySelector('.modal-card, .signin-modal');
      if (!modal || !modal.offsetParent) return;
      const vv = window.visualViewport;
      const kb = window.innerHeight - vv.height;
      modal.style.paddingBottom = kb > 50 ? `${kb}px` : '';
    }
    window.visualViewport.addEventListener('resize', adjust);
    window.visualViewport.addEventListener('scroll', adjust);
  }

  // ============================================================
  // STAARHaptic — vibration helpers (no-op on devices without support)
  // ============================================================
  window.STAARHaptic = window.STAARHaptic || {
    light()   { try { navigator.vibrate && navigator.vibrate(10); } catch (_) {} },
    medium()  { try { navigator.vibrate && navigator.vibrate(20); } catch (_) {} },
    heavy()   { try { navigator.vibrate && navigator.vibrate([10, 30, 10]); } catch (_) {} },
    success() { try { navigator.vibrate && navigator.vibrate([10, 50, 30, 50]); } catch (_) {} }
  };

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
    startHeartbeat,
    stopHeartbeat,
    markMastered,
    isMastered,
    refreshWallet,
    formatCents,
    showCentsToast,
    showToast,
    gradeLevel,
    userGradeLevel,
    setGrade,
    requireLoginOnLoad: window.STAARAuth ? !!window.STAARAuth.requireLoginOnLoad : false,
    statsKey(slug) {
      const u = currentUser();
      const id = u ? u.userId : 'guest';
      return `staar-stats:${id}:${slug}`;
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    refreshHeader();
    ensureMobileMenu();
    ensureMobileTabBar();
    setupInputFocusedClass();
    setupIOSKeyboardHandler();
    if (window.STAARAuth.requireLoginOnLoad && !currentUser()) {
      showLogin();
    } else if (currentUser()) {
      pullStats();
      refreshWallet();
    }
  });
})();
