import { describe, expect, it } from "vitest";
import {
  journalPromoBanner,
  mentionsAnnouncementEligible,
  selectJournalPromo,
} from "./journal-promo-config";

describe("journal promo config", () => {
  it("keeps the mentions card ahead of phone notifications", () => {
    expect(journalPromoBanner("mentions").priority).toBeLessThan(
      journalPromoBanner("phone-notifications").priority,
    );
    expect(
      selectJournalPromo({
        mentionsEligible: true,
        mentionsDismissed: false,
        phoneEligible: true,
      })?.id,
    ).toBe("mentions");
  });

  it("shows phone notifications only after mentions is dismissed or ineligible", () => {
    expect(
      selectJournalPromo({
        mentionsEligible: true,
        mentionsDismissed: true,
        phoneEligible: true,
      })?.id,
    ).toBe("phone-notifications");
    expect(
      selectJournalPromo({
        mentionsEligible: false,
        mentionsDismissed: false,
        phoneEligible: true,
      })?.id,
    ).toBe("phone-notifications");
    expect(
      selectJournalPromo({
        mentionsEligible: false,
        mentionsDismissed: false,
        phoneEligible: false,
      }),
    ).toBeNull();
  });

  it("targets signed-in people who share a circle", () => {
    expect(mentionsAnnouncementEligible(false, [{ memberCount: 4 }])).toBe(
      false,
    );
    expect(mentionsAnnouncementEligible(true, [{ memberCount: 1 }])).toBe(
      false,
    );
    expect(
      mentionsAnnouncementEligible(true, [
        { memberCount: 1 },
        { memberCount: 2 },
      ]),
    ).toBe(true);
    expect(
      mentionsAnnouncementEligible(true, [{ memberCount: undefined }]),
    ).toBe(false);
  });
});
