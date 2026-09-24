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

function notificationPath(raw) {
  if (typeof raw !== "string" || !raw.startsWith("/family")) return "/family";
  let url;
  try {
    url = new URL(raw, self.location.origin);
  } catch {
    return "/family";
  }
  if (url.pathname !== "/family") return "/family";
  const hashMoment = /^#moment-(.+)$/.exec(url.hash);
  if (hashMoment && !url.searchParams.get("moment")) {
    url.searchParams.set("moment", decodeURIComponent(hashMoment[1]));
  }
  url.searchParams.delete("circle");
  url.searchParams.delete("name");
  url.hash = "";
  const search = url.searchParams.toString();
  return search ? `/family?${search}` : "/family";
}

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
  const url = notificationPath(payload.url);
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
  const targetPath = notificationPath(
    event.notification.data && event.notification.data.url,
  );
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
          const open = () => {
            try {
              existing.postMessage({
                type: "our-days:notification-open",
                url: targetPath,
              });
            } catch {
              /* older clients ignore the message */
            }
            if ("navigate" in existing) {
              return Promise.resolve(existing.navigate(target)).catch(
                () => undefined,
              );
            }
          };
          return focused.then(open, open);
        }
        return self.clients.openWindow(target);
      }),
  );
});
