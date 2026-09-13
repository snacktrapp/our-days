"use client";

import { catchError, type ErrorInfo } from "next/error";
import { useEffect, useRef } from "react";
import { isRecoverableJournalNavigationError } from "@/lib/auth/family-session-error";
import { JournalInterrupted } from "./journal-interrupted";
import { RoutePendingSkeleton } from "./journal-pending-route";

const autoRetryWindowMs = 4000;
const autoRetryStorageKey = "our-days:journal-nav-auto-retry";

export function shouldAutoRetryJournalRoute(error: unknown) {
  return isRecoverableJournalNavigationError(error);
}

function canAutoRetryNow() {
  if (typeof sessionStorage === "undefined") return true;
  const last = Number(sessionStorage.getItem(autoRetryStorageKey) ?? "0");
  return !Number.isFinite(last) || Date.now() - last > autoRetryWindowMs;
}

function markAutoRetry() {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(autoRetryStorageKey, String(Date.now()));
}

function JournalRouteAutoRetry({ retry }: Readonly<{ retry: () => void }>) {
  const tried = useRef(false);
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    markAutoRetry();
    retry();
  }, [retry]);

  return (
    <main className="app-shell">
      <section className="phone-stage" aria-label="Family journal">
        <RoutePendingSkeleton kind="timeline" />
      </section>
    </main>
  );
}

export function JournalSegmentError({
  error,
  retry,
  reset,
}: Readonly<{
  error?: unknown;
  retry?: () => void;
  reset?: () => void;
}>) {
  const recover = retry ?? reset;
  if (
    error &&
    recover &&
    shouldAutoRetryJournalRoute(error) &&
    canAutoRetryNow()
  ) {
    return <JournalRouteAutoRetry retry={recover} />;
  }
  return <JournalInterrupted retry={retry} reset={reset} />;
}

function JournalRouteFallback(
  _props: object,
  { error, retry, reset }: ErrorInfo,
) {
  return <JournalSegmentError error={error} retry={retry} reset={reset} />;
}

export const JournalRouteBoundary = catchError(JournalRouteFallback);
