// STAAR Prep — simple local profiles
//
// Stores a list of profiles in localStorage. No server, no email.
// Each profile has: { id, name, pin?, color, createdAt }
// Active profile id is in localStorage under STAAR_ACTIVE_USER.
// All other modules can read window.STAARAuth.currentUser() to scope data.
//
// Phase 1 design note: stats are now namespaced per user under
//   staar-stats:<userId>:<gradeSlug>
// so multiple kids on one device don't share progress.

(function () {
  const LS_PROFILES = 'staar-profiles:v1';
  const LS_ACTIVE = 'staar-active-user:v1';
  const COLORS = ['#1e40af', '#f59e0b', '#16a34a', '#db2777', '#7c3aed', '#0ea5e9', '#dc2626', '#0d9488'];

  function uid() {
    return 'u_' + Math.random().toString(36).slice(2, 10);
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(LS_PROFILES) || '[]'); }
    catch { return []; }
  }
  function save(list) { localStorage.setItem(LS_PROFILES, JSON.stringify(list)); }
  function activeId() { return localStorage.getItem(LS_ACTIVE) || ''; }
  function setActiveId(id) {
    if (id) localStorage.setItem(LS_ACTIVE, id);
    else localStorage.removeItem(LS_ACTIVE);
  }
  function currentUser() {
    const id = activeId();
    if (!id) return null;
    return load().find(u => u.id === id) || null;
  }
  function avatar(name) {
    return (name || '?').trim().charAt(0).toUpperCase() || '?';
  }
  function pickColor() {
    return COLORS[Math.floor(Math.random() * COLORS.length)];
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
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

  // ----- Screens -----
  function showLogin() {
    const profiles = load();

    const profileList = profiles.map(p => `
      <button type="button" class="profile-tile" data-id="${p.id}">
        <span class="profile-avatar" style="background:${p.color}">${escapeHtml(avatar(p.name))}</span>
        <span class="profile-name">${escapeHtml(p.name)}</span>
        ${p.pin ? '<span class="profile-lock" aria-hidden="true">🔒</span>' : ''}
      </button>`).join('');

    const overlay = openModal(`
      <h3 class="modal-title">Who's practicing today?</h3>
      ${profiles.length
        ? `<div class="profile-grid">${profileList}</div>
           <div class="modal-divider"><span>or</span></div>`
        : '<p class="modal-message">Create a profile to track your progress and keep your stats safe on this device.</p>'
      }
      <button type="button" class="btn btn-primary modal-full" data-act="new">+ Create new profile</button>
      ${profiles.length ? '<button type="button" class="btn btn-ghost modal-full modal-tight" data-act="manage">Manage profiles</button>' : ''}
    `);

    overlay.querySelectorAll('.profile-tile').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = profiles.find(x => x.id === btn.dataset.id);
        if (!p) return;
        if (p.pin) showPinPrompt(p);
        else { setActiveId(p.id); closeModal(); refreshHeader(); onLoginSuccess(); }
      });
    });
    overlay.querySelector('[data-act="new"]')?.addEventListener('click', showCreate);
    overlay.querySelector('[data-act="manage"]')?.addEventListener('click', showManage);
  }

  function showPinPrompt(profile) {
    const overlay = openModal(`
      <h3 class="modal-title">Enter PIN for ${escapeHtml(profile.name)}</h3>
      <p class="modal-message">This profile is locked with a 4-digit PIN.</p>
      <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
             class="auth-input pin-input" id="pin-in" placeholder="••••" autocomplete="off" />
      <p class="auth-error" id="pin-err" hidden>That PIN doesn't match. Try again.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="back">Back</button>
        <button type="button" class="btn btn-primary" data-act="ok">Sign in</button>
      </div>
    `);
    const input = overlay.querySelector('#pin-in');
    const err = overlay.querySelector('#pin-err');
    setTimeout(() => input.focus(), 50);

    const submit = () => {
      const v = (input.value || '').trim();
      if (v === profile.pin) {
        setActiveId(profile.id);
        closeModal();
        refreshHeader();
        onLoginSuccess();
      } else {
        err.hidden = false;
        input.value = '';
        input.focus();
      }
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    overlay.querySelector('[data-act="ok"]').addEventListener('click', submit);
    overlay.querySelector('[data-act="back"]').addEventListener('click', showLogin);
  }

  function showCreate() {
    const overlay = openModal(`
      <h3 class="modal-title">Create your profile</h3>
      <label class="auth-label">First name or nickname</label>
      <input type="text" class="auth-input" id="name-in" maxlength="24" placeholder="e.g. Maya" autocomplete="off" />

      <label class="auth-label">PIN (optional, 4 digits)</label>
      <input type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4"
             class="auth-input" id="pin-in" placeholder="Skip if you don't want a PIN" autocomplete="off" />
      <p class="auth-help">A PIN keeps your stats private if other kids share this device.</p>

      <p class="auth-error" id="err" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-act="back">Back</button>
        <button type="button" class="btn btn-primary" data-act="create">Create profile</button>
      </div>
    `);
    const nameIn = overlay.querySelector('#name-in');
    const pinIn = overlay.querySelector('#pin-in');
    const err = overlay.querySelector('#err');
    setTimeout(() => nameIn.focus(), 50);

    overlay.querySelector('[data-act="back"]').addEventListener('click', showLogin);
    overlay.querySelector('[data-act="create"]').addEventListener('click', () => {
      const name = (nameIn.value || '').trim();
      const pin = (pinIn.value || '').trim();
      if (!name) { err.textContent = 'Please enter a name.'; err.hidden = false; return; }
      if (pin && !/^\d{4}$/.test(pin)) { err.textContent = 'PIN must be 4 digits, or leave it empty.'; err.hidden = false; return; }

      const list = load();
      if (list.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        err.textContent = 'A profile with that name already exists on this device.';
        err.hidden = false;
        return;
      }
      const profile = {
        id: uid(),
        name,
        pin: pin || null,
        color: pickColor(),
        createdAt: Date.now()
      };
      list.push(profile);
      save(list);
      setActiveId(profile.id);
      // First-time migration: if there are legacy single-user stats keys
      // (from before profiles existed), adopt them under this first profile
      // so we don't lose pre-existing progress on this device.
      if (list.length === 1) {
        Object.keys(localStorage).forEach(k => {
          const m = k.match(/^staar-stats:([a-z0-9-]+)$/i);
          if (m) {
            const v = localStorage.getItem(k);
            localStorage.setItem(`staar-stats:${profile.id}:${m[1]}`, v);
            localStorage.removeItem(k);
          }
        });
      }
      closeModal();
      refreshHeader();
      onLoginSuccess();
    });
  }

  function showManage() {
    const profiles = load();
    const rows = profiles.map(p => `
      <div class="manage-row">
        <span class="profile-avatar small" style="background:${p.color}">${escapeHtml(avatar(p.name))}</span>
        <span class="profile-name">${escapeHtml(p.name)}${p.pin ? ' <span aria-label="has PIN">🔒</span>' : ''}</span>
        <button type="button" class="btn-link danger" data-del="${p.id}">Remove</button>
      </div>`).join('');

    const overlay = openModal(`
      <h3 class="modal-title">Manage profiles</h3>
      <p class="modal-message">Removing a profile deletes its stats from this device.</p>
      <div class="manage-list">${rows || '<em class="auth-help">No profiles yet.</em>'}</div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" data-act="done">Done</button>
      </div>
    `);
    overlay.querySelectorAll('[data-del]').forEach(b => {
      b.addEventListener('click', () => {
        if (!confirm('Remove this profile and its stats from this device?')) return;
        const id = b.dataset.del;
        const list = load().filter(p => p.id !== id);
        save(list);
        // Also clear that user's per-grade stats keys.
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(`staar-stats:${id}:`)) localStorage.removeItem(k);
        });
        if (activeId() === id) setActiveId('');
        showManage();
        refreshHeader();
      });
    });
    overlay.querySelector('[data-act="done"]').addEventListener('click', () => {
      closeModal();
      if (!currentUser()) showLogin();
    });
  }

  function onLoginSuccess() {
    // Hook for pages to refresh once a user is signed in.
    if (typeof window.onSTAARLogin === 'function') {
      try { window.onSTAARLogin(currentUser()); } catch (_) {}
    }
  }

  // ----- Header pill -----
  function refreshHeader() {
    const slot = document.getElementById('user-slot');
    if (!slot) return;
    const u = currentUser();
    if (!u) {
      slot.innerHTML = `<button type="button" class="btn btn-primary user-signin">Sign in</button>`;
      slot.querySelector('.user-signin').addEventListener('click', showLogin);
      return;
    }
    slot.innerHTML = `
      <button type="button" class="user-pill" id="user-pill">
        <span class="profile-avatar small" style="background:${u.color}">${escapeHtml(avatar(u.name))}</span>
        <span class="user-pill-name">${escapeHtml(u.name)}</span>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="user-menu" id="user-menu" hidden>
        <button type="button" data-act="switch">Switch profile</button>
        <button type="button" data-act="logout">Sign out</button>
      </div>`;
    const pill = slot.querySelector('#user-pill');
    const menu = slot.querySelector('#user-menu');
    pill.addEventListener('click', e => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener('click', () => { menu.hidden = true; }, { once: true });
    menu.querySelector('[data-act="switch"]').addEventListener('click', () => {
      menu.hidden = true;
      showLogin();
    });
    menu.querySelector('[data-act="logout"]').addEventListener('click', () => {
      menu.hidden = true;
      setActiveId('');
      refreshHeader();
      // Force a fresh login on protected pages.
      if (window.STAARAuth.requireLoginOnLoad) showLogin();
    });
  }

  // ----- Public API -----
  window.STAARAuth = {
    currentUser,
    profiles: load,
    showLogin,
    refreshHeader,
    requireLoginOnLoad: false,
    // Helper for stats namespacing
    statsKey(slug) {
      const u = currentUser();
      const uid = u ? u.id : 'guest';
      return `staar-stats:${uid}:${slug}`;
    }
  };

  // Auto-init: render the header pill once DOM is ready.
  document.addEventListener('DOMContentLoaded', () => {
    refreshHeader();
    // If the page set window.STAARAuth.requireLoginOnLoad = true before
    // DOMContentLoaded, prompt for login when no user is active.
    if (window.STAARAuth.requireLoginOnLoad && !currentUser()) {
      showLogin();
    }
  });
})();
