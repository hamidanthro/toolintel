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

    function render() {
      if (state === 'idle') {
        container.innerHTML =
          '<button type="button" class="voice-rec-btn voice-rec-start" aria-label="Start recording">' +
            '<span class="voice-rec-icon" aria-hidden="true">🎙️</span>' +
            '<span class="voice-rec-label">Record yourself reading</span>' +
          '</button>';
        container.querySelector('.voice-rec-start').addEventListener('click', startRecording);
        return;
      }
      if (state === 'recording') {
        container.innerHTML =
          '<div class="voice-rec-recording">' +
            '<span class="voice-rec-pulse" aria-hidden="true"></span>' +
            '<span class="voice-rec-time">' + fmtTime(durationSec) + '</span>' +
            '<button type="button" class="voice-rec-btn voice-rec-stop" aria-label="Stop recording">Stop</button>' +
          '</div>';
        container.querySelector('.voice-rec-stop').addEventListener('click', stopRecording);
        return;
      }
      if (state === 'recorded') {
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
        container.innerHTML = '';
      }
    };
  }

  window.GEVoice = {
    supported: supported,
    mount: mount
  };
})();
