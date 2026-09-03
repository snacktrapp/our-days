import { describe, expect, it } from "vitest";
import {
  clearBottomNavVisualInset,
  syncBottomNavVisualInset,
  visualViewportBottomInset,
} from "./visual-viewport-bottom";

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

  it("does not write a stylesheet that would lift the tab bar", () => {
    syncBottomNavVisualInset({
      innerHeight: 800,
      visualViewport: {
        height: 740,
        offsetTop: 12,
      } as VisualViewport,
      document,
    });
    expect(document.documentElement.getAttribute("style")).toBeNull();
    expect(
      document.head.querySelector("style#our-days-dynamic-css"),
    ).toBeNull();
    clearBottomNavVisualInset(document.documentElement);
  });
});
