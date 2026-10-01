/**
 * Time labels copied from the web feed.
 * src/features/timeline/moment-time-label.ts
 * src/features/timeline/display-conversation-date.ts
 * src/data/moments.server.ts formatPlainDate
 */

const headerMonths = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * Minutes east of UTC for `timeZone` at `instant`.
 *
 * Reads the zone's wall clock from format(), not formatToParts(): Hermes on
 * iOS builds parts by splitting on punctuation, so "GMT-7" comes back as a
 * timeZoneName of "GMT" and every zone looked like UTC. That hid the poster's
 * zone label on every card.
 */
function offsetMinutes(timeZone: string, instant: Date) {
  let text: string;
  try {
    text = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).format(instant);
  } catch {
    return null;
  }
  const numbers = text.match(/\d+/g)?.map(Number);
  if (!numbers || numbers.length < 5) return null;
  const [month, day, year, hour, minute] = numbers as [number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour % 24, minute);
  const actual = Math.floor(instant.getTime() / 60000) * 60000;
  const offset = Math.round((wall - actual) / 60000);
  return Math.abs(offset) <= 18 * 60 ? offset : null;
}

function zonesEquivalent(posterZone: string, viewerZone: string, instant: Date) {
  if (posterZone === viewerZone) return true;
  const posterOffset = offsetMinutes(posterZone, instant);
  const viewerOffset = offsetMinutes(viewerZone, instant);
  if (posterOffset === null || viewerOffset === null) return false;
  return posterOffset === viewerOffset;
}

function formatClock(instant: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

const utcNames = new Set(["UTC", "GMT", "ETC/UTC", "ETC/GMT", "ETC/UCT", "UCT", "ZULU"]);

function zonePlaceLabel(timeZone: string, instant: Date) {
  if (utcNames.has(timeZone.toUpperCase())) return "UTC";
  const segments = timeZone.split("/");
  const city = segments.length > 1 ? segments.at(-1) : undefined;
  if (city) return city.replaceAll("_", " ");
  try {
    // Last word of "5 PM EST"; format() is reliable where formatToParts is not.
    const text = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "short",
      hour: "numeric",
    }).format(instant);
    return text.split(/\s+/u).at(-1) || timeZone;
  } catch {
    return timeZone;
  }
}

function headerClock(clock: string | undefined) {
  const trimmed = clock?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\b([ap])m\b/giu, (_match, period: string) => {
    return `${period.toUpperCase()}M`;
  });
}

/** One-line post header: "Sep 25 · 6:15 PM", plus the poster city when zones differ. */
export function formatRecordedMomentHeader(input: Readonly<{
  occurredOn: string;
  occurredAt?: string | null;
  occurredTimezone?: string | null;
  viewerTimeZone?: string | null;
  viewerYear: number;
}>) {
  let clock: string | undefined;
  let placeLabel: string | undefined;
  if (input.occurredAt && input.occurredTimezone) {
    const instant = new Date(input.occurredAt);
    if (!Number.isNaN(instant.getTime())) {
      try {
        clock = formatClock(instant, input.occurredTimezone);
      } catch {
        clock = undefined;
      }
      if (
        clock &&
        input.viewerTimeZone &&
        !zonesEquivalent(input.occurredTimezone, input.viewerTimeZone, instant)
      ) {
        placeLabel = zonePlaceLabel(input.occurredTimezone, instant);
      }
    }
  }
  const [yearText, monthText, dayText] = input.occurredOn.split("-");
  const year = Number(yearText);
  const month = headerMonths[Number(monthText) - 1];
  const day = Number(dayText);
  const date =
    month && year && day
      ? year === input.viewerYear
        ? `${month} ${day}`
        : `${month} ${day}, ${year}`
      : input.occurredOn;
  const timed = clock ? `${date} · ${headerClock(clock)}` : date;
  return placeLabel ? `${timed} ${placeLabel}` : timed;
}

/** Date-marker copy. "Today" when the plain date is the viewer's today. */
export function formatPlainDate(value: string, today: string) {
  if (value === today) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function zonedParts(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone }).formatToParts(
    instant,
  );
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

/** Comment stamp: "Today · 6:15 PM" in the viewer's zone. */
export function formatConversationStamp(
  value: string,
  now = new Date(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
) {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return "";
  const pieces = zonedParts(instant, timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  const hour = part(pieces, "hour");
  const minute = part(pieces, "minute");
  const dayPeriod = part(pieces, "dayPeriod");
  if (!hour || !minute || !dayPeriod) return "";
  const time = `${hour}:${minute} ${dayPeriod}`;
  if (calendarKey(instant, timeZone) === calendarKey(now, timeZone)) {
    return `Today · ${time}`;
  }
  const includeYear =
    Number(part(zonedParts(instant, timeZone, { year: "numeric" }), "year")) !==
    Number(part(zonedParts(now, timeZone, { year: "numeric" }), "year"));
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(instant);
  return `${day} · ${time}`;
}
