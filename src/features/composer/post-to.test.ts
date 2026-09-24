import { describe, expect, it } from "vitest";
import {
  createPostToDefault,
  defaultPostToCircleIds,
  familyFeedHref,
  momentSubmitHref,
  formatPostToTriggerLabel,
  initialPostToCircleIds,
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

  it("lands a new circle post on All circles and Just me on Just me", () => {
    expect(
      momentSubmitHref({
        editing: false,
        audience: "family",
        journalPersonId: "brian",
        stayHref: "/family?circle=cousins",
      }),
    ).toBe("/family");
    expect(
      momentSubmitHref({
        editing: false,
        audience: "family",
        journalPersonId: "brian",
        stayHref: "/family?circle=home",
        momentId: "moment-1",
      }),
    ).toBe("/family?moment=moment-1");
    expect(
      momentSubmitHref({
        editing: false,
        audience: "just_me",
        journalPersonId: "brian",
        stayHref: "/family?circle=cousins",
      }),
    ).toBe("/people/brian");
    expect(
      momentSubmitHref({
        editing: true,
        audience: "family",
        journalPersonId: "brian",
        stayHref: "/family?circle=cousins",
        momentId: "moment-1",
      }),
    ).toBe("/family?circle=cousins");
  });

  it("prefills linked circles and keeps the primary first", () => {
    expect(
      initialPostToCircleIds(circles, {
        audience: "family",
        circleId: "family",
        linkedCircleIds: ["cousins", "family"],
      }),
    ).toEqual(["family", "cousins"]);
    expect(
      initialPostToCircleIds(circles, {
        audience: "just_me",
        circleId: "family",
        linkedCircleIds: ["family"],
      }),
    ).toEqual([]);
  });

  it("uses the first selected circle as primary", () => {
    expect(primaryPostToCircle(circles, ["cousins", "family"])?.personId).toBe(
      "brian-cousins",
    );
  });

  it("defaults create Post to from Home switcher context", () => {
    expect(createPostToDefault(circles, { kind: "you" }, "family")).toEqual({
      audience: "just_me",
      circleIds: [],
    });
    expect(createPostToDefault(circles, { kind: "person" }, "family")).toEqual({
      audience: "just_me",
      circleIds: [],
    });
    expect(
      createPostToDefault(
        circles,
        { kind: "group", circleId: "cousins" },
        "family",
      ),
    ).toEqual({
      audience: "family",
      circleIds: ["cousins"],
    });
    expect(createPostToDefault(circles, undefined, "family")).toEqual({
      audience: "family",
      circleIds: ["family"],
    });
    expect(createPostToDefault(circles, { kind: "all" }, "family")).toEqual({
      audience: "family",
      circleIds: ["family"],
    });
    expect(
      createPostToDefault(
        circles,
        { kind: "group", circleId: "cousins" },
        "family",
        { defaultAudience: "just_me" },
      ),
    ).toEqual({
      audience: "just_me",
      circleIds: [],
    });
  });
});
