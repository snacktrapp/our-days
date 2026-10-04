const connectionMonths = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "June",
  "July",
  "Aug.",
  "Sept.",
  "Oct.",
  "Nov.",
  "Dec.",
] as const;

/** Same recorded-date shape as timelineCardOccurredLabel in the web app. */
export function recordedDateLabel(occurredOn: string) {
  const [year, month, day] = occurredOn.split("-").map(Number);
  const monthLabel = connectionMonths[(month ?? 0) - 1];
  if (!monthLabel || !year || !day) return occurredOn;
  return `${monthLabel} ${day}, ${year}`;
}

/** YYYY-MM-DD in the circle's time zone. The RPC rejects a future occurred_on. */
export function circleToday(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  }
}
