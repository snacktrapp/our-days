const CACHE_PREFIX = "our-days-public-shell-";

// Push-capable worker. It never intercepts document navigations: private
// journal pages need a live authenticated response, and a fetch handler
// would add an auth-failure boundary without a usable offline app.

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
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title =
    typeof payload.title === "string" && payload.title.trim()
      ? payload.title.trim()
      : "Our Days";
  const url =
    typeof payload.url === "string" && payload.url.startsWith("/family")
      ? payload.url
      : "/family";
  const tag =
    typeof payload.tag === "string" && payload.tag.startsWith("our-days:")
      ? payload.tag
      : "our-days";
  event.waitUntil(
    self.registration.showNotification(title, {
      data: { url },
      tag,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetPath =
    event.notification.data &&
    typeof event.notification.data.url === "string" &&
    event.notification.data.url.startsWith("/family")
      ? event.notification.data.url
      : "/family";
  const target = new URL(targetPath, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        const existing = windows.find((client) =>
          client.url.startsWith(self.location.origin),
        );
        if (existing && "focus" in existing) {
          const focused = existing.focus();
          if ("navigate" in existing) {
            return focused.then(() => existing.navigate(target));
          }
          return focused;
        }
        return self.clients.openWindow(target);
      }),
  );
});
