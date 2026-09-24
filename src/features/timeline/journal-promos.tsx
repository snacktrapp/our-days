"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { JournalBanner } from "./journal-banner";
import {
  JOURNAL_PROMO_CHANGE_EVENT,
  JOURNAL_PROMO_DISMISSED,
  journalPromoAsyncEligibility,
  journalPromoBanners,
  selectJournalPromo,
  type JournalPromoBannerConfig,
  type JournalPromoContext,
  type JournalPromoEligibility,
} from "./journal-promo-config";

function storageDismissed(storageKey: string) {
  try {
    return window.localStorage.getItem(storageKey) === JOURNAL_PROMO_DISMISSED;
  } catch {
    return false;
  }
}

function writeDismissed(storageKey: string) {
  try {
    window.localStorage.setItem(storageKey, JOURNAL_PROMO_DISMISSED);
  } catch {
    // The banner still hides for this visit when storage is unavailable.
  }
  window.dispatchEvent(new Event(JOURNAL_PROMO_CHANGE_EVENT));
}

function subscribeJournalPromos(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(JOURNAL_PROMO_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(JOURNAL_PROMO_CHANGE_EVENT, onStoreChange);
  };
}

function dismissedPromoIds(banners: readonly JournalPromoBannerConfig[]) {
  return banners
    .filter((banner) => storageDismissed(banner.storageKey))
    .map((banner) => banner.id)
    .join(" ");
}

const serverDismissedPromoIds = () => "";

function parseDismissedIds(snapshot: string) {
  return new Set(snapshot.split(" ").filter(Boolean));
}

export function JournalPromos({
  context,
  banners = journalPromoBanners,
}: Readonly<{
  context: JournalPromoContext;
  banners?: readonly JournalPromoBannerConfig[];
}>) {
  const dismissedSnapshot = useSyncExternalStore(
    subscribeJournalPromos,
    () => dismissedPromoIds(banners),
    serverDismissedPromoIds,
  );
  const [heldForVisit, setHeldForVisit] = useState(false);
  const [resolvedEligibility, setResolvedEligibility] = useState<
    Partial<Record<JournalPromoEligibility, boolean>>
  >({});
  const choice = heldForVisit
    ? null
    : selectJournalPromo(
        {
          ...context,
          dismissedIds: parseDismissedIds(dismissedSnapshot),
          resolvedEligibility,
        },
        banners,
      );
  const pendingKey = choice?.pending
    ? (choice.banner.eligibility ?? "always")
    : null;

  useEffect(() => {
    if (!pendingKey || !(pendingKey in journalPromoAsyncEligibility)) return;
    const key = pendingKey as keyof typeof journalPromoAsyncEligibility;
    let cancelled = false;
    void journalPromoAsyncEligibility[key]().then((passes) => {
      if (cancelled) return;
      setResolvedEligibility((current) =>
        current[key] === passes ? current : { ...current, [key]: passes },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [pendingKey]);

  if (!choice || choice.pending) return null;

  const banner = choice.banner;
  const dismiss = () => {
    setHeldForVisit(true);
    writeDismissed(banner.storageKey);
  };
  const cta = banner.ctaHref
    ? {
        kind: "pill" as const,
        label: banner.ctaLabel,
        href: banner.ctaHref,
        onClick: dismiss,
      }
    : {
        kind: "pill" as const,
        label: banner.ctaLabel,
        onClick: () => {
          // JournalBanner plays the collapse, then calls onDismiss.
        },
      };

  return (
    <JournalBanner
      promoId={banner.id}
      variant={banner.variant}
      icon={banner.icon}
      title={banner.title}
      body={banner.body}
      cta={cta}
      showNotNow={banner.showNotNow}
      onDismiss={dismiss}
    />
  );
}
