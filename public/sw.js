const CACHE_PREFIX = "our-days-public-shell-";
const CACHE_NAME = `${CACHE_PREFIX}v4`;
const PUBLIC_SHELL = Object.freeze([
  "/offline.html",
  "/offline.css",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_SHELL)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .catch(() => caches.match("/offline.html"))
        .then(
          (response) =>
            response ??
            new Response("", {
              status: 503,
              statusText: "Offline shell temporarily unavailable",
            }),
        )
        .catch(
          () =>
            new Response("", {
              status: 503,
              statusText: "Offline shell temporarily unavailable",
            }),
        ),
    );
    return;
  }

  // Browser-owned manifest/icon requests are deliberately not intercepted.
  // Firefox treats some icon responses from respondWith as a failed load even
  // when the asset was pre-cached successfully. Only the offline document's
  // stylesheet needs a cache-first fetch path.
  if (url.pathname === "/offline.css") {
    event.respondWith(
      caches
        .match(request)
        .catch(() => undefined)
        .then((cached) => cached ?? fetch(request))
        .catch(
          () =>
            new Response("", {
              status: 503,
              statusText: "Public shell asset temporarily unavailable",
            }),
        ),
    );
  }
});
