"use client";

import { useEffect, useState } from "react";
import { JournalBanner } from "./journal-banner";

const STORAGE_KEY = "our-days:phone-notifications-announcement";
const DISMISSED = "dismissed";

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

export function PhoneNotificationsAnnouncement() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!vapidConfigured() || alreadyDismissed()) return;
    let cancelled = false;
    void notificationsAlreadyEnabled().then((enabled) => {
      if (!cancelled && !enabled) setVisible(true);
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
      variant="enablement"
      title="Phone notifications are live"
      body="Get a quiet ping on this phone."
      cta={{
        kind: "pill",
        label: "Turn on notifications",
        href: "/settings/family#notifications",
        onClick: dismiss,
      }}
      showNotNow
      onDismiss={dismiss}
    />
  );
}
