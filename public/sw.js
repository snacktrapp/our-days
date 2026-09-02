const CACHE_PREFIX = "our-days-public-shell-";

// This worker exists only to retire earlier Our Days service workers. Private
// journal pages require a live authenticated response, so intercepting document
// navigation adds a failure boundary without providing a usable offline app.
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.registration.unregister())
      .then(() => self.clients.claim()),
  );
});
