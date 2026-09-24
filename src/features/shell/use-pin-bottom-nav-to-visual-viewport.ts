"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import {
  clearBottomNavVisualInset,
  scheduleBottomNavPin,
  syncBottomNavVisualInset,
} from "./visual-viewport-bottom";

export function usePinBottomNavToVisualViewport() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const sync = () => syncBottomNavVisualInset();
    const resync = () => scheduleBottomNavPin();
    sync();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", resync);
    window.addEventListener("pageshow", resync);
    window.addEventListener("focus", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", resync);
      window.removeEventListener("pageshow", resync);
      window.removeEventListener("focus", resync);
      document.removeEventListener("visibilitychange", resync);
      clearBottomNavVisualInset(document.documentElement);
    };
  }, []);

  useLayoutEffect(() => {
    syncBottomNavVisualInset();
  }, [pathname]);

  return syncBottomNavVisualInset;
}
