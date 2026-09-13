import { describe, expect, it } from "vitest";
import {
  formatAudienceChipLabel,
  normalizeMomentAudience,
  showAudienceChip,
  showJustMeAudienceBadge,
} from "./moment-audience";

describe("moment audience mapping", () => {
  it("defaults unknown values to Family", () => {
    expect(normalizeMomentAudience(undefined)).toBe("family");
    expect(normalizeMomentAudience("family")).toBe("family");
    expect(normalizeMomentAudience("just_me")).toBe("just_me");
  });

  it("marks Just me posts for the Just me pill", () => {
    expect(
      showJustMeAudienceBadge({
        audience: "just_me",
        viewerPersonId: "me",
        viewingJournalPersonId: "me",
        momentJournalPersonId: "me",
      }),
    ).toBe(true);
    expect(
      showJustMeAudienceBadge({
        audience: "just_me",
        viewerPersonId: "me",
        viewingJournalPersonId: undefined,
        momentJournalPersonId: "me",
      }),
    ).toBe(true);
    expect(
      showJustMeAudienceBadge({
        audience: "family",
        viewerPersonId: "me",
        viewingJournalPersonId: "me",
        momentJournalPersonId: "me",
      }),
    ).toBe(false);
  });

  it("shows an audience chip on every post except insights", () => {
    expect(
      showAudienceChip({
        viewerPersonId: "me",
        viewingJournalPersonId: undefined,
        momentJournalPersonId: "other",
      }),
    ).toBe(true);
    expect(showAudienceChip({ momentKind: "insight" })).toBe(false);
  });

  it("labels All-feed chips with a name, Name +1, or N circles", () => {
    expect(
      formatAudienceChipLabel({ audience: "just_me", linkedCircleIds: [] }),
    ).toBe("Just me");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family"],
        circleNames: { family: "Trapp Family" },
      }),
    ).toBe("Trapp Family");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family", "cousins"],
        circleNames: { family: "Trapp Family", cousins: "Cousins" },
      }),
    ).toBe("Trapp Family +1");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["a", "b", "c"],
      }),
    ).toBe("3 circles");
  });

  it("uses a quiet Also label when a single-circle feed is also shared elsewhere", () => {
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family"],
        circleNames: { family: "Trapp Family" },
        feedCircleId: "family",
      }),
    ).toBe("Trapp Family");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family", "cousins"],
        circleNames: { family: "Trapp Family", cousins: "Cousins" },
        feedCircleId: "family",
      }),
    ).toBe("Also · Cousins");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family", "cousins", "harbor"],
        circleNames: {
          family: "Trapp Family",
          cousins: "Cousins",
          harbor: "Harbor",
        },
        feedCircleId: "family",
      }),
    ).toBe("Also · Cousins +1");
  });
});
