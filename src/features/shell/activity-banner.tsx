"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { timelineResumeRefreshStartingEvent } from "@/features/timeline/timeline-resume-refresh";
import type { JournalChromeViewModel } from "./shell-view-model";

export type ActivityItem = NonNullable<
  JournalChromeViewModel["notifications"]
>[number];
export const activityUpdatedEvent = "our-days:activity-updated";
export const activityPollMs = 30000;
const activityResumePollSuppressMs = 15_000;

/** Visible-session updates only. Opening/resuming establishes a silent baseline. */
export function ActivityBanner() {
  const [banner, setBanner] = useState<ActivityItem | null>(null);

  useEffect(() => {
    let stopped = false;
    let generation = 0;
    let checkedAt: string | null = null;
    let known = new Set<string>();
    let suppressResumePollUntil = 0;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;

    const latestCreatedAt = (items: readonly ActivityItem[]) => {
      let newest: string | null = null;
      for (const item of items) {
        if (!item.createdAt || !Number.isFinite(Date.parse(item.createdAt))) {
          continue;
        }
        if (!newest || Date.parse(item.createdAt) > Date.parse(newest)) {
          newest = item.createdAt;
        }
      }
      return newest;
    };

    const seedBaseline = (items: readonly ActivityItem[]) => {
      known = new Set(items.map((item) => item.id));
      checkedAt = latestCreatedAt(items) ?? new Date().toISOString();
    };

    const schedulePoll = () => {
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(poll, activityPollMs);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const requestGeneration = generation;
      controller = new AbortController();
      const request = controller;
      const timeout = setTimeout(() => request.abort(), 15000);
      try {
        const response = await fetch("/api/activity", {
          cache: "no-store",
          signal: request.signal,
        });
        if (!response.ok) throw new Error("Activity unavailable");
        const result = (await response.json()) as {
          items: ActivityItem[];
          observedAt: string;
        };
        if (
          !Array.isArray(result.items) ||
          !Number.isFinite(Date.parse(result.observedAt))
        )
          throw new Error("Invalid activity");
        if (stopped || requestGeneration !== generation) return;
        const previousCheckedAt = checkedAt;
        const previousKnown = known;
        const nextKnown = new Set(result.items.map((item) => item.id));
        const freshComment =
          previousCheckedAt &&
          result.items.find(
            (item) =>
              item.id.startsWith("note:") &&
              !previousKnown.has(item.id) &&
              item.createdAt &&
              Date.parse(item.createdAt) > Date.parse(previousCheckedAt),
          );
        if (freshComment && !document.querySelector("dialog[open]"))
          setBanner(freshComment);
        window.dispatchEvent(
          new CustomEvent(activityUpdatedEvent, { detail: result.items }),
        );
        checkedAt = result.observedAt;
        known = nextKnown;
      } catch {
        // Reconnecting should not replay a backlog as fresh banners.
        if (requestGeneration === generation) checkedAt = null;
      } finally {
        clearTimeout(timeout);
        if (requestGeneration === generation) schedulePoll();
      }
    };

    const resume = (skipImmediatePoll = false) => {
      generation += 1;
      clearTimeout(timer);
      controller?.abort();
      checkedAt = null;
      setBanner(null);
      if (skipImmediatePoll) {
        schedulePoll();
        return;
      }
      void poll();
    };

    const handleSeed = (event: Event) => {
      const items = (event as CustomEvent<ActivityItem[]>).detail;
      if (!Array.isArray(items)) return;
      seedBaseline(items);
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        generation += 1;
        clearTimeout(timer);
        controller?.abort();
        setBanner(null);
        return;
      }
      resume(Date.now() < suppressResumePollUntil);
    };

    const suppressResumePoll = () => {
      suppressResumePollUntil = Date.now() + activityResumePollSuppressMs;
    };

    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resume(Date.now() < suppressResumePollUntil);
      }
    };

    window.addEventListener(activityUpdatedEvent, handleSeed);
    window.addEventListener(
      timelineResumeRefreshStartingEvent,
      suppressResumePoll,
    );
    void Promise.resolve().then(() => {
      if (stopped || document.visibilityState !== "visible") return;
      if (checkedAt) {
        schedulePoll();
        return;
      }
      void poll();
    });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", pageShow);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      window.removeEventListener(activityUpdatedEvent, handleSeed);
      window.removeEventListener(
        timelineResumeRefreshStartingEvent,
        suppressResumePoll,
      );
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", pageShow);
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 7000);
    return () => clearTimeout(timer);
  }, [banner]);

  if (!banner) return null;
  return createPortal(
    <aside className="activity-banner" role="status" aria-label="New comment">
      <Link href={banner.href} prefetch={false} onClick={() => setBanner(null)}>
        <strong>{banner.actorName}</strong> {banner.message}
      </Link>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => setBanner(null)}
      >
        ×
      </button>
    </aside>,
    document.body,
  );
}
