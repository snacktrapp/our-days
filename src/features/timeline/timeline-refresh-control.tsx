"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import {
  announceTimelineRefresh,
  feedIsAtTop,
  pullArmPx,
  pullRefreshHoldMs,
  pullSettleMs,
  pullShouldRefresh,
  pullIsVertical,
  readFeedScroll,
  readJournalRefreshBlock,
  resistedPull,
  pullThresholdPx,
  type TimelinePullState,
} from "./timeline-pull-to-refresh";

function touchPoint(event: TouchEvent) {
  return event.touches[0] ?? event.changedTouches[0];
}

function writePull(root: HTMLElement | null, px: number) {
  root?.style.setProperty("--timeline-pull", `${px}px`);
}

function writeState(shell: HTMLElement | null, state: TimelinePullState) {
  if (shell) shell.dataset.pullState = state;
}

export function TimelineRefreshControl({ children }: { children: ReactNode }) {
  const router = useRouter();
  const shellRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const refreshingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    if (!refreshing) return;
    if (isPending) return;
    const hold = overlayMotionReduced() ? 0 : pullRefreshHoldMs;
    const settle = overlayMotionReduced() ? 0 : pullSettleMs;
    const holdId = window.setTimeout(() => {
      refreshingRef.current = false;
      setRefreshing(false);
      writePull(rootRef.current, 0);
      writeState(shellRef.current, settle > 0 ? "settling" : "idle");
      if (settle <= 0) return;
      window.setTimeout(() => {
        if (!refreshingRef.current) writeState(shellRef.current, "idle");
      }, settle);
    }, hold);
    return () => window.clearTimeout(holdId);
  }, [isPending, refreshing]);

  useEffect(() => {
    let startX = 0;
    let startY = 0;
    let tracking = false;
    let armed = false;
    let raw = 0;
    let settleId = 0;

    const snapIdle = () => {
      tracking = false;
      armed = false;
      raw = 0;
      if (refreshingRef.current) return;
      writePull(rootRef.current, 0);
      window.clearTimeout(settleId);
      if (overlayMotionReduced()) {
        writeState(shellRef.current, "idle");
        return;
      }
      writeState(shellRef.current, "settling");
      settleId = window.setTimeout(() => {
        if (!refreshingRef.current) writeState(shellRef.current, "idle");
      }, pullSettleMs);
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        if (tracking && !refreshingRef.current) snapIdle();
        tracking = false;
        armed = false;
        return;
      }
      if (refreshingRef.current) return;
      if (readJournalRefreshBlock(event.target)) {
        tracking = false;
        return;
      }
      const scroll = readFeedScroll();
      if (!feedIsAtTop(scroll.windowScrollY, scroll.stageScrollTop)) {
        tracking = false;
        return;
      }
      const touch = touchPoint(event);
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
      armed = false;
      raw = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking || refreshingRef.current) return;
      if (event.touches.length !== 1) {
        snapIdle();
        return;
      }
      const touch = touchPoint(event);
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!armed) {
        if (dy < pullArmPx) return;
        if (!pullIsVertical(dx, dy)) {
          tracking = false;
          return;
        }
        const scroll = readFeedScroll();
        if (
          !feedIsAtTop(scroll.windowScrollY, scroll.stageScrollTop) ||
          readJournalRefreshBlock(event.target)
        ) {
          tracking = false;
          return;
        }
        armed = true;
      }
      if (event.cancelable) event.preventDefault();
      raw = Math.max(0, dy);
      writePull(rootRef.current, resistedPull(raw));
      writeState(
        shellRef.current,
        pullShouldRefresh(raw) ? "armed" : "pulling",
      );
    };

    const onEnd = () => {
      if (!tracking) return;
      tracking = false;
      if (!armed) return;
      armed = false;
      if (pullShouldRefresh(raw)) {
        writePull(rootRef.current, resistedPull(pullThresholdPx));
        writeState(shellRef.current, "refreshing");
        refreshingRef.current = true;
        setRefreshing(true);
        announceTimelineRefresh();
        startTransition(() => {
          router.refresh();
        });
        return;
      }
      snapIdle();
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd, { passive: true });
    document.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.clearTimeout(settleId);
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [router, startTransition]);

  return (
    <div
      ref={shellRef}
      className="timeline-pull-shell"
      data-pull-state="idle"
      aria-busy={refreshing || undefined}
    >
      <div className="timeline-refresh" aria-hidden="true">
        <span className="timeline-refresh-mark" />
      </div>
      <div ref={rootRef} className="timeline-pull-root">
        {children}
      </div>
    </div>
  );
}
