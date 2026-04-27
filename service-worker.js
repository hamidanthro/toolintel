/**
 * StarTest — Service Worker
 *
 * Strategy: cache-first for static assets, network-first for HTML and API calls.
 * Versioned cache: bump CACHE_VERSION to invalidate.
 *
 * Critical: never cache API responses (Lambda calls). They must always be fresh.
 */

const CACHE_VERSION = 'startest-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// Files to pre-cache on install (the "app shell")
const SHELL_FILES = [
  '/',
  '/index.html',
  '/about.html',
  '/marketplace.html',
  '/practice.html',
  '/grade.html',
  '/states/index.html',
  '/css/styles.css',
  '/js/states-data.js',
  '/js/auth.js',
  '/js/state-picker.js',
  '/js/dashboard.js',
  '/js/grade-page.js',
  '/js/about-page.js',
  '/js/practice.js',
  '/js/pwa-install.js',
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
