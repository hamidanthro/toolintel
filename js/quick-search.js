/**
 * GradeEarn — Quick Search palette (Cmd+K / Ctrl+K).
 *
 * Premium IDE-style command palette: fuzzy-search states + grades +
 * subjects, jump straight into practice. Uses window.STATES from
 * states-data.js as the data source. No backend dep, fully client-side.
 *
 * Triggers:
 *   - Cmd+K (Mac) / Ctrl+K (Win/Linux)
 *   - Optional: any element with data-quick-search-trigger attribute
 *
 * Result types (priority order):
 *   1. Exact state slug / abbr match
 *   2. State name prefix
 *   3. State + grade combos (e.g. "tx 5 math")
 *   4. Bare-grade fallback (uses currently-selected state)
 */
(function () {
  if (window.GradeEarnQuickSearch) return; // load-once guard

  const SUBJECTS = ['math', 'reading', 'science', 'social-studies'];
  const GRADE_LABELS = {
    'grade-k': 'K', 'grade-1': '1', 'grade-2': '2', 'grade-3': '3',
    'grade-4': '4', 'grade-5': '5', 'grade-6': '6', 'grade-7': '7',
    'grade-8': '8', 'grade-9': '9', 'grade-10': '10', 'grade-11': '11',
    'grade-12': '12', 'algebra-1': 'Algebra 1'
  };

  let isOpen = false;
  let modal = null;

  function getStates() {
    return Array.isArray(window.STATES) ? window.STATES : [];
  }

  function getCurrentState() {
    try {
      const slug = localStorage.getItem('gradeearn.state');
      if (slug) return getStates().find(s => s.slug === slug) || null;
    } catch (_) {}
    return null;
  }

  function buildIndex() {
    const states = getStates();
    const items = [];
    for (const s of states) {
      // State entry — opens grade picker for that state
      items.push({
        kind: 'state',
        title: s.name,
        subtitle: `${s.testName} · ${(s.gradesTested || []).length} grades`,
        href: `grades.html?s=${encodeURIComponent(s.slug)}`,
        searchKey: `${s.name} ${s.nameAbbr || ''} ${s.slug} ${s.testName || ''}`.toLowerCase()
      });
      // Per-grade entries for the user's current state, plus flagship states
      const flagship = ['texas', 'california', 'florida', 'new-york'].includes(s.slug);
      const cur = getCurrentState();
      const isCurrent = cur && cur.slug === s.slug;
      if (!flagship && !isCurrent) continue;
      const grades = (s.gradesTested || []);
      for (const g of grades) {
        const gradeLabel = GRADE_LABELS[g] || g;
        items.push({
          kind: 'grade',
          title: `${s.name} · Grade ${gradeLabel}`,
          subtitle: `Math · Reading${(s.gradesTestedBySubject?.science || []).includes(g) ? ' · Science' : ''}`,
          href: `grade.html?s=${encodeURIComponent(s.slug)}&g=${encodeURIComponent(g)}`,
          searchKey: `${s.name} ${s.nameAbbr || ''} ${gradeLabel} grade ${g}`.toLowerCase()
        });
      }
    }
    // Top-level shortcuts
    items.push(
      { kind: 'shortcut', title: 'My dashboard', subtitle: 'Streak, recent practice, fun facts', href: 'index.html', searchKey: 'home dashboard' },
      { kind: 'shortcut', title: 'Toy marketplace', subtitle: 'Spend points on real toys', href: 'marketplace.html', searchKey: 'toys marketplace shop' },
      { kind: 'shortcut', title: 'Browse all grades', subtitle: 'States × grades × subjects', href: 'grades.html', searchKey: 'browse all grades' },
      { kind: 'shortcut', title: 'How GradeEarn works', subtitle: 'About + parent info', href: 'about.html', searchKey: 'about how it works info' },
      { kind: 'shortcut', title: 'Settings', subtitle: 'Account, profile, daily goal', href: 'settings.html', searchKey: 'settings preferences profile' },
      { kind: 'shortcut', title: 'Review wrong answers', subtitle: 'Re-do questions you missed', href: 'practice.html?review=1', searchKey: 'review wrong answers misses' }
    );
    return items;
  }

  function score(item, query) {
    if (!query) return 1;
    const q = query.toLowerCase().trim();
    const k = item.searchKey;
    if (k.startsWith(q)) return 100;
    if (k.includes(' ' + q)) return 80;
    if (k.includes(q)) return 60;
    // Fuzzy: every query char appears in order in key
    let i = 0;
    for (const c of k) { if (c === q[i]) i++; if (i === q.length) return 40; }
    return 0;
  }

  function search(query) {
    const items = buildIndex();
    if (!query || !query.trim()) {
      // No query: show shortcuts + current-state grades
      return items.filter(it => it.kind === 'shortcut' || it.kind === 'grade').slice(0, 12);
    }
    return items
      .map(it => ({ it, s: score(it, query) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.it);
  }

  function render(query, focusIdx) {
    if (!modal) return;
    const results = search(query);
    const list = modal.querySelector('.qs-results');
    if (results.length === 0) {
      list.innerHTML = `<div class="qs-empty">No matches. Try "Texas grade 5" or "marketplace".</div>`;
      return;
    }
    list.innerHTML = results.map((r, i) => `
      <a class="qs-item${i === focusIdx ? ' qs-item--focus' : ''}" href="${r.href}" data-idx="${i}">
        <span class="qs-item-kind qs-item-kind--${r.kind}">${r.kind}</span>
        <span class="qs-item-title">${escapeHtml(r.title)}</span>
        <span class="qs-item-sub">${escapeHtml(r.subtitle || '')}</span>
      </a>
    `).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    document.body.style.overflow = 'hidden';
    modal = document.createElement('div');
    modal.className = 'qs-overlay';
    modal.innerHTML = `
      <div class="qs-modal" role="dialog" aria-modal="true" aria-label="Quick search">
        <div class="qs-input-wrap">
          <svg class="qs-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="qs-input" placeholder="Search states, grades, or pages…" autocomplete="off" spellcheck="false" aria-label="Search">
          <span class="qs-kbd qs-kbd--esc">esc</span>
        </div>
        <div class="qs-results" role="listbox" aria-label="Search results"></div>
        <div class="qs-footer">
          <span><span class="qs-kbd">↑</span><span class="qs-kbd">↓</span> navigate</span>
          <span><span class="qs-kbd">↵</span> open</span>
          <span><span class="qs-kbd">esc</span> close</span>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('.qs-input');
    let focusIdx = 0;
    render('', focusIdx);
    requestAnimationFrame(() => input.focus());

    function move(d) {
      const items = modal.querySelectorAll('.qs-item');
      if (!items.length) return;
      focusIdx = (focusIdx + d + items.length) % items.length;
      render(input.value, focusIdx);
    }
    function pick() {
      const items = modal.querySelectorAll('.qs-item');
      const cur = items[focusIdx] || items[0];
      if (cur) location.href = cur.getAttribute('href');
    }
    input.addEventListener('input', () => {
      focusIdx = 0;
      render(input.value, focusIdx);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(+1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    modal.querySelector('.qs-results').addEventListener('mouseover', e => {
      const it = e.target.closest('.qs-item');
      if (it) {
        focusIdx = parseInt(it.dataset.idx, 10) || 0;
        render(input.value, focusIdx);
      }
    });
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    document.body.style.overflow = '';
    if (modal) { modal.remove(); modal = null; }
  }

  function toggle() {
    if (isOpen) close();
    else open();
  }

  document.addEventListener('keydown', e => {
    const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    if (isCmdK) {
      e.preventDefault();
      toggle();
    }
  });
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-quick-search-trigger]');
    if (t) { e.preventDefault(); toggle(); }
  });

  // K4: auto-inject a Cmd+K hint chip in the site-header (desktop
  // only; CSS hides it on phones). Sits before the user-slot. Click
  // toggles the palette via the data-quick-search-trigger handler.
  function injectHeaderHint() {
    if (document.querySelector('.header-cmdk-hint')) return;
    const userSlot = document.getElementById('user-slot');
    if (!userSlot) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'header-cmdk-hint';
    btn.setAttribute('data-quick-search-trigger', '');
    btn.setAttribute('aria-label', 'Open quick search');
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      Search <kbd class="header-cmdk-kbd">⌘K</kbd>`;
    userSlot.parentNode.insertBefore(btn, userSlot);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectHeaderHint);
  } else {
    injectHeaderHint();
  }

  window.GradeEarnQuickSearch = { open, close, toggle };
})();
