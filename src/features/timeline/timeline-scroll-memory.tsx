"use client";

import { useEffect } from "react";

const scrollPositionKey = "ourDaysTimelineScrollY";
const scrollUrlKey = "ourDaysTimelineScrollUrl";

export function TimelineScrollMemory() {
  useEffect(() => {
    const route = `${window.location.pathname}${window.location.search}`;
    const existingState =
      window.history.state && typeof window.history.state === "object"
        ? window.history.state
        : {};
    const savedPosition = existingState[scrollPositionKey];
    const shouldRestore =
      existingState[scrollUrlKey] === route &&
      typeof savedPosition === "number" &&
      savedPosition > 0;
    let ready = !shouldRestore;
    let scrollFrame = 0;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    const remember = () => {
      if (!ready) return;
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        const state =
          window.history.state && typeof window.history.state === "object"
            ? window.history.state
            : {};
        window.history.replaceState(
          {
            ...state,
            [scrollPositionKey]: window.scrollY,
            [scrollUrlKey]: route,
          },
          "",
          window.location.href,
        );
      });
    };

    window.addEventListener("scroll", remember, { passive: true });
    if (shouldRestore) {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          window.scrollTo(0, savedPosition);
          ready = true;
          remember();
        }),
      );
    } else {
      remember();
    }

    return () => {
      window.removeEventListener("scroll", remember);
      window.cancelAnimationFrame(scrollFrame);
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);

  return null;
}
