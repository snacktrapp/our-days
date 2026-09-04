import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bottomNavIdleRestoreMs,
  useCompactBottomNavOnScroll,
} from "./use-compact-bottom-nav-on-scroll";

function CompactProbe() {
  const compact = useCompactBottomNavOnScroll();
  return <span>{compact ? "compact" : "full"}</span>;
}

describe("useCompactBottomNavOnScroll", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(window.matchMedia).mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  it("compacts on window scroll down and restores near the top", () => {
    let scrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    render(<CompactProbe />);
    expect(screen.getByText("full")).toBeInTheDocument();

    scrollY = 80;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByText("compact")).toBeInTheDocument();

    scrollY = 8;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByText("full")).toBeInTheDocument();
  });

  it("compacts when the family stage scrolls down and restores when idle", () => {
    vi.useFakeTimers();
    const stage = document.createElement("div");
    stage.className = "phone-stage";
    Object.defineProperty(stage, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });
    document.body.append(stage);
    render(<CompactProbe />);

    stage.scrollTop = 120;
    act(() => {
      stage.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByText("compact")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(bottomNavIdleRestoreMs);
    });
    expect(screen.getByText("full")).toBeInTheDocument();
    stage.remove();
  });

  it("does not change size when motion is reduced", () => {
    const media = vi.mocked(window.matchMedia);
    media.mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    let scrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => scrollY,
    });
    render(<CompactProbe />);
    scrollY = 80;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.getByText("full")).toBeInTheDocument();
  });
});
