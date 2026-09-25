"use client";

import { useSyncExternalStore } from "react";
import {
  displayConversationDate,
  displayConversationDateOnly,
} from "./display-conversation-date";

function subscribe() {
  return () => {};
}

function viewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function ConversationStamp({
  createdAt,
}: Readonly<{
  createdAt: string;
}>) {
  const viewerZone = useSyncExternalStore(
    subscribe,
    viewerTimeZone,
    () => null,
  );
  const text = viewerZone
    ? displayConversationDate(createdAt, new Date(), viewerZone)
    : displayConversationDateOnly(createdAt, "UTC");

  return (
    <time className="inline-note-when" dateTime={createdAt}>
      {text}
    </time>
  );
}
