"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { skeletonKindFromPathname } from "./journal-routes";

/** Move both journal bars pixel-for-pixel without changing document geometry. */
export function useScrollAwayHeader() {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
    const root = document.documentElement;
    const journal = skeletonKindFromPathname(pathname) === "timeline";
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const position = () =>
      Math.max(
        0,
        Math.min(
          window.scrollY,
          Math.max(
            0,
            document.documentElement.scrollHeight - window.innerHeight,
          ),
        ),
      );
    let previous = position();
    let offset = 0;
    let distance = 0;
    const paint = () => {
      header.style.setProperty("--header-scroll-offset", `${-offset}px`);
      root.style.setProperty(
        "--journal-nav-scroll-offset",
        `${journal ? offset : 0}px`,
      );
      header.dataset.scrollHidden = String(offset >= distance && distance > 0);
    };
    const measure = () => {
      distance =
        header.offsetHeight +
        (parseFloat(getComputedStyle(header).top) || 0) +
        24;
      if (journal && nav) {
        distance = Math.max(
          distance,
          nav.offsetHeight +
            (parseFloat(getComputedStyle(nav).bottom) || 0) +
            24,
        );
      }
      offset = Math.min(offset, distance);
      paint();
      previous = position();
    };
    let revealUntil = 0;
    const show = () => {
      offset = 0;
      paint();
      previous = position();
    };
    const reveal = () => {
      revealUntil = performance.now() + 160;
      show();
    };
    const heldOpen = () =>
      Boolean(
        header.querySelector('[aria-expanded="true"], details[open]') ||
        document.documentElement.classList.contains("overlay-open"),
      );
    // Restored/programmatic focus can remain :focus-visible after a phone
    // resumes. Focus reveals the header once; it must not veto later scrolling.
    const resume = () => {
      if (document.visibilityState !== "visible") return;
      measure();
      show();
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    const scroll = () => {
      if (performance.now() < revealUntil) {
        show();
        return;
      }
      const y = position();
      const delta = y - previous;
      previous = y;
      if (y === 0 || heldOpen()) {
        show();
        return;
      }
      if (!delta) return;
      // No threshold or timed animation: reverse immediately, pixel for pixel.
      offset = Math.max(0, Math.min(distance, y, offset + delta));
      paint();
    };
    measure();
    show();
    const observer = new MutationObserver(() => {
      if (heldOpen()) show();
    });
    observer.observe(header, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-expanded", "open"],
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", pageShow);
    window.visualViewport?.addEventListener("resize", measure);
    window.addEventListener("our-days:reveal-new-entry", reveal);
    header.addEventListener("focusin", show);
    nav?.addEventListener("focusin", show);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", pageShow);
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("our-days:reveal-new-entry", reveal);
      header.removeEventListener("focusin", show);
      nav?.removeEventListener("focusin", show);
      root.style.removeProperty("--journal-nav-scroll-offset");
      delete header.dataset.scrollHidden;
      header.style.removeProperty("--header-scroll-offset");
    };
  }, [pathname]);
  return ref;
}
