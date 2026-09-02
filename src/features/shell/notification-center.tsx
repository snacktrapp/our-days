"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { JournalChromeViewModel } from "./shell-view-model";

type NotificationItem = NonNullable<
  JournalChromeViewModel["notifications"]
>[number];

const storageKey = "our-days:seen-notifications";
const storageEvent = "our-days-notifications-seen";

function subscribeToSeenNotifications(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(storageEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(storageEvent, onStoreChange);
  };
}

function readSeenNotifications() {
  return window.localStorage.getItem(storageKey) ?? "[]";
}

export function NotificationCenter({
  items = [],
}: Readonly<{ items?: readonly NotificationItem[] }>) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const centerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLElement>(null);
  const seenSnapshot = useSyncExternalStore(
    subscribeToSeenNotifications,
    readSeenNotifications,
    () => "[]",
  );
  const seenIds = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(seenSnapshot);
      return Array.isArray(parsed) &&
        parsed.every((item): item is string => typeof item === "string")
        ? parsed
        : [];
    } catch {
      return [];
    }
  }, [seenSnapshot]);

  const closePanel = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !centerRef.current?.contains(event.target)
      ) {
        closePanel();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [closePanel, open]);

  const unseenIds = useMemo(
    () =>
      items.filter((item) => !seenIds.includes(item.id)).map(({ id }) => id),
    [items, seenIds],
  );

  const toggle = () => {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    if (unseenIds.length === 0) return;
    const nextSeen = Array.from(new Set([...seenIds, ...unseenIds])).slice(
      -100,
    );
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextSeen));
      window.dispatchEvent(new Event(storageEvent));
    } catch {
      // The activity panel remains usable when storage is unavailable.
    }
  };

  return (
    <div ref={centerRef} className="notification-center">
      <button
        ref={triggerRef}
        className="notification-trigger"
        type="button"
        aria-label={
          unseenIds.length > 0
            ? `Open notifications, ${unseenIds.length} new`
            : "Open notifications"
        }
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.2 8.8c0 5.2-8.2 10-8.2 10s-8.2-4.8-8.2-10A4.3 4.3 0 0 1 12 6.9a4.3 4.3 0 0 1 8.2 1.9Z" />
        </svg>
        {unseenIds.length > 0 ? (
          <span className="notification-dot" aria-hidden="true" />
        ) : null}
      </button>
      {open ? (
        <section
          id={panelId}
          className="notification-panel header-drawer-surface"
          aria-label="Notifications"
        >
          <div className="notification-heading">
            <strong ref={headingRef} tabIndex={-1}>
              Activity
            </strong>
            <button
              className="header-drawer-close"
              type="button"
              aria-label="Close notifications"
              onClick={closePanel}
            >
              ×
            </button>
          </div>
          {items.length > 0 ? (
            <ol>
              {items.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} onClick={() => setOpen(false)}>
                    <span>
                      <strong>{item.actorName}</strong> {item.message}
                    </span>
                    <time>{item.displayDate}</time>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <p>No new family activity.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}
