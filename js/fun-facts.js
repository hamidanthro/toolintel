// GradeEarn — Fun Facts Phase 2
// Selector logic + per-user state. Caller (Phase 3 UI card) drives
// rendering and dismissal. Pure functions for testing; impure ones
// for state lifecycle.
//
// Public API: window.FunFacts (exposed at end-of-file)
// State source-of-truth: staar-users record on the lambda. localStorage
// is a write-through cache + offline fallback + guest-mode store.

(function () {
  'use strict';

  // -------- localStorage keys --------
  const LS_FREQ           = 'gradeearn:ff:freq';
  const LS_SEEN           = 'gradeearn:ff:seen';
  const LS_FIRST_SHOWN_AT = 'gradeearn:ff:firstShownAt';

  const SEEN_CAP          = 200;
  const VALID_FREQS       = [1, 5, 10, 25, 'paused'];
  const CATALOG_URL       = '/data/fun-facts.json';

  // -------- in-memory state (mirror) --------
  let _catalog = null;        // null = not loaded yet; array once fetched
  let _catalogLoading = null; // shared promise during fetch

  // Hydrated from localStorage on module load. Server hydrates over the
  // top on sign-in via _hydrateFromServer().
  const _state = loadStateFromLocalStorage();

  // -------- helpers --------

  function loadStateFromLocalStorage() {
    let freq;
    try {
      const raw = localStorage.getItem(LS_FREQ);
      if (raw === null) {
        freq = undefined;
      } else if (raw === 'paused') {
        freq = 'paused';
      } else {
        const n = parseInt(raw, 10);
        freq = (VALID_FREQS.indexOf(n) >= 0) ? n : undefined;
      }
    } catch (_) { freq = undefined; }

    let seen = [];
    try {
      const raw = localStorage.getItem(LS_SEEN);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          seen = parsed.filter(x => typeof x === 'string').slice(-SEEN_CAP);
        }
      }
    } catch (_) { seen = []; }

    let firstShownAt;
    try {
      const raw = localStorage.getItem(LS_FIRST_SHOWN_AT);
      if (raw) {
        const n = parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0) firstShownAt = n;
      }
    } catch (_) { firstShownAt = undefined; }

    return { freq, seen, firstShownAt };
  }

  function persistFreqToLocal(value) {
    try {
      if (value === undefined || value === null) {
        localStorage.removeItem(LS_FREQ);
      } else {
        localStorage.setItem(LS_FREQ, String(value));
      }
    } catch (_) {}
  }
  function persistSeenToLocal(seen) {
    try { localStorage.setItem(LS_SEEN, JSON.stringify(seen)); } catch (_) {}
  }
  function persistFirstShownAtToLocal(ts) {
    try {
      if (ts === undefined || ts === null) localStorage.removeItem(LS_FIRST_SHOWN_AT);
      else localStorage.setItem(LS_FIRST_SHOWN_AT, String(ts));
    } catch (_) {}
  }

  function _pickRandom(arr) {
    if (!arr || arr.length === 0) return null;
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function isSignedIn() {
    return !!(window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser());
  }
  function authToken() {
    return (window.STAARAuth && window.STAARAuth.token && window.STAARAuth.token()) || null;
  }

  // -------- pure decision functions --------

  // Returns true iff a fact should be picked NOW. No side effects, no I/O.
  // freq is the user's manual override (number, 'paused', or undefined).
  function _shouldShow(args) {
    const isFirstTry = !!(args && args.isFirstTry);
    const lifetimeCorrect = (args && Number.isFinite(args.lifetimeCorrect)) ? args.lifetimeCorrect : 0;
    const sessionCorrectCount = (args && Number.isFinite(args.sessionCorrectCount)) ? args.sessionCorrectCount : 0;
    const freq = (args && args.freq !== undefined) ? args.freq : undefined;

    if (!isFirstTry) return false;
    if (freq === 'paused') return false;

    const effectiveFreq = (typeof freq === 'number')
      ? freq
      : (lifetimeCorrect < 50 ? 1 : 5);

    if (effectiveFreq < 1) return false;
    return sessionCorrectCount > 0 && (sessionCorrectCount % effectiveFreq === 0);
  }

  // Pure selection. Returns a fact object from catalog, OR null.
  function _selectNext(args) {
    const catalog = (args && Array.isArray(args.catalog)) ? args.catalog : [];
    const seenIds = (args && Array.isArray(args.seenIds)) ? args.seenIds : [];
    const isFirstFactEver = !!(args && args.isFirstFactEver);

    if (catalog.length === 0) return null;
    const seen = new Set(seenIds);

    // First fact ever: Texas L1, unseen. State-pride hook.
    if (isFirstFactEver) {
      const candidates = catalog.filter(f =>
        f && f.category === 'texas' && f.wowLevel === 1 && !seen.has(f.id)
      );
      if (candidates.length) return _pickRandom(candidates);
      // Fall through if Texas L1 exhausted (shouldn't happen w/ 17 L1 + 200 cap).
    }

    let pool = catalog.filter(f => f && !seen.has(f.id));
    if (pool.length === 0) {
      // Defensive — all 352 seen. Shouldn't happen with 200-cap, but pick any L1.
      pool = catalog.filter(f => f && f.wowLevel === 1);
      return _pickRandom(pool);
    }

    // Wow-level distribution: 60% L1, 30% L2, 10% L3.
    const roll = Math.random();
    const targetLevel = roll < 0.60 ? 1 : roll < 0.90 ? 2 : 3;
    let levelPool = pool.filter(f => f.wowLevel === targetLevel);
    if (levelPool.length === 0) levelPool = pool;

    // 40% Texas-relevance bias.
    const wantTexas = Math.random() < 0.40;
    const texasPool = levelPool.filter(f => f.isTexasRelevant === true);
    const finalPool = (wantTexas && texasPool.length > 0) ? texasPool : levelPool;

    return _pickRandom(finalPool);
  }

  // -------- catalog loader --------

  function loadCatalog() {
    if (_catalog) return Promise.resolve(_catalog);
    if (_catalogLoading) return _catalogLoading;
    _catalogLoading = fetch(CATALOG_URL, { cache: 'force-cache' })
      .then(res => {
        if (!res.ok) throw new Error('catalog ' + res.status);
        return res.json();
      })
      .then(json => {
        _catalog = Array.isArray(json) ? json.filter(f => f && f.id) : [];
        return _catalog;
      })
      .catch(err => {
        // Reset loader so a future call can retry. Caller treats null as "no fact today".
        _catalogLoading = null;
        console.warn('[funFacts] catalog load failed:', err && err.message || err);
        return null;
      });
    return _catalogLoading;
  }

  // -------- public selection entry point --------

  // Synchronous decision based on cached state. If catalog isn't loaded
  // yet, kicks off load and returns null this round; next correct will
  // see it cached. This keeps the practice flow non-blocking.
  function pickFactForCorrect(ctx) {
    const args = ctx || {};
    const should = _shouldShow({
      isFirstTry: args.isFirstTry,
      lifetimeCorrect: args.lifetimeCorrect,
      sessionCorrectCount: args.sessionCorrectCount,
      freq: _state.freq
    });
    if (!should) return null;

    if (!_catalog) {
      // Lazy fire — answer will be ready next time.
      loadCatalog();
      return null;
    }

    return _selectNext({
      catalog: _catalog,
      seenIds: _state.seen,
      isFirstFactEver: !_state.firstShownAt
    });
  }

  // -------- state mutations --------

  function markFactSeen(factId) {
    if (!factId || typeof factId !== 'string') return;

    // Append + FIFO-cap locally.
    if (_state.seen.indexOf(factId) === -1) {
      _state.seen.push(factId);
      if (_state.seen.length > SEEN_CAP) {
        _state.seen = _state.seen.slice(-SEEN_CAP);
      }
      persistSeenToLocal(_state.seen);
    }

    const isFirst = !_state.firstShownAt;
    if (isFirst) {
      _state.firstShownAt = Date.now();
      persistFirstShownAtToLocal(_state.firstShownAt);
    }

    if (isSignedIn() && window.STAARAuth && window.STAARAuth.api) {
      const body = { token: authToken(), markSeen: factId };
      if (isFirst) body.setFirstShownAt = _state.firstShownAt;
      window.STAARAuth.api('updateFunFactsState', body).catch(err => {
        // Fire-and-forget; localStorage still has it. Log but don't surface.
        console.warn('[funFacts] markSeen sync failed:', err && err.message || err);
      });
    }
  }

  function getFrequency() {
    // Manual override > undefined (caller-side default applies).
    return _state.freq;
  }

  function setFrequency(value) {
    // Validate.
    let v = value;
    if (typeof v === 'string' && v !== 'paused') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) v = n;
    }
    if (VALID_FREQS.indexOf(v) === -1 && v !== undefined) {
      throw new Error('Invalid frequency: ' + value);
    }

    _state.freq = v;
    persistFreqToLocal(v);

    if (isSignedIn() && window.STAARAuth && window.STAARAuth.api) {
      window.STAARAuth.api('updateFunFactsState', {
        token: authToken(),
        setFrequency: v === undefined ? null : v
      }).catch(err => {
        console.warn('[funFacts] setFrequency sync failed:', err && err.message || err);
      });
    }
  }

  function isPaused() { return _state.freq === 'paused'; }

  function _getSeenIds() { return _state.seen.slice(); }

  // -------- server hydration --------

  // Called by auth.js after sign-in success. Server values WIN — they
  // overwrite local state + localStorage so the cross-device picture
  // is consistent.
  function _hydrateFromServer(serverState) {
    if (!serverState || typeof serverState !== 'object') return;

    if (serverState.funFactsFreq !== undefined && serverState.funFactsFreq !== null) {
      let v = serverState.funFactsFreq;
      if (typeof v === 'string' && v !== 'paused') {
        const n = parseInt(v, 10);
        if (Number.isFinite(n)) v = n;
      }
      if (VALID_FREQS.indexOf(v) >= 0) {
        _state.freq = v;
        persistFreqToLocal(v);
      }
    } else {
      _state.freq = undefined;
      persistFreqToLocal(undefined);
    }

    if (Array.isArray(serverState.funFactsSeen)) {
      _state.seen = serverState.funFactsSeen
        .filter(x => typeof x === 'string')
        .slice(-SEEN_CAP);
      persistSeenToLocal(_state.seen);
    }

    if (Number.isFinite(serverState.funFactsFirstShownAt) && serverState.funFactsFirstShownAt > 0) {
      _state.firstShownAt = serverState.funFactsFirstShownAt;
      persistFirstShownAtToLocal(_state.firstShownAt);
    } else {
      _state.firstShownAt = undefined;
      persistFirstShownAtToLocal(undefined);
    }
  }

  // Returns the local state in the shape the lambda expects, for the
  // guest-→-signup migration path. auth.js calls this just before the
  // signup API call so the new account inherits the guest's seen list +
  // frequency choice.
  function _exportLocalForSignup() {
    const out = {};
    if (_state.freq !== undefined) out.funFactsFreq = _state.freq;
    if (_state.seen && _state.seen.length) out.funFactsSeen = _state.seen.slice();
    if (_state.firstShownAt) out.funFactsFirstShownAt = _state.firstShownAt;
    return Object.keys(out).length ? out : null;
  }

  // After successful guest→signup migration, clear local guest state so
  // we don't double-apply on the next sign-in (server is now source of truth).
  function _clearLocalGuestState() {
    _state.freq = undefined;
    _state.seen = [];
    _state.firstShownAt = undefined;
    persistFreqToLocal(undefined);
    persistSeenToLocal([]);
    persistFirstShownAtToLocal(undefined);
  }

  // -------- export --------

  window.FunFacts = {
    // Public
    pickFactForCorrect,
    markFactSeen,
    getFrequency,
    setFrequency,
    isPaused,
    loadCatalog,
    // Internal — exposed for tests + auth.js wiring + Phase 3 prefetch
    _getSeenIds,
    _shouldShow,
    _selectNext,
    _hydrateFromServer,
    _exportLocalForSignup,
    _clearLocalGuestState,
    _state: _state,    // read-only-ish handle for tests
    _SEEN_CAP: SEEN_CAP,
    _VALID_FREQS: VALID_FREQS.slice()
  };
})();
