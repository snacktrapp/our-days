import { describe, expect, it } from "vitest";
import {
  normalizeMomentAudience,
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
});
