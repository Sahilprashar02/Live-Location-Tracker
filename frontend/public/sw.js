const CACHE = 'live-map-shell-v1';
const APP_SHELL = ['/', '/index.html'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isAppAsset = url.origin === self.location.origin;
  const isTile = /tile|basemaps|arcgisonline/.test(url.hostname);
  if (!isAppAsset && !isTile) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        if (response.ok || response.type === 'opaque') {
          caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      });
      return cached || network;
    }).catch(() => caches.match('/index.html'))
  );
});
