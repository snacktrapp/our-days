import "server-only";

import { elapsedCalendarLabel } from "@/features/memories/memory-date";
import type {
  TimelineEntryViewModel,
  TimelineMomentViewModel,
  TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import type { JournalAccess } from "@/lib/auth/journal-access";
import type { Database } from "@/lib/supabase/database.types";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type { ConnectedJournalContext } from "./journal-context.server";
import { mapDatabaseAccent } from "./journal-context.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;
type GeneratedTimelineRow =
  Database["public"]["Functions"]["list_timeline_moments"]["Returns"][number];
export type TimelineRow = Omit<
  GeneratedTimelineRow,
  | "occurred_at"
  | "occurred_timezone"
  | "tagged_people"
  | "moment_kind"
  | "moment_title"
  | "place_name"
> & {
  occurred_at: string | null;
  occurred_timezone: string | null;
  moment_kind?: string;
  moment_title?: string | null;
  place_name?: string | null;
  tagged_people?: unknown;
};

const pageSize = 20;
const maximumCumulativePages = 25;

function formatPlainDate(value: string, today: string) {
  if (value === today) return "Today";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatPreciseTime(value: string, timeZone: string | null) {
  if (!timeZone) return undefined;
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function mapTimelineRow(
  row: TimelineRow,
  today: string,
): TimelineMomentViewModel {
  const taggedPeople = Array.isArray(row.tagged_people)
    ? row.tagged_people.flatMap((tag): { id: string; name: string }[] => {
        if (
          typeof tag === "object" &&
          tag !== null &&
          "id" in tag &&
          "name" in tag &&
          typeof tag.id === "string" &&
          typeof tag.name === "string"
        ) {
          return [{ id: tag.id, name: tag.name }];
        }
        return [];
      })
    : [];
  const base = {
    id: row.moment_id,
    journalPersonId: row.moment_journal_person_id,
    personName: row.journal_person_name,
    personInitial:
      Array.from(row.journal_person_name.trim())[0]?.toLocaleUpperCase(
        "en-US",
      ) ?? "•",
    personAccent: mapDatabaseAccent(row.journal_person_accent),
    displayTime: row.occurred_at
      ? formatPreciseTime(row.occurred_at, row.occurred_timezone)
      : undefined,
    displayDate: formatPlainDate(row.occurred_on, today),
    occurredOn: row.occurred_on,
    maxOccurredOn: today,
    kicker:
      row.recorder_person_id === row.moment_journal_person_id
        ? row.moment_kind === "milestone"
          ? "A milestone"
          : row.moment_kind === "location"
            ? "A place"
            : "A thought"
        : `Recorded by ${row.recorder_person_name}`,
    text: row.body,
    conversation: { notes: [], reactions: [] },
    canChange: row.can_change,
    revision: row.revision,
    editOccurrence: {
      occurredAt: row.occurred_at,
      timeZone: row.occurred_timezone,
    },
    taggedPeople,
    taggedPeopleLabel:
      taggedPeople.map((person) => person.name).join(", ") || undefined,
    placeName: row.place_name ?? undefined,
  };
  if (row.moment_kind === "milestone") {
    return {
      ...base,
      kind: "milestone",
      milestone: row.moment_title ?? "A milestone",
      yearLabel: row.occurred_on.slice(0, 4),
    };
  }
  if (row.moment_kind === "location") {
    return {
      ...base,
      kind: "location",
      place: row.place_name ?? "A remembered place",
      mapLabel: "Remembered here",
    };
  }
  return { ...base, kind: "thought" };
}

export function buildTimelineEntries(
  moments: readonly TimelineMomentViewModel[],
  today: string,
  hasMore: boolean,
  personalName?: string,
  completion: Readonly<{ markerLabel: string; message: string }> = {
    markerLabel: "The beginning",
    message: "You’ve reached the earliest moment kept here.",
  },
): readonly TimelineEntryViewModel[] {
  if (moments.length === 0) {
    return [
      {
        id: "empty-journal",
        entryType: "empty-state",
        title: personalName
          ? "A story ready to begin"
          : "Your family story starts here",
        message: personalName
          ? `The first moment in ${personalName}’s journal will appear on this line.`
          : "Write a small moment and it will find its place on this line.",
      },
    ];
  }

  const entries: TimelineEntryViewModel[] = [];
  let previousDate: string | undefined;
  for (const moment of moments) {
    if (moment.occurredOn !== previousDate) {
      if (previousDate) {
        entries.push({
          id: `gap-${previousDate}-${moment.occurredOn}`,
          entryType: "elapsed-gap",
          label: elapsedCalendarLabel(previousDate, moment.occurredOn),
        });
      }
      entries.push({
        id: `date-${moment.occurredOn}`,
        entryType: "date-marker",
        label: formatPlainDate(moment.occurredOn, today),
        divider:
          Boolean(previousDate) &&
          previousDate?.slice(0, 4) !== moment.occurredOn.slice(0, 4),
      });
      previousDate = moment.occurredOn;
    }
    entries.push({
      id: `moment-${moment.id}`,
      entryType: "moment",
      moment,
    });
  }
  if (!hasMore) {
    entries.push({
      id: "connected-end",
      entryType: "end-message",
      markerLabel: completion.markerLabel,
      message: completion.message,
    });
  }
  return entries;
}

export function requestedPageCount(value: number) {
  if (!Number.isInteger(value)) return 1;
  if (value < 1) return 1;
  if (value > maximumCumulativePages) {
    throw new Error("Timeline request is too large");
  }
  return value;
}

export function requestedSnapshot(value: string | undefined) {
  if (!value) return undefined;
  if (value.length > 40 || !Number.isFinite(Date.parse(value))) {
    throw new Error("Timeline snapshot is invalid");
  }
  return value;
}

export function connectedTimelineInteraction(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
): TimelineViewModel["interaction"] {
  const currentPerson = context.people.find(
    (person) => person.id === access.personId,
  );
  return {
    audienceName: context.circleName,
    currentPerson: {
      name: currentPerson?.name ?? "You",
      initial: currentPerson?.initial ?? "•",
      accent: currentPerson?.accent ?? "slate",
    },
    taggablePeople: context.people.map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.initial,
      accent: person.accent,
    })),
    reactionOptions: [
      { id: "held-close", label: "Held close", symbol: "♡" },
      { id: "made-me-smile", label: "Made me smile", symbol: "◡" },
      { id: "remember-this", label: "Remember this", symbol: "✦" },
    ],
  };
}

export async function loadConnectedTimeline(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
  options: Readonly<{
    journalPersonId?: string;
    pages: number;
    snapshotAt?: string;
  }>,
): Promise<TimelineViewModel> {
  const supabase = await createOurDaysServerClient();
  const pageCount = requestedPageCount(options.pages);
  const rows: TimelineRow[] = [];
  const personal = options.journalPersonId
    ? context.people.find((person) => person.id === options.journalPersonId)
    : undefined;
  const queryPrefix = personal ? `/people/${personal.id}` : "/family";
  let cursor: TimelineRow | undefined;
  let snapshotAt = requestedSnapshot(options.snapshotAt);
  let hasMore = false;
  let paginationFailed = false;

  for (let page = 0; page < pageCount; page += 1) {
    const { data, error } = await supabase.rpc("list_timeline_moments", {
      circle_id: access.circleId,
      journal_person_id: options.journalPersonId,
      cursor_occurred_on: cursor?.occurred_on,
      cursor_has_precise_time: cursor ? cursor.occurred_at !== null : undefined,
      cursor_occurred_at: cursor?.occurred_at ?? undefined,
      cursor_moment_id: cursor?.moment_id,
      page_size: pageSize + 1,
      snapshot_at: snapshotAt,
    });
    if (error) {
      if (page === 0) throw error;
      hasMore = true;
      paginationFailed = true;
      break;
    }
    const pageRows = (data ?? []) as TimelineRow[];
    hasMore = pageRows.length > pageSize;
    const visibleRows = pageRows.slice(0, pageSize);
    rows.push(...visibleRows);
    snapshotAt ??= visibleRows[0]?.feed_snapshot_at;
    cursor = visibleRows.at(-1);
    if (!hasMore || !cursor) break;
  }

  const moments = rows.map((row) => mapTimelineRow(row, context.today));
  const chrome = personal
    ? { ...context.chrome, accent: personal.accent, title: personal.name }
    : context.chrome;
  return {
    chrome,
    switcher: [
      { label: "Family", href: "/family", current: !personal },
      ...(personal
        ? [{ label: personal.name, href: queryPrefix, current: true }]
        : []),
    ],
    timelineLabel: personal
      ? `Chronological moments for ${personal.name}`
      : "Chronological family moments",
    personalIntro: personal
      ? {
          initial: personal.initial,
          accent: personal.accent,
          title: `${personal.name}’s days`,
          summary: "One life, held in its true order.",
        }
      : undefined,
    interaction: connectedTimelineInteraction(access, context),
    entries: buildTimelineEntries(
      moments,
      context.today,
      hasMore,
      personal?.name,
    ),
    pagination:
      hasMore && !paginationFailed
        ? {
            nextHref: `${queryPrefix}?pages=${pageCount + 1}&snapshot=${encodeURIComponent(snapshotAt!)}`,
            label: "Show earlier days",
          }
        : undefined,
    paginationError: paginationFailed
      ? {
          retryHref: `${queryPrefix}?pages=${pageCount}&snapshot=${encodeURIComponent(snapshotAt!)}`,
          message:
            "Earlier days couldn’t be opened. The moments already here are still safe.",
          label: "Try opening earlier days again",
        }
      : undefined,
  };
}
