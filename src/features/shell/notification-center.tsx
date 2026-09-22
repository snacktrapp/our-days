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
import { activityUpdatedEvent } from "./activity-banner";

type NotificationItem = NonNullable<
  JournalChromeViewModel["notifications"]
>[number];

const storageKey = "our-days:seen-notifications";
const storageEvent = "our-days-notifications-seen";
export const activityPageSize = 20;
const emptyItems: readonly NotificationItem[] = [];

function subscribeToSeenNotifications(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(storageEvent, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(storageEvent, onStoreChange);
  };
}

function readSeenNotifications() {
  try {
    return window.localStorage.getItem(storageKey) ?? "[]";
  } catch {
    return "[]";
  }
}

export function NotificationCenter({
  items: initialItems = emptyItems,
  refreshOnOpen = false,
}: Readonly<{ items?: readonly NotificationItem[]; refreshOnOpen?: boolean }>) {
  const panelId = useId();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [freshSnapshot, setFreshSnapshot] = useState<{
    source: readonly NotificationItem[];
    items: readonly NotificationItem[];
  } | null>(null);
  const [refreshAttempt, setRefreshAttempt] = useState(0);
  const [refreshState, setRefreshState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const items =
    freshSnapshot?.source === initialItems ? freshSnapshot.items : initialItems;
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

  useEffect(() => {
    if (!refreshOnOpen) return;
    const refresh = (event: Event) => {
      const updated = (event as CustomEvent<NotificationItem[]>).detail;
      if (Array.isArray(updated))
        setFreshSnapshot({ source: initialItems, items: updated });
    };
    window.addEventListener(activityUpdatedEvent, refresh);
    return () => window.removeEventListener(activityUpdatedEvent, refresh);
  }, [initialItems, refreshOnOpen]);

  useEffect(() => {
    if (!open || !refreshOnOpen) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let active = true;
    fetch("/api/activity", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Activity unavailable");
        const result = (await response.json()) as { items: NotificationItem[] };
        if (!Array.isArray(result.items)) throw new Error("Invalid activity");
        if (active) {
          setFreshSnapshot({ source: initialItems, items: result.items });
          setRefreshState("idle");
        }
      })
      .catch(() => {
        if (active) setRefreshState("error");
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [open, refreshOnOpen, refreshAttempt, initialItems]);

  useEffect(() => {
    if (!open || unseenIds.length === 0) return;
    const nextSeen = Array.from(new Set([...seenIds, ...unseenIds])).slice(
      -100,
    );
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(nextSeen));
      window.dispatchEvent(new Event(storageEvent));
    } catch {
      // Reading Activity still works when local storage is unavailable.
    }
  }, [open, seenIds, unseenIds]);

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
    setRefreshState(refreshOnOpen ? "loading" : "idle");
    setOpen(true);
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
          </header>
        </div>
        <div
          ref={scrollerRef}
          className="activity-sheet-list"
          onScroll={onListScroll}
        >
          {refreshState === "loading" ? (
            <p role="status">Checking for new activity…</p>
          ) : null}
          {refreshState === "error" ? (
            <div role="status">
              <p>Activity couldn’t be refreshed.</p>
              <button
                type="button"
                onClick={() => {
                  setRefreshState("loading");
                  setRefreshAttempt((attempt) => attempt + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : null}
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
          ) : refreshState === "idle" ? (
            <p>No new activity.</p>
          ) : null}
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
