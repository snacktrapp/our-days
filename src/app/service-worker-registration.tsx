"use client";

import { useEffect } from "react";

const OUR_DAYS_CACHE_PREFIX = "our-days-public-shell-";

function vapidPublicKey() {
  return process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
}

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;

    const syncWorker = async () => {
      try {
        if ("caches" in window) {
          const cacheNames = await window.caches.keys();
          await Promise.all(
            cacheNames
              .filter((name) => name.startsWith(OUR_DAYS_CACHE_PREFIX))
              .map((name) => window.caches.delete(name)),
          );
        }

        if (vapidPublicKey()) {
          await navigator.serviceWorker.register("/sw.js", {
            scope: "/",
            updateViaCache: "none",
          });
          return;
        }

        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter(
              (registration) =>
                new URL(registration.scope).origin === window.location.origin,
            )
            .map((registration) => registration.unregister()),
        );
      } catch (error) {
        if (process.env.NODE_ENV === "development")
          console.error("Service worker registration failed.", error);
      }
    };

    void syncWorker();
  }, []);

  return null;
}
