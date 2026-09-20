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
    let travel = 0;
    let direction = 0;
    const show = () => {
      header.dataset.scrollHidden = "false";
      travel = 0;
      previous = position();
    };
    const heldOpen = () =>
      Boolean(
        header.querySelector('[aria-expanded="true"], details[open]') ||
        document.documentElement.classList.contains("overlay-open") ||
        header.querySelector(":focus-visible"),
      );
    const scroll = () => {
      const y = position();
      const delta = y - previous;
      previous = y;
      if (y < 96 || heldOpen()) {
        show();
        return;
      }
      if (!delta) return;
      const nextDirection = Math.sign(delta);
      if (nextDirection !== direction) travel = 0;
      direction = nextDirection;
      travel += Math.abs(delta);
      if (travel >= (direction > 0 ? 36 : 12)) {
        header.dataset.scrollHidden = String(direction > 0);
        travel = 0;
      }
    };
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
    window.addEventListener("our-days:reveal-new-entry", show);
    header.addEventListener("focusin", show);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("our-days:reveal-new-entry", show);
      header.removeEventListener("focusin", show);
      delete header.dataset.scrollHidden;
    };
  }, [pathname]);
  return ref;
}
