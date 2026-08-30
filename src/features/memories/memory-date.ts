const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/u;
const monthAndDayPattern = /^(\d{2})-(\d{2})$/u;

type CalendarDate = Readonly<{ year: number; month: number; day: number }>;
type MemoryDateKey = Readonly<{ id: string; occurredOn: string }>;

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseOccurredOn(value: string): CalendarDate {
  const match = isoDatePattern.exec(value);
  if (!match) throw new Error("occurredOn must be a plain YYYY-MM-DD date.");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw new Error("occurredOn must be a real calendar date.");
  }
  return { year, month, day };
}

export function parseMemoryDate(value: string): CalendarDate {
  return parseOccurredOn(value);
}

function calendarOrdinal({ year, month, day }: CalendarDate) {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const adjustedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * adjustedMonth + 2) / 5) + day - 1;
  return (
    era * 146_097 +
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear
  );
}

export function anniversaryKey(occurredOn: string) {
  parseOccurredOn(occurredOn);
  return occurredOn.slice(5);
}

export function matchesAnniversary(occurredOn: string, monthAndDay: string) {
  if (!monthAndDayPattern.test(monthAndDay)) {
    throw new Error("The anniversary key must use MM-DD.");
  }
  parseOccurredOn(`2000-${monthAndDay}`);
  return anniversaryKey(occurredOn) === monthAndDay;
}

export function formatAnniversaryLabel(monthAndDay: string) {
  if (!monthAndDayPattern.test(monthAndDay)) {
    throw new Error("The anniversary key must use MM-DD.");
  }
  const { month, day } = parseOccurredOn(`2000-${monthAndDay}`);
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ] as const;
  return `${monthNames[month - 1]} ${day}`;
}

export function compareMemoryDatesDescending(
  left: MemoryDateKey,
  right: MemoryDateKey,
) {
  parseOccurredOn(left.occurredOn);
  parseOccurredOn(right.occurredOn);
  return (
    right.occurredOn.localeCompare(left.occurredOn) ||
    right.id.localeCompare(left.id)
  );
}

export function elapsedCalendarLabel(newerDate: string, olderDate: string) {
  const newer = parseOccurredOn(newerDate);
  const older = parseOccurredOn(olderDate);
  if (newerDate < olderDate) {
    throw new Error("The elapsed gap must run from newer to older.");
  }
  const dayDelta = calendarOrdinal(newer) - calendarOrdinal(older);
  if (dayDelta <= 0) return "earlier that day";
  if (dayDelta === 1) return "one day earlier";
  if (dayDelta < 14) return `${dayDelta} days earlier`;
  if (dayDelta < 28) return `${Math.floor(dayDelta / 7)} weeks earlier`;

  const monthDelta =
    newer.year * 12 + newer.month - (older.year * 12 + older.month);
  if (monthDelta === 0) return `${Math.floor(dayDelta / 7)} weeks earlier`;
  if (monthDelta === 1) return "one month earlier";
  if (monthDelta < 12) return `${monthDelta} months earlier`;

  const years = newer.year - older.year;
  return years === 1 ? "one year earlier" : `${years} years earlier`;
}
