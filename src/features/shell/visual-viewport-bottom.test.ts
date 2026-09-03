import { afterEach, describe, expect, it } from "vitest";
import {
  clearBottomNavVisualInset,
  syncBottomNavVisualInset,
  visualViewportBottomInset,
} from "./visual-viewport-bottom";

afterEach(() => {
  document.getElementById("bottom-nav-visual-inset-sheet")?.remove();
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

  it("writes the inset through a nonceable stylesheet instead of a style attribute", () => {
    const nonce = document.createElement("script");
    nonce.setAttribute("nonce", "test-nonce");
    document.head.append(nonce);

    syncBottomNavVisualInset({
      innerHeight: 800,
      visualViewport: {
        height: 740,
        offsetTop: 12,
      } as VisualViewport,
      document,
    });
    const sheet = document.getElementById("bottom-nav-visual-inset-sheet");
    expect(sheet).toBeInstanceOf(HTMLStyleElement);
    expect(sheet?.getAttribute("nonce")).toBe("test-nonce");
    expect(sheet?.textContent).toBe(":root{--bottom-nav-visual-inset:48px}");
    expect(document.documentElement.getAttribute("style")).toBeNull();
    clearBottomNavVisualInset(document.documentElement);
    expect(document.getElementById("bottom-nav-visual-inset-sheet")).toBeNull();
    nonce.remove();
  });
});
