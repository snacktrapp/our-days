import type { JournalBannerVariant } from "./journal-banner";

/**
 * One-time journal cards. To add a banner, append one object to
 * `journalPromoBanners` and nothing else:
 *
 * - `id` — stable id (`data-promo`, pre-paint hide list)
 * - `storageKey` — localStorage key; `"dismissed"` hides it for good
 * - `priority` — lower numbers win; only one card shows at a time
 * - `variant` — `"feature"` | `"enablement"` | `"tip"`
 * - `icon?` — badge mark. A short glyph such as `"@"` or a named icon
 *   `"bell"` | `"sparkle"` | `"bulb"`. Omit to use the variant default
 *   (feature sparkle, enablement bell, tip bulb).
 * - `title`, `body`, `ctaLabel`
 * - `ctaHref?` — pill link; omit for a pill button
 * - `showNotNow?` — include the Not now action
 * - `eligibility?` — `"always"` (signed-in) | `"sharedCircle"` |
 *   `"phoneNotificationsOff"`. Defaults to `"always"`.
 *
 * Dismissing a card does not reveal the next one until the next visit.
 * Existing `storageKey` values must stay stable so prior dismissals persist.
 */

export const JOURNAL_PROMO_DISMISSED = "dismissed";
export const JOURNAL_PROMO_CHANGE_EVENT = "our-days:journal-promo";

export type JournalPromoEligibility =
  "always" | "sharedCircle" | "phoneNotificationsOff";

export type JournalPromoBannerConfig = {
  id: string;
  storageKey: string;
  priority: number;
  variant: JournalBannerVariant;
  icon?: string;
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref?: string;
  showNotNow?: boolean;
  eligibility?: JournalPromoEligibility;
};

export const journalPromoBanners = [
  {
    id: "mentions",
    storageKey: "our-days:mentions-announcement",
    priority: 0,
    variant: "feature",
    icon: "@",
    title: "Tag your people",
    body: "Type @ in a comment or caption to mention someone in the circle. They'll get a notice so they don't miss it.",
    ctaLabel: "Got it",
    eligibility: "sharedCircle",
  },
  {
    id: "phone-notifications",
    storageKey: "our-days:phone-notifications-announcement",
    priority: 1,
    variant: "enablement",
    title: "Phone notifications are live",
    body: "Get a quiet ping on this phone.",
    ctaLabel: "Turn on notifications",
    ctaHref: "/settings/family#notifications",
    showNotNow: true,
    eligibility: "phoneNotificationsOff",
  },
] as const satisfies readonly JournalPromoBannerConfig[];

export type JournalPromoBanner = (typeof journalPromoBanners)[number];
export type JournalPromoId = JournalPromoBanner["id"];

export type JournalPromoContext = Readonly<{
  signedIn: boolean;
  sharedCircle: boolean;
}>;

export type JournalPromoSelectionInput = JournalPromoContext &
  Readonly<{
    dismissedIds: ReadonlySet<string>;
    resolvedEligibility?: Partial<Record<JournalPromoEligibility, boolean>>;
  }>;

export type JournalPromoChoice<T extends JournalPromoBannerConfig> = Readonly<{
  banner: T;
  pending: boolean;
}>;

const syncEligibility: Record<
  Exclude<JournalPromoEligibility, "phoneNotificationsOff">,
  (context: JournalPromoContext) => boolean
> = {
  always: (context) => context.signedIn,
  sharedCircle: (context) => context.signedIn && context.sharedCircle,
};

export function journalPromoBanner<Id extends JournalPromoId>(id: Id) {
  const entry = journalPromoBanners.find(
    (banner): banner is Extract<JournalPromoBanner, { id: Id }> =>
      banner.id === id,
  );
  if (!entry) throw new Error(`Unknown journal promo: ${id}`);
  return entry;
}

export function hasSharedCircle(
  circles: readonly Readonly<{ memberCount?: number }>[],
) {
  return circles.some((circle) => (circle.memberCount ?? 0) > 1);
}

function vapidConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim());
}

async function notificationsAlreadyEnabled() {
  if (
    typeof window !== "undefined" &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    return true;
  }
  if (
    typeof navigator === "undefined" ||
    !("serviceWorker" in navigator) ||
    typeof window === "undefined" ||
    !("PushManager" in window)
  ) {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  return Boolean(await registration.pushManager.getSubscription());
}

export async function phoneNotificationsAreOff() {
  if (!vapidConfigured()) return false;
  return !(await notificationsAlreadyEnabled());
}

export const journalPromoAsyncEligibility = {
  phoneNotificationsOff: phoneNotificationsAreOff,
} as const satisfies Partial<
  Record<JournalPromoEligibility, () => Promise<boolean>>
>;

function eligibilityVerdict(
  key: JournalPromoEligibility,
  input: JournalPromoSelectionInput,
): "yes" | "no" | "pending" {
  if (key === "phoneNotificationsOff") {
    const resolved = input.resolvedEligibility?.phoneNotificationsOff;
    if (resolved === undefined) return "pending";
    return resolved ? "yes" : "no";
  }
  return syncEligibility[key](input) ? "yes" : "no";
}

export function selectJournalPromo(
  input: JournalPromoSelectionInput,
): JournalPromoChoice<JournalPromoBanner> | null;
export function selectJournalPromo<T extends JournalPromoBannerConfig>(
  input: JournalPromoSelectionInput,
  banners: readonly T[],
): JournalPromoChoice<T> | null;
export function selectJournalPromo(
  input: JournalPromoSelectionInput,
  banners: readonly JournalPromoBannerConfig[] = journalPromoBanners,
): JournalPromoChoice<JournalPromoBannerConfig> | null {
  const ranked = [...banners].sort(
    (left, right) => left.priority - right.priority,
  );
  for (const banner of ranked) {
    if (input.dismissedIds.has(banner.id)) continue;
    const verdict = eligibilityVerdict(banner.eligibility ?? "always", input);
    if (verdict === "no") continue;
    return { banner, pending: verdict === "pending" };
  }
  return null;
}

export function journalPromoPrepaintScript(
  banners: readonly Pick<
    JournalPromoBannerConfig,
    "id" | "storageKey"
  >[] = journalPromoBanners,
) {
  const pairs = JSON.stringify(
    banners.map((banner) => [banner.storageKey, banner.id]),
  );
  return `try {
    var dismissedPromos = [];
    var promoKeys = ${pairs};
    for (var i = 0; i < promoKeys.length; i++) {
      if (window.localStorage.getItem(promoKeys[i][0]) === "${JOURNAL_PROMO_DISMISSED}") {
        dismissedPromos.push(promoKeys[i][1]);
      }
    }
    if (dismissedPromos.length) {
      document.documentElement.setAttribute("data-dismissed-promos", dismissedPromos.join(" "));
    }
    var promoHideCss = "";
    for (var j = 0; j < promoKeys.length; j++) {
      var promoId = String(promoKeys[j][1]).replace(/[^A-Za-z0-9_-]/g, "");
      if (!promoId) continue;
      promoHideCss += 'html[data-dismissed-promos~="' + promoId + '"] .journal-banner[data-promo="' + promoId + '"]{display:none}';
    }
    if (promoHideCss && document.head) {
      var promoStyle = document.createElement("style");
      var promoScript = document.currentScript || document.getElementById("our-days-theme");
      var promoNonce = promoScript && (promoScript.nonce || promoScript.getAttribute("nonce"));
      if (promoNonce) {
        promoStyle.setAttribute("nonce", promoNonce);
        promoStyle.nonce = promoNonce;
      }
      promoStyle.textContent = promoHideCss;
      document.head.appendChild(promoStyle);
    }
  } catch (_) {}`;
}
