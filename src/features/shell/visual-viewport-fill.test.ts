import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyVisualViewportFill,
  readVisualViewportBox,
  subscribeVisualViewportFill,
} from "./visual-viewport-fill";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("visual viewport fill", () => {
  it("reads the visual viewport box used for fullscreen media", () => {
    expect(
      readVisualViewportBox({
        visualViewport: {
          offsetTop: 0,
          offsetLeft: 12,
          width: 844,
          height: 390,
        } as VisualViewport,
      }),
    ).toEqual({
      top: 0,
      left: 12,
      width: 844,
      height: 390,
    });
  });

  it("sizes an overlay to a landscape visual viewport", () => {
    const element = document.createElement("div");
    applyVisualViewportFill(element, {
      visualViewport: {
        offsetTop: 0,
        offsetLeft: 0,
        width: 844,
        height: 390,
      } as VisualViewport,
    });
    expect(element.style.top).toBe("0px");
    expect(element.style.left).toBe("0px");
    expect(element.style.width).toBe("844px");
    expect(element.style.height).toBe("390px");
  });

  it("clears inline fill when visualViewport is missing", () => {
    const element = document.createElement("div");
    element.style.width = "844px";
    applyVisualViewportFill(element, { visualViewport: null });
    expect(element.style.width).toBe("");
  });

  it("resizes on orientation change", () => {
    const element = document.createElement("div");
    const listeners = new Map<string, EventListener>();
    const viewportListeners = new Map<string, EventListener>();
    const visualViewport = {
      offsetTop: 0,
      offsetLeft: 0,
      width: 390,
      height: 844,
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        viewportListeners.set(name, listener);
      }),
      removeEventListener: vi.fn((name: string) => {
        viewportListeners.delete(name);
      }),
    } as unknown as VisualViewport;
    const view = {
      visualViewport,
      addEventListener: vi.fn((name: string, listener: EventListener) => {
        listeners.set(name, listener);
      }),
      removeEventListener: vi.fn((name: string) => {
        listeners.delete(name);
      }),
    };
    const unsubscribe = subscribeVisualViewportFill(element, view);
    expect(element.style.height).toBe("844px");

    Object.assign(visualViewport, { width: 844, height: 390 });
    listeners.get("orientationchange")?.(new Event("orientationchange"));
    expect(element.style.width).toBe("844px");
    expect(element.style.height).toBe("390px");

    unsubscribe();
    expect(element.style.width).toBe("");
  });
});
