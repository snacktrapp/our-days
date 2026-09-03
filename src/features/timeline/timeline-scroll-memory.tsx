"use client";

import { useEffect } from "react";

const storageKey = "our-days:timeline-scroll";

function readPositions() {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(storageKey) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function savedPositionFor(route: string) {
  const value = readPositions()[route];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function rememberPosition(route: string, y: number) {
  try {
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ ...readPositions(), [route]: y }),
    );
  } catch {
    // Private mode or quota must not take down the timeline.
  }
}

export function TimelineScrollMemory() {
  useEffect(() => {
    const route = `${window.location.pathname}${window.location.search}`;
    const savedPosition = savedPositionFor(route);
    const shouldRestore = savedPosition > 0;
    let ready = !shouldRestore;
    let scrollFrame = 0;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    const remember = () => {
      if (!ready) return;
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        rememberPosition(route, window.scrollY);
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
