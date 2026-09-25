"use client";

import { useSyncExternalStore } from "react";
import { formatRecordedMomentHeader } from "./moment-time-label";

function subscribe() {
  return () => {};
}

function viewerContext() {
  return `${new Date().getFullYear()}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
}

export function MomentRecordedTime({
  occurredOn,
  clock,
  occurredAt,
  timeZone,
}: Readonly<{
  occurredOn: string;
  clock?: string;
  occurredAt?: string;
  timeZone?: string;
}>) {
  const viewer = useSyncExternalStore(subscribe, viewerContext, () => null);
  const viewerYear = viewer
    ? Number(viewer.slice(0, viewer.indexOf("|")))
    : new Date().getUTCFullYear();
  const viewerZone = viewer ? viewer.slice(viewer.indexOf("|") + 1) : null;
  const text = formatRecordedMomentHeader({
    occurredOn,
    occurredAt,
    occurredTimezone: timeZone,
    clock,
    viewerTimeZone: viewerZone,
    viewerYear,
  });

  return (
    <span className="moment-when">
      <span className="moment-when-line">{text}</span>
    </span>
  );
}
