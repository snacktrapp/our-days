import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DateTimeFields } from "./date-time-fields";
import { composerEditorScrollClass } from "./composer-picker-panel";

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

describe("DateTimeFields", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    document.body.replaceChildren();
  });

  it("scrolls the entry sheet so the open calendar sits above Save", async () => {
    const user = userEvent.setup();
    const scroller = document.createElement("div");
    scroller.className = composerEditorScrollClass;
    document.body.append(scroller);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this === scroller) return rect(80, 480);
      if (this.getAttribute("aria-label") === "Choose moment date") {
        const top = 300 - scroller.scrollTop;
        return rect(top, top + 340);
      }
      return originalRect.call(this);
    };

    render(
      <DateTimeFields
        date="2026-09-02"
        maxDate="2026-09-03"
        time=""
        onDateChange={() => undefined}
        onTimeChange={() => undefined}
      />,
      { container: scroller },
    );

    await user.click(
      screen.getByRole("button", { name: "Moment date, Sep 2, 2026" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Choose moment date" }),
    ).toBeVisible();
    expect(scroller.scrollTop).toBe(172);
  });

  it("scrolls the entry sheet so the open time panel sits above Save", async () => {
    const user = userEvent.setup();
    const scroller = document.createElement("div");
    scroller.className = composerEditorScrollClass;
    document.body.append(scroller);
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function getRect() {
      if (this === scroller) return rect(80, 480);
      if (this.getAttribute("aria-label") === "Choose optional time") {
        const top = 360 - scroller.scrollTop;
        return rect(top, top + 180);
      }
      return originalRect.call(this);
    };

    render(
      <DateTimeFields
        date="2026-09-02"
        maxDate="2026-09-03"
        time=""
        onDateChange={() => undefined}
        onTimeChange={() => undefined}
      />,
      { container: scroller },
    );

    await user.click(screen.getByRole("button", { name: "Time, No time" }));
    expect(
      screen.getByRole("dialog", { name: "Choose optional time" }),
    ).toBeVisible();
    expect(scroller.scrollTop).toBe(72);
  });
});
