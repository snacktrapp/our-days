"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    )
      return;

    let registration: ServiceWorkerRegistration | undefined;

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
      } catch (error) {
        if (process.env.NODE_ENV === "development")
          console.error("Service worker registration failed.", error);
      }
    };

    const updateWhenVisible = () => {
      if (document.visibilityState === "visible") void registration?.update();
    };

    void register();
    document.addEventListener("visibilitychange", updateWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", updateWhenVisible);
  }, []);

  return null;
}
