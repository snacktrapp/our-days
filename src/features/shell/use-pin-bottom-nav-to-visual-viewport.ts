"use client";

import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";
import {
  clearBottomNavVisualInset,
  syncBottomNavVisualInset,
} from "./visual-viewport-bottom";

export function usePinBottomNavToVisualViewport() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const sync = () => syncBottomNavVisualInset();
    sync();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      document.removeEventListener("visibilitychange", sync);
      clearBottomNavVisualInset(document.documentElement);
    };
  }, []);

  useLayoutEffect(() => {
    syncBottomNavVisualInset();
  }, [pathname]);

  return syncBottomNavVisualInset;
}
