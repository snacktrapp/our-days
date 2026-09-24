import type { JournalBannerVariant } from "./journal-banner";

export const JOURNAL_PROMO_DISMISSED = "dismissed";

export const journalPromoBanners = [
  {
    id: "mentions",
    storageKey: "our-days:mentions-announcement",
    priority: 0,
    variant: "feature" satisfies JournalBannerVariant,
    title: "Tag your people",
    body: "Type @ in a comment or caption to mention someone in the circle. They'll get a notice so they don't miss it.",
    ctaLabel: "Got it",
  },
  {
    id: "phone-notifications",
    storageKey: "our-days:phone-notifications-announcement",
    priority: 1,
    variant: "enablement" satisfies JournalBannerVariant,
    title: "Phone notifications are live",
    body: "Get a quiet ping on this phone.",
    ctaLabel: "Turn on notifications",
    ctaHref: "/settings/family#notifications",
    showNotNow: true,
  },
] as const;

export type JournalPromoBanner = (typeof journalPromoBanners)[number];
export type JournalPromoId = JournalPromoBanner["id"];

export function journalPromoBanner<Id extends JournalPromoId>(id: Id) {
  const entry = journalPromoBanners.find(
    (banner): banner is Extract<JournalPromoBanner, { id: Id }> =>
      banner.id === id,
  );
  if (!entry) throw new Error(`Unknown journal promo: ${id}`);
  return entry;
}

export function mentionsAnnouncementEligible(
  signedIn: boolean,
  circles: readonly Readonly<{ memberCount?: number }>[],
) {
  if (!signedIn) return false;
  return circles.some((circle) => (circle.memberCount ?? 0) > 1);
}

export function selectJournalPromo(
  input: Readonly<{
    mentionsEligible: boolean;
    mentionsDismissed: boolean;
    phoneEligible: boolean;
  }>,
): JournalPromoBanner | null {
  const ranked = [...journalPromoBanners].sort(
    (left, right) => left.priority - right.priority,
  );
  for (const entry of ranked) {
    if (entry.id === "mentions") {
      if (input.mentionsEligible && !input.mentionsDismissed) return entry;
      continue;
    }
    if (input.phoneEligible) return entry;
  }
  return null;
}
