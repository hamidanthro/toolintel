// GradeEarn — Speech (Phase 2 — cloud TTS additive)
// Web Speech API wrapper with iOS Safari quirk handling, plus a Google
// Cloud TTS path (Neural2-F) that's the default with browser fallback.
//
// Public surface: window.Speech.{ play, stop, isPlaying, current,
//                                  onStateChange, _normalize, _isSupported,
//                                  _getVoice, mode, setMode }
//
// Design rules (Owners' Room §73 + §76 cloud):
// - ONE global utterance at a time. play() cancels any in-flight one.
// - tap to play, tap to stop. NEVER auto-play.
// - Pre-normalize text BEFORE sending to either engine so math content
//   reads consistently.
// - mode='auto' (default): try cloud TTS via lambda → fall back to
//   browser on any failure (network, 5xx, audio error, expired URL).
// - mode='cloud': cloud only. mode='browser': browser only (legacy).
// - State machine is shared between both engines — onStateChange and
//   isPlaying() work identically regardless of source.
// - iOS Safari: voiceschanged is async; speak() must be inside a
//   click handler; cancel() before every speak() to flush stale state.
//   Cloud audio doesn't have the same quirks.
// - Silent on unsupported browsers (caller hides the button).
//
// TODO (deferred):
// - STAARAuth.cloudTtsEnabled() gate for Pro-tier subscription rollout.
//   Currently always true (Phase 3 deferred per Hamid + Owners' Room).
// - Per-user rate limit (50 cloud plays/day) — server-side.
// - Word-level highlighting via boundary events (cloud TTS doesn't
//   surface them; would need timepoint metadata or chunked synthesis).

(function () {
  'use strict';

  const SUPPORTED = typeof window !== 'undefined' && !!window.speechSynthesis;

  // ----- voice cache -----
  let _voicesLoaded = false;
  let _cachedVoice = null;

  function _ensureVoices() {
    if (!SUPPORTED || _voicesLoaded) return;
    const v = window.speechSynthesis.getVoices();
    if (v && v.length) {
      _voicesLoaded = true;
      _cachedVoice = _pickPreferred(v);
    }
  }
  if (SUPPORTED) {
    _ensureVoices();
    // iOS / Chrome populate voices async. Listen once.
    if (!_voicesLoaded && typeof window.speechSynthesis.addEventListener === 'function') {
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        _voicesLoaded = false;
        _ensureVoices();
      });
    } else if (!_voicesLoaded && 'onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => {
        _voicesLoaded = false;
        _ensureVoices();
      };
    }
  }

  // Prefer en-US, then a known kid-friendly voice.
  function _pickPreferred(voices) {
    const enUs = voices.filter(v => /^en[-_]US$/i.test(v.lang));
    const pool = enUs.length ? enUs : voices.filter(v => /^en/i.test(v.lang));
    if (pool.length === 0) return null;
    const namedPreference = ['Samantha', 'Google US English', 'Karen', 'Allison', 'Ava'];
    for (const name of namedPreference) {
      const hit = pool.find(v => v.name === name || v.name.includes(name));
      if (hit) return hit;
    }
    // Heuristic — female-leaning voice if name hints
    const fem = pool.find(v => /female/i.test(v.name) || /woman/i.test(v.name));
    return fem || pool[0];
  }

  function _getVoice() {
    _ensureVoices();
    return _cachedVoice;
  }

  // ----- number-to-words -----
  // Range 0–999,999,999. Caller-passed strings outside this range
  // are returned as-is (the Web Speech engine will read digit-by-digit
  // which is fine fallback).
  const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine',
                'ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen',
                'seventeen','eighteen','nineteen'];
  const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];

  function _under1000ToWords(n) {
    if (n < 20) return ONES[n];
    if (n < 100) {
      const t = Math.floor(n / 10), o = n % 10;
      return TENS[t] + (o ? '-' + ONES[o] : '');
    }
    const h = Math.floor(n / 100), rest = n % 100;
    return ONES[h] + ' hundred' + (rest ? ' ' + _under1000ToWords(rest) : '');
  }

  function _intToWords(n) {
    n = Number(n);
    if (!Number.isFinite(n) || n < 0) return String(n);
    if (n === 0) return 'zero';
    if (n > 999999999) return String(n);
    const parts = [];
    const billion = Math.floor(n / 1000000000);
    if (billion) { parts.push(_under1000ToWords(billion) + ' billion'); n %= 1000000000; }
    const million = Math.floor(n / 1000000);
    if (million) { parts.push(_under1000ToWords(million) + ' million'); n %= 1000000; }
    const thousand = Math.floor(n / 1000);
    if (thousand) { parts.push(_under1000ToWords(thousand) + ' thousand'); n %= 1000; }
    if (n) parts.push(_under1000ToWords(n));
    return parts.join(' ');
  }

  function _decimalToWords(intPart, fracPart) {
    const intWords = _intToWords(intPart);
    // Decimals after the point: read each digit individually
    // ("0.45" → "zero point four five"). Strip trailing zeros? No —
    // mathematically meaningful in some contexts.
    const fracDigits = fracPart.split('').map(d => ONES[Number(d)] || d).join(' ');
    return intWords + ' point ' + fracDigits;
  }

  // Pure normalize. Order matters — numbers BEFORE operators so
  // "53 × 4 = 212" doesn't lose its operands.
  function _normalize(text) {
    if (text == null) return '';
    let s = String(text);

    // 1. Decimals (1-3 fractional digits) before plain integers
    //    so "0.5" doesn't become "zero . five".
    s = s.replace(/(\d{1,3}(?:,\d{3})+|\d+)\.(\d+)\b/g, (m, intStr, fracStr) => {
      const cleanedInt = intStr.replace(/,/g, '');
      const intN = parseInt(cleanedInt, 10);
      if (!Number.isFinite(intN)) return m;
      return _decimalToWords(intN, fracStr);
    });

    // 2. Numbers with commas (1,234 / 271,142). Skip if alphanumeric
    //    label like "TEKS 3.4B" — already handled by the decimal pass
    //    or out of this regex's grasp.
    s = s.replace(/\b\d{1,3}(?:,\d{3})+\b/g, m => {
      const n = parseInt(m.replace(/,/g, ''), 10);
      return Number.isFinite(n) ? _intToWords(n) : m;
    });

    // 3. Plain integers ≥10. Leave 0–9 alone (already pronounceable
    //    and avoids breaking "TEKS 3.4B" or single-digit choices).
    //    Only convert when the digits are a standalone token.
    s = s.replace(/\b\d{2,}\b/g, m => {
      const n = parseInt(m, 10);
      return Number.isFinite(n) ? _intToWords(n) : m;
    });

    // 4. Math operators (do AFTER numbers so we don't munge things).
    s = s.replace(/×/g, ' times ');
    s = s.replace(/÷/g, ' divided by ');
    s = s.replace(/(\d)\s*\*\s*(\d)/g, '$1 times $2');
    s = s.replace(/(\d)\s*\/\s*(\d)/g, '$1 divided by $2');
    s = s.replace(/\+/g, ' plus ');
    s = s.replace(/−/g, ' minus ');
    // ASCII hyphen used as subtraction (between two operands), but
    // leave compound words ("ice-cream") and negative leads alone.
    s = s.replace(/(\w)\s+-\s+(\w)/g, '$1 minus $2');
    s = s.replace(/=/g, ' equals ');
    s = s.replace(/</g, ' less than ');
    s = s.replace(/>/g, ' greater than ');

    // 5. Common units — only when directly preceded by a number-word
    //    (we just expanded numbers, so check for a trailing space + the unit).
    s = s.replace(/(\b[a-z]+)\s+cm\b/gi, '$1 centimeters');
    s = s.replace(/(\b[a-z]+)\s+mm\b/gi, '$1 millimeters');
    s = s.replace(/(\b[a-z]+)\s+km\b/gi, '$1 kilometers');
    s = s.replace(/(\b[a-z]+)\s+ft\b/gi, '$1 feet');
    s = s.replace(/(\b[a-z]+)\s+lb\b/gi, '$1 pounds');
    s = s.replace(/(\b[a-z]+)\s+oz\b/gi, '$1 ounces');
    s = s.replace(/(\b[a-z]+)\s+in\.\B/gi, '$1 inches');

    // 6. Collapse double spaces left by replacements.
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
  }

  // ----- state machine + subscribers -----
  let _state = 'idle';                  // 'idle' | 'playing' | 'error'
  let _current = null;                  // SpeechSynthesisUtterance | null
  const _subs = new Set();

  function _setState(next) {
    if (_state === next) return;
    _state = next;
    for (const cb of Array.from(_subs)) {
      try { cb(next); } catch (_) {}
    }
  }

  function onStateChange(cb) {
    if (typeof cb !== 'function') return () => {};
    _subs.add(cb);
    return () => _subs.delete(cb);
  }

  function isPlaying() { return _state === 'playing'; }
  function current() { return _current; }
  // §76 — cloud TTS counts as supported even when browser TTS isn't.
  // Caller hides the speaker button if neither path can produce audio.
  function _isSupported() {
    if (SUPPORTED) return true;
    return !!(typeof fetch === 'function' && _ttsEndpoint());
  }

  // play(text, opts?) — returns Promise that resolves when speech ends
  // or rejects-quietly on error (we still resolve for callers).
  //
  // opts.mode: 'auto' (default; cloud first, browser fallback) |
  //            'cloud' (cloud only, no fallback) |
  //            'browser' (legacy: browser only)
  async function play(text, opts) {
    const o = opts || {};
    const requestedMode = (o.mode && (o.mode === 'auto' || o.mode === 'cloud' || o.mode === 'browser'))
      ? o.mode : _mode;

    // Stop anything in flight (cloud audio + browser utterance).
    stop();

    const normalized = _normalize(text);
    if (!normalized) return;

    // Cloud first if mode allows. _ttsEndpoint() returns '' if no
    // endpoint is configured — fall straight to browser in that case.
    const cloudAvailable = !!_ttsEndpoint();
    const tryCloud = cloudAvailable && (requestedMode === 'auto' || requestedMode === 'cloud');
    if (tryCloud) {
      const ok = await _playCloud(normalized, o);
      if (ok) return;                              // cloud completed (or was stopped)
      if (requestedMode === 'cloud') return;       // cloud-only mode — give up silently
      // else fall through to browser fallback
    }

    return _playBrowser(normalized, o);
  }

  // Browser TTS path (the original implementation, factored out so
  // _playCloud can fall through to it). Returns the same Promise<void>
  // shape as play() expected.
  function _playBrowser(normalized, o) {
    if (!SUPPORTED) return Promise.resolve();
    const synth = window.speechSynthesis;

    // Cancel any in-flight utterance. iOS sometimes leaks state; do it
    // unconditionally rather than checking isPlaying() (which can lie
    // after a screen-lock).
    try { synth.cancel(); } catch (_) {}
    _current = null;
    _setState('idle');

    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(normalized);
      u.rate  = (typeof o.rate  === 'number') ? o.rate  : 1.0;
      u.pitch = (typeof o.pitch === 'number') ? o.pitch : 1.0;
      u.volume = (typeof o.volume === 'number') ? o.volume : 1.0;
      const v = o.voice || _getVoice();
      if (v) u.voice = v;

      u.onstart = () => {
        _current = u;
        _setState('playing');
      };
      const finish = () => {
        if (_current === u) _current = null;
        _setState('idle');
        resolve();
      };
      u.onend   = finish;
      // iOS sometimes fires error on cancel; treat as success per spec.
      u.onerror = (e) => {
        // Don't surface to UI — silent fallback.
        finish();
      };
      if (typeof o.onWord === 'function') {
        u.onboundary = ev => {
          try { o.onWord({ charIndex: ev.charIndex, name: ev.name }); } catch (_) {}
        };
      }

      // Defensive: if onstart never fires (some iOS race), nudge state.
      // Web Speech spec says onstart fires before audio output begins;
      // if synth.speaking is true synchronously after speak(), that's
      // a strong proxy.
      try { synth.speak(u); } catch (err) {
        finish();
      }
      // Some Safari builds miss onstart entirely. Hint the state if
      // synth.speaking flips true within a frame.
      requestAnimationFrame(() => {
        if (_state === 'idle' && synth.speaking && _current === null) {
          _current = u;
          _setState('playing');
        }
      });
    });
  }

  function stop() {
    if (SUPPORTED) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
    // §76 — also stop any cloud audio in-flight
    if (_cloudAudio) {
      try {
        _cloudAudio.pause();
        _cloudAudio.src = '';
        _cloudAudio.removeAttribute('src');
        _cloudAudio.load();
      } catch (_) {}
      _cloudAudio = null;
    }
    if (_cloudAbort) {
      try { _cloudAbort.abort(); } catch (_) {}
      _cloudAbort = null;
    }
    _current = null;
    _setState('idle');
  }

  // ============================================================
  // §76 — Cloud TTS (Google Neural2 via lambda /tts)
  // ============================================================
  //
  // Failure cascade (per Owners' Room): on ANY cloud failure
  // (fetch fail, 5xx, audio.error, expired URL), silently fall back
  // to browser TTS. Cloud is additive; browser stays the safety net.

  let _mode = 'auto';                 // 'auto' | 'cloud' | 'browser'
  let _cloudAudio = null;             // <audio> element in flight
  let _cloudAbort = null;             // AbortController for the fetch
  const CLOUD_FETCH_TIMEOUT_MS = 8000;
  const CLOUD_DEFAULT_VOICE = 'en-US-Neural2-F';

  function _ttsEndpoint() {
    // Accept an explicit override; otherwise derive from the existing
    // tutor endpoint (same API GW, /tts path).
    if (typeof window.STAAR_TTS_ENDPOINT === 'string' && window.STAAR_TTS_ENDPOINT) {
      return window.STAAR_TTS_ENDPOINT;
    }
    const base = (typeof window.STAAR_TUTOR_ENDPOINT === 'string' && window.STAAR_TUTOR_ENDPOINT)
      ? window.STAAR_TUTOR_ENDPOINT
      : '';
    if (!base) return '';
    return base.replace(/\/+$/, '') + '/tts';
  }

  // Returns an AbortSignal that fires after ms.
  function _timeoutSignal(ms) {
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), ms);
    return ctl;
  }

  // Fetches a presigned audio URL from the lambda. Returns the URL
  // string on success, throws on any failure. Caller decides whether
  // to fall back. `signal` lets stop() cancel an in-flight request.
  async function _fetchCloudAudioUrl(text, voice, signal) {
    const url = _ttsEndpoint();
    if (!url) throw new Error('no_endpoint');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice }),
      signal
    });
    if (!res.ok) throw new Error('http_' + res.status);
    const data = await res.json();
    if (!data || !data.audioUrl) throw new Error('no_audio_url');
    return data.audioUrl;
  }

  // Plays text via cloud TTS. Returns a Promise<true> on full playback,
  // Promise<false> if a fallback is desired (any failure path).
  function _playCloud(normalizedText, opts) {
    return new Promise(async (resolve) => {
      const voice = (opts && opts.voice && typeof opts.voice === 'string')
        ? opts.voice : CLOUD_DEFAULT_VOICE;

      // 1. Fetch presigned URL
      _cloudAbort = _timeoutSignal(CLOUD_FETCH_TIMEOUT_MS);
      let audioUrl;
      try {
        audioUrl = await _fetchCloudAudioUrl(normalizedText, voice, _cloudAbort.signal);
      } catch (err) {
        _cloudAbort = null;
        if (err && err.name === 'AbortError') {
          // stop() called or timed out — finish quiet, no fallback.
          resolve(true);
          return;
        }
        console.warn('[speech] cloud fetch failed:', err.message || err);
        resolve(false);
        return;
      }
      _cloudAbort = null;

      // 2. Play via <audio>
      let triedRefresh = false;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.crossOrigin = 'anonymous';
      _cloudAudio = audio;

      audio.addEventListener('playing', () => {
        if (_cloudAudio === audio) _setState('playing');
      });
      audio.addEventListener('ended', () => {
        if (_cloudAudio === audio) {
          _cloudAudio = null;
          _setState('idle');
        }
        resolve(true);
      });
      audio.addEventListener('error', async () => {
        // Possible expired URL — try one re-fetch before giving up.
        if (!triedRefresh) {
          triedRefresh = true;
          try {
            _cloudAbort = _timeoutSignal(CLOUD_FETCH_TIMEOUT_MS);
            const fresh = await _fetchCloudAudioUrl(normalizedText, voice, _cloudAbort.signal);
            _cloudAbort = null;
            audio.src = fresh;
            audio.play().catch(() => {});
            return;
          } catch (_) {
            _cloudAbort = null;
          }
        }
        if (_cloudAudio === audio) _cloudAudio = null;
        _setState('idle');
        console.warn('[speech] cloud audio error — falling back to browser');
        resolve(false);
      });

      audio.src = audioUrl;
      try {
        await audio.play();
      } catch (err) {
        // Autoplay rejection (e.g. not in a user gesture) — fall back.
        if (_cloudAudio === audio) _cloudAudio = null;
        _setState('idle');
        console.warn('[speech] audio.play() rejected:', err.message || err);
        resolve(false);
      }
    });
  }

  // Public mode setters
  function setMode(m) {
    if (m === 'auto' || m === 'cloud' || m === 'browser') _mode = m;
  }
  function getMode() { return _mode; }

  // Auto-stop on page hide / sign-out — defense against leaked audio.
  if (SUPPORTED && typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stop();
    });
    document.addEventListener('gradeearn:auth-changed', e => {
      // auth.js dispatches this with detail.user; null means signed out.
      if (e && e.detail && e.detail.user === null) stop();
    });
  }

  window.Speech = {
    play, stop, isPlaying, current, onStateChange,
    _normalize, _isSupported, _getVoice,
    // §76 cloud TTS additions
    setMode, getMode, _playCloud, _playBrowser, _ttsEndpoint
  };
})();
