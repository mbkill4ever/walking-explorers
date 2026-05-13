/* Walking Explorers — minimal offline shell service worker.
 * Strategy:
 *  - install: precache the gate, manifest, icons, fonts, leaflet css.
 *  - fetch:
 *      - API (`/api/`) and POSTs:        network-only, never cached
 *      - same-origin static GETs:        network-first (with cache fallback) for /beta and /
 *                                        cache-first for other static assets
 *      - cross-origin GETs (fonts/cdn):  stale-while-revalidate
 *  - activate: clean up old caches.
 *
 * Bump CACHE_VERSION when shipping breaking changes to precached assets.
 */
const CACHE_VERSION = 'we-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// HTML pages we precache for offline boot, but always try network first
// so users get the latest gate / app shell when online.
const HTML_PRECACHE = ['/', '/beta'];
const PRECACHE_URLS = [
  ...HTML_PRECACHE,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { credentials: 'same-origin' })).catch(() => null)
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

function isHtmlPrecachePath(pathname) {
  return HTML_PRECACHE.includes(pathname) || HTML_PRECACHE.includes(pathname.replace(/\/$/, ''));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never cache API
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  if (!url.protocol.startsWith('http')) return;

  // Same-origin
  if (url.origin === self.location.origin) {
    // For HTML pages (/, /beta) prefer the network so users always see the
    // freshest gate. Fall back to cache only if offline.
    if (isHtmlPrecachePath(url.pathname) || req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      event.respondWith(
        fetch(req).then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => caches.match(req).then((cached) => cached || caches.match('/beta')))
      );
      return;
    }

    // Other same-origin static assets: cache-first
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }).catch(() => caches.match('/beta'));
      })
    );
    return;
  }

  // Cross-origin: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
