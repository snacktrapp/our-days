"use client";

import { useLayoutEffect } from "react";

export const backgroundScrollLockClass = "composer-scroll-locked";
export const backgroundScrollLockSheetId = "composer-scroll-lock-sheet";
const lockTopVariable = "--composer-scroll-lock-top";

const exemptOverlaySelector = "iframe, .composer-location-map";

function overflowYCanScroll(element: HTMLElement) {
  const overflowY = getComputedStyle(element).overflowY;
  return overflowY === "auto" || overflowY === "scroll";
}

export function overlayScrollParent(
  target: EventTarget | null,
): HTMLElement | null {
  let node: Element | null = target instanceof Element ? target : null;
  while (node instanceof HTMLElement) {
    if (node.matches(exemptOverlaySelector)) return node;
    if (overflowYCanScroll(node) && node.scrollHeight - node.clientHeight > 1) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

export function overlayBackgroundScrollShouldStop(
  target: EventTarget | null,
  scrollDirection: "up" | "down",
): boolean {
  const scroller = overlayScrollParent(target);
  if (!scroller) return true;
  if (scroller.matches(exemptOverlaySelector)) return false;
  const atTop = scroller.scrollTop <= 0;
  const atBottom =
    scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  if (scrollDirection === "up" && atTop) return true;
  if (scrollDirection === "down" && atBottom) return true;
  return false;
}

function pageNonce(doc: Document) {
  // Browsers strip the nonce attribute from connected nodes, so [nonce]
  // never matches. The IDL property still holds the value on script/style.
  for (const node of doc.querySelectorAll("script, style")) {
    if (!(node instanceof HTMLElement)) continue;
    const nonce = node.nonce || node.getAttribute("nonce") || "";
    if (nonce) return nonce;
  }
  const attributed = doc.querySelector<HTMLElement>("[nonce]");
  return attributed?.nonce || attributed?.getAttribute("nonce") || "";
}

function writeLockSheet(doc: Document, topPx: number) {
  const existing = doc.getElementById(backgroundScrollLockSheetId);
  const sheet =
    existing instanceof HTMLStyleElement
      ? existing
      : doc.createElement("style");
  if (!(existing instanceof HTMLStyleElement)) {
    sheet.id = backgroundScrollLockSheetId;
    const nonce = pageNonce(doc);
    if (nonce) {
      sheet.setAttribute("nonce", nonce);
      sheet.nonce = nonce;
    }
    doc.head.append(sheet);
  }
  sheet.textContent = `:root{${lockTopVariable}:${topPx}px}`;
}

function clearLockSheet(doc: Document) {
  doc.getElementById(backgroundScrollLockSheetId)?.remove();
}

export function useLockBackgroundScroll(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const htmlWasLocked = html.classList.contains(backgroundScrollLockClass);
    const bodyWasLocked = body.classList.contains(backgroundScrollLockClass);
    const scrollY = window.scrollY;
    writeLockSheet(document, -scrollY);
    html.classList.add(backgroundScrollLockClass);
    body.classList.add(backgroundScrollLockClass);

    let lastTouchY = 0;
    const onTouchStart = (event: TouchEvent) => {
      lastTouchY = event.touches[0]?.clientY ?? 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY ?? 0;
      const deltaY = y - lastTouchY;
      lastTouchY = y;
      const direction = deltaY > 0 ? "up" : "down";
      if (overlayBackgroundScrollShouldStop(event.target, direction)) {
        event.preventDefault();
      }
    };
    const onWheel = (event: WheelEvent) => {
      const direction = event.deltaY < 0 ? "up" : "down";
      if (overlayBackgroundScrollShouldStop(event.target, direction)) {
        event.preventDefault();
      }
    };

    document.addEventListener("touchstart", onTouchStart, {
      capture: true,
      passive: true,
    });
    document.addEventListener("touchmove", onTouchMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("wheel", onWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      if (!htmlWasLocked) html.classList.remove(backgroundScrollLockClass);
      if (!bodyWasLocked) body.classList.remove(backgroundScrollLockClass);
      if (!htmlWasLocked && !bodyWasLocked) clearLockSheet(document);
      if (scrollY > 0) window.scrollTo(0, scrollY);
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("wheel", onWheel, true);
    };
  }, [active]);
}
