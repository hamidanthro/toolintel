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
  // Catalog version — bump when data/fun-facts.json content changes
  // so clients with cached JSON refetch. Without this, force-cache
  // keeps stale catalogs around (and K-2 kids would never see the
  // K-2-tagged facts).
  const CATALOG_URL       = '/data/fun-facts.json?v=20260510k';

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

  // K-2 grade slugs. A K-2 kid prefers gradeLevel:'k-2' facts; older
  // grades use the full catalog as before. Unknown grade = full catalog.
  const K2_GRADES = ['grade-k', 'grade-1', 'grade-2'];

  // Per-grade category preferences. A K kid lights up at concrete,
  // sensory, silly facts (animals, body, food, weird-funny). A G4
  // kid is identity-forming and likes inventions, history, mythology.
  // A middle-schooler skews toward space, robots-tech, geography.
  // The selector applies these as a 60% bias on top of the wow-level
  // and Texas filters — a K kid still occasionally sees a space fact
  // (40% of the time) so we don't over-narrow.
  //
  // Categories not in a grade's list are still reachable through the
  // 40% off-pref roll. This is a *bias*, not a hard filter.
  //
  // Gender / individual-interest axis (e.g. 9yo boy vs 9yo girl) is
  // a real signal but auto-detecting from a child's name is unreliable
  // and culturally tone-deaf. Future: parent-controlled `interests`
  // array in settings, layered over these grade defaults.
  const GRADE_CATEGORY_PREFS = {
    'grade-k':   ['animals', 'body',     'food',           'weird-funny', 'texas'],
    'grade-1':   ['animals', 'body',     'food',           'weird-funny', 'texas', 'sports'],
    'grade-2':   ['animals', 'body',     'food',           'weird-funny', 'texas', 'sports', 'dinosaurs'],
    'grade-3':   ['animals', 'dinosaurs','space',          'mythology',   'weird-funny', 'sports', 'texas'],
    'grade-4':   ['animals', 'space',    'mythology',      'inventions',  'history', 'sports', 'weird-funny', 'texas'],
    'grade-5':   ['space',   'history',  'math-numbers',   'mythology',   'inventions', 'music', 'sports'],
    'grade-6':   ['space',   'history',  'inventions',     'robots-tech', 'music', 'geography', 'math-numbers'],
    'grade-7':   ['space',   'history',  'inventions',     'robots-tech', 'music', 'geography', 'math-numbers'],
    'grade-8':   ['space',   'history',  'robots-tech',    'inventions',  'math-numbers', 'music', 'geography'],
    'algebra-1': ['space',   'history',  'robots-tech',    'inventions',  'math-numbers', 'music']
  };

  // 60% of the time, restrict to the grade's preferred categories.
  // 40% of the time, leave the pool wide open so kids still get
  // serendipity (a K kid hearing about Saturn one in five facts is
  // delightful; if the bias were 100% they'd never broaden).
  const GRADE_PREF_BIAS = 0.6;

  function _isK2(userGrade) {
    return typeof userGrade === 'string' && K2_GRADES.indexOf(userGrade) >= 0;
  }

  // Fact is K-2-suitable if its primary gradeLevel is 'k-2' OR its
  // gradeLevels array (newer multi-tag schema) includes 'k-2'. The
  // multi-tag schema lets us promote simple-vocab existing 3-4 facts
  // into the K-2 preferred pool without losing their 3-4 tag.
  function _isK2Fact(f) {
    if (!f) return false;
    if (f.gradeLevel === 'k-2') return true;
    if (Array.isArray(f.gradeLevels) && f.gradeLevels.indexOf('k-2') >= 0) return true;
    return false;
  }

  // Pure selection. Returns a fact object from catalog, OR null.
  function _selectNext(args) {
    const catalog = (args && Array.isArray(args.catalog)) ? args.catalog : [];
    const seenIds = (args && Array.isArray(args.seenIds)) ? args.seenIds : [];
    const isFirstFactEver = !!(args && args.isFirstFactEver);
    const userGrade = (args && typeof args.userGrade === 'string') ? args.userGrade : null;
    const isK2 = _isK2(userGrade);

    if (catalog.length === 0) return null;
    const seen = new Set(seenIds);

    // First fact ever: Texas L1, unseen. State-pride hook. For K-2 kids,
    // prefer K-2-tagged Texas L1 first; fall back to any Texas L1.
    if (isFirstFactEver) {
      let candidates = catalog.filter(f =>
        f && f.category === 'texas' && f.wowLevel === 1 && !seen.has(f.id)
      );
      if (isK2) {
        const k2Cands = candidates.filter(_isK2Fact);
        if (k2Cands.length) return _pickRandom(k2Cands);
      }
      if (candidates.length) return _pickRandom(candidates);
      // Fall through if Texas L1 exhausted (shouldn't happen w/ 17 L1 + 200 cap).
    }

    let pool = catalog.filter(f => f && !seen.has(f.id));
    if (pool.length === 0) {
      // Defensive — all seen. Shouldn't happen with 200-cap, but pick any L1.
      pool = catalog.filter(f => f && f.wowLevel === 1);
      return _pickRandom(pool);
    }

    // K-2 preference: if the kid is K-2 AND there are still unseen K-2
    // facts in the pool, restrict to those. The general 3-4 catalog uses
    // 6-12-word vocab and concepts (estivation, photosynthesis, "Pledge
    // of Allegiance") that's above a kindergartener's reading level.
    // Once a K-2 kid has seen every k-2 fact, the pool naturally widens
    // to the full catalog — by then they've seen 30+ facts and have
    // grown into the wider vocabulary.
    if (isK2) {
      const k2Pool = pool.filter(_isK2Fact);
      if (k2Pool.length > 0) pool = k2Pool;
    }

    // Wow-level distribution: 60% L1, 30% L2, 10% L3.
    const roll = Math.random();
    const targetLevel = roll < 0.60 ? 1 : roll < 0.90 ? 2 : 3;
    let levelPool = pool.filter(f => f.wowLevel === targetLevel);
    if (levelPool.length === 0) levelPool = pool;

    // Grade-specific category bias. 60% of the time, restrict to the
    // grade's preferred categories. 40% of the time leave the pool
    // wide open so a K kid still sometimes sees space facts and a G7
    // kid still sometimes sees animals — serendipity matters.
    const gradePrefs = GRADE_CATEGORY_PREFS[userGrade] || null;
    let workingPool = levelPool;
    if (gradePrefs && Math.random() < GRADE_PREF_BIAS) {
      const prefSet = new Set(gradePrefs);
      const prefPool = levelPool.filter(f => f && prefSet.has(f.category));
      if (prefPool.length > 0) workingPool = prefPool;
    }

    // §74 — 15% Texas-relevance bias (was 40%; produced ~46% effective
    // hit rate against a 10% Texas catalog — felt Texas-only). 15% gives
    // a state-pride bump above the 10% baseline without takeover. After
    // Phase 5 expands the catalog to ~5% Texas, this lands at ~17%
    // effective — healthy pride boost on a deep global catalog.
    const wantTexas = Math.random() < 0.15;
    const texasPool = workingPool.filter(f => f.isTexasRelevant === true);
    const finalPool = (wantTexas && texasPool.length > 0) ? texasPool : workingPool;

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
      isFirstFactEver: !_state.firstShownAt,
      userGrade: args.userGrade || null
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
    // null and undefined both mean "clear override → use Auto rule".
    // Normalize early so the rest of the fn treats them identically.
    let v = value;
    if (v === null) v = undefined;
    if (typeof v === 'string' && v !== 'paused') {
      const n = parseInt(v, 10);
      if (Number.isFinite(n)) v = n;
    }
    if (v !== undefined && VALID_FREQS.indexOf(v) === -1) {
      throw new Error('Invalid frequency: ' + value);
    }

    _state.freq = v;
    persistFreqToLocal(v);

    if (isSignedIn() && window.STAARAuth && window.STAARAuth.api) {
      window.STAARAuth.api('updateFunFactsState', {
        token: authToken(),
        // Send null on the wire to signal "REMOVE the funFactsFreq attr"
        // (lambda's setFrequency:null branch).
        setFrequency: v === undefined ? null : v
      }).catch(err => {
        console.warn('[funFacts] setFrequency sync failed:', err && err.message || err);
      });
    }
  }

  function isPaused() { return _state.freq === 'paused'; }

  function _getSeenIds() { return _state.seen.slice(); }
  function _getFirstShownAt() { return _state.firstShownAt; }

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
    _getFirstShownAt,
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
