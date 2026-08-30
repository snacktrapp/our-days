const CACHE_PREFIX = 'our-days-public-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;
const PUBLIC_SHELL = Object.freeze([
  '/offline.html',
  '/offline.css',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (PUBLIC_SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) => cached ?? fetch(request).catch(() => new Response('', {
          status: 503,
          statusText: 'Public shell asset temporarily unavailable',
        })),
      ),
    );
  }
});
