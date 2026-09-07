"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import type { JournalChromeViewModel } from "./shell-view-model";
import { lockOverlayChrome, unlockOverlayChrome } from "./overlay-chrome";
import {
  sheetCloseMs,
  useOverlayPopoverClose,
} from "./use-overlay-popover-close";
import { useSheetDismiss } from "./use-sheet-dismiss";

type NotificationItem = NonNullable<
  JournalChromeViewModel["notifications"]
>[number];

const storageKey = "our-days:seen-notifications";
const storageEvent = "our-days-notifications-seen";
export const activityPageSize = 20;

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
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(activityPageSize);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLLIElement>(null);
  const { closing, closingRef, requestClose, cancel, onAnimationEnd } =
    useOverlayPopoverClose("sheet-down", sheetCloseMs);
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
    requestClose(() => {
      setOpen(false);
      setVisibleCount(activityPageSize);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    });
  }, [requestClose]);

  const dismissGesture = useSheetDismiss({
    onDismiss: closePanel,
    scrollerRef,
    sheetRef,
  });

  const dialogMounted = useModalDialog(open, dialogRef);

  useLayoutEffect(() => {
    if (!dialogMounted) return;
    lockOverlayChrome();
    return () => unlockOverlayChrome();
  }, [dialogMounted]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() =>
      headingRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, [open]);

  const unseenIds = useMemo(
    () =>
      items.filter((item) => !seenIds.includes(item.id)).map(({ id }) => id),
    [items, seenIds],
  );

  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  useEffect(() => {
    if (!open || !hasMore) return;
    const sentinel = sentinelRef.current;
    const root = scrollerRef.current;
    if (!sentinel || !root || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisibleCount((count) =>
          Math.min(items.length, count + activityPageSize),
        );
      },
      { root, rootMargin: "96px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length, open, visibleItems.length]);

  const revealEarlier = () => {
    setVisibleCount((count) =>
      Math.min(items.length, count + activityPageSize),
    );
  };

  const onListScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller || !hasMore) return;
    if (
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <
      96
    ) {
      revealEarlier();
    }
  };

  const toggle = () => {
    if (open) {
      if (closingRef.current) return;
      closePanel();
      return;
    }
    cancel();
    setVisibleCount(activityPageSize);
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

  const sheet = (
    <dialog
      ref={dialogRef}
      id={panelId}
      className="composer-dialog activity-dialog"
      aria-labelledby={titleId}
      aria-modal="true"
      aria-hidden={closing ? true : undefined}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closePanel();
          return;
        }
        containDialogFocus(event);
      }}
      onCancel={(event) => {
        event.preventDefault();
        closePanel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closePanel();
      }}
    >
      <section
        ref={sheetRef}
        className={`composer-sheet activity-sheet${closing ? " is-closing" : ""}`}
        onAnimationEnd={onAnimationEnd}
        onPointerDown={dismissGesture.onPointerDown}
        onPointerMove={dismissGesture.onPointerMove}
        onPointerUp={dismissGesture.onPointerUp}
        onPointerCancel={dismissGesture.onPointerCancel}
      >
        <div className="activity-sheet-chrome">
          <span className="sheet-handle" aria-hidden="true" />
          <header className="activity-sheet-bar">
            <h2 ref={headingRef} id={titleId} tabIndex={-1}>
              Activity
            </h2>
            <button
              className="sheet-close activity-sheet-done"
              type="button"
              onClick={closePanel}
            >
              Done
            </button>
          </header>
        </div>
        <div
          ref={scrollerRef}
          className="activity-sheet-list"
          onScroll={onListScroll}
        >
          {items.length > 0 ? (
            <ol>
              {visibleItems.map((item) => (
                <li key={item.id}>
                  <Link href={item.href} onClick={() => setOpen(false)}>
                    <span>
                      <strong>{item.actorName}</strong> {item.message}
                    </span>
                    <time>{item.displayDate}</time>
                  </Link>
                </li>
              ))}
              {hasMore ? (
                <li ref={sentinelRef} className="activity-sheet-more">
                  <button type="button" onClick={revealEarlier}>
                    Earlier activity
                  </button>
                </li>
              ) : null}
            </ol>
          ) : (
            <p>No new family activity.</p>
          )}
        </div>
      </section>
    </dialog>
  );

  return (
    <div className="notification-center">
      <button
        ref={triggerRef}
        className="notification-trigger"
        type="button"
        aria-label={
          unseenIds.length > 0
            ? `Open notifications, ${unseenIds.length} new`
            : "Open notifications"
        }
        aria-expanded={open && !closing}
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
      {dialogMounted && typeof document !== "undefined"
        ? createPortal(sheet, document.body)
        : null}
    </div>
  );
}
