"use client";

import { useSyncExternalStore } from "react";
import { formatMomentTimeLabel } from "./moment-time-label";
import { timelineCardOccurredLabel } from "./timeline-view-model";

function subscribe() {
  return () => {};
}

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function MomentRecordedTime({
  occurredOn,
  displayTime,
  occurredAt,
  timeZone,
}: Readonly<{
  occurredOn: string;
  displayTime?: string;
  occurredAt?: string;
  timeZone?: string;
}>) {
  const viewerZone = useSyncExternalStore(
    subscribe,
    viewerTimeZone,
    () => null,
  );
  const quiet = timelineCardOccurredLabel(occurredOn, displayTime);
  if (!viewerZone || !occurredAt || !timeZone) {
    return <span>{quiet}</span>;
  }
  const label = formatMomentTimeLabel({
    occurredAt,
    occurredTimezone: timeZone,
    timePrecision: "minute",
    viewerTimeZone: viewerZone,
  });
  if (label.precision !== "minute" || !label.zonesDiffer || !label.viewerTime) {
    return <span>{quiet}</span>;
  }
  const posted = timelineCardOccurredLabel(occurredOn, label.posterTime);
  return (
    <span className="moment-when">
      <span className="moment-when-line">
        {posted}
        {label.placeLabel ? ` ${label.placeLabel}` : ""}
      </span>
      <span className="moment-when-line">· {label.viewerTime} your time</span>
    </span>
  );
}
