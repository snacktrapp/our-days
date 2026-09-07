import { describe, expect, it } from "vitest";
import {
  defaultPostToCircleIds,
  familyFeedHref,
  formatPostToTriggerLabel,
  orderPostToCircleIds,
  primaryPostToCircle,
} from "./post-to";

const circles = [
  { id: "family", name: "Trapp Family", personId: "brian-family" },
  { id: "cousins", name: "Cousins", personId: "brian-cousins" },
] as const;

describe("post-to selection", () => {
  it("defaults to Home's current group when that membership exists", () => {
    expect(defaultPostToCircleIds(circles, "cousins")).toEqual(["cousins"]);
    expect(defaultPostToCircleIds(circles, "missing")).toEqual(["family"]);
  });

  it("keeps the current group first, then the rest in membership order", () => {
    expect(
      orderPostToCircleIds(["cousins", "family"], circles, "family"),
    ).toEqual(["family", "cousins"]);
  });

  it("labels one circle, two circles, or Just me", () => {
    expect(formatPostToTriggerLabel(circles, ["family"], false)).toBe(
      "Trapp Family",
    );
    expect(
      formatPostToTriggerLabel(circles, ["family", "cousins"], false),
    ).toBe("Trapp Family + Cousins");
    expect(formatPostToTriggerLabel(circles, ["family"], true)).toBe("Just me");
  });

  it("sends Home back to the primary circle after save", () => {
    expect(familyFeedHref("family")).toBe("/family?circle=family");
    expect(familyFeedHref()).toBe("/family");
  });

  it("uses the first selected circle as primary", () => {
    expect(primaryPostToCircle(circles, ["cousins", "family"])?.personId).toBe(
      "brian-cousins",
    );
  });
});
