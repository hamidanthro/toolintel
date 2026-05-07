// GradeEarn — Speech (Phase 1)
// Web Speech API wrapper with iOS Safari quirk handling.
// Public surface: window.Speech.{ play, stop, isPlaying, current,
//                                  onStateChange, _normalize, _isSupported,
//                                  _getVoice }
//
// Design rules (Owners' Room §73):
// - ONE global utterance at a time. play() cancels any in-flight one.
// - tap to play, tap to stop. NEVER auto-play.
// - Pre-normalize text: numbers → words, math operators → words.
// - iOS Safari: voiceschanged is async; speak() must be inside a
//   click handler; cancel() before every speak() to flush stale state.
// - Silent on unsupported browsers (caller hides the button).

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
  function _isSupported() { return SUPPORTED; }

  // play(text, opts?) — returns Promise that resolves when speech ends
  // or rejects-quietly on error (we still resolve for callers).
  function play(text, opts) {
    if (!SUPPORTED) return Promise.resolve();
    const o = opts || {};
    const synth = window.speechSynthesis;

    // Cancel any in-flight utterance. iOS sometimes leaks state; do it
    // unconditionally rather than checking isPlaying() (which can lie
    // after a screen-lock).
    try { synth.cancel(); } catch (_) {}
    _current = null;
    _setState('idle');

    const normalized = _normalize(text);
    if (!normalized) return Promise.resolve();

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
    if (!SUPPORTED) return;
    try { window.speechSynthesis.cancel(); } catch (_) {}
    _current = null;
    _setState('idle');
  }

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
    _normalize, _isSupported, _getVoice
  };
})();
