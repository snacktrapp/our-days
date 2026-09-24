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

function currentPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function scrollToMoment(article: HTMLElement) {
  const topbar = document.querySelector(".topbar");
  const topbarBottom =
    topbar instanceof HTMLElement ? topbar.getBoundingClientRect().bottom : 0;
  const top =
    article.getBoundingClientRect().top + window.scrollY - topbarBottom - 16;
  window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
  window.dispatchEvent(new Event("our-days:reveal-new-entry"));
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

function revealNotificationTarget() {
  const here = currentPath();
  const normalized = normalizeNotificationPath(here);
  const target = readNotificationTarget(normalized);
  if (!target) return "idle" as const;
  if (normalized !== here.split("#")[0] && normalized !== here) {
    return { replace: normalized } as const;
  }
  const article = document.getElementById(`moment-${target.momentId}`);
  if (!(article instanceof HTMLElement)) {
    const link = document.querySelector(".timeline-pagination a");
    const nextHref =
      link instanceof HTMLAnchorElement
        ? nextNotificationPageHref(here, link.getAttribute("href") ?? "")
        : null;
    if (nextHref && nextHref !== here.split("#")[0])
      return { replace: nextHref };
    showMissingTarget();
    return "missing" as const;
  }
  article.classList.add("notification-target");
  window.setTimeout(
    () => article.classList.remove("notification-target"),
    1800,
  );
  scrollToMoment(article);
  window.dispatchEvent(new CustomEvent(targetEvent, { detail: target }));
  const scrollThread = () => {
    const node = target.noteId
      ? document.getElementById(`note-${target.noteId}`)
      : target.openThread
        ? article.querySelector(".inline-conversation")
        : null;
    if (node instanceof HTMLElement) scrollToMoment(node);
  };
  window.requestAnimationFrame(scrollThread);
  window.setTimeout(scrollThread, 80);
  return "shown" as const;
}

export function NotificationArrival() {
  const router = useRouter();
  const replaced = useRef<string | null>(null);

  useEffect(() => {
    let frame = 0;
    const run = () => {
      const result = revealNotificationTarget();
      if (
        result &&
        typeof result === "object" &&
        "replace" in result &&
        replaced.current !== result.replace
      ) {
        replaced.current = result.replace;
        router.replace(result.replace);
      }
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(run);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener(revealEvent, schedule);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener(revealEvent, schedule);
    };
  }, [router]);

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
      if (here !== next) router.push(next);
      else window.dispatchEvent(new Event(revealEvent));
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () =>
      navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  return null;
}
