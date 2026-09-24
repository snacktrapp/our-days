import { describe, expect, it } from "vitest";
import { pendingMomentVisible } from "./pending-timeline-entries";

describe("pendingMomentVisible", () => {
  it("shows a new circle post on All circles and hides Just me there", () => {
    expect(
      pendingMomentVisible({
        audience: "family",
        journalPersonId: "brian",
        circleId: "grandparents",
        created: true,
        pathname: "/family",
        circleQuery: null,
      }),
    ).toBe(true);
    expect(
      pendingMomentVisible({
        audience: "just_me",
        journalPersonId: "brian",
        circleId: "home",
        created: true,
        pathname: "/family",
        circleQuery: null,
      }),
    ).toBe(false);
  });

  it("shows Just me only on that journal and skips edits", () => {
    expect(
      pendingMomentVisible({
        audience: "just_me",
        journalPersonId: "brian",
        circleId: "home",
        created: true,
        pathname: "/people/brian",
        circleQuery: null,
      }),
    ).toBe(true);
    expect(
      pendingMomentVisible({
        audience: "family",
        journalPersonId: "brian",
        circleId: "home",
        created: false,
        pathname: "/family",
        circleQuery: null,
      }),
    ).toBe(false);
  });
});
