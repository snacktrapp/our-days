"use client";

import { useState, useSyncExternalStore } from "react";
import { JournalBanner } from "./journal-banner";
import {
  JOURNAL_PROMO_DISMISSED,
  journalPromoBanner,
  selectJournalPromo,
} from "./journal-promo-config";
import { PhoneNotificationsAnnouncement } from "./phone-notifications-announcement";

const mentionsPromo = journalPromoBanner("mentions");
const mentionsChangeEvent = "our-days:mentions-announcement";

function alreadyDismissed(storageKey: string) {
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
}

function rememberDismissed(storageKey: string) {
  writeDismissed(storageKey);
  window.dispatchEvent(new Event(mentionsChangeEvent));
}

function subscribeMentions(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(mentionsChangeEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(mentionsChangeEvent, onStoreChange);
  };
}

export function JournalPromos({
  mentionsEligible,
}: Readonly<{ mentionsEligible: boolean }>) {
  const mentionsDismissed = useSyncExternalStore(
    subscribeMentions,
    () => alreadyDismissed(mentionsPromo.storageKey),
    () => false,
  );
  const [heldForPhone, setHeldForPhone] = useState(false);
  const selected = selectJournalPromo({
    mentionsEligible,
    mentionsDismissed,
    phoneEligible: !mentionsEligible || (mentionsDismissed && !heldForPhone),
  });

  if (selected?.id === "mentions") {
    return (
      <JournalBanner
        promoId={mentionsPromo.id}
        variant={mentionsPromo.variant}
        title={mentionsPromo.title}
        body={mentionsPromo.body}
        cta={{
          kind: "pill",
          label: mentionsPromo.ctaLabel,
          onClick: () => {
            setHeldForPhone(true);
            writeDismissed(mentionsPromo.storageKey);
          },
        }}
        onDismiss={() => {
          setHeldForPhone(true);
          rememberDismissed(mentionsPromo.storageKey);
        }}
      />
    );
  }

  if (selected?.id !== "phone-notifications") return null;
  return <PhoneNotificationsAnnouncement />;
}
