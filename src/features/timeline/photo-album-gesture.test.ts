import { describe, expect, it, vi } from "vitest";
import {
  albumFrameFit,
  albumGestureFrameHeight,
  albumSlideWidth,
  clampedAlbumFrameBox,
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

describe("album frame height", () => {
  it("matches the slide ratio inside the clamp and caps 3:4 and 2:1", () => {
    expect(albumGestureFrameHeight(390, 9 / 16, 9 / 16, "idle", 0)).toBeCloseTo(
      390 * (9 / 16),
    );
    expect(albumGestureFrameHeight(390, 3 / 4, 3 / 4, "idle", 0)).toBeCloseTo(
      390 * 0.75,
    );
    expect(albumGestureFrameHeight(390, 4 / 3, 4 / 3, "idle", 0)).toBeCloseTo(
      390 * (4 / 3),
    );
    expect(albumGestureFrameHeight(390, 16 / 9, 16 / 9, "idle", 0)).toBeCloseTo(
      390 * (4 / 3),
    );
    expect(albumGestureFrameHeight(390, 1 / 3, 1 / 3, "idle", 0)).toBeCloseTo(
      390 * 0.5,
    );
  });

  it("interpolates height by drag progress and settles to the incoming slide", () => {
    const from = 9 / 16;
    const to = 3 / 4;
    const midway = albumGestureFrameHeight(390, from, to, "drag", -195);
    expect(midway).toBeCloseTo((390 * (9 / 16) + 390 * 0.75) / 2);
    expect(albumGestureFrameHeight(390, from, to, "snap", 0)).toBeCloseTo(
      390 * 0.75,
    );
    expect(albumGestureFrameHeight(390, from, to, "spring", -40)).toBeCloseTo(
      390 * (9 / 16),
    );
  });

  it("covers through 3:4 and contains taller portraits and wider than 2:1", () => {
    expect(albumFrameFit(1920, 1080)).toBe("cover");
    expect(albumFrameFit(1200, 900)).toBe("cover");
    expect(albumFrameFit(900, 1200)).toBe("cover");
    expect(albumFrameFit(900, 1600)).toBe("contain");
    expect(albumFrameFit(3000, 800)).toBe("contain");
    expect(albumFrameFit(undefined, undefined)).toBe("contain");
    expect(clampedAlbumFrameBox(900, 1600)).toEqual({
      width: 10000,
      height: 13333,
    });
    expect(clampedAlbumFrameBox(900, 1200)).toEqual({
      width: 900,
      height: 1200,
    });
    expect(clampedAlbumFrameBox(1920, 1080)).toEqual({
      width: 1920,
      height: 1080,
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
