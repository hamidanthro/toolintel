/**
 * GradeEarn — Fun Facts Discovery Deck (§114, May 16)
 *
 * Was a scrolling list of fact cards (3rd-grade catalog browsing).
 * Now a single-card-at-a-time deck: focal card with 3 AI-powered
 * pills (🤔 Why?, 🎲 Even weirder, 💚 Save), ghost cards behind
 * for stack illusion, keyboard + swipe + chevron navigation.
 *
 * AI Why? wired to lambda action 'funFactExplain' which calls
 * gpt-4o-mini and caches the result in staar-explanations keyed
 * by `funfact:<factId>`. Subsequent fetches of the same fact
 * return the cached explanation with no model call.
 *
 * No green/teal/cyan introduced. Gold accent only.
 */
(function () {
  'use strict';

  // ---- Subject → category mapping (carried over from prior list view) ----
  const SUBJECT_CATEGORIES = {
    math:    ['math-numbers', 'space', 'inventions', 'robots-tech', 'weird-funny'],
    reading: ['mythology',    'history', 'music',     'weird-funny', 'animals'],
    science: ['animals',      'body',  'space', 'dinosaurs', 'robots-tech', 'geography', 'food'],
    all:     null
  };

  // ---- Category emoji + label. Mapped per prompt + existing catalog. ----
  const CATEGORY_EMOJI = {
    animals: '🦋', body: '🫀', food: '🍯', 'weird-funny': '🎲',
    space: '🪐', sports: '🏀', dinosaurs: '🦕', mythology: '🐉',
    history: '🏛', 'math-numbers': '🔢', inventions: '💡',
    music: '🎵', geography: '🌍', 'robots-tech': '🤖', texas: '⭐'
  };
  const CATEGORY_LABEL = {
    animals: 'Animals', body: 'Body', food: 'Food', 'weird-funny': 'Weird',
    space: 'Space', sports: 'Sports', dinosaurs: 'Dinos', mythology: 'Myth',
    history: 'History', 'math-numbers': 'Numbers', inventions: 'Inventions',
    music: 'Music', geography: 'Geography', 'robots-tech': 'Robots & Tech',
    texas: 'Texas'
  };

  const CATALOG_URL = '/data/fun-facts.json?v=20260510k';
  const TUTOR_ENDPOINT = window.STAAR_TUTOR_ENDPOINT
    || 'https://4wvuw21yjl.execute-api.us-east-1.amazonaws.com/';
  const SAVED_KEY = 'gradeearn_saved_facts';

  let _catalog = null;
  let _filtered = [];
  let _index = 0;
  let _savedIds = null;
  const _explanationCache = new Map(); // per-session memo of /funFactExplain replies

  const state = { subject: 'all', grade: 'all' };

  // ============================================================
  // Catalog + saved-facts persistence
  // ============================================================
  async function loadCatalog() {
    if (_catalog) return _catalog;
    if (window.FunFacts && typeof window.FunFacts._getCatalog === 'function') {
      const cached = window.FunFacts._getCatalog();
      if (Array.isArray(cached) && cached.length) {
        _catalog = cached; return _catalog;
      }
    }
    try {
      const res = await fetch(CATALOG_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('catalog ' + res.status);
      _catalog = await res.json();
    } catch (e) {
      console.warn('[deck] catalog load failed:', e && e.message);
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
  function persistSavedIds() {
    try { localStorage.setItem(SAVED_KEY, JSON.stringify([..._savedIds])); } catch (_) {}
  }
  function isSaved(id) { return loadSavedIds().has(id); }
  function toggleSaved(id) {
    const s = loadSavedIds();
    if (s.has(id)) s.delete(id); else s.add(id);
    persistSavedIds();
    return s.has(id);
  }

  // ============================================================
  // Filter + shuffle + position
  // ============================================================
  function filterCatalog() {
    if (!_catalog) return [];
    const cats = SUBJECT_CATEGORIES[state.subject];
    return _catalog.filter(f => {
      if (!f || !f.fact) return false;
      if (cats && !cats.includes(f.category)) return false;
      if (state.grade !== 'all') {
        const grades = Array.isArray(f.gradeLevels) ? f.gradeLevels :
                       (f.gradeLevel ? [f.gradeLevel] : []);
        if (!grades.includes(state.grade)) return false;
      }
      return true;
    });
  }

  // Fisher-Yates shuffle (deterministic seed not needed — kid wants surprise)
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function applyURLParams() {
    try {
      const p = new URLSearchParams(location.search);
      const subj = p.get('subj') || p.get('subject');
      if (subj && SUBJECT_CATEGORIES.hasOwnProperty(subj)) state.subject = subj;
      const age = p.get('age') || p.get('grade');
      if (age === 'k-2' || age === '3-4' || age === '5-8') state.grade = age;
    } catch (_) {}
  }
  function updateURL() {
    try {
      const p = new URLSearchParams();
      if (state.subject !== 'all') p.set('subj', state.subject);
      if (state.grade !== 'all')   p.set('age', state.grade);
      const qs = p.toString();
      history.replaceState(null, '', qs ? '?' + qs : location.pathname);
    } catch (_) {}
  }

  function rebuildDeck() {
    _filtered = shuffle(filterCatalog());
    _index = 0;
    render();
  }

  // ============================================================
  // Rendering
  // ============================================================
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
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
    const fchip = document.getElementById('deck-filter-chip');

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
    const emoji = CATEGORY_EMOJI[f.category] || '💡';
    const cat   = CATEGORY_LABEL[f.category] || (f.category || 'Fun');

    document.getElementById('deck-emoji').textContent = emoji;
    document.getElementById('deck-cat').textContent = cat;
    document.getElementById('deck-fact').textContent = f.fact;

    // Save state
    const saveBtn = document.getElementById('deck-btn-save');
    if (saveBtn) {
      const saved = isSaved(f.id);
      saveBtn.setAttribute('aria-pressed', saved ? 'true' : 'false');
      saveBtn.classList.toggle('deck-action--saved', saved);
      const heart = saveBtn.querySelector('.deck-heart');
      if (heart) heart.textContent = saved ? '💛' : '💚';
    }

    // Why? section — show if we already have a cached explanation
    // for this fact (either from f._aiExplanation in the catalog or
    // from our session-memo Map). Otherwise hide until user taps.
    const whyEl = document.getElementById('deck-why');
    if (whyEl) {
      let cached = _explanationCache.get(f.id);
      if (!cached && f._aiExplanation) cached = f._aiExplanation;
      if (cached) {
        whyEl.textContent = cached;
        whyEl.hidden = false;
      } else {
        whyEl.textContent = '';
        whyEl.hidden = true;
      }
    }

    // Position label
    if (pos) pos.textContent = (_index + 1).toLocaleString() + ' of ' + _filtered.length.toLocaleString();

    // Progress dots — sliding window of 5
    renderDots(_index, _filtered.length);

    // Update filter chip label (state changed)
    updateFilterChipLabel();

    // Mark seen via existing FunFacts API (per-user)
    try {
      if (window.FunFacts && typeof window.FunFacts.markFactSeen === 'function') {
        window.FunFacts.markFactSeen(f.id);
      }
    } catch (_) {}

    // Transition animation (skip if prefers-reduced-motion)
    if (direction && !prefersReducedMotion()) {
      const focal = document.getElementById('deck-card-focal');
      if (focal) {
        focal.classList.remove('deck-card--in-left', 'deck-card--in-right');
        // force reflow then add the right class
        // eslint-disable-next-line no-unused-expressions
        focal.offsetWidth;
        focal.classList.add(direction === 'next' ? 'deck-card--in-right' : 'deck-card--in-left');
      }
    }
  }

  function renderDots(current, total) {
    const wrap = document.getElementById('deck-dots');
    if (!wrap) return;
    // Render exactly 5 dots: positions -2, -1, 0, +1, +2 around current.
    // For ends of the deck, the window still has 5 but shifts so the
    // current dot stays centered when possible.
    wrap.innerHTML = '';
    for (let offset = -2; offset <= 2; offset++) {
      const dot = document.createElement('span');
      dot.className = 'deck-dot';
      // Tier based on |offset|
      dot.classList.add('deck-dot--t' + Math.abs(offset));
      // If the absolute index would be invalid (<0 or >=total), treat as ghost
      const abs = current + offset;
      if (abs < 0 || abs >= total) dot.classList.add('deck-dot--ghost');
      wrap.appendChild(dot);
    }
  }

  function updateFilterChipLabel() {
    const lbl = document.getElementById('deck-filter-label');
    if (!lbl) return;
    const sLabel = state.subject === 'all' ? 'All subjects' :
                   state.subject[0].toUpperCase() + state.subject.slice(1);
    const aLabel = state.grade === 'all' ? 'All ages' :
                   state.grade === 'k-2' ? 'K–2' :
                   state.grade === '3-4' ? 'Grades 3–4' :
                   state.grade === '5-8' ? 'Grades 5–8' : state.grade;
    lbl.textContent = sLabel + ' · ' + aLabel;
  }

  // ============================================================
  // Navigation: next / prev / "even weirder" (same category)
  // ============================================================
  function next() {
    if (!_filtered.length) return;
    _index = (_index + 1) % _filtered.length;
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
    const sameCat = _filtered
      .map((f, i) => ({ f, i }))
      .filter(({ f, i }) => i !== _index && f.category === here.category);
    const pool = sameCat.length ? sameCat : _filtered.map((f, i) => ({ f, i })).filter(({ i }) => i !== _index);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    _index = pick.i;
    render('next');
  }

  // ============================================================
  // AI Why? — call lambda action funFactExplain
  // ============================================================
  async function fetchWhy() {
    if (!_filtered.length) return;
    const f = _filtered[_index];
    if (!f) return;
    // Cache hits
    if (_explanationCache.has(f.id)) {
      revealWhy(_explanationCache.get(f.id));
      return;
    }
    if (f._aiExplanation) {
      _explanationCache.set(f.id, f._aiExplanation);
      revealWhy(f._aiExplanation);
      return;
    }
    const btn = document.getElementById('deck-btn-why');
    if (btn) {
      btn.disabled = true;
      btn.classList.add('deck-action--loading');
    }
    try {
      const res = await fetch(TUTOR_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'funFactExplain',
          factId: f.id,
          fact: f.fact,
          category: f.category,
          grade: f.gradeLevel || (Array.isArray(f.gradeLevels) ? f.gradeLevels[0] : '3-4')
        })
      });
      if (!res.ok) throw new Error('explain ' + res.status);
      const body = await res.json();
      const text = body && body.explanation ? String(body.explanation).trim() : '';
      if (text) {
        _explanationCache.set(f.id, text);
        // Stamp the catalog row so subsequent visits skip the API call
        f._aiExplanation = text;
        revealWhy(text);
      }
    } catch (e) {
      console.warn('[deck] why fetch failed:', e && e.message);
      revealWhy("That's just how it is — try asking a grown-up for the deeper reason.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.classList.remove('deck-action--loading');
      }
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
  // Save flow
  // ============================================================
  function toggleSaveOnCurrent() {
    if (!_filtered.length) return;
    const f = _filtered[_index];
    const nowSaved = toggleSaved(f.id);
    const btn = document.getElementById('deck-btn-save');
    if (btn) {
      btn.setAttribute('aria-pressed', nowSaved ? 'true' : 'false');
      btn.classList.toggle('deck-action--saved', nowSaved);
      const heart = btn.querySelector('.deck-heart');
      if (heart) {
        heart.textContent = nowSaved ? '💛' : '💚';
        if (!prefersReducedMotion()) {
          heart.classList.remove('deck-heart--bounce');
          // eslint-disable-next-line no-unused-expressions
          heart.offsetWidth;
          heart.classList.add('deck-heart--bounce');
        }
      }
    }
  }

  // ============================================================
  // Filter dialog
  // ============================================================
  function openFilterDialog() {
    const dlg = document.getElementById('deck-filter-dialog');
    if (!dlg) return;
    // Sync pill active states to current state
    document.querySelectorAll('.deck-fpill').forEach(b => {
      const f = b.dataset.filter, v = b.dataset.value;
      const target = f === 'subject' ? state.subject : state.grade;
      b.classList.toggle('deck-fpill--active', v === target);
      b.setAttribute('aria-checked', v === target ? 'true' : 'false');
    });
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
    document.querySelectorAll('.deck-fpill').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter, v = btn.dataset.value;
        if (!f || !v) return;
        if (f === 'subject') state.subject = v;
        if (f === 'grade')   state.grade   = v;
        // Active class swap within this row
        btn.parentElement.querySelectorAll('.deck-fpill').forEach(b => {
          b.classList.toggle('deck-fpill--active', b === btn);
          b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
        });
      });
    });
    const apply = document.getElementById('deck-filter-apply');
    if (apply) apply.addEventListener('click', () => {
      closeFilterDialog();
      updateURL();
      rebuildDeck();
    });
    const close = document.getElementById('deck-filter-close');
    if (close) close.addEventListener('click', closeFilterDialog);
  }

  // ============================================================
  // Keyboard + swipe
  // ============================================================
  function wireKeyboard() {
    document.addEventListener('keydown', e => {
      // Ignore if focus is in an input/textarea (filter dialog text inputs)
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); fetchWhy(); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); toggleSaveOnCurrent(); }
    });
  }
  function wireSwipe() {
    const stage = document.getElementById('deck-stage');
    if (!stage) return;
    let startX = 0, startY = 0, tracking = false;
    stage.addEventListener('touchstart', e => {
      if (!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
    }, { passive: true });
    stage.addEventListener('touchend', e => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) next(); else prev();
      }
    }, { passive: true });
  }

  // ============================================================
  // Boot
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
    const emptyCta = document.getElementById('deck-empty-cta');
    if (emptyCta) emptyCta.addEventListener('click', () => {
      state.subject = 'all'; state.grade = 'all';
      updateURL();
      rebuildDeck();
    });

    await loadCatalog();
    rebuildDeck();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
