/**
 * GradeEarn — family profile switcher (Tier 6 AC, May 10)
 *
 * Lightweight multi-kid: instead of refactoring auth into parent +
 * child records, this module lets ONE device keep a list of saved kid
 * sessions and swap between them in two taps. Each "profile" is a
 * snapshot of {user, token} from the active staar-session.
 *
 * Auto-saves the current session to the family list on every
 * gradeearn:auth-changed event. Manual switch overwrites the active
 * session and reloads the page so all auth-aware modules pick up the
 * new identity cleanly.
 *
 * Exposed as window.GEFamily.
 *   GEFamily.list()             -> [{username, displayName, avatarEmoji, savedAt}]
 *   GEFamily.snapshot()         -> save current session into the family list
 *   GEFamily.switchTo(username) -> swap active session + reload
 *   GEFamily.remove(username)
 */
(function () {
  'use strict';

  const LS_FAMILY = 'gradeearn:family:v1';
  const LS_SESSION = 'staar-session:v2'; // matches auth.js constant
  const MAX_PROFILES = 6;

  function loadFamily() {
    try {
      const raw = localStorage.getItem(LS_FAMILY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function saveFamily(arr) {
    try { localStorage.setItem(LS_FAMILY, JSON.stringify(arr)); } catch (_) {}
  }

  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); }
    catch (_) { return null; }
  }
  function setSession(session) {
    try { localStorage.setItem(LS_SESSION, JSON.stringify(session)); } catch (_) {}
  }

  function avatarEmojiFor(username) {
    if (!username) return null;
    try { return localStorage.getItem('gradeearn:avatarEmoji:' + username) || null; }
    catch (_) { return null; }
  }

  function list() { return loadFamily(); }

  function snapshot() {
    const s = loadSession();
    if (!s || !s.user || !s.user.username || !s.token) return;
    const fam = loadFamily();
    const idx = fam.findIndex(p => p.username === s.user.username);
    const entry = {
      username:    s.user.username,
      displayName: s.user.displayName || s.user.username,
      avatarEmoji: avatarEmojiFor(s.user.username),
      session:     s, // full session blob; the token lives here
      savedAt:     Date.now()
    };
    if (idx >= 0) fam[idx] = entry;
    else fam.unshift(entry);
    // Cap to MAX_PROFILES — drop oldest by savedAt.
    if (fam.length > MAX_PROFILES) {
      fam.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
      fam.length = MAX_PROFILES;
    }
    saveFamily(fam);
  }

  function switchTo(username) {
    if (!username) return;
    const fam = loadFamily();
    const entry = fam.find(p => p.username === username);
    if (!entry || !entry.session) return;
    // Snapshot the active session first so we don't lose its token.
    snapshot();
    setSession(entry.session);
    // Reload — all auth-aware modules (achievements sync, lake events,
    // etc.) pick up the new identity cleanly on a fresh page load.
    location.reload();
  }

  function remove(username) {
    const fam = loadFamily().filter(p => p.username !== username);
    saveFamily(fam);
  }

  // Auto-snapshot on every auth change so the current kid is always in
  // the family list. Listener fires on login + logout; we only snapshot
  // when there IS a user.
  document.addEventListener('gradeearn:auth-changed', (e) => {
    if (e.detail && e.detail.user) {
      // Defer so auth.js finishes writing the session first.
      setTimeout(snapshot, 50);
    }
  });

  // Best-effort initial snapshot on load (covers pages where auth was
  // already established before this module loaded).
  setTimeout(() => {
    const s = loadSession();
    if (s && s.user) snapshot();
  }, 200);

  window.GEFamily = { list, snapshot, switchTo, remove };
})();
