function zonedParts(
  instant: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone,
  }).formatToParts(instant);
}

function part(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
) {
  return parts.find((item) => item.type === type)?.value;
}

function calendarKey(instant: Date, timeZone: string) {
  const pieces = zonedParts(instant, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const year = part(pieces, "year");
  const month = part(pieces, "month");
  const day = part(pieces, "day");
  if (!year || !month || !day) return "";
  return `${year}-${month}-${day}`;
}

function clockInZone(instant: Date, timeZone: string) {
  const pieces = zonedParts(instant, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const hour = part(pieces, "hour");
  const minute = part(pieces, "minute");
  const dayPeriod = part(pieces, "dayPeriod");
  if (!hour || !minute || !dayPeriod) return "";
  return `${hour}:${minute} ${dayPeriod}`;
}

function dayInZone(instant: Date, timeZone: string, includeYear: boolean) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(instant);
}

function yearInZone(instant: Date, timeZone: string) {
  return Number(
    part(zonedParts(instant, timeZone, { year: "numeric" }), "year"),
  );
}

/**
 * Conversation stamp in an explicit zone. "Today" is that zone's calendar day.
 * Pass the viewer's zone; do not call this during server rendering.
 */
export function displayConversationDate(
  value: string,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const time = clockInZone(instant, timeZone);
  if (!time) return "";
  if (calendarKey(instant, timeZone) === calendarKey(now, timeZone)) {
    return `Today · ${time}`;
  }
  const includeYear =
    yearInZone(instant, timeZone) !== yearInZone(now, timeZone);
  return `${dayInZone(instant, timeZone, includeYear)} · ${time}`;
}

/** Date-only placeholder. No clock, so server HTML cannot show a UTC time. */
export function displayConversationDateOnly(value: string, timeZone = "UTC") {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const includeYear =
    yearInZone(instant, timeZone) !== yearInZone(new Date(), timeZone);
  return dayInZone(instant, timeZone, includeYear);
}

/** Notification day in an explicit zone. Always includes the year. */
export function displayActivityDate(value: string, timeZone: string) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(instant);
}
