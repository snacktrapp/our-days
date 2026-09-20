import { describe, expect, it } from "vitest";
import {
  isProfileColor,
  profileColorAccent,
  profileColors,
  storedProfileColors,
} from "./profile-color";

describe("profile palette", () => {
  it("has twelve distinct choices that round-trip through database mapping", () => {
    expect(profileColors).toHaveLength(12);
    expect(new Set(profileColors.map((color) => color.accent)).size).toBe(12);
    for (const color of profileColors) {
      expect(isProfileColor(color.token)).toBe(true);
      expect(storedProfileColors).toContain(color.token);
      expect(profileColorAccent(color.token)).toBe(color.accent);
    }
  });
  it("preserves legacy colors and rejects arbitrary input", () => {
    expect(profileColorAccent("plum")).toBe("clay");
    expect(profileColorAccent("rose")).toBe("ochre");
    expect(profileColorAccent("sage")).toBe("moss");
    for (const value of [null, undefined, {}, "neon", "#123456"])
      expect(isProfileColor(value)).toBe(false);
  });
});
