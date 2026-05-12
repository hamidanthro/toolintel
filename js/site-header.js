/**
 * site-header.js — canonical site header normalizer.
 *
 * Why: each app page used to ship its own <header class="site-header">
 * HTML block. Over time these drifted — some had the logo, some didn't;
 * some had 3 nav items, some had 6; some had the ⌘K search hint, some
 * didn't. Trophies (achievements.html) was visually broken — no brand
 * on the left — and the §11/§18 signed-out simplification only fired
 * on the homepage + grade page.
 *
 * Fix: one script, runs on every app page, replaces the .container
 * inside .site-header with a canonical brand + nav + user-slot triplet.
 * Authoritative for app-shell pages only — the SEO content surfaces
 * (body.fw-page) and MySpace (body.myspace-page) own their own headers
 * and are intentionally skipped.
 *
 * Trigger order:
 *   1. auth.js runs (defines window.STAARAuth)
 *   2. site-header.js runs (this file) — normalizes the DOM
 *   3. auth.js's STAARAuth.refreshHeader() is called by us to repopulate
 *      the new #user-slot
 *   4. quick-search.js's injectHeaderHint() is called to add the ⌘K pill
 *
 * Public API: window.GradeEarnSiteHeader.normalize()
 */

(function () {
  'use strict';

  // Skip pages that own their own header design:
  //   .fw-page       — SEO content surfaces (/free-worksheets/, /articles/, /glossary/, /blog/)
  //   .myspace-page  — kid-facing personal dashboard with light-theme custom header
  //   .admin-page    — admin nav has Admin-specific links (Home / Toys / Admin)
  if (document.body.classList.contains('fw-page')) return;
  if (document.body.classList.contains('myspace-page')) return;
  if (document.body.classList.contains('admin-page')) return;

  // Canonical nav items.
  //   authOnly = hidden for signed-out users (signed-in only)
  //   anonOnly = hidden for signed-in users (signed-out only — sales/marketing)
  // Order matters — this is the left-to-right reading order in the pill.
  const NAV_ITEMS = [
    { href: '/index.html',        label: 'Home',        i18n: 'nav.home' },
    { href: '/myspace.html',      label: 'MySpace',                            authOnly: true },
    { href: '/achievements.html', label: 'Trophies',    i18n: 'nav.trophies',  authOnly: true },
    { href: '/league.html',       label: 'League',                              authOnly: true },
    { href: '/games.html',        label: 'Games' },
    { href: '/marketplace.html',  label: 'Toys',        i18n: 'nav.toys' },
    { href: '/about.html',        label: 'How it works', i18n: 'nav.howItWorks', anonOnly: true },
  ];

  function isCurrentPath(href) {
    let path = location.pathname || '/';
    // Treat / as /index.html
    if (path === '/' || path === '') path = '/index.html';
    return path === href;
  }

  function isSignedIn() {
    try {
      return !!(window.STAARAuth
        && typeof window.STAARAuth.currentUser === 'function'
        && window.STAARAuth.currentUser());
    } catch (_) { return false; }
  }

  function brandHtml() {
    return [
      '<a href="/index.html" class="brand" aria-label="GradeEarn home">',
        '<svg class="brand-logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">',
          '<defs><linearGradient id="ghStarGrad" x1="0%" y1="0%" x2="100%" y2="100%">',
            '<stop offset="0%" stop-color="#fde047"/>',
            '<stop offset="55%" stop-color="#fbbf24"/>',
            '<stop offset="100%" stop-color="#f59e0b"/>',
          '</linearGradient></defs>',
          '<path d="M16 2.6 19.6 11.5 29.2 12.2 21.8 18.4 24.2 27.6 16 22.4 7.8 27.6 10.2 18.4 2.8 12.2 12.4 11.5 Z" ',
                'fill="url(#ghStarGrad)" stroke="rgba(255,255,255,0.18)" stroke-width="0.6" stroke-linejoin="round"/>',
          '<circle cx="25" cy="6" r="1.6" fill="#fde047" opacity="0.95"/>',
          '<circle cx="25" cy="6" r="3" fill="#fde047" opacity="0.25"/>',
        '</svg>',
        '<span class="brand-text">Grade<span class="brand-text-accent">Earn</span></span>',
      '</a>'
    ].join('');
  }

  function navHtml(signedIn) {
    const items = NAV_ITEMS.filter(function (i) {
      if (i.authOnly && !signedIn) return false;
      if (i.anonOnly && signedIn) return false;
      return true;
    });
    const links = items.map(function (i) {
      const active = isCurrentPath(i.href) ? ' class="active"' : '';
      const i18n = i.i18n ? ' data-i18n="' + i.i18n + '"' : '';
      return '<a href="' + i.href + '"' + active + i18n + '>' + i.label + '</a>';
    }).join('');
    return '<nav class="nav" aria-label="Primary">' + links + '</nav>';
  }

  function userSlotHtml() {
    return '<div id="user-slot" class="user-slot"></div>';
  }

  function normalize() {
    const header = document.querySelector('header.site-header');
    if (!header) return;

    let container = header.querySelector('.container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'container';
      header.innerHTML = '';
      header.appendChild(container);
    }

    const signedIn = isSignedIn();
    container.innerHTML = brandHtml() + navHtml(signedIn) + userSlotHtml();

    // Re-populate #user-slot (Sign in button OR avatar pill)
    if (window.STAARAuth && typeof window.STAARAuth.refreshHeader === 'function') {
      try { window.STAARAuth.refreshHeader(); } catch (_) {}
    }

    // Re-inject the ⌘K search hint (only present on desktop per its own CSS).
    // quick-search.js exposes this so we can call it after rebuilding DOM.
    if (window.GradeEarnQuickSearch && typeof window.GradeEarnQuickSearch.injectHeaderHint === 'function') {
      try { window.GradeEarnQuickSearch.injectHeaderHint(); } catch (_) {}
    }
  }

  // First run: wait for DOMContentLoaded so STAARAuth is already loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', normalize);
  } else {
    normalize();
  }

  // Re-normalize when auth state changes in another tab (sign in/out)
  window.addEventListener('storage', function (e) {
    if (e && e.key && (e.key.indexOf('staar.user') === 0 || e.key.indexOf('staar.token') === 0)) {
      normalize();
    }
  });

  // Re-normalize when this tab signs in/out (auth.js fires this)
  if (!window._gradeearnSiteHeaderBound) {
    window._gradeearnSiteHeaderBound = true;
    const orig = window.onSTAARLogin;
    window.onSTAARLogin = function (u) {
      try { normalize(); } catch (_) {}
      if (typeof orig === 'function') {
        try { orig(u); } catch (_) {}
      }
    };
  }

  // Public hook
  window.GradeEarnSiteHeader = { normalize: normalize };
})();
