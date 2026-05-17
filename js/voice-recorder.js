/**
 * GradeEarn — kid voice recorder for reading-fluency practice
 *
 * Mount-on-demand recorder for the reading passage card. Kid taps a
 * mic button, speaks the passage aloud, taps stop, plays it back.
 *
 * Storage: local Blob in memory only. Nothing leaves the device today;
 * a future commit adds optional S3 upload for parent listen-back.
 *
 * Exposed as window.GEVoice.
 *   GEVoice.mount(container, options)
 *     options.maxDurationSec  default 90
 *     options.onChange        callback({state, blobUrl?, durationSec?})
 *
 * Browser support: requires MediaRecorder + getUserMedia. Falls back to
 * a "Voice recording isn't available on this device" notice on older
 * browsers (especially Safari before 14.1 and Chrome before 47).
 */
(function () {
  'use strict';

  function supported() {
    return !!(window.MediaRecorder &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function');
  }

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }

  function mount(container, options) {
    options = options || {};
    const maxDuration = Number.isFinite(options.maxDurationSec) ? options.maxDurationSec : 90;
    const onChange = typeof options.onChange === 'function' ? options.onChange : function () {};

    container.innerHTML = '';
    container.classList.add('voice-recorder');

    if (!supported()) {
      container.innerHTML = '<div class="voice-recorder-unavail">Voice recording isn\'t available on this device.</div>';
      return { destroy: function () {} };
    }

    // State
    let stream = null;
    let recorder = null;
    let chunks = [];
    let blobUrl = null;
    let durationSec = 0;
    let startedAt = 0;
    let tickTimer = null;
    let state = 'idle'; // 'idle' | 'recording' | 'recorded'

    function setState(s) { state = s; render(); onChange({ state: s, blobUrl: blobUrl, durationSec: durationSec }); }

    function cleanupStream() {
      if (stream) {
        try { stream.getTracks().forEach(t => t.stop()); } catch (_) {}
        stream = null;
      }
    }

    function revokeBlob() {
      if (blobUrl) {
        try { URL.revokeObjectURL(blobUrl); } catch (_) {}
        blobUrl = null;
      }
    }

    async function startRecording() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        container.innerHTML = '<div class="voice-recorder-unavail">Microphone permission is needed to record your reading.</div>';
        return;
      }
      chunks = [];
      revokeBlob();
      try {
        recorder = new MediaRecorder(stream);
      } catch (e) {
        cleanupStream();
        container.innerHTML = '<div class="voice-recorder-unavail">Recording isn\'t supported in this browser.</div>';
        return;
      }
      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = function () {
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          blobUrl = URL.createObjectURL(blob);
        } catch (_) {}
        cleanupStream();
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        durationSec = Math.round((Date.now() - startedAt) / 1000);
        setState('recorded');
      };
      try {
        recorder.start();
      } catch (e) {
        cleanupStream();
        return;
      }
      startedAt = Date.now();
      durationSec = 0;
      setState('recording');
      tickTimer = setInterval(function () {
        durationSec = Math.round((Date.now() - startedAt) / 1000);
        if (durationSec >= maxDuration) {
          stopRecording();
        } else {
          render();
        }
      }, 500);
    }

    function stopRecording() {
      if (!recorder || recorder.state !== 'recording') return;
      try { recorder.stop(); } catch (_) {}
    }

    function reset() {
      revokeBlob();
      durationSec = 0;
      setState('idle');
    }

    // While 'recording' we also paint a fixed-bottom bar attached to
    // <body> so the timer + Stop button are reachable no matter how
    // far the kid has scrolled into the passage. This is the same
    // pattern that audio recording apps + Voice Memos use.
    function paintFixedBar() {
      removeFixedBar();
      const bar = document.createElement('div');
      bar.className = 'voice-rec-fixed';
      bar.setAttribute('role', 'status');
      bar.setAttribute('aria-live', 'polite');
      bar.innerHTML =
        '<span class="voice-rec-pulse" aria-hidden="true"></span>' +
        '<span class="voice-rec-fixed-label">Recording</span>' +
        '<span class="voice-rec-time" data-role="vr-time">' + fmtTime(durationSec) + '</span>' +
        '<button type="button" class="voice-rec-btn voice-rec-stop" aria-label="Stop recording">Stop</button>';
      bar.querySelector('.voice-rec-stop').addEventListener('click', stopRecording);
      document.body.appendChild(bar);
      document.body.classList.add('voice-recording-active');
    }
    function updateFixedBarTime() {
      const t = document.querySelector('.voice-rec-fixed .voice-rec-time');
      if (t) t.textContent = fmtTime(durationSec);
    }
    function removeFixedBar() {
      const existing = document.querySelector('.voice-rec-fixed');
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      document.body.classList.remove('voice-recording-active');
    }

    function render() {
      if (state === 'idle') {
        removeFixedBar();
        // §120 — when mounted with data-icon-only="1" (passage card
        // audio row), render a compact Tabler-microphone-only button
        // matched to the Listen-button shape. Default render keeps
        // the pill with the OS emoji for back-compat with other
        // surfaces that mount the recorder.
        const iconOnly = container.getAttribute('data-icon-only') === '1';
        // §131 — `data-mini-label` (when paired with data-icon-only)
        // renders an icon + short label pill ("Read") matching the
        // §131 Listen button shape. Default icon-only stays bare.
        const miniLabel = container.getAttribute('data-mini-label') || '';
        const TI_MIC = '<svg class="voice-rec-icon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
        if (iconOnly && miniLabel) {
          container.innerHTML =
            '<button type="button" class="voice-rec-btn voice-rec-start" aria-label="Record yourself reading the passage" title="Record">' +
              TI_MIC +
              '<span class="voice-rec-label">' + miniLabel + '</span>' +
            '</button>';
        } else if (iconOnly) {
          container.innerHTML =
            '<button type="button" class="voice-rec-btn voice-rec-start" aria-label="Record yourself reading" title="Record">' +
              TI_MIC +
            '</button>';
        } else {
          container.innerHTML =
            '<button type="button" class="voice-rec-btn voice-rec-start" aria-label="Start recording">' +
              '<span class="voice-rec-icon" aria-hidden="true">' + TI_MIC + '</span>' +
              '<span class="voice-rec-label">Record yourself reading</span>' +
            '</button>';
        }
        container.querySelector('.voice-rec-start').addEventListener('click', startRecording);
        return;
      }
      if (state === 'recording') {
        // §86 — Stop button + time live INLINE next to the recording
        // indicator. The old fixed-bottom bar is gone — user explicitly
        // asked for Stop next to the indicator, not at viewport bottom.
        // Reachability is fine: the recorder slot sits at the TOP of
        // the passage card, the passage card is sticky on desktop and
        // scrolls internally on mobile, so the Stop button never goes
        // off-screen.
        removeFixedBar();
        const existingTime = container.querySelector('[data-role="vr-time"]');
        if (existingTime) {
          // In-place time update — preserves the click listener on the
          // Stop button (don't blow away innerHTML on every tick).
          existingTime.textContent = fmtTime(durationSec);
          return;
        }
        container.innerHTML =
          '<div class="voice-rec-inline-recording" role="status" aria-live="polite">' +
            '<span class="voice-rec-pulse" aria-hidden="true"></span>' +
            '<span class="voice-rec-fixed-label">Recording</span>' +
            '<span class="voice-rec-time" data-role="vr-time">' + fmtTime(durationSec) + '</span>' +
            '<button type="button" class="voice-rec-btn voice-rec-stop voice-rec-stop-inline" aria-label="Stop recording">Stop</button>' +
          '</div>';
        const stopBtn = container.querySelector('.voice-rec-stop');
        if (stopBtn) stopBtn.addEventListener('click', stopRecording);
        return;
      }
      if (state === 'recorded') {
        removeFixedBar();
        container.innerHTML =
          '<div class="voice-rec-recorded">' +
            '<audio class="voice-rec-audio" controls preload="metadata" src="' + (blobUrl || '') + '"></audio>' +
            '<div class="voice-rec-actions">' +
              '<button type="button" class="voice-rec-btn voice-rec-redo" aria-label="Record again">⟲ Redo</button>' +
            '</div>' +
          '</div>';
        container.querySelector('.voice-rec-redo').addEventListener('click', reset);
        return;
      }
    }

    render();

    return {
      destroy: function () {
        if (recorder && recorder.state === 'recording') {
          try { recorder.stop(); } catch (_) {}
        }
        if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
        cleanupStream();
        revokeBlob();
        removeFixedBar();
        container.innerHTML = '';
      }
    };
  }

  window.GEVoice = {
    supported: supported,
    mount: mount
  };
})();
