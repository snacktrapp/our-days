function localCalendarKey(value: Date) {
  return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
}

function conversationTime(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value;
  if (!hour || !minute || !dayPeriod) {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(value);
  }
  return `${hour}:${minute} ${dayPeriod}`;
}

function conversationDay(value: Date, includeYear: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(value);
}

/** Viewer-local conversation stamp. Does not force UTC calendar parts. */
export function displayConversationDate(value: string, now = new Date()) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";

  const time = conversationTime(instant);
  if (localCalendarKey(instant) === localCalendarKey(now)) {
    return `Today · ${time}`;
  }
  const includeYear = instant.getFullYear() !== now.getFullYear();
  return `${conversationDay(instant, includeYear)} · ${time}`;
}
