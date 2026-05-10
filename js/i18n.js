// GradeEarn — internationalization (i18n).
// Texas-only product but ~half of Texas families speak Spanish at
// home. STAAR is also available in Spanish for ELL kids in grades 3-5.
// This module localizes the parent-facing chrome (nav, settings,
// dashboards, errors). Practice content (questions, passages, fun
// facts) stays in English for now — that's what STAAR Math is given
// in. Parent / chrome translation is the high-value target.
//
// Public API:
//   window.I18n.lang()           → current lang code ('en' | 'es')
//   window.I18n.setLang(code)    → switch language; persists in localStorage
//   window.I18n.t(key, fallback) → look up translation (string)
//   window.I18n.applyToPage()    → walks DOM, fills data-i18n[*] attrs
//   window.I18n.onChange(cb)     → subscribe to lang change
//
// HTML usage:
//   <h2 data-i18n="settings.title">Settings</h2>
//   <a data-i18n="nav.home">Home</a>
//   <input data-i18n-placeholder="form.email" placeholder="Email" />
//   <button data-i18n-aria-label="btn.menu" aria-label="Menu" />
//
// On `applyToPage()`, every element with a data-i18n attribute gets
// its visible text or attribute replaced with the looked-up string.
// Default text in the HTML is the EN fallback (so the page works
// before JS, and works if a translation key is missing).

(function () {
  'use strict';

  const LS_LANG = 'gradeearn:lang';
  const SUPPORTED = ['en', 'es'];
  const DEFAULT_LANG = 'en';

  let _lang = null;
  let _bundles = {};   // { en: {...}, es: {...} }
  let _loading = {};
  const _changeCallbacks = [];

  // Detect from localStorage > <html lang> > navigator > default
  function detectLang() {
    try {
      const stored = localStorage.getItem(LS_LANG);
      if (stored && SUPPORTED.indexOf(stored) >= 0) return stored;
    } catch (_) {}
    const htmlLang = (document.documentElement.getAttribute('lang') || '').slice(0, 2).toLowerCase();
    if (SUPPORTED.indexOf(htmlLang) >= 0) return htmlLang;
    const nav = (navigator.language || navigator.userLanguage || '').slice(0, 2).toLowerCase();
    if (SUPPORTED.indexOf(nav) >= 0) return nav;
    return DEFAULT_LANG;
  }

  function lang() {
    if (!_lang) _lang = detectLang();
    return _lang;
  }

  async function loadBundle(code) {
    if (_bundles[code]) return _bundles[code];
    if (_loading[code]) return _loading[code];
    _loading[code] = fetch(`/data/i18n/${code}.json?v=20260510a`, { cache: 'force-cache' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('i18n ' + r.status)))
      .then(json => { _bundles[code] = json || {}; return _bundles[code]; })
      .catch(err => {
        console.warn(`[i18n] failed to load ${code}:`, err && err.message || err);
        _bundles[code] = {};
        delete _loading[code];
        return _bundles[code];
      });
    return _loading[code];
  }

  // Look up a dotted key in the active bundle. Falls back to EN bundle,
  // then to the explicit fallback arg, then to the key itself.
  function t(key, fallback) {
    if (!key) return fallback || '';
    const lookup = (bundle) => {
      let v = bundle;
      const parts = String(key).split('.');
      for (const p of parts) {
        if (v && typeof v === 'object' && v[p] !== undefined) v = v[p];
        else return undefined;
      }
      return typeof v === 'string' ? v : undefined;
    };
    const active = _bundles[lang()];
    const en = _bundles.en;
    return lookup(active) || lookup(en) || fallback || key;
  }

  // Walk the DOM and replace text on every [data-i18n] element.
  // Also handles [data-i18n-placeholder], [data-i18n-aria-label],
  // [data-i18n-title] for non-text attributes. Idempotent.
  function applyToPage(root) {
    const scope = root || document;

    // Text content
    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      const fallback = el.getAttribute('data-i18n-default') || el.textContent;
      const v = t(key, fallback);
      if (v !== el.textContent) el.textContent = v;
    });
    // Attribute variants
    [['data-i18n-placeholder', 'placeholder'],
     ['data-i18n-aria-label', 'aria-label'],
     ['data-i18n-title', 'title'],
     ['data-i18n-value', 'value']].forEach(([dataAttr, attr]) => {
      scope.querySelectorAll(`[${dataAttr}]`).forEach(el => {
        const key = el.getAttribute(dataAttr);
        const fallback = el.getAttribute(attr) || '';
        const v = t(key, fallback);
        el.setAttribute(attr, v);
      });
    });
    // <html lang>
    document.documentElement.setAttribute('lang', lang());
  }

  function setLang(code) {
    if (SUPPORTED.indexOf(code) < 0) return Promise.resolve(false);
    _lang = code;
    try { localStorage.setItem(LS_LANG, code); } catch (_) {}
    return loadBundle(code).then(() => {
      applyToPage();
      _changeCallbacks.forEach(cb => { try { cb(code); } catch (_) {} });
      return true;
    });
  }

  function onChange(cb) {
    if (typeof cb === 'function') _changeCallbacks.push(cb);
  }

  // Init: load both EN and ES bundles up-front (small JSON, ~1-3 KB each)
  // so dynamic .t() lookups never block. Then apply once on first paint.
  function init() {
    const code = lang();
    return Promise.all([loadBundle('en'), loadBundle('es')]).then(() => {
      applyToPage();
      return code;
    });
  }

  window.I18n = { lang, setLang, t, applyToPage, onChange, init, SUPPORTED };

  // Auto-init on DOMContentLoaded (or immediately if already loaded)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
