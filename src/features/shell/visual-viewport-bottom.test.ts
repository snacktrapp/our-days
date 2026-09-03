import { afterEach, describe, expect, it } from "vitest";
import {
  clearBottomNavVisualInset,
  syncBottomNavVisualInset,
  visualViewportBottomInset,
} from "./visual-viewport-bottom";

afterEach(() => {
  document.documentElement.style.removeProperty("--bottom-nav-visual-inset");
});

describe("visual viewport bottom inset", () => {
  it("is zero when the visual viewport fills the layout viewport", () => {
    expect(
      visualViewportBottomInset({
        innerHeight: 844,
        visualViewport: {
          height: 844,
          offsetTop: 0,
        } as VisualViewport,
      }),
    ).toBe(0);
  });

  it("tracks the gap below a shrunken iOS visual viewport", () => {
    expect(
      visualViewportBottomInset({
        innerHeight: 844,
        visualViewport: {
          height: 720,
          offsetTop: 0,
        } as VisualViewport,
      }),
    ).toBe(124);
  });

  it("writes the inset onto the document so the tab bar can follow it", () => {
    syncBottomNavVisualInset({
      innerHeight: 800,
      visualViewport: {
        height: 740,
        offsetTop: 12,
      } as VisualViewport,
      document,
    });
    expect(
      document.documentElement.style.getPropertyValue(
        "--bottom-nav-visual-inset",
      ),
    ).toBe("48px");
    clearBottomNavVisualInset(document.documentElement);
    expect(
      document.documentElement.style.getPropertyValue(
        "--bottom-nav-visual-inset",
      ),
    ).toBe("");
  });
});
