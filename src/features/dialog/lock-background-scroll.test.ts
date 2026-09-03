import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backgroundScrollLockClass,
  backgroundScrollLockSheetId,
  overlayBackgroundScrollShouldStop,
  overlayScrollParent,
  useLockBackgroundScroll,
} from "./lock-background-scroll";

function scrollable(kind: "auto" | "scroll" = "auto") {
  const element = document.createElement("div");
  element.style.overflowY = kind;
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: 120,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: 360,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: 40,
  });
  return element;
}

describe("overlay background scroll lock", () => {
  afterEach(() => {
    document.documentElement.classList.remove(backgroundScrollLockClass);
    document.body.classList.remove(backgroundScrollLockClass);
    document.getElementById(backgroundScrollLockSheetId)?.remove();
    vi.restoreAllMocks();
  });

  it("stops a drag that is not on an inner scroller", () => {
    const sheet = document.createElement("div");
    expect(overlayScrollParent(sheet)).toBeNull();
    expect(overlayBackgroundScrollShouldStop(sheet, "down")).toBe(true);
    expect(overlayBackgroundScrollShouldStop(sheet, "up")).toBe(true);
  });

  it("lets a verse box or note field scroll until it hits an edge", () => {
    const verse = document.createElement("textarea");
    verse.style.overflowY = "auto";
    Object.defineProperty(verse, "clientHeight", { value: 120 });
    Object.defineProperty(verse, "scrollHeight", { value: 400 });
    Object.defineProperty(verse, "scrollTop", { writable: true, value: 0 });

    expect(overlayBackgroundScrollShouldStop(verse, "down")).toBe(false);
    expect(overlayBackgroundScrollShouldStop(verse, "up")).toBe(true);

    verse.scrollTop = 280;
    expect(overlayBackgroundScrollShouldStop(verse, "down")).toBe(true);
    expect(overlayBackgroundScrollShouldStop(verse, "up")).toBe(false);
  });

  it("finds the composer sheet scroller from a nested control", () => {
    const scroller = scrollable();
    const chapter = document.createElement("button");
    scroller.append(chapter);
    document.body.append(scroller);

    expect(overlayScrollParent(chapter)).toBe(scroller);
    expect(overlayBackgroundScrollShouldStop(chapter, "down")).toBe(false);

    scroller.remove();
  });

  it("does not treat a non-overflowing sheet as a page scroller", () => {
    const sheet = scrollable();
    Object.defineProperty(sheet, "scrollHeight", { value: 120 });
    expect(overlayScrollParent(sheet)).toBeNull();
    expect(overlayBackgroundScrollShouldStop(sheet, "down")).toBe(true);
  });

  it("leaves the place map iframe free to pan", () => {
    const map = document.createElement("iframe");
    expect(overlayBackgroundScrollShouldStop(map, "down")).toBe(false);
  });

  it("pins the locked page with a nonceable scroll offset", () => {
    const nonceHost = document.createElement("script");
    Object.defineProperty(nonceHost, "nonce", {
      configurable: true,
      get: () => "test-nonce",
    });
    document.head.append(nonceHost);
    expect(document.querySelector("[nonce]")).toBeNull();
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 160,
    });
    window.scrollTo = scrollTo as typeof window.scrollTo;
    const { unmount } = renderHook(() => useLockBackgroundScroll(true));
    const sheet = document.getElementById(backgroundScrollLockSheetId);
    expect(sheet).toBeInstanceOf(HTMLStyleElement);
    expect(sheet).toHaveAttribute("nonce", "test-nonce");
    expect(sheet?.textContent).toBe(":root{--composer-scroll-lock-top:-160px}");
    expect(scrollTo).not.toHaveBeenCalled();
    unmount();
    expect(document.getElementById(backgroundScrollLockSheetId)).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(0, 160);
    nonceHost.remove();
  });

  it("locks html and body while an overlay is open", () => {
    const { rerender, unmount } = renderHook(
      ({ active }) => useLockBackgroundScroll(active),
      { initialProps: { active: true } },
    );

    expect(document.documentElement).toHaveClass(backgroundScrollLockClass);
    expect(document.body).toHaveClass(backgroundScrollLockClass);

    rerender({ active: false });
    expect(document.documentElement).not.toHaveClass(backgroundScrollLockClass);
    expect(document.body).not.toHaveClass(backgroundScrollLockClass);
    unmount();
  });
});
