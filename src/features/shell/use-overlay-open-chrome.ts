"use client";

import { useLayoutEffect } from "react";
import { lockOverlayChrome, unlockOverlayChrome } from "./overlay-chrome";
import {
  restoreBottomNavAfterOverlay,
  syncBottomNavVisualInset,
} from "./visual-viewport-bottom";

export function useOverlayOpenChrome(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("overlay-open");
    document.body.classList.add("overlay-open");
    lockOverlayChrome();
    syncBottomNavVisualInset();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.classList.remove("overlay-open");
      document.body.classList.remove("overlay-open");
      unlockOverlayChrome();
      restoreBottomNavAfterOverlay();
    };
  }, [active]);
}
