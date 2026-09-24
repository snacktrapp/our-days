"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  nextNotificationPageHref,
  normalizeNotificationPath,
  readNotificationTarget,
} from "@/lib/activity-notifications";
import { scheduleBottomNavPin } from "@/features/shell/visual-viewport-bottom";

const revealEvent = "our-days:notification-reveal";
const targetEvent = "our-days:notification-target";
const missingCopy = "That entry isn’t available anymore.";
const duplicateLandingMs = 700;
const consumedStorageKey = "our-days:notification-consumed";
const landingGapPx = 16;

type NotificationTarget = NonNullable<
  ReturnType<typeof readNotificationTarget>
>;

let landedDuplicate: { key: string; until: number } | null = null;
let landedThisDocument: string | null = null;

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function targetKey(target: NotificationTarget) {
  return `${target.momentId}\n${target.noteId ?? ""}\n${target.openThread ? "1" : "0"}`;
}

function readConsumedLanding() {
  try {
    return sessionStorage.getItem(consumedStorageKey);
  } catch {
    return null;
  }
}

function rememberConsumedLanding(key: string) {
  landedThisDocument = key;
  try {
    sessionStorage.setItem(consumedStorageKey, key);
  } catch {
    // Private mode must not pin the reader to a notification after refresh.
  }
}

function navigationIsReload() {
  const entry = performance.getEntriesByType("navigation")[0] as
    { type?: string } | undefined;
  return entry?.type === "reload";
}

/**
 * Distance from the viewport top to the first pixel below the fixed header.
 * Uses the header's layout box, not getBoundingClientRect: the scroll-away
 * header translates upward, and that shrunk rect lands the post underneath
 * the bar once the header is shown again.
 */
export function notificationTopInset() {
  const topbar = document.querySelector(".topbar");
  if (!(topbar instanceof HTMLElement)) return landingGapPx;
  const top = Number.parseFloat(getComputedStyle(topbar).top);
  const anchoredTop = Number.isFinite(top) ? Math.max(0, top) : 0;
  return anchoredTop + topbar.offsetHeight + landingGapPx;
}

function scrollTopFor(node: HTMLElement) {
  return Math.max(
    0,
    node.getBoundingClientRect().top + window.scrollY - notificationTopInset(),
  );
}

function notificationHrefWithoutTarget() {
  const url = new URL(window.location.href);
  if (
    !url.searchParams.has("moment") &&
    !url.searchParams.has("note") &&
    !url.searchParams.has("thread")
  ) {
    return null;
  }
  url.searchParams.delete("moment");
  url.searchParams.delete("note");
  url.searchParams.delete("thread");
  return `${url.pathname}${url.search}${url.hash}`;
}

function focusNode(article: HTMLElement, target: NotificationTarget) {
  if (target.noteId) {
    const note = document.getElementById(`note-${target.noteId}`);
    if (note instanceof HTMLElement) return note;
  }
  if (target.openThread) {
    const thread = article.querySelector(".inline-conversation");
    if (thread instanceof HTMLElement) return thread;
  }
  return article;
}

function bareHistoryState() {
  const state: Record<string, unknown> = {
    ...(window.history.state as Record<string, unknown> | null),
  };
  // Next.js skips canonical-URL sync when the state is marked __NA, then
  // the next router.refresh() writes the original notification query back.
  delete state.__NA;
  delete state._N;
  delete state.__PRIVATE_NEXTJS_INTERNALS_TREE;
  return state;
}

function showMissingTarget() {
  if (document.querySelector("[data-notification-missing]")) return;
  const host = document.querySelector(".timeline");
  if (!host) return;
  const note = document.createElement("p");
  note.className = "timeline-target-note";
  note.dataset.notificationMissing = "true";
  note.setAttribute("role", "status");
  note.textContent = missingCopy;
  host.prepend(note);
}

function isDuplicateLanding(key: string) {
  return landedDuplicate?.key === key && Date.now() < landedDuplicate.until;
}

function rememberLanding(key: string) {
  landedDuplicate = { key, until: Date.now() + duplicateLandingMs };
}

export function clearNotificationLandingGuard() {
  landedDuplicate = null;
  landedThisDocument = null;
  try {
    sessionStorage.removeItem(consumedStorageKey);
  } catch {
    // Ignore storage failures while resetting tests.
  }
}

/**
 * Scrolls a notification open once, keeps that post still while media above
 * it loads, then lets go so later layout and realtime updates cannot pull
 * the reader back.
 */
export function NotificationArrival() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    const replaced = { href: null as string | null };
    const primed = { key: null as string | null };
    const finished = { key: null as string | null };
    let frame = 0;
    let waitTimer = 0;
    let followTimer = 0;
    let highlightTimer = 0;
    let attempts = 0;
    let holding = false;
    let ignoreScroll = false;
    let caughtUp = false;
    let anchor: HTMLElement | null = null;
    let lastSet = -1;
    let observer: ResizeObserver | null = null;
    let noteWatcher: MutationObserver | null = null;
    let pendingWatch: MutationObserver | null = null;
    let highlighted: HTMLElement | null = null;
    let freshIntent = false;

    const consumeMomentParam = () => {
      const next = notificationHrefWithoutTarget();
      if (!next) return;
      // Null the App Router marker so Next records this URL. Reusing
      // history.state leaves the notification query canonical, and refresh
      // writes it back.
      window.history.replaceState(bareHistoryState(), "", next);
      routerRef.current.replace(next, { scroll: false });
    };

    const armIntent = () => {
      freshIntent = true;
      finished.key = null;
      primed.key = null;
      attempts = 0;
    };

    const restoredTarget = (key: string) =>
      !freshIntent &&
      (landedThisDocument === key ||
        (navigationIsReload() && readConsumedLanding() === key));

    const release = () => {
      holding = false;
      anchor = null;
      observer?.disconnect();
      observer = null;
      noteWatcher?.disconnect();
      noteWatcher = null;
      window.removeEventListener("scroll", onScroll);
    };

    const scrollGoal = (top: number) => {
      const max = Math.max(
        0,
        document.documentElement.scrollHeight - window.innerHeight,
      );
      return Math.min(Math.max(0, top), max);
    };

    const onScroll = () => {
      if (!holding || ignoreScroll) return;
      // WebKit reports the programmatic landing scroll after scrollTo
      // returns. That echo is not the reader. Only a move away from a
      // position we already reached releases the anchor.
      if (Math.abs(window.scrollY - scrollGoal(lastSet)) <= 2) {
        caughtUp = true;
        return;
      }
      if (!caughtUp) return;
      release();
    };

    const scrollToY = (top: number, behavior: ScrollBehavior = "auto") => {
      ignoreScroll = true;
      lastSet = top;
      caughtUp = false;
      window.scrollTo({ top, behavior });
      if (Math.abs(window.scrollY - scrollGoal(top)) <= 2) caughtUp = true;
      ignoreScroll = false;
    };

    const stopWaiting = () => {
      pendingWatch?.disconnect();
      pendingWatch = null;
    };

    const waitForDom = () => {
      if (pendingWatch) return;
      pendingWatch = new MutationObserver(() => schedule());
      pendingWatch.observe(document.body, {
        childList: true,
        subtree: true,
      });
    };

    const correctAnchor = () => {
      if (!holding || !anchor) return;
      const next = scrollTopFor(anchor);
      if (Math.abs(next - window.scrollY) < 2) return;
      scrollToY(next);
    };

    const hold = (node: HTMLElement) => {
      release();
      holding = true;
      anchor = node;
      const timeline = document.querySelector(".timeline");
      if (timeline && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => correctAnchor());
        observer.observe(timeline);
      }
      window.addEventListener("scroll", onScroll, { passive: true });
    };

    const scrollOnce = (node: HTMLElement) => {
      scrollToY(scrollTopFor(node));
      window.dispatchEvent(new Event("our-days:reveal-new-entry"));
      scheduleBottomNavPin();
      hold(node);
      window.requestAnimationFrame(() => {
        if (!holding) return;
        const settled = scrollTopFor(node);
        if (Math.abs(settled - window.scrollY) > 2) scrollToY(settled);
      });
    };

    const prime = (article: HTMLElement, target: NotificationTarget) => {
      const key = targetKey(target);
      if (primed.key === key) return;
      primed.key = key;
      highlighted?.classList.remove("notification-target");
      highlighted = article;
      article.classList.add("notification-target");
      window.clearTimeout(highlightTimer);
      highlightTimer = window.setTimeout(() => {
        highlighted?.classList.remove("notification-target");
        if (highlighted === article) highlighted = null;
      }, 1800);
      window.dispatchEvent(new CustomEvent(targetEvent, { detail: target }));
    };

    const finish = (article: HTMLElement, target: NotificationTarget) => {
      const key = targetKey(target);
      if (finished.key === key) return;
      finished.key = key;
      attempts = 0;
      stopWaiting();
      rememberLanding(key);
      rememberConsumedLanding(key);
      freshIntent = false;
      noteWatcher?.disconnect();
      const node = focusNode(article, target);
      scrollOnce(node);
      consumeMomentParam();
      if (
        target.noteId &&
        !(
          document.getElementById(`note-${target.noteId}`) instanceof
          HTMLElement
        )
      ) {
        let settled = false;
        noteWatcher = new MutationObserver(() => {
          if (settled || !holding) {
            noteWatcher?.disconnect();
            return;
          }
          const note = document.getElementById(`note-${target.noteId}`);
          if (!(note instanceof HTMLElement)) return;
          settled = true;
          noteWatcher?.disconnect();
          noteWatcher = null;
          const top = scrollTopFor(note);
          if (Math.abs(top - window.scrollY) < 2) {
            anchor = note;
            return;
          }
          scrollToY(top, "smooth");
          anchor = note;
        });
        noteWatcher.observe(article, { childList: true, subtree: true });
      }
    };

    const run = () => {
      const here = currentPath();
      const normalized = normalizeNotificationPath(here);
      const target = readNotificationTarget(normalized);
      if (!target) {
        attempts = 0;
        stopWaiting();
        return;
      }
      waitForDom();

      const key = targetKey(target);
      if (restoredTarget(key)) {
        finished.key = key;
        freshIntent = false;
        stopWaiting();
        consumeMomentParam();
        return;
      }
      if (isDuplicateLanding(key)) {
        if (document.getElementById(`moment-${target.momentId}`)) {
          consumeMomentParam();
        }
        return;
      }
      if (finished.key === key) return;

      const bare = here.split("#")[0];
      if (normalized !== bare) {
        if (replaced.href !== normalized) {
          replaced.href = normalized;
          const before = `${window.location.pathname}${window.location.search}`;
          routerRef.current.replace(normalized, { scroll: false });
          follow(before);
        }
        return;
      }

      const article = document.getElementById(`moment-${target.momentId}`);
      if (!(article instanceof HTMLElement)) {
        const link = document.querySelector(".timeline-pagination a");
        const nextHref =
          link instanceof HTMLAnchorElement
            ? nextNotificationPageHref(here, link.getAttribute("href") ?? "")
            : null;
        if (nextHref && nextHref !== bare && replaced.href !== nextHref) {
          replaced.href = nextHref;
          const before = `${window.location.pathname}${window.location.search}`;
          routerRef.current.replace(nextHref, { scroll: false });
          follow(before);
          return;
        }
        if (!nextHref) {
          showMissingTarget();
          consumeMomentParam();
          finished.key = key;
          stopWaiting();
        }
        return;
      }

      prime(article, target);
      const notePending = Boolean(
        target.noteId &&
        !(
          document.getElementById(`note-${target.noteId}`) instanceof
          HTMLElement
        ),
      );
      if (notePending && attempts < 10) {
        attempts += 1;
        window.clearTimeout(waitTimer);
        waitTimer = window.setTimeout(schedule, 32);
        return;
      }
      finish(article, target);
    };

    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(run);
    };

    const follow = (before: string) => {
      let tries = 0;
      const tick = () => {
        const now = `${window.location.pathname}${window.location.search}`;
        if (now !== before || tries >= 30) {
          schedule();
          return;
        }
        tries += 1;
        followTimer = window.setTimeout(tick, 50);
      };
      window.clearTimeout(followTimer);
      followTimer = window.setTimeout(tick, 0);
    };

    const pushState = history.pushState.bind(history);
    const replaceState = history.replaceState.bind(history);
    history.pushState = (...args) => {
      pushState(...args);
      if (readNotificationTarget(normalizeNotificationPath(currentPath()))) {
        armIntent();
      }
      schedule();
    };
    history.replaceState = (...args) => {
      replaceState(...args);
      schedule();
    };

    schedule();
    const onReveal = () => {
      armIntent();
      schedule();
      follow(`${window.location.pathname}${window.location.search}`);
    };
    window.addEventListener(revealEvent, onReveal);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(waitTimer);
      window.clearTimeout(followTimer);
      window.clearTimeout(highlightTimer);
      window.removeEventListener(revealEvent, onReveal);
      history.pushState = pushState;
      history.replaceState = replaceState;
      stopWaiting();
      release();
    };
  }, []);

  return null;
}

export function NotificationOpenBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (!data || data.type !== "our-days:notification-open") return;
      if (typeof data.url !== "string" || !data.url.startsWith("/family"))
        return;
      scheduleBottomNavPin();
      const next = normalizeNotificationPath(data.url);
      const here = `${window.location.pathname}${window.location.search}`;
      if (here !== next) router.push(next, { scroll: false });
      window.dispatchEvent(new Event(revealEvent));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
