/**
 * GradeEarn — FACTS BROWSE PAGE (§75 May 13)
 *
 * Replaces the inline fact-card mount in the practice flow. The
 * every-5-correct trigger was a context-break for kids hunting
 * points. Facts now live on /facts.html as a browsable, filterable
 * feed — subject-aware AND age-aware.
 *
 * Reuses the existing FunFacts catalog (data/fun-facts.json,
 * loaded by js/fun-facts.js). Adds:
 *   - subject→category map (math / reading / science / all)
 *   - filter pill row wiring
 *   - paginated render (30 per page, "Show more" to load more)
 *   - URL query-string support (?subj=math&age=3-4 deep-links)
 */
(function () {
  'use strict';

  // ----- Subject → categories. The catalog tags facts with one of
  // ~15 categories; we group those into the three product subjects
  // so the kid sees a coherent set under each. 'texas' is opt-in
  // and only appears under "All" — per user directive "go global,
  // don't push Texas hard". -----
  const SUBJECT_CATEGORIES = {
    math:    ['math-numbers', 'space', 'inventions', 'robots-tech', 'weird-funny'],
    reading: ['mythology',    'history', 'music',     'weird-funny', 'animals'],
    science: ['animals',      'body',  'space', 'dinosaurs', 'robots-tech', 'geography', 'food'],
    all:     null   // null sentinel = no category filter
  };

  // Catalog: try the in-memory cache from window.FunFacts first
  // (fast path if the kid was just on practice), fall back to a
  // direct fetch.
  const CATALOG_URL = '/data/fun-facts.json?v=20260510k';
  let _catalog = null;
  let _seenSet = null;

  async function loadCatalog() {
    if (_catalog) return _catalog;
    // Fast path — FunFacts already loaded it
    if (window.FunFacts && typeof window.FunFacts._getCatalog === 'function') {
      const cached = window.FunFacts._getCatalog();
      if (Array.isArray(cached) && cached.length) {
        _catalog = cached;
        return _catalog;
      }
    }
    // Fetch direct
    try {
      const res = await fetch(CATALOG_URL, { cache: 'force-cache' });
      if (!res.ok) throw new Error('catalog fetch ' + res.status);
      _catalog = await res.json();
      return _catalog;
    } catch (e) {
      console.warn('[facts] catalog load failed:', e && e.message);
      _catalog = [];
      return _catalog;
    }
  }

  // Seen-set: the catalog already tracks "seen" via FunFacts
  // localStorage (gradeearn:ff:seen). Read it once on init so
  // we can stamp "✓ seen" badges on the feed cards.
  function loadSeenSet() {
    if (_seenSet) return _seenSet;
    try {
      if (window.FunFacts && typeof window.FunFacts._getSeenIds === 'function') {
        _seenSet = new Set(window.FunFacts._getSeenIds());
        return _seenSet;
      }
      const raw = localStorage.getItem('gradeearn:ff:seen');
      _seenSet = new Set(raw ? JSON.parse(raw) : []);
    } catch (_) { _seenSet = new Set(); }
    return _seenSet;
  }

  // Active filter state — driven by the pill rows + URL params
  const state = {
    subject: 'all',  // 'all' | 'math' | 'reading' | 'science'
    grade:   'all',  // 'all' | 'k-2' | '3-4' | '5-8'
    pageSize: 30,
    visibleCount: 30
  };

  function applyURLParams() {
    try {
      const p = new URLSearchParams(location.search);
      const subj = p.get('subj') || p.get('subject');
      if (subj && SUBJECT_CATEGORIES.hasOwnProperty(subj)) state.subject = subj;
      const age = p.get('age') || p.get('grade');
      if (age === 'k-2' || age === '3-4' || age === '5-8') state.grade = age;
      // Activate matching pills visually
      document.querySelectorAll('.facts-pill').forEach(b => {
        const f = b.dataset.filter, v = b.dataset.value;
        const target = f === 'subject' ? state.subject : state.grade;
        b.classList.toggle('facts-pill--active', v === target);
        b.setAttribute('aria-checked', v === target ? 'true' : 'false');
      });
    } catch (_) {}
  }

  function updateURL() {
    try {
      const p = new URLSearchParams();
      if (state.subject !== 'all') p.set('subj', state.subject);
      if (state.grade !== 'all')   p.set('age', state.grade);
      const qs = p.toString();
      const next = qs ? '?' + qs : location.pathname;
      history.replaceState(null, '', next);
    } catch (_) {}
  }

  // Filter the catalog by current state
  function filterFacts() {
    if (!_catalog) return [];
    const cats = SUBJECT_CATEGORIES[state.subject];
    const seen = loadSeenSet();
    return _catalog.filter(f => {
      if (!f || !f.fact) return false;
      // Subject filter — match if cats is null (all) OR fact.category is in cats
      if (cats && !cats.includes(f.category)) return false;
      // Grade filter — fact.gradeLevel (single) OR fact.gradeLevels[] (multi)
      if (state.grade !== 'all') {
        const grades = Array.isArray(f.gradeLevels) ? f.gradeLevels :
                       (f.gradeLevel ? [f.gradeLevel] : []);
        if (!grades.includes(state.grade)) return false;
      }
      return true;
    });
  }

  // Deterministic emoji per category (no per-fact emoji in catalog;
  // matches the practice page's old FUN_FACT_CATEGORY_EMOJI but
  // works as inline decoration here rather than a hero image)
  const CATEGORY_EMOJI = {
    animals: '🐢', body: '🧠', food: '🥑', 'weird-funny': '🎲',
    space: '🚀', sports: '🏀', dinosaurs: '🦕', mythology: '🐉',
    history: '📜', 'math-numbers': '🔢', inventions: '💡',
    music: '🎵', geography: '🌍', 'robots-tech': '🤖', texas: '⭐'
  };
  const CATEGORY_LABEL = {
    animals: 'Animals', body: 'Body', food: 'Food', 'weird-funny': 'Weird',
    space: 'Space', sports: 'Sports', dinosaurs: 'Dinos', mythology: 'Myth',
    history: 'History', 'math-numbers': 'Numbers', inventions: 'Inventions',
    music: 'Music', geography: 'Geography', 'robots-tech': 'Robots & Tech',
    texas: 'Texas'
  };

  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;');
  }

  // Render the feed
  function render() {
    const feed   = document.getElementById('facts-feed');
    const empty  = document.getElementById('facts-empty');
    const meta   = document.getElementById('facts-meta');
    const more   = document.getElementById('facts-loadmore');
    if (!feed) return;

    const all = filterFacts();
    const seen = loadSeenSet();
    const slice = all.slice(0, state.visibleCount);

    // Meta line
    if (meta) {
      meta.hidden = all.length === 0;
      const cntEl = document.getElementById('facts-count');
      const seenEl = document.getElementById('facts-seen-count');
      if (cntEl)  cntEl.textContent  = all.length.toLocaleString();
      if (seenEl) seenEl.textContent = all.filter(f => seen.has(f.id)).length.toLocaleString();
    }

    // Empty state
    if (empty) empty.hidden = all.length > 0;

    // Feed
    feed.innerHTML = slice.map(f => {
      const emoji = CATEGORY_EMOJI[f.category] || '✨';
      const catLabel = CATEGORY_LABEL[f.category] || f.category;
      const isSeen = seen.has(f.id);
      return `<article class="facts-card${isSeen ? ' facts-card--seen' : ''}" data-fact-id="${escHtml(f.id)}">
        <div class="facts-card-head">
          <span class="facts-card-emoji" aria-hidden="true">${emoji}</span>
          <span class="facts-card-cat">${escHtml(catLabel)}</span>
          ${isSeen ? '<span class="facts-card-seen" title="You’ve already seen this one">✓ seen</span>' : ''}
        </div>
        <p class="facts-card-body">${escHtml(f.fact)}</p>
      </article>`;
    }).join('');

    // Load-more visibility
    if (more) more.hidden = state.visibleCount >= all.length;

    // Mark facts seen as the kid scrolls past them. IntersectionObserver
    // gives a "passive" read-tracking without requiring taps.
    try {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          const id = e.target.getAttribute('data-fact-id');
          if (id && window.FunFacts && typeof window.FunFacts.markFactSeen === 'function') {
            window.FunFacts.markFactSeen(id);
            // Update our local set; on next render we'll show the seen badge
            _seenSet && _seenSet.add(id);
          }
        });
      }, { rootMargin: '0px 0px -40% 0px', threshold: 0.5 });
      feed.querySelectorAll('.facts-card:not(.facts-card--seen)').forEach(c => io.observe(c));
    } catch (_) {}

    // Update sub-copy with the active filters
    const subEl = document.getElementById('facts-sub');
    if (subEl) {
      const subjLabel = state.subject === 'all' ? 'all subjects' : state.subject;
      const ageLabel  = state.grade === 'all'   ? 'all ages'     :
                        state.grade === 'k-2' ? 'K–2'   :
                        state.grade === '3-4' ? 'grades 3–4' :
                        state.grade === '5-8' ? 'grades 5–8' : state.grade;
      subEl.textContent = 'Showing ' + subjLabel + ' · ' + ageLabel + '.';
    }
  }

  // Wire pill clicks
  function wirePills() {
    document.querySelectorAll('.facts-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const f = btn.dataset.filter;
        const v = btn.dataset.value;
        if (!f || !v) return;
        if (f === 'subject') state.subject = v;
        if (f === 'grade')   state.grade   = v;
        state.visibleCount = state.pageSize; // reset paging on filter change
        // Active class swap within this row
        const row = btn.parentElement;
        row.querySelectorAll('.facts-pill').forEach(b => {
          b.classList.toggle('facts-pill--active', b === btn);
          b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
        });
        updateURL();
        render();
        // Scroll to top of feed on filter change
        try { document.getElementById('facts-feed').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
      });
    });
  }

  // Wire load-more
  function wireLoadMore() {
    const btn = document.getElementById('facts-loadmore');
    if (!btn) return;
    btn.addEventListener('click', () => {
      state.visibleCount += state.pageSize;
      render();
    });
  }

  // Boot
  async function init() {
    wirePills();
    wireLoadMore();
    applyURLParams();
    await loadCatalog();
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
