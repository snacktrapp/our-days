import { afterEach, describe, expect, it } from "vitest";
import {
  clearBottomNavVisualInset,
  keyboardLikeVisualViewportMinShrinkPx,
  pinVisualViewportBottomInset,
  syncBottomNavVisualInset,
  timelinePullFreezesChromeInset,
  visualViewportBottomInset,
  visualViewportBottomInsetVar,
  visualViewportOffsetTop,
  visualViewportOffsetTopVar,
} from "./visual-viewport-bottom";

afterEach(() => {
  document.documentElement.style.removeProperty(visualViewportOffsetTopVar);
  document.documentElement.style.removeProperty(visualViewportBottomInsetVar);
  document.querySelectorAll(".timeline-pull-shell").forEach((shell) => {
    shell.remove();
  });
});

function viewport(
  innerHeight: number,
  height: number,
  offsetTop: number,
): Pick<Window, "innerHeight" | "visualViewport"> & { document: Document } {
  return {
    innerHeight,
    visualViewport: {
      height,
      offsetTop,
    } as VisualViewport,
    document,
  };
}

function mountPullShell(state: string) {
  const shell = document.createElement("div");
  shell.className = "timeline-pull-shell";
  shell.dataset.pullState = state;
  document.body.append(shell);
  return shell;
}

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

  it("does not treat rubber-band overscroll as a bottom gap", () => {
    expect(
      visualViewportBottomInset({
        innerHeight: 844,
        visualViewport: {
          height: 844,
          offsetTop: -220,
        } as VisualViewport,
      }),
    ).toBe(0);
    expect(
      visualViewportOffsetTop({
        visualViewport: {
          height: 844,
          offsetTop: -220,
        } as VisualViewport,
      }),
    ).toBe(0);
  });

  it("pins a keyboard-sized shrink and ignores Safari chrome leftover", () => {
    expect(
      pinVisualViewportBottomInset({
        innerHeight: 844,
        visualViewport: {
          height: 560,
          offsetTop: 0,
        } as VisualViewport,
      }),
    ).toBe(284);
    expect(
      pinVisualViewportBottomInset({
        innerHeight: 844,
        visualViewport: {
          height: 760,
          offsetTop: 0,
        } as VisualViewport,
      }),
    ).toBe(0);
    expect(keyboardLikeVisualViewportMinShrinkPx).toBe(140);
  });

  it("writes CSS variables for a scrolled visual viewport without lifting the tab bar", () => {
    syncBottomNavVisualInset(viewport(800, 740, 12));
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportOffsetTopVar,
      ),
    ).toBe("12px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("0px");
    expect(
      document.head.querySelector("style#our-days-dynamic-css"),
    ).toBeNull();
  });

  it("writes a keyboard pin when the visual viewport shrinks from the bottom", () => {
    syncBottomNavVisualInset(viewport(844, 560, 0));
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportOffsetTopVar,
      ),
    ).toBe("0px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("284px");
  });

  it("writes 0px when the visual viewport fills the layout viewport", () => {
    syncBottomNavVisualInset(viewport(844, 844, 0));
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

  it("clears rubber-band measurements instead of lifting chrome", () => {
    syncBottomNavVisualInset(viewport(844, 844, -280));
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

  it("freezes chrome insets while the timeline is being pulled", () => {
    const shell = mountPullShell("pulling");
    expect(timelinePullFreezesChromeInset(document)).toBe(true);

    document.documentElement.style.setProperty(
      visualViewportOffsetTopVar,
      "20px",
    );
    document.documentElement.style.setProperty(
      visualViewportBottomInsetVar,
      "284px",
    );
    syncBottomNavVisualInset(viewport(844, 560, 0));
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

    for (const state of ["armed", "refreshing", "settling"] as const) {
      shell.dataset.pullState = state;
      syncBottomNavVisualInset(viewport(844, 560, 16));
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
    }

    shell.dataset.pullState = "idle";
    expect(timelinePullFreezesChromeInset(document)).toBe(false);
    syncBottomNavVisualInset(viewport(844, 560, 16));
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportOffsetTopVar,
      ),
    ).toBe("16px");
    expect(
      document.documentElement.style.getPropertyValue(
        visualViewportBottomInsetVar,
      ),
    ).toBe("268px");
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
