// StarTest — single source of truth for grade-card rendering and grade-gating.
// Exposes:
//   window.STAARGradeAccess.getVisibleGrades(user)   -> grade list a user can see
//   window.STAARGradeAccess.canPracticeGrade(user, slug) -> bool
//   window.STAARGradeCard.render(grade, opts)        -> HTMLAnchorElement | HTMLDivElement
//   window.STAARGradeCard.html(grade, opts)          -> string (innerHTML form)
//
// Depends on:
//   window.STAAR_GRADES (from staar-data.js)
//   window.STAARAuth.gradeLevel / userGradeLevel (from auth.js)
//
// Grade-gating policy (Step 3 of Prompt 21):
//   - Logged-out users see all grades (acquisition surface).
//   - Logged-in users see only their grade and above (no farming below-level points).
//   - If a user's grade can't be resolved, fall back to showing all grades.
(function () {
  'use strict';

  // --- UI metadata enrichment for STAAR_GRADES entries (level / ages / popular) ---
  const META = {
    'grade-k':   { level: 0, ages: 'Ages 5–6',   popular: false, icon: 'K'  },
    'grade-1':   { level: 1, ages: 'Ages 6–7',   popular: false, icon: '1'  },
    'grade-2':   { level: 2, ages: 'Ages 7–8',   popular: false, icon: '2'  },
    'grade-3':   { level: 3, ages: 'Ages 8–9',   popular: true,  icon: '3'  },
    'grade-4':   { level: 4, ages: 'Ages 9–10',  popular: false, icon: '4'  },
    'grade-5':   { level: 5, ages: 'Ages 10–11', popular: false, icon: '5'  },
    'grade-6':   { level: 6, ages: 'Ages 11–12', popular: false, icon: '6'  },
    'grade-7':   { level: 7, ages: 'Ages 12–13', popular: false, icon: '7'  },
    'grade-8':   { level: 8, ages: 'Ages 13–14', popular: false, icon: '8'  },
    'algebra-1': { level: 9, ages: 'High school',popular: false, icon: 'A1' }
  };

  function metaFor(slug) {
    return META[slug] || { level: -1, ages: '', popular: false, icon: '★' };
  }

  // --- Grade-access helpers ---------------------------------------------------
  function currentUser() {
    try { return (window.STAARAuth && window.STAARAuth.currentUser && window.STAARAuth.currentUser()) || null; }
    catch (_) { return null; }
  }

  function userMinLevel(user) {
    const u = user === undefined ? currentUser() : user;
    if (!u || !u.grade) return -Infinity;
    const m = META[u.grade];
    return m ? m.level : -Infinity;
  }

  function getVisibleGrades(user) {
    const list = (window.STAAR_GRADES || []).slice();
    const min = userMinLevel(user);
    if (!isFinite(min)) return list;
    return list.filter(g => metaFor(g.slug).level >= min);
  }

  function canPracticeGrade(user, slug) {
    const min = userMinLevel(user);
    if (!isFinite(min)) return true; // logged-out can practice anything (guest mode)
    const m = META[slug];
    if (!m) return false;
    return m.level >= min;
  }

  // --- Shared GradeCard component --------------------------------------------
  // opts:
  //   variant:     'default' | 'compact' | 'practice'
  //                  default  = full landing/marketplace card
  //                  compact  = dashboard tile with progress bar
  //                  practice = full card on the practice-select page
  //   isCurrent:   bool  -> adds .grade-card--current and "Your grade" badge
  //   isLocked:    bool  -> renders as <div>, adds .grade-card--locked, "Below your grade" badge
  //   href:        string override (defaults: practice→practice.html?g=, default→grade.html?g=)
  //   progress:    { pct, answered, target } for compact variant
  function html(grade, opts) {
    opts = opts || {};
    const m = metaFor(grade.slug);
    const subject = (grade.subject || 'Math').toUpperCase();
    const variant = opts.variant || 'default';
    const isCurrent = !!opts.isCurrent;
    const isLocked = !!opts.isLocked;
    const isPopular = !!m.popular && !isCurrent && !isLocked;
    const isKinder = grade.slug === 'grade-k';

    // ---- COMPACT (dashboard tile with progress) ----
    if (variant === 'compact') {
      const p = opts.progress || { pct: 0, answered: 0, target: 300 };
      const ageBit = m.ages ? ' · ' + m.ages : '';
      return `
        <div class="dashboard-grade-tile-header">
          <span class="dashboard-grade-tile-eyebrow">STATE TEST · ${subject}</span>
          <div class="dashboard-grade-tile-icon">${m.icon}</div>
        </div>
        <h4 class="dashboard-grade-tile-title">${grade.title}</h4>
        <p class="dashboard-grade-tile-meta">${grade.categories.length} reporting categories${ageBit}</p>
        <div class="dashboard-grade-tile-progress">
          <div class="tile-progress-bar"><div class="tile-progress-fill" style="width:${p.pct}%"></div></div>
          <span class="tile-progress-text">${p.pct}% · ${p.answered}/${p.target}</span>
        </div>`;
    }

    // ---- DEFAULT / PRACTICE (full card) ----
    const popularBadge = isPopular
      ? '<span class="grade-card-badge">Most popular</span>'
      : '';
    const currentBadge = isCurrent
      ? '<span class="grade-card-badge grade-card-badge--current">Your grade</span>'
      : '';
    const lockedBadge = isLocked
      ? '<span class="grade-card-badge grade-card-badge--locked">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">' +
          '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>' +
          ' Below your grade</span>'
      : '';

    return `
      ${popularBadge}${currentBadge}${lockedBadge}
      <div class="grade-card-head">
        <span class="grade-card-eyebrow">State test &middot; ${subject.charAt(0) + subject.slice(1).toLowerCase()}</span>
        <span class="grade-card-icon">${m.icon}</span>
      </div>
      <h3 class="grade-card-title">${grade.title}</h3>
      <p class="grade-card-meta">${grade.categories.length} reporting categories</p>
      <div class="grade-card-foot">
        <span class="grade-card-age">${m.ages}</span>
        <span class="grade-card-arrow" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7H11M11 7L7.5 3.5M11 7L7.5 10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>`;
  }

  function render(grade, opts) {
    opts = opts || {};
    const variant = opts.variant || 'default';
    const isLocked = !!opts.isLocked;
    const tag = isLocked ? 'div' : 'a';
    const el = document.createElement(tag);

    if (!isLocked) {
      const defaultHref = variant === 'practice'
        ? `practice.html?g=${encodeURIComponent(grade.slug)}`
        : `grade.html?g=${encodeURIComponent(grade.slug)}`;
      el.href = opts.href || defaultHref;
    }

    const m = metaFor(grade.slug);
    const isCurrent = !!opts.isCurrent;
    const isPopular = !!m.popular && !isCurrent && !isLocked;
    const isKinder = grade.slug === 'grade-k';

    const cls = [
      variant === 'compact' ? 'dashboard-grade-tile' : 'grade-card',
      variant === 'compact' ? null : `grade-card--${variant}`,
      isCurrent ? 'grade-card--current' : null,
      isPopular ? 'grade-card--popular' : null,
      isKinder && variant !== 'compact' ? 'grade-card--kinder' : null,
      isLocked ? 'grade-card--locked' : null
    ].filter(Boolean).join(' ');
    el.className = cls;
    if (isLocked) el.setAttribute('aria-disabled', 'true');

    el.innerHTML = html(grade, opts);
    return el;
  }

  window.STAARGradeAccess = { getVisibleGrades, canPracticeGrade, metaFor };
  window.STAARGradeCard = { render, html };
})();
