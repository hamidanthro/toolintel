/**
 * GradeEarn — Service Worker
 *
 * Strategy: cache-first for static assets, network-first for HTML and API calls.
 * Versioned cache: bump CACHE_VERSION to invalidate.
 *
 * Critical: never cache API responses (Lambda calls). They must always be fresh.
 */

const CACHE_VERSION = 'gradeearn-v84';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Files to pre-cache on install (the "app shell"). Updated 2026-05-10
// for the rewards-v2 + i18n + topic-picker rounds (achievements,
// subject, i18n, mastery, achievements-page modules).
const SHELL_FILES = [
  '/',
  '/index.html',
  '/about.html',
  '/marketplace.html',
  '/practice.html',
  '/grade.html',
  '/achievements.html',
  '/subject.html',
  '/settings.html',
  '/states/index.html',
  '/css/styles.css',
  '/js/states-data.js',
  '/js/auth.js',
  '/js/fun-facts.js',
  '/js/fun-facts-settings.js',
  '/js/speech.js',
  '/js/reading-render.js',
  '/js/stopwords.js',
  '/js/state-picker.js',
  '/js/dashboard.js',
  '/js/grade-page.js',
  '/js/about-page.js',
  '/js/practice.js',
  '/js/pwa-install.js',
  '/js/i18n.js',
  '/js/achievements.js',
  '/js/achievements-page.js',
  '/js/mastery.js',
  '/js/subject-page.js',
  '/js/spaced-rep.js',
  '/js/text-utils.js',
  '/js/voice-recorder.js',
  '/js/placement.js',
  '/js/push-subscribe.js',
  '/js/league.js',
  '/js/games/word-connect.js',
  '/js/games/memory-match.js',
  '/js/games/math-sprint.js',
  '/js/games/equation-builder.js',
  '/js/games/number-line.js',
  '/js/games/pattern-builder.js',
  '/js/games/twenty-four.js',
  '/js/games/math-bingo.js',
  '/js/games/sudoku-mini.js',
  '/js/games/spelling-bee.js',
  '/js/games/word-ladder.js',
  '/js/games/story-sequence.js',
  '/js/games/texas-map.js',
  '/js/games/number-tetris.js',
  '/js/games/match-engine.js',
  '/js/games/showdown.js',
  '/js/games/battle-royale.js',
  '/js/games/bear-cub.js',
  '/games.html',
  '/games/word-connect.html',
  '/games/memory-match.html',
  '/games/math-sprint.html',
  '/games/equation-builder.html',
  '/games/number-line.html',
  '/games/pattern-builder.html',
  '/games/twenty-four.html',
  '/games/math-bingo.html',
  '/games/sudoku-mini.html',
  '/games/spelling-bee.html',
  '/games/word-ladder.html',
  '/games/story-sequence.html',
  '/games/texas-map.html',
  '/games/number-tetris.html',
  '/games/showdown.html',
  '/games/battle-royale.html',
  '/games/bear-cub.html',
  '/data/games/word-connect-puzzles.json',
  '/data/games/memory-match-puzzles.json',
  '/data/games/spelling-bee-words.json',
  '/data/games/word-ladder-puzzles.json',
  '/data/games/story-sequence-stories.json',
  '/js/parent.js',
  '/js/family-switcher.js',
  '/league.html',
  '/parent.html',
  '/placement.html',
  '/data/i18n/en.json',
  '/data/i18n/es.json',
  '/data/achievements.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

// API hostnames that should NEVER be cached
const NEVER_CACHE_HOSTS = [
  '4wvuw21yjl.execute-api.us-east-1.amazonaws.com',
  'ipapi.co'
];

// ============================================================
// INSTALL — pre-cache shell
// ============================================================

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.allSettled(
        SHELL_FILES.map((url) =>
          cache.add(url).catch((err) => {
            console.warn(`[SW] Failed to cache ${url}:`, err.message);
          })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — clean up old caches
// ============================================================

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — runtime caching strategy
// ============================================================

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET; let POST/PUT/DELETE pass through
  if (request.method !== 'GET') return;

  // Never cache API calls — always go to network
  if (NEVER_CACHE_HOSTS.some((host) => url.hostname === host)) {
    return;
  }

  // HTML: network-first, falls back to cache
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return caches.match('/index.html');
          });
        })
    );
    return;
  }

  // Static assets: cache-first, fall back to network (stale-while-revalidate)
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        fetch(request)
          .then((response) => {
            if (response.ok) {
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, response));
            }
          })
          .catch(() => {});
        return cached;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type === 'opaque') {
          return response;
        }
        const clone = response.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
        return response;
      }).catch(() => {
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' }
        });
      });
    })
  );
});

// ============================================================
// MESSAGE — let the page send 'SKIP_WAITING' to force update
// ============================================================

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Tier 6 AD — Web Push handlers.
//
// 'push' fires when the server delivers a push message (VAPID-signed via
// the web-push npm package; not wired on the server yet — that's the
// next-step in CLAUDE.md). Payload shape: {title, body, url, tag}.
// Falls back to a kid-friendly default if the payload is missing.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    if (event.data) data = event.data.json();
  } catch (_) {
    // Plain-text payload; tolerate it.
    try { data = { body: event.data && event.data.text() }; } catch (_) {}
  }
  const title = data.title || 'GradeEarn';
  const body  = data.body  || 'Your daily mission is ready.';
  const url   = data.url   || '/';
  const tag   = data.tag   || 'gradeearn-default';
  const options = {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: tag,
    data: { url: url },
    vibrate: [80, 40, 80]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 'notificationclick' — bring the app to focus on the requested URL.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an existing tab on the same origin if one exists.
      for (const client of clientList) {
        try {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        } catch (_) {}
      }
      // Otherwise open a new tab.
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
