import { afterEach, describe, expect, it } from "vitest";
import {
  clearBottomNavVisualInset,
  syncBottomNavVisualInset,
  visualViewportBottomInset,
  visualViewportBottomInsetVar,
  visualViewportOffsetTop,
  visualViewportOffsetTopVar,
} from "./visual-viewport-bottom";

afterEach(() => {
  document.documentElement.style.removeProperty(visualViewportOffsetTopVar);
  document.documentElement.style.removeProperty(visualViewportBottomInsetVar);
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
    expect(
      visualViewportOffsetTop({
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

  it("writes CSS variables for a shrunken visual viewport", () => {
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
        visualViewportOffsetTopVar,
      ),
    ).toBe("12px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("48px");
    expect(
      document.head.querySelector("style#our-days-dynamic-css"),
    ).toBeNull();
  });

  it("writes 0px when the visual viewport fills the layout viewport", () => {
    syncBottomNavVisualInset({
      innerHeight: 844,
      visualViewport: {
        height: 844,
        offsetTop: 0,
      } as VisualViewport,
      document,
    });
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportOffsetTopVar,
      ),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
    expect(
      document.head.querySelector("style#our-days-dynamic-css"),
    ).toBeNull();
  });

  it("clears the pins back to 0px", () => {
    document.documentElement.style.setProperty(
      visualViewportOffsetTopVar,
      "20px",
    );
    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "40px",
    );
    clearBottomNavVisualInset(document.documentElement);
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportOffsetTopVar,
      ),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
  });
});
