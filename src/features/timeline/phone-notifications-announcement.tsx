"use client";

import { useEffect, useState } from "react";
import { JournalBanner } from "./journal-banner";
import {
  JOURNAL_PROMO_DISMISSED,
  journalPromoBanner,
} from "./journal-promo-config";

const phonePromo = journalPromoBanner("phone-notifications");
const STORAGE_KEY = phonePromo.storageKey;
const DISMISSED = JOURNAL_PROMO_DISMISSED;

function vapidConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim());
}

async function notificationsAlreadyEnabled() {
  if ("Notification" in window && Notification.permission === "granted") {
    return true;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return false;
  return Boolean(await registration.pushManager.getSubscription());
}

function alreadyDismissed() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === DISMISSED;
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(STORAGE_KEY, DISMISSED);
  } catch {
    // The banner still hides for this visit when storage is unavailable.
  }
}

export async function phoneNotificationsAnnouncementEligible() {
  if (!vapidConfigured() || alreadyDismissed()) return false;
  return !(await notificationsAlreadyEnabled());
}

export function PhoneNotificationsAnnouncement() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void phoneNotificationsAnnouncementEligible().then((eligible) => {
      if (!cancelled && eligible) setVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    rememberDismissed();
    setVisible(false);
  };

  return (
    <JournalBanner
      promoId={phonePromo.id}
      variant={phonePromo.variant}
      title={phonePromo.title}
      body={phonePromo.body}
      cta={{
        kind: "pill",
        label: phonePromo.ctaLabel,
        href: phonePromo.ctaHref,
        onClick: dismiss,
      }}
      showNotNow={phonePromo.showNotNow}
      onDismiss={dismiss}
    />
  );
}
