import { describe, expect, it } from "vitest";
import {
  albumSlideWidth,
  pairSlideTransform,
  pairTransform,
} from "./photo-album-gesture";

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

describe("albumSlideWidth", () => {
  it("prefers the track's clientWidth", () => {
    const stage = { clientWidth: 430 } as HTMLElement;
    const track = { clientWidth: 390 } as HTMLElement;
    expect(albumSlideWidth(stage, track)).toBe(390);
  });
});
