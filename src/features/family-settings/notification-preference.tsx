"use client";

import { useEffect, useState } from "react";
import {
  deleteWebPushSubscriptionAction,
  saveWebPushSubscriptionAction,
} from "./web-push-actions";

type PreferenceState = "loading" | "unsupported" | "blocked" | "off" | "on";

function vapidPublicKey() {
  return process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "";
}

function urlBase64ToUint8Array(value: string) {
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padLength = (4 - (padded.length % 4)) % 4;
  const raw = atob(`${padded}${"=".repeat(padLength)}`);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/u.test(navigator.userAgent);
}

async function currentPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    return null;
  }
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export function NotificationPreference() {
  const [state, setState] = useState<PreferenceState>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const configured = vapidPublicKey().length > 0;

  useEffect(() => {
    let cancelled = false;
    const readState = async () => {
      if (
        !configured ||
        !("Notification" in window) ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window)
      ) {
        if (!cancelled) setState(configured ? "unsupported" : "off");
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setState("blocked");
        return;
      }
      const subscription = await currentPushSubscription();
      if (!cancelled) setState(subscription ? "on" : "off");
    };
    void readState();
    return () => {
      cancelled = true;
    };
  }, [configured]);

  const enable = async () => {
    setMessage(null);
    if (!configured) {
      setMessage("Phone notifications aren’t set up on this journal yet.");
      return;
    }
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      setState("unsupported");
      return;
    }
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey()),
      });
      const json = subscription.toJSON();
      const endpoint = json.endpoint;
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!endpoint || !p256dh || !auth) {
        setState("off");
        setMessage("Notifications could not be turned on.");
        return;
      }
      const result = await saveWebPushSubscriptionAction({
        endpoint,
        p256dh,
        auth,
      });
      if (!result.ok) {
        await subscription.unsubscribe().catch(() => undefined);
        setState("off");
        setMessage(result.message);
        return;
      }
      setState("on");
    } catch {
      setState("off");
      setMessage("Notifications could not be turned on.");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const subscription = await currentPushSubscription();
      if (subscription) {
        await deleteWebPushSubscriptionAction({
          endpoint: subscription.endpoint,
        });
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setState("on");
      setMessage("Notifications could not be turned off.");
    } finally {
      setBusy(false);
    }
  };

  const heading =
    state === "on"
      ? "Notifications on"
      : state === "blocked"
        ? "Notifications blocked"
        : "Enable notifications";
  const detail =
    state === "on"
      ? "Family posts, reactions, and comments can reach this phone"
      : state === "blocked"
        ? "This device blocked Our Days. Change that in system settings."
        : state === "unsupported"
          ? "This browser cannot receive phone notifications"
          : "Banners when family posts, reacts, or comments";

  return (
    <div className="notification-preference">
      {state === "on" ? (
        <button
          className="account-tool-link"
          type="button"
          onClick={() => void disable()}
          disabled={busy}
        >
          <span>
            <strong>Turn off notifications</strong>
            <small>{detail}</small>
          </span>
          <span aria-hidden="true">×</span>
        </button>
      ) : (
        <button
          className="account-tool-link"
          type="button"
          onClick={() => void enable()}
          disabled={busy || state === "blocked"}
        >
          <span>
            <strong>{heading}</strong>
            <small>{detail}</small>
          </span>
          <span aria-hidden="true">{state === "blocked" ? "!" : "→"}</span>
        </button>
      )}
      <p className="notification-preference-note">
        {isIosDevice()
          ? "On iPhone and iPad, add Our Days to your Home Screen first."
          : "On iPhone and iPad, Our Days must be on the Home Screen for push."}
      </p>
      {message ? (
        <p className="notification-preference-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
