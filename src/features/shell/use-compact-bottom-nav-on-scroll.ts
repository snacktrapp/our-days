"use client";

import { useEffect, useState } from "react";
import { overlayMotionReduced } from "./use-overlay-popover-close";

export const bottomNavIdleRestoreMs = 900;
const nearTopPx = 24;
const deltaPx = 4;

function scrollTopOf(target: EventTarget | null) {
  if (
    target instanceof Element &&
    target !== document.documentElement &&
    target !== document.body
  ) {
    return target.scrollTop;
  }
  return window.scrollY || document.documentElement.scrollTop;
}

export function useCompactBottomNavOnScroll() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (overlayMotionReduced()) return;
    let lastY = window.scrollY || document.documentElement.scrollTop;
    let idle = 0;
    const onScroll = (event: Event) => {
      const y = scrollTopOf(event.target);
      if (y < nearTopPx || y < lastY - deltaPx) {
        setCompact(false);
      } else if (y > lastY + deltaPx) {
        setCompact(true);
      }
      lastY = y;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setCompact(false), bottomNavIdleRestoreMs);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    const stage = document.querySelector(".phone-stage");
    stage?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      stage?.removeEventListener("scroll", onScroll);
      window.clearTimeout(idle);
    };
  }, []);

  return compact;
}
