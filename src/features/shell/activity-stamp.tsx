"use client";

import { useSyncExternalStore } from "react";
import { displayActivityDate } from "@/features/timeline/display-conversation-date";

function subscribe() {
  return () => {};
}

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function ActivityStamp({
  createdAt,
  displayDate,
}: Readonly<{
  createdAt?: string;
  displayDate: string;
}>) {
  const viewerZone = useSyncExternalStore(
    subscribe,
    viewerTimeZone,
    () => null,
  );
  const text =
    createdAt && viewerZone
      ? displayActivityDate(createdAt, viewerZone)
      : displayDate;

  return <time dateTime={createdAt}>{text}</time>;
}
