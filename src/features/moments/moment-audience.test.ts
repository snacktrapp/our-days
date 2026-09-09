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

  it("shows the Just Me pill only on the author's own journal", () => {
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
    ).toBe(false);
    expect(
      showJustMeAudienceBadge({
        audience: "just_me",
        viewerPersonId: "me",
        viewingJournalPersonId: "other",
        momentJournalPersonId: "other",
      }),
    ).toBe(false);
    expect(
      showJustMeAudienceBadge({
        audience: "family",
        viewerPersonId: "me",
        viewingJournalPersonId: "me",
        momentJournalPersonId: "me",
      }),
    ).toBe(false);
  });

  it("shows an audience chip on the author's own posts only", () => {
    expect(
      showAudienceChip({
        viewerPersonId: "me",
        viewingJournalPersonId: "me",
        momentJournalPersonId: "me",
      }),
    ).toBe(true);
    expect(
      showAudienceChip({
        viewerPersonId: "me",
        viewingJournalPersonId: undefined,
        momentJournalPersonId: "me",
      }),
    ).toBe(false);
    expect(
      showAudienceChip({
        viewerPersonId: "me",
        viewingJournalPersonId: "other",
        momentJournalPersonId: "other",
      }),
    ).toBe(false);
  });

  it("labels Just me, one circle, or N circles", () => {
    expect(
      formatAudienceChipLabel({ audience: "just_me", linkedCircleIds: [] }),
    ).toBe("Just me");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family"],
      }),
    ).toBe("1 circle");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["family", "cousins"],
      }),
    ).toBe("2 circles");
    expect(
      formatAudienceChipLabel({
        audience: "family",
        linkedCircleIds: ["a", "b", "c"],
      }),
    ).toBe("3 circles");
  });
});
