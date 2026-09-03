import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimelineScrollMemory } from "./timeline-scroll-memory";

const storageKey = "our-days:timeline-scroll";

function route() {
  return `${window.location.pathname}${window.location.search}`;
}

describe("TimelineScrollMemory", () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.scrollTo(0, 0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("does not write the Next history stack while the family feed scrolls", () => {
    const replaceState = vi.spyOn(history, "replaceState");
    render(<TimelineScrollMemory />);
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 180,
    });
    window.dispatchEvent(new Event("scroll"));
    expect(replaceState).not.toHaveBeenCalled();
    expect(
      JSON.parse(sessionStorage.getItem(storageKey) ?? "{}")[route()],
    ).toBe(180);
    replaceState.mockRestore();
  });

  it("restores this route’s saved position without touching history", () => {
    const replaceState = vi.spyOn(history, "replaceState");
    const scrollTo = vi.spyOn(window, "scrollTo");
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ [route()]: 240, "/people": 80 }),
    );
    render(<TimelineScrollMemory />);
    expect(scrollTo).toHaveBeenCalledWith(0, 240);
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
    scrollTo.mockRestore();
  });
});
