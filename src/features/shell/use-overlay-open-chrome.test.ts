import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetOverlayChromeForTests } from "./overlay-chrome";
import { useOverlayOpenChrome } from "./use-overlay-open-chrome";
import {
  visualViewportBottomInsetVar,
  visualViewportOffsetTopVar,
} from "./visual-viewport-bottom";

describe("useOverlayOpenChrome", () => {
  afterEach(() => {
    resetOverlayChromeForTests();
    document.documentElement.classList.remove("overlay-open");
    document.body.classList.remove("overlay-open");
    document.documentElement.style.removeProperty(visualViewportOffsetTopVar);
    document.documentElement.style.removeProperty(visualViewportBottomInsetVar);
    vi.restoreAllMocks();
  });

  it("freezes the tab bar while open and restores it on close", () => {
    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "454px",
    );
    const { rerender, unmount } = renderHook(
      ({ active }) => useOverlayOpenChrome(active),
      { initialProps: { active: true } },
    );

    expect(document.documentElement).toHaveClass("overlay-open");
    expect(document.body).toHaveClass("overlay-open");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");

    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "454px",
    );
    rerender({ active: false });
    expect(document.documentElement).not.toHaveClass("overlay-open");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
    unmount();
  });
});
