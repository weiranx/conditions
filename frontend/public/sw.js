const CACHE_NAME = 'backcountry-conditions-shell-v3';
const APP_SHELL = ['/', '/index.html', '/summitsafe-icon.svg', '/manifest.webmanifest'];

function isSafeAssetResponse(response) {
  if (!response.ok) return false;
  return !response.headers.get('content-type')?.includes('text/html');
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(APP_SHELL);
  const response = await fetch('/index.html');
  if (!response.ok) return;
  const html = await response.clone().text();
  const assetPaths = [...html.matchAll(/(?:src|href)="(\/[^"?#]+)(?:[?#][^"]*)?"/g)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/assets/'));
  await Promise.allSettled([...new Set(assetPaths)].map((path) => cache.add(path)));
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      let usableCached = cached;
      if (usableCached && url.pathname.startsWith('/assets/') && !isSafeAssetResponse(usableCached)) {
        void caches.open(CACHE_NAME).then((cache) => cache.delete(request));
        usableCached = undefined;
      }

      const network = fetch(request).then((response) => {
        if (isSafeAssetResponse(response)) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
      return usableCached || network;
    }),
  );
});
