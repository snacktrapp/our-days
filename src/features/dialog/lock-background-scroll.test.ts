import { render, renderHook, waitFor } from "@testing-library/react";
import { createElement, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  backgroundScrollLockClass,
  overlayBackgroundScrollShouldStop,
  overlayScrollParent,
  showDialogPreservingScroll,
  showModalPreservingScroll,
  useLockBackgroundScroll,
  useModalDialog,
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

  it("restores scroll after a native modal dialog opens", () => {
    const dialog = document.createElement("dialog");
    const scrollTo = vi.fn();
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 160,
    });
    window.scrollTo = scrollTo as typeof window.scrollTo;
    dialog.showModal = () => {
      Object.defineProperty(window, "scrollY", {
        configurable: true,
        value: 0,
      });
    };
    showModalPreservingScroll(dialog);
    expect(scrollTo).toHaveBeenCalledWith(0, 160);
  });

  it("opens a type-picker overlay without promoting it to the modal top layer", () => {
    const dialog = document.createElement("dialog");
    const show = vi.fn(() => {
      dialog.setAttribute("open", "");
    });
    const showModal = vi.fn();
    dialog.show = show;
    dialog.showModal = showModal;
    showDialogPreservingScroll(dialog, false);
    expect(show).toHaveBeenCalledOnce();
    expect(showModal).not.toHaveBeenCalled();
  });

  it("restores window scroll after the overlay closes", () => {
    let scrollY = 160;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    const scrollTo = vi.fn((...args: unknown[]) => {
      if (typeof args[1] === "number") scrollY = args[1];
    });
    window.scrollTo = scrollTo as typeof window.scrollTo;
    const { unmount } = renderHook(() => useLockBackgroundScroll(true));
    expect(scrollTo).not.toHaveBeenCalled();
    scrollY = 0;
    window.dispatchEvent(new Event("scroll"));
    document.body.dispatchEvent(new Event("focusin", { bubbles: true }));
    expect(scrollTo).not.toHaveBeenCalled();
    unmount();
    expect(scrollTo).toHaveBeenCalledWith(0, 160);
  });

  it("prevents wheel default on overlay chrome while locked", () => {
    const { unmount } = renderHook(() => useLockBackgroundScroll(true));
    const event = new WheelEvent("wheel", {
      deltaY: 480,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    unmount();
  });

  it("opens the type picker with show() so nav frost can keep sampling the grid", async () => {
    const show = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    });
    const showModal = vi.fn();

    function Harness({ open }: { open: boolean }) {
      const ref = useRef<HTMLDialogElement>(null);
      const mounted = useModalDialog(open, ref, { modal: false });
      if (!mounted) return null;
      return createElement("dialog", {
        ref: (node: HTMLDialogElement | null) => {
          if (node) {
            node.show = show;
            node.showModal = showModal;
          }
          ref.current = node;
        },
      });
    }

    render(createElement(Harness, { open: true }));
    await waitFor(() => expect(show).toHaveBeenCalled());
    expect(showModal).not.toHaveBeenCalled();
  });

  it("closes a connected modal before restoring window scroll", async () => {
    let scrollY = 160;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    const scrollTo = vi.fn((...args: unknown[]) => {
      if (typeof args[1] === "number") scrollY = args[1];
    });
    window.scrollTo = scrollTo as typeof window.scrollTo;

    function Harness({ open }: { open: boolean }) {
      const ref = useRef<HTMLDialogElement>(null);
      const mounted = useModalDialog(open, ref);
      if (!mounted) return null;
      return createElement("dialog", { ref });
    }

    const { rerender } = render(createElement(Harness, { open: true }));
    const dialog = document.querySelector("dialog");
    expect(dialog).toHaveAttribute("open");
    expect(document.body).toHaveClass(backgroundScrollLockClass);

    rerender(createElement(Harness, { open: false }));
    await waitFor(() => expect(document.querySelector("dialog")).toBeNull());
    expect(document.body).not.toHaveClass(backgroundScrollLockClass);
    expect(scrollTo).toHaveBeenCalledWith(0, 160);
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
