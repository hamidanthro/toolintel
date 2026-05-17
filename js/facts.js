/**
 * GradeEarn — Fun Facts (§115 May 16)
 *
 * Two views in one page, driven by URL state:
 *   1. PICKER (no ?cat=)        — grid of category tiles + age filter
 *   2. DECK   (?cat=animals)    — single-card AI-powered deck
 *
 * Kids pick a topic first (Sports, Dinos, Space, ...), THEN see the
 * deck filtered to that topic. NO-REPEAT honors per-topic + per-age
 * scope: within a (cat, age) tuple, every fact shows once before
 * any repeat. Silent cycle rollover when the topic is exhausted.
 */
(function () {
  'use strict';

  const CATALOG_URL = '/data/fun-facts.json?v=20260510k';
  const TUTOR_ENDPOINT = window.STAAR_TUTOR_ENDPOINT
    || 'https://4wvuw21yjl.execute-api.us-east-1.amazonaws.com/';
  const SAVED_KEY = 'gradeearn_saved_facts';

  // Category metadata. The 15 categories actually present in the
  // catalog plus the 'all' meta-tile. Emoji per the §114 spec.
  const CATEGORIES = [
    { id: 'all',          label: 'All topics',  emoji: '✨' },
    { id: 'animals',      label: 'Animals',     emoji: '🦋' },
    { id: 'space',        label: 'Space',       emoji: '🪐' },
    { id: 'body',         label: 'Body',        emoji: '🫀' },
    { id: 'dinosaurs',    label: 'Dinos',       emoji: '🦕' },
    { id: 'math-numbers', label: 'Numbers',     emoji: '🔢' },
    { id: 'history',      label: 'History',     emoji: '🏛' },
    { id: 'inventions',   label: 'Inventions',  emoji: '💡' },
    { id: 'geography',    label: 'Geography',   emoji: '🌍' },
    { id: 'robots-tech',  label: 'Robots & Tech', emoji: '🤖' },
    { id: 'mythology',    label: 'Myth',        emoji: '🐉' },
    { id: 'music',        label: 'Music',       emoji: '🎵' },
    { id: 'sports',       label: 'Sports',      emoji: '🏀' },
    { id: 'food',         label: 'Food',        emoji: '🍯' },
    { id: 'weird-funny',  label: 'Weird',       emoji: '🎲' },
    { id: 'texas',        label: 'Texas',       emoji: '⭐' }
  ];
  const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

  let _catalog = null;
  let _filtered = [];
  let _index = 0;
  let _savedIds = null;
  const _explanationCache = new Map();
  let _whyPulseTimer = null; // §116 — auto-stop pulse after 4s

  const state = { cat: 'all', grade: 'all', mode: 'picker' };

  // ============================================================
  // Catalog + saved + seen
  // ============================================================
  async function loadCatalog() {
    if (_catalog) return _catalog;
    if (window.FunFacts && typeof window.FunFacts._getCatalog === 'function') {
      const cached = window.FunFacts._getCatalog();
      if (Array.isArray(cached) && cached.length) { _catalog = cached; return _catalog; }
    }
    try {
      const res = await fetch(CATALOG_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('catalog ' + res.status);
      _catalog = await res.json();
    } catch (e) {
      console.warn('[facts] catalog load failed:', e && e.message);
      _catalog = [];
    }
    return _catalog;
  }

  function loadSavedIds() {
    if (_savedIds) return _savedIds;
    try {
      const raw = localStorage.getItem(SAVED_KEY);
      _savedIds = new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { _savedIds = new Set(); }
    return _savedIds;
  }
  function persistSavedIds() { try { localStorage.setItem(SAVED_KEY, JSON.stringify([..._savedIds])); } catch (_) {} }
  function isSaved(id) { return loadSavedIds().has(id); }
  function toggleSaved(id) {
    const s = loadSavedIds();
    if (s.has(id)) s.delete(id); else s.add(id);
    persistSavedIds();
    return s.has(id);
  }

  function getSeenSet() {
    try {
      if (window.FunFacts && typeof window.FunFacts._getSeenIds === 'function') {
        return new Set(window.FunFacts._getSeenIds() || []);
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem('gradeearn:ff:seen');
      return new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { return new Set(); }
  }

  // ============================================================
  // Filter — by category + age
  // ============================================================
  function filterCatalog(catId, gradeId) {
    if (!_catalog) return [];
    const cat = catId || state.cat;
    const grade = gradeId || state.grade;
    return _catalog.filter(f => {
      if (!f || !f.fact) return false;
      if (cat !== 'all' && f.category !== cat) return false;
      if (grade !== 'all') {
        const grades = Array.isArray(f.gradeLevels) ? f.gradeLevels :
                       (f.gradeLevel ? [f.gradeLevel] : []);
        if (!grades.includes(grade)) return false;
      }
      return true;
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ============================================================
  // URL ↔ state
  // ============================================================
  function applyURLParams() {
    try {
      const p = new URLSearchParams(location.search);
      const c = p.get('cat') || p.get('category');
      if (c && CAT_BY_ID[c]) state.cat = c;
      // Legacy support: ?subj= maps to nothing (subject grouping retired); skip.
      const age = p.get('age') || p.get('grade');
      if (age === 'k-2' || age === '3-4' || age === '5-8' || age === 'all') state.grade = age;
      // Mode is determined by whether ?cat= is present
      state.mode = c ? 'deck' : 'picker';
    } catch (_) {}
  }
  function pushURL() {
    try {
      const p = new URLSearchParams();
      if (state.mode === 'deck') p.set('cat', state.cat);
      if (state.grade !== 'all') p.set('age', state.grade);
      const qs = p.toString();
      history.pushState(null, '', qs ? '?' + qs : location.pathname);
    } catch (_) {}
  }
  function replaceURL() {
    try {
      const p = new URLSearchParams();
      if (state.mode === 'deck') p.set('cat', state.cat);
      if (state.grade !== 'all') p.set('age', state.grade);
      const qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    } catch (_) {}
  }

  // ============================================================
  // PICKER VIEW
  // ============================================================
  function renderPicker() {
    document.getElementById('deck-picker').hidden = false;
    document.getElementById('deck-main').hidden = true;

    const seen = getSeenSet();
    const grid = document.getElementById('deck-picker-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // Active categories (skip 'texas' if catalog has very few)
    CATEGORIES.forEach(c => {
      const facts = filterCatalog(c.id, state.grade);
      if (facts.length === 0 && c.id !== 'all') return; // hide empty tiles
      const seenCount = facts.filter(f => seen.has(f.id)).length;
      const pct = facts.length ? Math.round((seenCount / facts.length) * 100) : 0;
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'deck-picker-tile' + (c.id === 'all' ? ' deck-picker-tile--all' : '');
      tile.dataset.cat = c.id;
      tile.setAttribute('aria-label', c.label + ' · ' + facts.length + ' facts');
      tile.innerHTML =
        '<span class="deck-picker-tile-emoji" aria-hidden="true">' + c.emoji + '</span>' +
        '<span class="deck-picker-tile-name">' + c.label + '</span>' +
        '<span class="deck-picker-tile-count">' + facts.length.toLocaleString() + ' facts</span>' +
        '<div class="deck-picker-tile-bar" aria-hidden="true">' +
          '<span class="deck-picker-tile-bar-fill" style="width:' + pct + '%"></span>' +
        '</div>' +
        '<span class="deck-picker-tile-progress">' + seenCount + ' / ' + facts.length + ' seen</span>';
      tile.addEventListener('click', () => {
        state.cat = c.id;
        state.mode = 'deck';
        pushURL();
        enterDeck();
      });
      grid.appendChild(tile);
    });

    const ageLabel = document.getElementById('deck-picker-age-label');
    if (ageLabel) ageLabel.textContent = labelForGrade(state.grade);
  }

  function labelForGrade(g) {
    return g === 'k-2' ? 'K–2' :
           g === '3-4' ? 'Grades 3–4' :
           g === '5-8' ? 'Grades 5–8' : 'All ages';
  }

  // ============================================================
  // DECK VIEW
  // ============================================================
  function rebuildDeck() {
    const filtered = filterCatalog();
    let seen = getSeenSet();
    const allSeen = filtered.length > 0 && filtered.every(f => seen.has(f.id));
    if (allSeen && window.FunFacts && typeof window.FunFacts._resetSeenForCycle === 'function') {
      try {
        console.log('[deck] cycle complete (' + filtered.length + ' facts in ' + state.cat + ') — resetting seen-set');
        window.FunFacts._resetSeenForCycle();
        seen = new Set();
      } catch (_) {}
    }
    const unseen = filtered.filter(f => !seen.has(f.id));
    const already = filtered.filter(f => seen.has(f.id));
    _filtered = shuffle(unseen).concat(shuffle(already));
    _index = 0;
    render();
  }

  function enterDeck() {
    document.getElementById('deck-picker').hidden = true;
    document.getElementById('deck-main').hidden = false;
    rebuildDeck();
  }

  function exitToPicker() {
    state.mode = 'picker';
    state.cat = 'all';
    pushURL();
    renderPicker();
  }

  function prefersReducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function render(direction) {
    const stage = document.getElementById('deck-stage');
    const empty = document.getElementById('deck-empty');
    const nav   = document.getElementById('deck-nav');
    const pos   = document.getElementById('deck-position');
    const help  = document.querySelector('.deck-helper');

    if (!_filtered.length) {
      if (stage) stage.hidden = true;
      if (nav)   nav.hidden = true;
      if (help)  help.hidden = true;
      if (empty) empty.hidden = false;
      if (pos)   pos.textContent = '0 of 0';
      updateFilterChipLabel();
      return;
    }
    if (stage) stage.hidden = false;
    if (nav)   nav.hidden = false;
    if (help)  help.hidden = false;
    if (empty) empty.hidden = true;

    const f = _filtered[_index];
    const cat = CAT_BY_ID[f.category] || { emoji: '💡', label: f.category || 'Fun' };

    document.getElementById('deck-emoji').textContent = cat.emoji;
    document.getElementById('deck-cat').textContent = cat.label;
    document.getElementById('deck-fact').textContent = f.fact;

    const saveBtn = document.getElementById('deck-btn-save');
    if (saveBtn) {
      const saved = isSaved(f.id);
      saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      saveBtn.classList.toggle('deck-action--saved', saved);
      // §116 — Tabler heart icon: swap outline ↔ filled visibility
      const outline = saveBtn.querySelector('.deck-icon--heart-outline');
      const filled  = saveBtn.querySelector('.deck-icon--heart-filled');
      if (outline) outline.hidden = saved;
      if (filled)  filled.hidden  = !saved;
    }

    const whyEl = document.getElementById('deck-why');
    if (whyEl) {
      let cached = _explanationCache.get(f.id);
      if (!cached && f._aiExplanation) cached = f._aiExplanation;
      if (cached) { whyEl.textContent = cached; whyEl.hidden = false; }
      else { whyEl.textContent = ''; whyEl.hidden = true; }
    }

    if (pos) pos.textContent = (_index + 1).toLocaleString() + ' of ' + _filtered.length.toLocaleString();
    renderDots(_index, _filtered.length);
    updateFilterChipLabel();

    try {
      if (window.FunFacts && typeof window.FunFacts.markFactSeen === 'function') {
        window.FunFacts.markFactSeen(f.id);
      }
    } catch (_) {}

    if (direction && !prefersReducedMotion()) {
      const focal = document.getElementById('deck-card-focal');
      if (focal) {
        focal.classList.remove('deck-card--in-left', 'deck-card--in-right');
        // eslint-disable-next-line no-unused-expressions
        focal.offsetWidth;
        focal.classList.add(direction === 'next' ? 'deck-card--in-right' : 'deck-card--in-left');
      }
    }

    // §116 — Why? pulse manager. On every new card render, restart
    // the pulse IF the kid hasn't tapped Why? for this fact AND
    // prefers-reduced-motion is not set. Auto-stops after 4s.
    startWhyPulse();
  }

  function startWhyPulse() {
    const btn = document.getElementById('deck-btn-why');
    if (!btn) return;
    // Clear any previous timer
    if (_whyPulseTimer) { clearTimeout(_whyPulseTimer); _whyPulseTimer = null; }
    if (prefersReducedMotion()) {
      btn.classList.remove('deck-action--ai-pulsing');
      return;
    }
    const f = _filtered[_index];
    // If kid already tapped Why? for this fact (cached explanation
    // exists), skip the pulse — they know the move now.
    if (f && (_explanationCache.has(f.id) || f._aiExplanation)) {
      btn.classList.remove('deck-action--ai-pulsing');
      return;
    }
    btn.classList.add('deck-action--ai-pulsing');
    _whyPulseTimer = setTimeout(() => {
      btn.classList.remove('deck-action--ai-pulsing');
      _whyPulseTimer = null;
    }, 4000);
  }
  function stopWhyPulse() {
    const btn = document.getElementById('deck-btn-why');
    if (btn) btn.classList.remove('deck-action--ai-pulsing');
    if (_whyPulseTimer) { clearTimeout(_whyPulseTimer); _whyPulseTimer = null; }
  }

  function renderDots(current, total) {
    const wrap = document.getElementById('deck-dots');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (let offset = -2; offset <= 2; offset++) {
      const dot = document.createElement('span');
      dot.className = 'deck-dot deck-dot--t' + Math.abs(offset);
      const abs = current + offset;
      if (abs < 0 || abs >= total) dot.classList.add('deck-dot--ghost');
      wrap.appendChild(dot);
    }
  }

  function updateFilterChipLabel() {
    const lbl = document.getElementById('deck-filter-label');
    if (!lbl) return;
    const cat = CAT_BY_ID[state.cat] || { label: 'All topics' };
    lbl.textContent = cat.label + ' · ' + labelForGrade(state.grade);
  }

  // ============================================================
  // Navigation
  // ============================================================
  function next() {
    if (!_filtered.length) return;
    if (_index >= _filtered.length - 1) {
      rebuildDeck();
      return;
    }
    _index = _index + 1;
    render('next');
  }
  function prev() {
    if (!_filtered.length) return;
    _index = (_index - 1 + _filtered.length) % _filtered.length;
    render('prev');
  }
  function evenWeirder() {
    if (_filtered.length < 2) return next();
    const here = _filtered[_index];
    const seen = getSeenSet();
    const candidates = _filtered.map((f, i) => ({ f, i })).filter(({ i }) => i !== _index);
    const unseenSameCat = candidates.filter(({ f }) => !seen.has(f.id) && f.category === here.category);
    const anyUnseen     = candidates.filter(({ f }) => !seen.has(f.id));
    const seenSameCat   = candidates.filter(({ f }) =>  f.category === here.category);
    const pool = unseenSameCat.length ? unseenSameCat
               : anyUnseen.length    ? anyUnseen
               : seenSameCat.length  ? seenSameCat
               : candidates;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    _index = pick.i;
    render('next');
  }

  // ============================================================
  // AI Why?
  // ============================================================
  async function fetchWhy() {
    if (!_filtered.length) return;
    const f = _filtered[_index];
    if (!f) return;
    stopWhyPulse(); // §116 — kid engaged, stop the attention signal
    if (_explanationCache.has(f.id)) { revealWhy(_explanationCache.get(f.id)); return; }
    if (f._aiExplanation) { _explanationCache.set(f.id, f._aiExplanation); revealWhy(f._aiExplanation); return; }
    const btn = document.getElementById('deck-btn-why');
    if (btn) { btn.disabled = true; btn.classList.add('deck-action--loading'); }
    try {
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'funFactExplain', factId: f.id, fact: f.fact,
          category: f.category, grade: f.gradeLevel || (Array.isArray(f.gradeLevels) ? f.gradeLevels[0] : '3-4')
        })
      });
      if (!res.ok) throw new Error('explain ' + res.status);
      const body = await res.json();
      const text = body && body.explanation ? String(body.explanation).trim() : '';
      if (text) { _explanationCache.set(f.id, text); f._aiExplanation = text; revealWhy(text); }
    } catch (e) {
      console.warn('[deck] why fetch failed:', e && e.message);
      // §130 — fallback string. Was "That's just how it is — try
      // asking a grown-up for the deeper reason" which only fit the
      // old "Why?" button label. New label is "Tell me more" so the
      // fallback should read as "we couldn't fetch the elaboration".
      revealWhy("Couldn't fetch more details right now — try again in a second, or ask a grown-up.");
    } finally {
      if (btn) { btn.disabled = false; btn.classList.remove('deck-action--loading'); }
    }
  }
  function revealWhy(text) {
    const el = document.getElementById('deck-why');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
    if (!prefersReducedMotion()) {
      el.classList.remove('deck-card-why--in');
      // eslint-disable-next-line no-unused-expressions
      el.offsetWidth;
      el.classList.add('deck-card-why--in');
    }
  }

  // ============================================================
  // Save
  // ============================================================
  function toggleSaveOnCurrent() {
    if (!_filtered.length) return;
    const f = _filtered[_index];
    const nowSaved = toggleSaved(f.id);
    const btn = document.getElementById('deck-btn-save');
    if (btn) {
      btn.setAttribute('aria-pressed', nowSaved ? 'true' : 'false');
      btn.classList.toggle('deck-action--saved', nowSaved);
      // §116 — swap outline ↔ filled heart SVGs
      const outline = btn.querySelector('.deck-icon--heart-outline');
      const filled  = btn.querySelector('.deck-icon--heart-filled');
      if (outline) outline.hidden = nowSaved;
      if (filled)  filled.hidden  = !nowSaved;
      const heart = btn.querySelector('.deck-heart');
      if (heart && !prefersReducedMotion()) {
        heart.classList.remove('deck-heart--bounce');
        // eslint-disable-next-line no-unused-expressions
        heart.offsetWidth;
        heart.classList.add('deck-heart--bounce');
      }
      // §116 — gold-particle burst (3 dots fading up + out)
      if (nowSaved && !prefersReducedMotion()) {
        spawnSaveBurst(btn);
      }
    }
  }

  // §116 — small gold-particle burst when the kid saves a fact.
  // 3 absolutely-positioned dots inside the heart container, each
  // animated by CSS class .deck-particle--up and removed after the
  // animation ends.
  function spawnSaveBurst(btn) {
    const heart = btn.querySelector('.deck-heart');
    if (!heart) return;
    // Anchor relative to heart
    if (getComputedStyle(heart).position === 'static') {
      heart.style.position = 'relative';
    }
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('span');
      d.className = 'deck-particle';
      // Spread 3 particles slightly: -8px, 0, +8px x; randomize tiny y wobble
      const x = (i - 1) * 8 + (Math.random() * 4 - 2);
      d.style.setProperty('--dx', x + 'px');
      heart.appendChild(d);
      // Cleanup once animation ends
      d.addEventListener('animationend', () => { d.remove(); }, { once: true });
      // Failsafe: remove after 700ms regardless
      setTimeout(() => { if (d.parentElement) d.remove(); }, 700);
    }
  }

  // ============================================================
  // Filter dialog — used in deck mode + age picker in picker mode
  // ============================================================
  function buildFilterCategoryPills() {
    const wrap = document.querySelector('.deck-filter-pills--cats');
    if (!wrap) return;
    wrap.innerHTML = '';
    CATEGORIES.forEach(c => {
      const facts = filterCatalog(c.id, state.grade);
      if (facts.length === 0 && c.id !== 'all') return;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'deck-fpill';
      b.dataset.filter = 'cat';
      b.dataset.value = c.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', c.id === state.cat ? 'true' : 'false');
      if (c.id === state.cat) b.classList.add('deck-fpill--active');
      b.textContent = c.emoji + ' ' + c.label;
      b.addEventListener('click', () => {
        wrap.querySelectorAll('.deck-fpill').forEach(x => {
          x.classList.remove('deck-fpill--active');
          x.setAttribute('aria-checked', 'false');
        });
        b.classList.add('deck-fpill--active');
        b.setAttribute('aria-checked', 'true');
        state.cat = c.id;
      });
      wrap.appendChild(b);
    });
  }

  function openFilterDialog() {
    const dlg = document.getElementById('deck-filter-dialog');
    if (!dlg) return;
    buildFilterCategoryPills();
    document.querySelectorAll('.deck-fpill[data-filter="grade"]').forEach(b => {
      const active = b.dataset.value === state.grade;
      b.classList.toggle('deck-fpill--active', active);
      b.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    // Hide category section when in picker mode (kid picks topic via tiles, not dialog)
    const catSection = document.getElementById('deck-filter-section-category');
    if (catSection) catSection.hidden = (state.mode === 'picker');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function closeFilterDialog() {
    const dlg = document.getElementById('deck-filter-dialog');
    if (!dlg) return;
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }
  function wireFilterDialog() {
    document.querySelectorAll('.deck-fpill[data-filter="grade"]').forEach(b => {
      b.addEventListener('click', () => {
        state.grade = b.dataset.value;
        b.parentElement.querySelectorAll('.deck-fpill').forEach(x => {
          x.classList.toggle('deck-fpill--active', x === b);
          x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        });
      });
    });
    const apply = document.getElementById('deck-filter-apply');
    if (apply) apply.addEventListener('click', () => {
      closeFilterDialog();
      pushURL();
      if (state.mode === 'deck') rebuildDeck();
      else renderPicker();
    });
    const close = document.getElementById('deck-filter-close');
    if (close) close.addEventListener('click', closeFilterDialog);
  }

  // ============================================================
  // Keyboard + swipe (only active in deck mode)
  // ============================================================
  function wireKeyboard() {
    document.addEventListener('keydown', e => {
      if (state.mode !== 'deck') return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); fetchWhy(); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); toggleSaveOnCurrent(); }
      else if (e.key === 'Escape') { e.preventDefault(); exitToPicker(); }
    });
  }
  function wireSwipe() {
    const stage = document.getElementById('deck-stage');
    if (!stage) return;
    let startX = 0, startY = 0, tracking = false;
    stage.addEventListener('touchstart', e => {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX; startY = e.touches[0].clientY; tracking = true;
    }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (!tracking) return; tracking = false;
      const t = e.changedTouches && e.changedTouches[0]; if (!t) return;
      const dx = t.clientX - startX; const dy = t.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next(); else prev();
      }
    }, { passive: true });
  }

  // ============================================================
  // Boot + back/forward
  // ============================================================
  async function init() {
    applyURLParams();
    wireFilterDialog();
    wireKeyboard();
    wireSwipe();

    // Card action buttons
    const btnWhy = document.getElementById('deck-btn-why');
    if (btnWhy) btnWhy.addEventListener('click', fetchWhy);
    const btnWeirder = document.getElementById('deck-btn-weirder');
    if (btnWeirder) btnWeirder.addEventListener('click', evenWeirder);
    const btnSave = document.getElementById('deck-btn-save');
    if (btnSave) btnSave.addEventListener('click', toggleSaveOnCurrent);
    const prev_ = document.getElementById('deck-prev');
    if (prev_) prev_.addEventListener('click', prev);
    const next_ = document.getElementById('deck-next');
    if (next_) next_.addEventListener('click', next);
    const filterChip = document.getElementById('deck-filter-chip');
    if (filterChip) filterChip.addEventListener('click', openFilterDialog);
    const backBtn = document.getElementById('deck-back');
    if (backBtn) backBtn.addEventListener('click', exitToPicker);
    const ageBtn = document.getElementById('deck-picker-age');
    if (ageBtn) ageBtn.addEventListener('click', openFilterDialog);
    const emptyCta = document.getElementById('deck-empty-cta');
    if (emptyCta) emptyCta.addEventListener('click', exitToPicker);

    // Browser back/forward
    window.addEventListener('popstate', () => {
      applyURLParams();
      if (state.mode === 'picker') renderPicker();
      else enterDeck();
    });

    await loadCatalog();
    if (state.mode === 'picker') renderPicker();
    else enterDeck();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
