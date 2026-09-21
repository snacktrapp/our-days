"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { JournalChromeViewModel } from "./shell-view-model";

export type ActivityItem = NonNullable<
  JournalChromeViewModel["notifications"]
>[number];
export const activityUpdatedEvent = "our-days:activity-updated";
export const activityPollMs = 30000;

/** Visible-session updates only. Opening/resuming establishes a silent baseline. */
export function ActivityBanner() {
  const [banner, setBanner] = useState<ActivityItem | null>(null);

  useEffect(() => {
    let stopped = false;
    let generation = 0;
    let checkedAt: string | null = null;
    let known = new Set<string>();
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;

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
        window.dispatchEvent(
          new CustomEvent(activityUpdatedEvent, { detail: result.items }),
        );
        const freshComment =
          checkedAt &&
          result.items.find(
            (item) =>
              item.id.startsWith("note:") &&
              !known.has(item.id) &&
              item.createdAt &&
              Date.parse(item.createdAt) > Date.parse(checkedAt!),
          );
        if (freshComment && !document.querySelector("dialog[open]"))
          setBanner(freshComment);
        checkedAt = result.observedAt;
        known = new Set(result.items.map((item) => item.id));
      } catch {
        // Reconnecting should not replay a backlog as fresh banners.
        if (requestGeneration === generation) checkedAt = null;
      } finally {
        clearTimeout(timeout);
        if (
          !stopped &&
          requestGeneration === generation &&
          document.visibilityState === "visible"
        )
          timer = setTimeout(poll, activityPollMs);
      }
    };
    const resume = () => {
      generation += 1;
      clearTimeout(timer);
      controller?.abort();
      checkedAt = null;
      setBanner(null);
      void poll();
    };
    const pageShow = (event: PageTransitionEvent) => {
      if (event.persisted) resume();
    };
    void poll();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", pageShow);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", resume);
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
