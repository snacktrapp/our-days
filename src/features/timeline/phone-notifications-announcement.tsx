"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
    <aside className="phone-notifications-announcement" role="status">
      <button
        type="button"
        className="phone-notifications-announcement-dismiss"
        aria-label="Dismiss"
        onClick={dismiss}
      >
        ×
      </button>
      <span
        className="phone-notifications-announcement-mark"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24">
          <path d="M6.2 16.4h11.6s-1.3-1.5-1.3-5.1a4.5 4.5 0 1 0-9 0c0 3.6-1.3 5.1-1.3 5.1Z" />
          <path d="M10.2 18.1a1.8 1.8 0 0 0 3.6 0" />
        </svg>
      </span>
      <strong>Phone notifications are live</strong>
      <p>Get a quiet ping on this phone.</p>
      <Link
        className="phone-notifications-announcement-cta"
        href="/settings/family#notifications"
        prefetch={false}
        onClick={dismiss}
      >
        Turn on notifications
      </Link>
    </aside>
  );
}
