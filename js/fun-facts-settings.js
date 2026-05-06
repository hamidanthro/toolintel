// GradeEarn — Fun Facts Phase 4 — Settings panel logic
// Wires the segmented frequency picker + pause toggle on settings.html
// to window.FunFacts.{getFrequency, setFrequency, _getSeenIds}.
// Changes are instant: setFrequency() handles localStorage + DDB write.

(function () {
  'use strict';

  function init() {
    const segmentsEl  = document.getElementById('ff-freq-segments');
    const toggleEl    = document.getElementById('ff-pause-toggle');
    const seenCountEl = document.getElementById('ff-seen-count');
    if (!segmentsEl || !toggleEl || !seenCountEl) return;
    if (!window.FunFacts) {
      console.warn('[settings] FunFacts module not loaded');
      return;
    }

    // Holds the kid's prior frequency before pausing so unpause can
    // restore exactly what was selected (vs always falling back to Auto).
    let priorFreqBeforePause = null;

    function render() {
      const freq = window.FunFacts.getFrequency();      // 1|5|10|25|'paused'|undefined
      const isPaused = (freq === 'paused');

      // Segments: 'auto' = no override (undefined/null), else number.
      const activeFreq = isPaused
        ? null
        : (freq == null ? 'auto' : String(freq));

      segmentsEl.querySelectorAll('.ff-segment').forEach(btn => {
        const isActive = (btn.dataset.freq === activeFreq);
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
        btn.setAttribute('tabindex', isActive ? '0' : '-1');
      });
      // Visually fade segments + block clicks while paused.
      segmentsEl.classList.toggle('ff-segments-disabled', isPaused);

      // Toggle visual + ARIA.
      toggleEl.classList.toggle('ff-toggle-on', isPaused);
      toggleEl.setAttribute('aria-checked', isPaused ? 'true' : 'false');

      // Seen count subtitle.
      const seen = (typeof window.FunFacts._getSeenIds === 'function')
        ? window.FunFacts._getSeenIds()
        : [];
      seenCountEl.textContent = String(seen.length);
    }

    function setFreqSafe(value) {
      try { window.FunFacts.setFrequency(value); }
      catch (err) {
        console.warn('[settings] setFrequency rejected:', err && err.message || err);
      }
    }

    // Frequency segment click → set + render.
    segmentsEl.addEventListener('click', e => {
      const btn = e.target.closest('.ff-segment');
      if (!btn) return;
      // If currently paused, segment click also unpauses (clears 'paused').
      const freq = btn.dataset.freq;
      if (freq === 'auto') {
        // null → fun-facts.js setFrequency clears the override (server-side
        // REMOVE funFactsFreq via updateFunFactsState's setFrequency:null path).
        setFreqSafe(null);
      } else {
        const n = parseInt(freq, 10);
        if (Number.isFinite(n)) setFreqSafe(n);
      }
      // Segment selection always exits paused state.
      priorFreqBeforePause = null;
      render();
    });

    // Keyboard: arrow-left/right cycle segments (radiogroup convention).
    segmentsEl.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const segs = Array.from(segmentsEl.querySelectorAll('.ff-segment'));
      const cur = segs.findIndex(b => b.classList.contains('active'));
      const dir = (e.key === 'ArrowRight') ? 1 : -1;
      const next = (cur + dir + segs.length) % segs.length;
      e.preventDefault();
      segs[next].click();
      segs[next].focus();
    });

    // Pause toggle: setFrequency('paused') ↔ restore prior.
    toggleEl.addEventListener('click', () => {
      const currentFreq = window.FunFacts.getFrequency();
      if (currentFreq === 'paused') {
        // Unpause — restore prior freq (null = Auto).
        setFreqSafe(priorFreqBeforePause == null ? null : priorFreqBeforePause);
        priorFreqBeforePause = null;
      } else {
        priorFreqBeforePause = currentFreq;     // may be undefined (Auto), 1, 5, 10, 25
        setFreqSafe('paused');
      }
      render();
    });

    // Initial render.
    render();

    // Server hydration is async on sign-in (auth.js fires-and-forgets
    // getFunFactsState → _hydrateFromServer). If we're signed in, the
    // initial render may show stale localStorage state for ~few hundred
    // ms. Re-render once after a beat so server values land.
    if (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) {
      setTimeout(render, 800);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
