import { describe, expect, it } from "vitest";
import {
  hasSharedCircle,
  journalPromoBanner,
  journalPromoPrepaintScript,
  selectJournalPromo,
  type JournalPromoBannerConfig,
} from "./journal-promo-config";

const signedIn = {
  signedIn: true,
  sharedCircle: true,
  dismissedIds: new Set<string>(),
};

describe("journal promo config", () => {
  it("keeps the mentions card ahead of phone notifications", () => {
    expect(journalPromoBanner("mentions").priority).toBeLessThan(
      journalPromoBanner("phone-notifications").priority,
    );
    expect(
      selectJournalPromo({
        ...signedIn,
        resolvedEligibility: { phoneNotificationsOff: true },
      })?.banner.id,
    ).toBe("mentions");
  });

  it("shows phone notifications only after mentions is dismissed or ineligible", () => {
    expect(
      selectJournalPromo({
        ...signedIn,
        dismissedIds: new Set(["mentions"]),
        resolvedEligibility: { phoneNotificationsOff: true },
      })?.banner.id,
    ).toBe("phone-notifications");
    expect(
      selectJournalPromo({
        signedIn: true,
        sharedCircle: false,
        dismissedIds: new Set(),
        resolvedEligibility: { phoneNotificationsOff: true },
      })?.banner.id,
    ).toBe("phone-notifications");
    expect(
      selectJournalPromo({
        signedIn: false,
        sharedCircle: false,
        dismissedIds: new Set(),
        resolvedEligibility: { phoneNotificationsOff: false },
      }),
    ).toBeNull();
  });

  it("holds an unresolved async card instead of skipping to the next one", () => {
    const choice = selectJournalPromo({
      signedIn: true,
      sharedCircle: false,
      dismissedIds: new Set(),
    });
    expect(choice?.banner.id).toBe("phone-notifications");
    expect(choice?.pending).toBe(true);
  });

  it("targets signed-in people who share a circle", () => {
    expect(hasSharedCircle([{ memberCount: 4 }])).toBe(true);
    expect(hasSharedCircle([{ memberCount: 1 }])).toBe(false);
    expect(hasSharedCircle([{ memberCount: 1 }, { memberCount: 2 }])).toBe(
      true,
    );
    expect(hasSharedCircle([{ memberCount: undefined }])).toBe(false);
    expect(
      selectJournalPromo({
        signedIn: false,
        sharedCircle: true,
        dismissedIds: new Set(),
      }),
    ).toMatchObject({ banner: { id: "phone-notifications" }, pending: true });
  });

  it("orders and dismisses a banner that exists only in the config list", () => {
    const banners = [
      {
        id: "zeta",
        storageKey: "our-days:zeta-announcement",
        priority: 5,
        variant: "tip",
        title: "Zeta tip",
        body: "Later",
        ctaLabel: "Okay",
      },
      {
        id: "alpha",
        storageKey: "our-days:alpha-announcement",
        priority: 0,
        variant: "feature",
        title: "Alpha feature",
        body: "Sooner",
        ctaLabel: "Okay",
      },
    ] as const satisfies readonly JournalPromoBannerConfig[];

    expect(
      selectJournalPromo(
        { signedIn: true, sharedCircle: false, dismissedIds: new Set() },
        banners,
      )?.banner.id,
    ).toBe("alpha");
    expect(
      selectJournalPromo(
        {
          signedIn: true,
          sharedCircle: false,
          dismissedIds: new Set(["alpha"]),
        },
        banners,
      )?.banner.id,
    ).toBe("zeta");
    expect(
      selectJournalPromo(
        {
          signedIn: false,
          sharedCircle: false,
          dismissedIds: new Set(),
        },
        banners,
      ),
    ).toBeNull();
  });

  it("builds the pre-paint hide from every config storage key", () => {
    const script = journalPromoPrepaintScript();
    expect(script).toContain("our-days:mentions-announcement");
    expect(script).toContain("our-days:phone-notifications-announcement");
    expect(script).toContain('setAttribute("data-dismissed-promos"');
    expect(script).toContain(
      "html[data-dismissed-promos~=\"' + promoId + '\"] .journal-banner[data-promo=\"' + promoId + '\"]{display:none}",
    );
    expect(
      journalPromoPrepaintScript([
        { id: "picnic", storageKey: "our-days:picnic-announcement" },
      ]),
    ).toContain("our-days:picnic-announcement");
  });
});
