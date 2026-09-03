import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ComposerPickerPanel,
  composerEditorScrollClass,
  scrollComposerPickerIntoView,
} from "./composer-picker-panel";

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 320,
    width: 320,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON() {
      return {};
    },
  };
}

describe("scrollComposerPickerIntoView", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("scrolls the entry sheet down when a picker is clipped by the footer", () => {
    const scroller = document.createElement("div");
    scroller.className = composerEditorScrollClass;
    const panel = document.createElement("section");
    scroller.append(panel);
    document.body.append(scroller);
    scroller.scrollTop = 40;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(80, 480));
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(280, 620));

    scrollComposerPickerIntoView(panel);

    expect(scroller.scrollTop).toBe(192);
    scroller.remove();
  });

  it("does not move the sheet when the picker already sits above Save", () => {
    const scroller = document.createElement("div");
    scroller.className = composerEditorScrollClass;
    const panel = document.createElement("section");
    scroller.append(panel);
    document.body.append(scroller);
    scroller.scrollTop = 80;
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue(rect(80, 480));
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(rect(120, 400));

    scrollComposerPickerIntoView(panel);

    expect(scroller.scrollTop).toBe(80);
    scroller.remove();
  });

  it("reveals a newly mounted picker panel inside the composer sheet", () => {
    const scroller = document.createElement("div");
    scroller.className = composerEditorScrollClass;
    document.body.append(scroller);
    scroller.scrollTop = 0;
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this === scroller) return rect(80, 480);
      const top = 300 - scroller.scrollTop;
      return rect(top, top + 340);
    };

    render(
      <ComposerPickerPanel aria-label="Choose moment date">
        Calendar
      </ComposerPickerPanel>,
      { container: scroller },
    );

    expect(scroller.scrollTop).toBe(172);
  });
});
