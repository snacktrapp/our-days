"use client";

import { useSyncExternalStore } from "react";
import { formatMomentTimeLabel } from "./moment-time-label";

function subscribe() {
  return () => {};
}

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function MomentRecordedTime({
  dateLabel,
  quietLabel,
  occurredAt,
  timeZone,
}: Readonly<{
  dateLabel: string;
  quietLabel: string;
  occurredAt?: string;
  timeZone?: string;
}>) {
  const viewerZone = useSyncExternalStore(
    subscribe,
    viewerTimeZone,
    () => null,
  );
  if (!viewerZone || !occurredAt || !timeZone) {
    return <span>{quietLabel}</span>;
  }
  const label = formatMomentTimeLabel({
    occurredAt,
    occurredTimezone: timeZone,
    timePrecision: "minute",
    viewerTimeZone: viewerZone,
  });
  if (label.precision !== "minute" || !label.zonesDiffer || !label.viewerTime) {
    return <span>{quietLabel}</span>;
  }
  return (
    <span className="moment-when">
      <span className="moment-when-line">
        {`${dateLabel} · ${label.posterTime}`}
        {label.placeLabel ? ` ${label.placeLabel}` : ""}
      </span>
      <span className="moment-when-line">· {label.viewerTime} your time</span>
    </span>
  );
}
