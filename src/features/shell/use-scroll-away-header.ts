"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** Move only the fixed header; never change the document's geometry. */
export function useScrollAwayHeader() {
  const ref = useRef<HTMLElement>(null);
  const pathname = usePathname();
  useEffect(() => {
    const header = ref.current;
    if (!header) return;
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
      header.dataset.scrollHidden = String(offset >= distance && distance > 0);
    };
    const measure = () => {
      distance =
        header.offsetHeight +
        (parseFloat(getComputedStyle(header).top) || 0) +
        24;
      offset = Math.min(offset, distance);
      paint();
      previous = position();
    };
    const show = () => {
      offset = 0;
      paint();
      previous = position();
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
    window.addEventListener("our-days:reveal-new-entry", show);
    header.addEventListener("focusin", show);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("pageshow", pageShow);
      window.visualViewport?.removeEventListener("resize", measure);
      window.removeEventListener("our-days:reveal-new-entry", show);
      header.removeEventListener("focusin", show);
      delete header.dataset.scrollHidden;
      header.style.removeProperty("--header-scroll-offset");
    };
  }, [pathname]);
  return ref;
}
