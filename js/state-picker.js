/**
 * StarTest — STATE PICKER
 *
 * Powers the landing page state-selection experience:
 *   - IP-based auto-detect via ipapi.co
 *   - Mobile: bottom-sheet picker with search
 *   - Desktop: alphabetical grid (Texas pinned first)
 *   - localStorage fast-path on return visits
 *   - Logged-in users with saved state get auto-redirect to states/?s=<slug>
 *
 * Storage keys:
 *   startest.state              Selected state slug (e.g. "texas")
 *   startest.state-detected     Auto-detected state slug (cached for 24h)
 *   startest.state-detected-ts  Timestamp of last detection
 */

(function () {
  const STORAGE_KEY = 'startest.state';
  const DETECTED_KEY = 'startest.state-detected';
  const DETECTED_TS_KEY = 'startest.state-detected-ts';
  const DETECT_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  const GEOLOCATE_URL = 'https://ipapi.co/json/';
  const GEOLOCATE_TIMEOUT_MS = 2500;

  function $(id) { return document.getElementById(id); }

  function init() {
    if (!$('state-picker')) return;
    if (!window.STATES_API) return;

    // 1. Logged-in user with state -> redirect to their state page (unless ?stay=1)
    const auth = window.STAARAuth;
    const user = (auth && auth.currentUser && auth.currentUser()) || null;
    if (user && user.state && window.STATES_API.getBySlug(user.state)) {
      const params = new URLSearchParams(location.search);
      if (!params.has('stay')) {
        location.href = 'states/?s=' + user.state;
        return;
      }
    }

    // 2. localStorage fast path -> show choice card (don't auto-redirect)
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && window.STATES_API.getBySlug(stored)) {
      showDetected(stored, 'You picked this earlier');
    }

    // 3. Render desktop grid
    renderDesktopGrid();

    // 4. Wire mobile trigger
    const trigger = $('state-picker-trigger');
    if (trigger) trigger.addEventListener('click', openMobileSheet);

    // 5. Wire sheet controls
    const scrim = $('state-sheet-scrim');
    if (scrim) scrim.addEventListener('click', closeMobileSheet);
    const closeBtn = document.querySelector('.state-sheet-close');
    if (closeBtn) closeBtn.addEventListener('click', closeMobileSheet);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMobileSheet();
    });
    const search = $('state-sheet-search');
    if (search) search.addEventListener('input', filterSheet);

    // 6. Render sheet list (delegated click handler attached once)
    renderSheetList();
    const list = $('state-sheet-list');
    if (list) {
      list.addEventListener('click', function (e) {
        const item = e.target.closest('.state-sheet-item');
        if (!item) return;
        chooseState(item.dataset.state);
      });
    }

    // 7. IP geolocation if no stored choice
    runGeolocation();
  }

  function renderDesktopGrid() {
    const grid = $('state-picker-grid');
    if (!grid) return;
    const states = window.STATES_API.getAlphabetical();
    const home = states.find(function (s) { return s.features && s.features.homeState; });
    const rest = states.filter(function (s) { return !(s.features && s.features.homeState); });
    const ordered = home ? [home].concat(rest) : states;

    grid.innerHTML = ordered.map(function (s) {
      const isHome = s.features && s.features.homeState;
      return ''
        + '<button type="button" class="state-tile' + (isHome ? ' state-tile--home' : '') + '" data-state="' + s.slug + '" role="option">'
        +   '<span class="state-tile-abbr">' + s.nameAbbr + '</span>'
        +   '<span class="state-tile-info">'
        +     '<span class="state-tile-name">' + s.name + '</span>'
        +     '<span class="state-tile-test">' + s.testName + '</span>'
        +   '</span>'
        + '</button>';
    }).join('');

    grid.addEventListener('click', function (e) {
      const tile = e.target.closest('.state-tile');
      if (!tile) return;
      const slug = tile.dataset.state;
      if (slug) chooseState(slug);
    });
  }

  function renderSheetList(filterText) {
    const list = $('state-sheet-list');
    if (!list) return;
    const filter = (filterText || '').trim().toLowerCase();
    let states = window.STATES_API.getAlphabetical();

    if (filter) {
      states = states.filter(function (s) {
        return s.name.toLowerCase().indexOf(filter) !== -1
          || s.nameAbbr.toLowerCase().indexOf(filter) !== -1
          || s.testName.toLowerCase().indexOf(filter) !== -1;
      });
    }

    if (states.length === 0) {
      list.innerHTML = '<li class="state-sheet-empty">No states match "' + escapeHtml(filter) + '"</li>';
      return;
    }

    list.innerHTML = states.map(function (s) {
      return ''
        + '<li>'
        +   '<button type="button" class="state-sheet-item" data-state="' + s.slug + '" role="option">'
        +     '<span class="state-sheet-item-abbr">' + s.nameAbbr + '</span>'
        +     '<span class="state-sheet-item-info">'
        +       '<span class="state-sheet-item-name">' + s.name + '</span>'
        +       '<span class="state-sheet-item-test">' + s.testName + '</span>'
        +     '</span>'
        +     '<span class="state-sheet-item-chevron" aria-hidden="true">'
        +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="16" height="16">'
        +         '<polyline points="9 18 15 12 9 6"/>'
        +       '</svg>'
        +     '</span>'
        +   '</button>'
        + '</li>';
    }).join('');
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  function filterSheet(e) {
    renderSheetList(e.target.value);
  }

  function openMobileSheet() {
    const scrim = $('state-sheet-scrim');
    const sheet = $('state-sheet');
    if (!scrim || !sheet) return;
    scrim.hidden = false;
    sheet.hidden = false;
    requestAnimationFrame(function () {
      scrim.dataset.open = 'true';
      sheet.dataset.open = 'true';
    });
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      const s = $('state-sheet-search');
      if (s) s.focus();
    }, 280);
  }

  function closeMobileSheet() {
    const scrim = $('state-sheet-scrim');
    const sheet = $('state-sheet');
    if (!scrim || !sheet) return;
    scrim.dataset.open = 'false';
    sheet.dataset.open = 'false';
    document.body.style.overflow = '';
    setTimeout(function () {
      scrim.hidden = true;
      sheet.hidden = true;
      const s = $('state-sheet-search');
      if (s) s.value = '';
      renderSheetList('');
    }, 280);
  }

  function chooseState(slug) {
    if (!window.STATES_API.getBySlug(slug)) return;
    localStorage.setItem(STORAGE_KEY, slug);
    try { if (navigator.vibrate) navigator.vibrate(10); } catch (_) {}
    location.href = 'states/?s=' + slug;
  }

  function showDetected(slug, label) {
    const state = window.STATES_API.getBySlug(slug);
    if (!state) return;
    const card = $('state-detected');
    if (!card) return;
    const nameEl = $('detected-state-name');
    if (nameEl) nameEl.textContent = state.name + ' \u00B7 ' + state.testName;

    const goBtn = $('detected-state-go');
    if (goBtn) {
      goBtn.href = 'states/?s=' + slug;
      goBtn.onclick = function (e) {
        e.preventDefault();
        chooseState(slug);
      };
    }

    const labelEl = card.querySelector('.state-picker-detected-label');
    if (labelEl && label) labelEl.textContent = label;

    card.hidden = false;
    requestAnimationFrame(function () { card.dataset.shown = 'true'; });
  }

  function runGeolocation() {
    if (localStorage.getItem(STORAGE_KEY)) return;

    const cached = localStorage.getItem(DETECTED_KEY);
    const cachedTs = parseInt(localStorage.getItem(DETECTED_TS_KEY) || '0', 10);
    if (cached && (Date.now() - cachedTs) < DETECT_TTL_MS) {
      if (window.STATES_API.getBySlug(cached)) {
        showDetected(cached, "Looks like you're in");
      }
      return;
    }

    const status = $('state-detect-status');
    if (status) status.hidden = false;

    const controller = new AbortController();
    const timer = setTimeout(function () { controller.abort(); }, GEOLOCATE_TIMEOUT_MS);

    fetch(GEOLOCATE_URL, { signal: controller.signal })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        clearTimeout(timer);
        if (status) status.hidden = true;

        const abbr = data.region_code;
        const country = data.country_code;
        if (country !== 'US' || !abbr) return;

        const state = window.STATES_API.getByAbbr(abbr);
        if (!state) return;

        localStorage.setItem(DETECTED_KEY, state.slug);
        localStorage.setItem(DETECTED_TS_KEY, String(Date.now()));
        showDetected(state.slug, "Looks like you're in");
      })
      .catch(function () {
        clearTimeout(timer);
        if (status) status.hidden = true;
      });
  }

  // Public API
  window.STARTEST_STATE = {
    get current() { return localStorage.getItem(STORAGE_KEY); },
    set: function (slug) {
      if (window.STATES_API && window.STATES_API.getBySlug(slug)) {
        localStorage.setItem(STORAGE_KEY, slug);
      }
    },
    clear: function () { localStorage.removeItem(STORAGE_KEY); }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
