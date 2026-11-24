/* Thock Lab service worker — generated at build time (see vite.config.ts).
 * - Precaches the app shell + every hashed build asset, so the app boots offline
 *   after the first visit.
 * - Never stores error pages, redirects or opaque responses.
 * - HTML is network-first (fresh deploys win); assets are cache-first (immutable hashes).
 */
const CACHE_VERSION = '__CACHE_VERSION__';
const CACHE_NAME = `thock-lab-${CACHE_VERSION}`;
const SHELL_URL = '/';
const PRECACHE_URLS = __PRECACHE_MANIFEST__;

function isCacheable(res) {
  return !!res && res.ok && res.status === 200 && res.type === 'basic' && !res.redirected;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          const res = await fetch(new Request(url, { cache: 'reload' }));
          if (!isCacheable(res)) throw new Error(`precache failed for ${url}: ${res.status}`);
          await cache.put(url, res);
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('thock-lab-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

async function fromCache(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request, { ignoreSearch: true });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/sw.js') return;

  if (req.mode === 'navigate') {
    const isShell = url.pathname === '/' || url.pathname === '/index.html';
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // Only a healthy, non-redirected app shell may refresh the cached shell.
          if (isShell && isCacheable(res)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(SHELL_URL, res.clone());
          }
          return res;
        } catch {
          const cached = await fromCache(SHELL_URL);
          if (cached) return cached;
          return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await fromCache(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (isCacheable(res) && url.pathname.startsWith('/assets/')) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(req, res.clone());
        }
        return res;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })()
  );
});
