import { afterEach, describe, expect, it } from "vitest";
import { dynamicCssStyleId } from "@/lib/page-csp-nonce";
import {
  clearBottomNavVisualInset,
  syncBottomNavVisualInset,
  visualViewportBottomInset,
} from "./visual-viewport-bottom";

afterEach(() => {
  document.getElementById(dynamicCssStyleId)?.remove();
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

  it("writes a nonceable stylesheet without lifting the tab bar off the layout bottom", () => {
    const sheet = document.createElement("style");
    sheet.id = dynamicCssStyleId;
    sheet.setAttribute("nonce", "test-nonce");
    document.head.append(sheet);

    syncBottomNavVisualInset({
      innerHeight: 800,
      visualViewport: {
        height: 740,
        offsetTop: 12,
      } as VisualViewport,
      document,
    });
    expect(document.getElementById(dynamicCssStyleId)).toBe(sheet);
    expect(sheet.getAttribute("nonce")).toBe("test-nonce");
    expect(sheet.textContent).toBe(":root{--bottom-nav-visual-inset:0px}");
    expect(document.documentElement.getAttribute("style")).toBeNull();
    clearBottomNavVisualInset(document.documentElement);
    expect(sheet.textContent).toBe("");
    expect(sheet.parentNode).toBe(document.head);
  });
});
