import "server-only";

import {
  formatAnniversaryLabel,
  parseMemoryDate,
} from "@/features/memories/memory-date";
import type {
  MemoriesViewModel,
  MemoryJourneyViewModel,
} from "@/features/memories/memories-view-model";
import type { TimelineMomentViewModel } from "@/features/timeline/timeline-view-model";
import type { JournalAccess } from "@/lib/auth/journal-access";
import type { Database } from "@/lib/supabase/database.types";
import { localJournalIsEnabled } from "../../config/our-days-environment";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  plainToday,
  type ConnectedJournalContext,
} from "./journal-context.server";
import {
  buildTimelineEntries,
  connectedTimelineInteraction,
  loadMomentPhotosByMomentId,
  mapTimelineRow,
  requestedPageCount,
  requestedSnapshot,
  type TimelineRow,
} from "./moments.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;
type MemoryRow = Omit<
  Database["public"]["Functions"]["list_memory_moments"]["Returns"][number],
  | "occurred_at"
  | "occurred_timezone"
  | "tagged_people"
  | "moment_kind"
  | "moment_title"
  | "place_name"
> &
  Pick<
    TimelineRow,
    | "occurred_at"
    | "occurred_timezone"
    | "tagged_people"
    | "moment_kind"
    | "moment_title"
    | "place_name"
  >;

type MilestoneRow = Omit<
  Database["public"]["Functions"]["list_milestone_memories"]["Returns"][number],
  | "occurred_at"
  | "occurred_timezone"
  | "tagged_people"
  | "moment_kind"
  | "moment_title"
  | "place_name"
> &
  Pick<
    TimelineRow,
    | "occurred_at"
    | "occurred_timezone"
    | "tagged_people"
    | "moment_kind"
    | "moment_title"
    | "place_name"
  >;

const pageSize = 20;
const yearPageSize = 40;

function memoryChrome(context: ConnectedJournalContext) {
  return { ...context.chrome, title: "Memories", accent: "teal" as const };
}

export function parseMemoryYear(value: string): number | null {
  if (!/^[1-9]\d{0,3}$/u.test(value)) return null;
  const year = Number(value);
  return year >= 1 && year <= 9999 ? year : null;
}

function anniversaryFromToday(today: string) {
  const parsed = parseMemoryDate(today);
  if (!parsed) throw new Error("Circle date is unavailable");
  return { month: parsed.month, day: parsed.day };
}

function requestedAnniversary(value: string | undefined) {
  if (value === undefined) return undefined;
  if (!/^\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Memory anniversary is unavailable");
  }
  const parsed = parseMemoryDate(`2000-${value}`);
  if (!parsed) throw new Error("Memory anniversary is unavailable");
  return { key: value, month: parsed.month, day: parsed.day };
}

function momentKindLabel(moment: TimelineMomentViewModel) {
  if (moment.kind === "milestone") return "Milestone";
  if (moment.kind === "location") return "Place";
  if (moment.kind === "photo") return "Photo";
  if (moment.kind === "video") return "Video";
  if (moment.kind === "insight") return "Insight";
  return "Thought";
}

function conciseSummary(value: string, maximumLength = 180) {
  const characters = Array.from(value.trim());
  if (characters.length <= maximumLength) return characters.join("");
  return `${characters
    .slice(0, maximumLength - 1)
    .join("")
    .trimEnd()}…`;
}

function momentSummary(moment: TimelineMomentViewModel) {
  if (moment.kind === "milestone") {
    return conciseSummary(
      [moment.milestone, moment.text].filter(Boolean).join(" — "),
    );
  }
  if (moment.kind === "location") {
    return conciseSummary(
      [moment.place, moment.text].filter(Boolean).join(" — "),
    );
  }
  return conciseSummary(moment.text);
}

export async function loadConnectedMemories(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
  options: Readonly<{ beforeYear?: number }> = {},
): Promise<MemoriesViewModel> {
  if (localJournalIsEnabled()) {
    const { loadLocalMemories } = await import("@/lib/local-journal/views");
    return loadLocalMemories(access, context, options);
  }
  const supabase = await createOurDaysServerClient();
  const anniversary = anniversaryFromToday(context.today);
  const [yearsResult, featureResult] = await Promise.all([
    supabase.rpc("list_memory_years", {
      circle_id: access.circleId,
      before_year: options.beforeYear,
      page_size: yearPageSize + 1,
    }),
    supabase.rpc("list_memory_moments", {
      circle_id: access.circleId,
      anniversary_month: anniversary.month,
      anniversary_day: anniversary.day,
      page_size: 1,
    }),
  ]);
  const error = yearsResult.error ?? featureResult.error;
  if (error) throw error;

  const yearRows = yearsResult.data ?? [];
  const hasEarlierYears = yearRows.length > yearPageSize;
  const visibleYears = yearRows.slice(0, yearPageSize);
  const lastVisibleYear = visibleYears.at(-1)?.memory_year;

  const featureRow = (featureResult.data?.[0] ?? undefined) as
    MemoryRow | undefined;
  const featurePhotos =
    featureRow?.moment_kind === "photo"
      ? await loadMomentPhotosByMomentId(supabase, [featureRow.moment_id])
      : new Map();
  const featureMoment = featureRow
    ? mapTimelineRow(
        featureRow,
        context.today,
        undefined,
        featurePhotos.get(featureRow.moment_id),
      )
    : undefined;

  return {
    chrome: memoryChrome(context),
    heading: "On this day",
    subheading: "This date across years",
    feature: featureMoment
      ? {
          state: "moment",
          href: "/memories/on-this-day",
          dateLabel: featureMoment.displayDate,
          personName: featureMoment.personName,
          personInitial: featureMoment.personInitial,
          personAccent: featureMoment.personAccent,
          kindLabel: momentKindLabel(featureMoment),
          summary: momentSummary(featureMoment),
          actionLabel: "View entries →",
        }
      : {
          state: "empty",
          href: "/memories/on-this-day",
          title: "No entries for this date",
          description: "Entries from this date will appear here.",
          actionLabel: "View date →",
        },
    years: visibleYears.map(({ memory_year: year }) => ({
      year: String(year),
      href: `/memories/years/${year}`,
      ariaLabel: `Browse memories from ${year}`,
    })),
    yearsEmptyMessage: options.beforeYear
      ? "No earlier years are kept here yet."
      : undefined,
    yearNavigation:
      options.beforeYear || (hasEarlierYears && lastVisibleYear)
        ? {
            newestHref: options.beforeYear ? "/memories" : undefined,
            earlierHref:
              hasEarlierYears && lastVisibleYear
                ? `/memories?beforeYear=${lastVisibleYear}`
                : undefined,
          }
        : undefined,
  };
}

type MemoryJourneyOptions =
  | Readonly<{
      mode: "year";
      year: number;
      pages: number;
      snapshotAt?: string;
    }>
  | Readonly<{
      mode: "anniversary";
      pages: number;
      snapshotAt?: string;
      anniversaryKey?: string;
    }>
  | Readonly<{
      mode: "milestones";
      pages: number;
      snapshotAt?: string;
    }>;

export async function loadConnectedMemoryJourney(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
  options: MemoryJourneyOptions,
): Promise<MemoryJourneyViewModel> {
  if (localJournalIsEnabled()) {
    const { loadLocalMemoryJourney } =
      await import("@/lib/local-journal/views");
    return loadLocalMemoryJourney(access, context, options);
  }
  const supabase = await createOurDaysServerClient();
  const pageCount = requestedPageCount(options.pages);
  let snapshotAt = requestedSnapshot(options.snapshotAt);
  const carriedAnniversary =
    options.mode === "anniversary"
      ? requestedAnniversary(options.anniversaryKey)
      : undefined;
  const anniversaryDate =
    options.mode === "anniversary" && !carriedAnniversary && snapshotAt
      ? plainToday(context.circleTimeZone, new Date(snapshotAt))
      : context.today;
  const anniversary =
    options.mode === "milestones"
      ? undefined
      : (carriedAnniversary ?? anniversaryFromToday(anniversaryDate));
  const anniversaryKey = anniversary
    ? `${String(anniversary.month).padStart(2, "0")}-${String(anniversary.day).padStart(2, "0")}`
    : undefined;
  const rows: (MemoryRow | MilestoneRow)[] = [];
  const queryPrefix =
    options.mode === "year"
      ? `/memories/years/${options.year}`
      : options.mode === "milestones"
        ? "/memories/milestones"
        : "/memories/on-this-day";
  let cursor: MemoryRow | MilestoneRow | undefined;
  let hasMore = false;
  let paginationFailed = false;

  for (let page = 0; page < pageCount; page += 1) {
    const cursorArguments = {
      circle_id: access.circleId,
      cursor_occurred_on: cursor?.occurred_on,
      cursor_has_precise_time: cursor ? cursor.occurred_at !== null : undefined,
      cursor_occurred_at: cursor?.occurred_at ?? undefined,
      cursor_moment_id: cursor?.moment_id,
      page_size: pageSize + 1,
      snapshot_at: snapshotAt,
    };
    const { data, error } =
      options.mode === "milestones"
        ? await supabase.rpc("list_milestone_memories", cursorArguments)
        : await supabase.rpc("list_memory_moments", {
            ...cursorArguments,
            memory_year: options.mode === "year" ? options.year : undefined,
            anniversary_month:
              options.mode === "anniversary" ? anniversary!.month : undefined,
            anniversary_day:
              options.mode === "anniversary" ? anniversary!.day : undefined,
          });
    if (error) {
      if (page === 0) throw error;
      hasMore = true;
      paginationFailed = true;
      break;
    }
    const pageRows = (data ?? []) as (MemoryRow | MilestoneRow)[];
    hasMore = pageRows.length > pageSize;
    const visibleRows = pageRows.slice(0, pageSize);
    rows.push(...visibleRows);
    snapshotAt ??= visibleRows[0]?.feed_snapshot_at;
    cursor = visibleRows.at(-1);
    if (!hasMore || !cursor) break;
  }

  const photoMomentIds = rows
    .filter((row) => row.moment_kind === "photo")
    .map((row) => row.moment_id);
  const photosByMoment = await loadMomentPhotosByMomentId(
    supabase,
    photoMomentIds,
  );
  const moments = rows.map((row) =>
    mapTimelineRow(
      row,
      context.today,
      undefined,
      photosByMoment.get(row.moment_id),
    ),
  );
  const chrome = memoryChrome(context);
  const title =
    options.mode === "year"
      ? String(options.year)
      : options.mode === "milestones"
        ? "Milestones"
        : formatAnniversaryLabel(anniversaryKey!);
  const base = {
    chrome,
    returnHref: "/memories",
    returnLabel: "All memories",
    eyebrow:
      options.mode === "year"
        ? "Browse by year"
        : options.mode === "milestones"
          ? "Family milestones"
          : "On this day · Across the years",
    title,
    description:
      options.mode === "year"
        ? "Entries recorded during this year."
        : options.mode === "milestones"
          ? "Milestone entries in chronological order."
          : "Entries recorded on this date in prior years.",
  } as const;

  if (moments.length === 0) {
    const futureYear =
      options.mode === "year" &&
      options.year > Number(context.today.slice(0, 4));
    return {
      ...base,
      state: "empty",
      emptyState: futureYear
        ? {
            title: "This year hasn’t happened yet",
            description: "Moments can only be kept on or before today.",
          }
        : options.mode === "year"
          ? {
              title: "No moments from this year",
              description:
                "If an older memory belongs here, you can add it with its true date.",
            }
          : options.mode === "milestones"
            ? {
                title: "No milestones have been marked yet",
                description:
                  "Milestones added to the family journal will gather here in their true order.",
              }
            : {
                title: "No entries for this date",
                description: "Entries from this date will appear here.",
              },
    };
  }

  const anniversaryQuery =
    options.mode === "anniversary"
      ? `&anniversary=${encodeURIComponent(anniversaryKey!)}`
      : "";
  const pageQuery = `pages=${pageCount + 1}&snapshot=${encodeURIComponent(snapshotAt!)}${anniversaryQuery}`;
  const retryQuery = `pages=${pageCount}&snapshot=${encodeURIComponent(snapshotAt!)}${anniversaryQuery}`;
  return {
    ...base,
    state: "moments",
    timeline: {
      chrome,
      switcher: [],
      timelineLabel:
        options.mode === "year"
          ? `Family moments from ${options.year}`
          : options.mode === "milestones"
            ? "Family milestones in reverse chronological order"
            : `Family moments from ${title} across the years`,
      interaction: connectedTimelineInteraction(access, context),
      entries: buildTimelineEntries(
        moments,
        context.today,
        hasMore,
        undefined,
        options.mode === "year"
          ? {
              markerLabel: `End of ${options.year}`,
              message: "Every year becomes a chapter in the family’s story.",
            }
          : options.mode === "milestones"
            ? {
                markerLabel: "Milestones through the years",
                message: "Turning points, held beside all the ordinary days.",
              }
            : {
                markerLabel: "Across the years",
                message: "Small days, held here for the years ahead.",
              },
      ),
      pagination:
        hasMore && !paginationFailed
          ? {
              nextHref: `${queryPrefix}?${pageQuery}`,
              label:
                options.mode === "milestones"
                  ? "Show earlier milestones"
                  : "Show earlier days",
            }
          : undefined,
      paginationError: paginationFailed
        ? {
            retryHref: `${queryPrefix}?${retryQuery}`,
            message:
              "Earlier memories couldn’t be opened. The moments already here are still safe.",
            label: "Try opening earlier memories again",
          }
        : undefined,
    },
  };
}
