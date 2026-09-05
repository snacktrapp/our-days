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
      <p>Phone notifications are live — turn them on in Account.</p>
      <div className="phone-notifications-announcement-actions">
        <Link
          href="/settings/family#notifications"
          prefetch={false}
          onClick={dismiss}
        >
          Open Account
        </Link>
        <button type="button" onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </aside>
  );
}
