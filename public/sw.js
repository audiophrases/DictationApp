// Service worker: makes the app installable (a shelf/launcher icon on a
// Chromebook, its own window, no browser chrome) and makes the shell load from
// disk instead of the network.
//
// Caching rules are deliberately split by what the URL guarantees:
//
//   /assets/*   Vite content-hashes these, so a given URL can never change its
//               contents — safe to serve from cache forever.
//   navigations Network FIRST, cache only as an offline fallback. index.html is
//               the one unhashed file, and a stale copy would point at hashed
//               assets a redeploy has already deleted — a blank app. Being
//               correct after a redeploy matters more than saving one request.
//   /api/*, /health  Never cached. Passages must be fresh, and /health has to
//               reflect the real server or the warm-up check becomes a lie.
//
// Audio from /api/tts is intentionally left alone: it is already cached by the
// browser (immutable) and prefetched by useSpeech, and mirroring it here would
// only fill up the student's storage quota.
const VERSION = 'v1';
const SHELL_CACHE = `dictation-shell-${VERSION}`;
const ASSET_CACHE = `dictation-assets-${VERSION}`;

// Enough to boot the app offline; the hashed bundles join ASSET_CACHE as soon as
// the page has been opened once.
const SHELL_FILES = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one missing file can't fail the whole install.
      await Promise.all(
        SHELL_FILES.map((file) =>
          cache.add(new Request(file, { cache: 'reload' })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL_CACHE, ASSET_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName, fallbackPath) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const hit = (await cache.match(request)) || (fallbackPath && (await cache.match(fallbackPath)));
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL_CACHE, '/index.html'));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }

  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});
