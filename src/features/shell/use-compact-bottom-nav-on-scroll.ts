"use client";

import { useEffect, useState } from "react";
import { overlayMotionReduced } from "./use-overlay-popover-close";

const idleRestoreMs = 900;
const nearTopPx = 24;
const deltaPx = 4;

export function useCompactBottomNavOnScroll() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    if (overlayMotionReduced()) return;
    let lastY = window.scrollY;
    let idle = 0;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < nearTopPx || y < lastY - deltaPx) {
        setCompact(false);
      } else if (y > lastY + deltaPx) {
        setCompact(true);
      }
      lastY = y;
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setCompact(false), idleRestoreMs);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.clearTimeout(idle);
    };
  }, []);

  return compact;
}
