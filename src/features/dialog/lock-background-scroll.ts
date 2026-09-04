"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

export const backgroundScrollLockClass = "composer-scroll-locked";

function dialogIsModal(dialog: HTMLDialogElement) {
  try {
    return dialog.matches(":modal");
  } catch {
    return false;
  }
}

function openDialog(dialog: HTMLDialogElement, modal: boolean) {
  if (modal) {
    dialog.showModal();
    return;
  }
  if (typeof dialog.show === "function") {
    dialog.show();
    return;
  }
  // jsdom implements showModal() but not show().
  dialog.setAttribute("open", "");
}

export function showDialogPreservingScroll(
  dialog: HTMLDialogElement,
  modal = true,
) {
  const scrollY = window.scrollY;
  const isOpen = dialog.open;
  const isModal = isOpen && dialogIsModal(dialog);
  if (!isOpen) {
    openDialog(dialog, modal);
  } else if (modal && !isModal) {
    dialog.close();
    openDialog(dialog, true);
  } else if (!modal && isModal) {
    dialog.close();
    openDialog(dialog, false);
  }
  // Native showModal() makes document scrolling a no-op until close.
  if (scrollY > 0) window.scrollTo(0, scrollY);
}

export function showModalPreservingScroll(dialog: HTMLDialogElement) {
  showDialogPreservingScroll(dialog, true);
}

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

function restoreWindowScroll(scrollY: number) {
  if (scrollY > 0 && window.scrollY !== scrollY) window.scrollTo(0, scrollY);
}

function restoreWindowScrollAfterModal(scrollY: number) {
  const pin = () => restoreWindowScroll(scrollY);
  pin();
  window.addEventListener("scroll", pin);
  requestAnimationFrame(() => {
    pin();
    requestAnimationFrame(() => {
      window.removeEventListener("scroll", pin);
      pin();
    });
  });
}

export function useLockBackgroundScroll(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    const body = document.body;
    const htmlWasLocked = html.classList.contains(backgroundScrollLockClass);
    const bodyWasLocked = body.classList.contains(backgroundScrollLockClass);
    const scrollY = window.scrollY;
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
      document.removeEventListener("touchstart", onTouchStart, true);
      document.removeEventListener("touchmove", onTouchMove, true);
      document.removeEventListener("wheel", onWheel, true);
      restoreWindowScrollAfterModal(scrollY);
    };
  }, [active]);
}

export function useOverlayMount(open: boolean) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useLockBackgroundScroll(mounted);

  useLayoutEffect(() => {
    if (!mounted) return;
    if (open) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMounted(false);
    });
    return () => {
      cancelled = true;
    };
  }, [mounted, open]);

  return mounted;
}

export function useModalDialog(
  open: boolean,
  dialogRef: RefObject<HTMLDialogElement | null>,
  options?: { modal?: boolean },
) {
  const modal = options?.modal ?? true;
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);

  useLockBackgroundScroll(mounted);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!mounted) return;
    if (open) {
      if (!dialog) return;
      const scrollY = window.scrollY;
      showDialogPreservingScroll(dialog, modal);
      return () => {
        if (dialog.open) dialog.close();
        restoreWindowScrollAfterModal(scrollY);
      };
    }
    // Release even when the consumer already unmounted the <dialog>.
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setMounted(false);
    });
    return () => {
      cancelled = true;
    };
  }, [dialogRef, modal, mounted, open]);

  return mounted;
}
