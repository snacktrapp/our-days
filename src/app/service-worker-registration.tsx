"use client";

import { useEffect } from "react";

const OUR_DAYS_CACHE_PREFIX = "our-days-public-shell-";

export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;

    const removeLegacyWorker = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations
            .filter(
              (registration) =>
                new URL(registration.scope).origin === window.location.origin,
            )
            .map((registration) => registration.unregister()),
        );

        if ("caches" in window) {
          const cacheNames = await window.caches.keys();
          await Promise.all(
            cacheNames
              .filter((name) => name.startsWith(OUR_DAYS_CACHE_PREFIX))
              .map((name) => window.caches.delete(name)),
          );
        }
      } catch (error) {
        if (process.env.NODE_ENV === "development")
          console.error("Legacy service worker cleanup failed.", error);
      }
    };

    void removeLegacyWorker();
  }, []);

  return null;
}
