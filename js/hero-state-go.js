/**
 * GradeEarn — HERO STATE → GO
 *
 * Wires the homepage hero "Choose your state" <select> + "Go" button.
 * - Populates options from window.STATES_API.getAlphabetical().
 * - Restores last picked state from localStorage['gradeearn.state'].
 * - Enables Go only when a valid state is selected.
 * - On Go click, navigates to states/?s=<slug>.
 *
 * Desktop-only behavioral concern; no media-query work here. The
 * existing .hero-cta wrap rule lays out small viewports.
 */
(function () {
  var STORAGE_KEY = 'gradeearn.state';

  function init() {
    var sel = document.getElementById('hero-state-select');
    var go = document.getElementById('hero-go-btn');
    if (!sel || !go) return;
    if (!window.STATES_API || typeof window.STATES_API.getAlphabetical !== 'function') return;

    var states = window.STATES_API.getAlphabetical();
    var frag = document.createDocumentFragment();
    states.forEach(function (s) {
      var opt = document.createElement('option');
      opt.value = s.slug;
      opt.textContent = s.name;
      var hasLive = Array.isArray(s.subjectsAvailable) && s.subjectsAvailable.length > 0;
      if (!hasLive) {
        opt.disabled = true;
        opt.textContent = s.name + ' (coming soon)';
      }
      frag.appendChild(opt);
    });
    sel.appendChild(frag);

    // Restore last pick (only if it's a real, live state).
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && window.STATES_API.getBySlug(stored)) {
        var match = window.STATES_API.getBySlug(stored);
        var live = Array.isArray(match.subjectsAvailable) && match.subjectsAvailable.length > 0;
        if (live) {
          sel.value = stored;
          setEnabled(go, true);
        }
      }
    } catch (_) { /* localStorage may be unavailable */ }

    sel.addEventListener('change', function () {
      var v = sel.value;
      var valid = !!(v && window.STATES_API.getBySlug(v));
      setEnabled(go, valid);
    });

    go.addEventListener('click', function () {
      var v = sel.value;
      if (!v || !window.STATES_API.getBySlug(v)) return;
      try { localStorage.setItem(STORAGE_KEY, v); } catch (_) {}
      location.href = 'states/?s=' + encodeURIComponent(v);
    });
  }

  function setEnabled(btn, on) {
    if (on) {
      btn.removeAttribute('disabled');
      btn.setAttribute('aria-disabled', 'false');
    } else {
      btn.setAttribute('disabled', '');
      btn.setAttribute('aria-disabled', 'true');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
