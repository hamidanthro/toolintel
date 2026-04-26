// STAAR Prep — user preferences (sound, read-aloud, dyslexia font, daily goal).
// Stored locally per-browser. Applied on every page load via init().
(function () {
  const KEY = 'staar.prefs';
  const DEFAULTS = {
    sound: true,
    haptics: true,
    readAloud: false,        // show the 🔊 button on questions
    dyslexiaFont: false,
    dailyGoal: 5,
    largeText: false,
    confetti: true
  };

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
      return Object.assign({}, DEFAULTS, raw);
    } catch (_) { return Object.assign({}, DEFAULTS); }
  }
  function save(p) {
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch (_) {}
  }
  function get() { return load(); }
  function set(patch) {
    const p = Object.assign(load(), patch || {});
    save(p);
    apply(p);
    window.dispatchEvent(new CustomEvent('staar:prefs-changed', { detail: p }));
    return p;
  }
  function apply(p) {
    p = p || load();
    const b = document.body;
    if (!b) return;
    b.classList.toggle('pref-dyslexia', !!p.dyslexiaFont);
    b.classList.toggle('pref-large-text', !!p.largeText);
  }
  function init() {
    apply(load());
    document.addEventListener('DOMContentLoaded', () => apply(load()));
  }

  window.STAARPrefs = { get, set, apply, DEFAULTS };
  init();
})();
