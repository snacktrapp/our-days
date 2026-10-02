import { describe, expect, it, vi } from "vitest";
import {
  albumFrameBox,
  albumFrameHeightRatio,
  albumSlideWidth,
  pairSlideTransform,
  pairTransform,
  waitForFrameReady,
} from "./photo-album-gesture";

describe("waitForFrameReady", () => {
  it("waits for a deferred image to mount and decode", async () => {
    const frame = document.createElement("div");
    const ready = vi.fn();
    const cancel = waitForFrameReady(frame, ready);
    expect(ready).not.toHaveBeenCalled();
    const img = document.createElement("img");
    frame.append(img);
    await Promise.resolve();
    expect(ready).not.toHaveBeenCalled();
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    img.dispatchEvent(new Event("load"));
    expect(ready).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("settles a failed private fetch without an image element", async () => {
    const frame = document.createElement("div");
    const ready = vi.fn();
    const cancel = waitForFrameReady(frame, ready);
    const error = document.createElement("div");
    error.dataset.mediaState = "error";
    frame.append(error);
    await Promise.resolve();
    expect(ready).toHaveBeenCalledTimes(1);
    cancel();
  });

  it("cancels a pending mount when the gesture is abandoned", async () => {
    const frame = document.createElement("div");
    const ready = vi.fn();
    waitForFrameReady(frame, ready)();
    const img = document.createElement("img");
    Object.defineProperty(img, "naturalWidth", { value: 100 });
    frame.append(img);
    await Promise.resolve();
    img.dispatchEvent(new Event("load"));
    expect(ready).not.toHaveBeenCalled();
  });
});

describe("pairSlideTransform", () => {
  const next = {
    from: 0,
    to: 1,
    direction: 1 as const,
    dx: 0,
    mode: "snap" as const,
  };

  it("drags and snaps in pixels of the stage width", () => {
    expect(pairSlideTransform({ ...next, mode: "drag", dx: -60 }, 390)).toBe(
      "translateX(-60px)",
    );
    expect(pairSlideTransform({ ...next, mode: "snap" }, 390)).toBe(
      "translateX(-390px)",
    );
    expect(pairSlideTransform({ ...next, mode: "spring" }, 390)).toBe(
      "translateX(0px)",
    );
  });

  it("parks the previous slide one stage-width to the left", () => {
    const prev = {
      from: 1,
      to: 0,
      direction: -1 as const,
      dx: 40,
      mode: "drag" as const,
    };
    expect(pairSlideTransform(prev, 390)).toBe("translateX(-350px)");
    expect(pairSlideTransform({ ...prev, mode: "snap", dx: 0 }, 390)).toBe(
      "translateX(0px)",
    );
    expect(pairSlideTransform({ ...prev, mode: "spring", dx: 0 }, 390)).toBe(
      "translateX(-390px)",
    );
  });

  it("falls back to a 100% slide when width is unknown", () => {
    expect(pairSlideTransform({ ...next, mode: "drag", dx: -60 }, 0)).toBe(
      "translateX(calc(0% + -60px))",
    );
    expect(pairSlideTransform({ ...next, mode: "snap" }, 0)).toBe(
      "translateX(-100%)",
    );
  });
});

describe("pairTransform", () => {
  it("keeps the card pager's 200% / -50% model", () => {
    expect(
      pairTransform({
        from: 0,
        to: 1,
        direction: 1,
        mode: "snap",
        dx: 0,
      }),
    ).toBe("translateX(-50%)");
  });
});

describe("album frame box", () => {
  it("uses the tallest slide and caps anything past 3:4", () => {
    const mixed = [
      { width: 1600, height: 900 },
      { width: 1200, height: 900 },
      { width: 1200, height: 1600 },
      { width: 900, height: 1600 },
    ];
    expect(albumFrameHeightRatio(mixed)).toBeCloseTo(4 / 3);
    expect(albumFrameBox(mixed)).toEqual({
      width: 10000,
      height: Math.round(10000 * (4 / 3)),
    });
    expect(
      albumFrameHeightRatio([
        { width: 1600, height: 900 },
        { width: 1200, height: 900 },
      ]),
    ).toBeCloseTo(0.75);
    expect(
      albumFrameHeightRatio([
        { width: 900, height: 2000 },
        { width: 1600, height: 900 },
      ]),
    ).toBeCloseTo(4 / 3);
  });

  it("keeps a 4:3 placeholder until a loaded image supplies the ratio", () => {
    expect(albumFrameBox([{}, {}])).toEqual({ width: 4, height: 3 });
    expect(albumFrameBox([{}, {}], 9 / 16)).toEqual({
      width: 10000,
      height: Math.round(10000 * (9 / 16)),
    });
    expect(albumFrameBox([{}, {}], 16 / 9)).toEqual({
      width: 10000,
      height: Math.round(10000 * (4 / 3)),
    });
    expect(albumFrameBox([{ width: 1200, height: 900 }], 16 / 9)).toEqual({
      width: 10000,
      height: 7500,
    });
  });
});

describe("albumSlideWidth", () => {
  it("prefers the track's clientWidth", () => {
    const stage = { clientWidth: 430 } as HTMLElement;
    const track = { clientWidth: 390 } as HTMLElement;
    expect(albumSlideWidth(stage, track)).toBe(390);
  });
});
