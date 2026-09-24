export type MomentTimePrecision = "date" | "minute";

export type MomentTimeLabelInput = Readonly<{
  occurredAt: string | null;
  occurredTimezone: string | null;
  timePrecision?: string | null;
  viewerTimeZone: string;
}>;

export type MomentTimeLabel =
  | Readonly<{ precision: "date" }>
  | Readonly<{
      precision: "minute";
      posterTime: string;
      posterDate: string;
      zonesDiffer: boolean;
      placeLabel?: string;
      viewerTime?: string;
      viewerDate?: string;
    }>;

function offsetMinutes(timeZone: string, instant: Date) {
  let name: string | undefined;
  try {
    name = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "numeric",
    })
      .formatToParts(instant)
      .find((part) => part.type === "timeZoneName")?.value;
  } catch {
    return null;
  }
  if (!name || name === "GMT" || name === "UTC") return name ? 0 : null;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
  if (!match) return null;
  const sign = match[1] === "+" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0"));
}

function zonesEquivalent(
  posterZone: string,
  viewerZone: string,
  instant: Date,
) {
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

export function plainDateInTimeZone(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return undefined;
  return `${year}-${month}-${day}`;
}

export function zonePlaceLabel(timeZone: string, instant: Date) {
  const segments = timeZone.split("/");
  const city = segments.length > 1 ? segments.at(-1) : undefined;
  if (city) return city.replaceAll("_", " ");
  try {
    return (
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "short",
        hour: "numeric",
      })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")?.value ?? timeZone
    );
  } catch {
    return timeZone;
  }
}

export function formatMomentClock(
  occurredAt: string,
  occurredTimezone: string,
) {
  const instant = new Date(occurredAt);
  if (Number.isNaN(instant.getTime())) return undefined;
  try {
    return formatClock(instant, occurredTimezone);
  } catch {
    return undefined;
  }
}

export function formatMomentTimeLabel(
  input: MomentTimeLabelInput,
): MomentTimeLabel {
  if (
    input.timePrecision === "date" ||
    !input.occurredAt ||
    !input.occurredTimezone
  ) {
    return { precision: "date" };
  }
  const instant = new Date(input.occurredAt);
  if (Number.isNaN(instant.getTime())) return { precision: "date" };

  let posterTime: string;
  let posterDate: string | undefined;
  try {
    posterTime = formatClock(instant, input.occurredTimezone);
    posterDate = plainDateInTimeZone(instant, input.occurredTimezone);
  } catch {
    return { precision: "date" };
  }
  if (!posterDate) return { precision: "date" };

  const sameZone = zonesEquivalent(
    input.occurredTimezone,
    input.viewerTimeZone,
    instant,
  );
  if (sameZone) {
    return { precision: "minute", posterTime, posterDate, zonesDiffer: false };
  }

  let viewerTime: string | undefined;
  let viewerDate: string | undefined;
  try {
    viewerTime = formatClock(instant, input.viewerTimeZone);
    viewerDate = plainDateInTimeZone(instant, input.viewerTimeZone);
  } catch {
    return { precision: "minute", posterTime, posterDate, zonesDiffer: false };
  }

  return {
    precision: "minute",
    posterTime,
    posterDate,
    zonesDiffer: true,
    placeLabel: zonePlaceLabel(input.occurredTimezone, instant),
    viewerTime,
    viewerDate,
  };
}
