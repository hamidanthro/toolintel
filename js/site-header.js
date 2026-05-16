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
    // §109 — wordmark-only. Star icon dropped per premium pass.
    // Logos-with-icons read fast-shipped; pure wordmarks (Stripe,
    // Linear, Vercel, Anthropic) read pedigreed. Letter-spacing
    // applied in CSS on .brand-text.
    return [
      '<a href="/index.html" class="brand brand--wordmark" aria-label="GradeEarn home">',
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

  // §122 — Mobile hamburger button. Sits next to the wordmark; the
  // nav pill is hidden on <768px (CSS). Click toggles a slide-down
  // panel that renders the same NAV_ITEMS in a vertical menu.
  function hamburgerHtml() {
    return [
      '<button type="button" class="nav-toggle" aria-label="Open menu" aria-haspopup="menu" aria-expanded="false">',
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/></svg>',
      '</button>'
    ].join('');
  }

  function mobileNavPanelHtml(signedIn) {
    const items = NAV_ITEMS.filter(function (i) {
      if (i.authOnly && !signedIn) return false;
      if (i.anonOnly && signedIn) return false;
      return true;
    });
    const links = items.map(function (i) {
      const active = isCurrentPath(i.href) ? ' class="active"' : '';
      return '<a href="' + i.href + '"' + active + '>' + i.label + '</a>';
    }).join('');
    return '<div class="nav-mobile-panel" role="menu" hidden>' + links + '</div>';
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
    container.innerHTML = hamburgerHtml() + brandHtml() + navHtml(signedIn) + userSlotHtml() + mobileNavPanelHtml(signedIn);

    // §122 — wire the hamburger toggle.
    const toggle = container.querySelector('.nav-toggle');
    const panel = container.querySelector('.nav-mobile-panel');
    if (toggle && panel) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        const expanded = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', String(!expanded));
        panel.hidden = expanded;
      });
      // Dismiss on outside click + Escape.
      document.addEventListener('click', function (e) {
        if (!container.contains(e.target)) {
          toggle.setAttribute('aria-expanded', 'false');
          panel.hidden = true;
        }
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          toggle.setAttribute('aria-expanded', 'false');
          panel.hidden = true;
        }
      });
    }

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
