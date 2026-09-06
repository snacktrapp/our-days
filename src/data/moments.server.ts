import "server-only";

import type {
  MomentConversationViewModel,
  MomentReactionId,
  TimelineEntryViewModel,
  TimelineMomentViewModel,
  TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import type { JournalAccess } from "@/lib/auth/journal-access";
import type { Database } from "@/lib/supabase/database.types";
import { localJournalIsEnabled } from "../../config/our-days-environment";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type { ConnectedJournalContext } from "./journal-context.server";
import { insightSourceLabel } from "@/features/insights/insight-source";
import { mapDatabaseAccent } from "./journal-context.server";
import {
  normalizeMomentAudience,
  showJustMeAudienceBadge,
} from "@/features/moments/moment-audience";
import {
  parseMomentPhotoRows,
  timelinePhotosFor,
  type MomentPhotoDescriptor,
} from "@/features/moments/moment-photos";

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
  | "latitude"
  | "longitude"
  | "source_url"
  | "moment_journal_person_id"
  | "journal_person_name"
  | "journal_person_accent"
  | "moment_audience"
> & {
  occurred_at: string | null;
  occurred_timezone: string | null;
  moment_kind?: string;
  moment_title?: string | null;
  place_name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source_url?: string | null;
  moment_journal_person_id: string | null;
  journal_person_name: string | null;
  journal_person_accent: string | null;
  moment_audience?: string | null;
  tagged_people?: unknown;
};

type MomentPhotoClient = Awaited<ReturnType<typeof createOurDaysServerClient>>;

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

const emptyConversation: MomentConversationViewModel = {
  notes: [],
  reactions: [],
};

const knownReactionIds = new Set<MomentReactionId>([
  "held-close",
  "made-me-smile",
  "remember-this",
]);

function displayConversationDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function conversationAuthorInitial(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

export async function loadMomentConversationsByMomentId(
  supabase: MomentPhotoClient,
  access: Readonly<{ circleId: string; membershipId: string }>,
  momentIds: readonly string[],
): Promise<Map<string, MomentConversationViewModel>> {
  const conversations = new Map<string, MomentConversationViewModel>();
  const uniqueIds = [...new Set(momentIds.filter(Boolean))];
  for (const id of uniqueIds) {
    conversations.set(id, emptyConversation);
  }
  if (uniqueIds.length === 0 || typeof supabase.from !== "function") {
    return conversations;
  }

  const [notesResult, reactionsResult] = await Promise.all([
    supabase
      .from("moment_notes")
      .select("id, moment_id, author_membership_id, body, revision, created_at")
      .in("moment_id", uniqueIds)
      .is("trashed_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("moment_reactions")
      .select("id, moment_id, author_membership_id, reaction_type, created_at")
      .in("moment_id", uniqueIds)
      .is("removed_at", null)
      .order("created_at", { ascending: true }),
  ]);
  const notes = notesResult.data ?? [];
  const reactions = reactionsResult.data ?? [];
  const membershipIds = [
    ...new Set([...notes, ...reactions].map((row) => row.author_membership_id)),
  ];
  if (membershipIds.length === 0) return conversations;

  const membershipsResult = await supabase
    .from("circle_memberships")
    .select("id, person_id")
    .eq("circle_id", access.circleId)
    .in("id", membershipIds);
  const memberships = membershipsResult.data ?? [];
  const personIds = [...new Set(memberships.map((row) => row.person_id))];
  const peopleResult =
    personIds.length === 0
      ? {
          data: [] as {
            id: string;
            display_name: string;
            accent_token: string;
          }[],
        }
      : await supabase
          .from("people")
          .select("id, display_name, accent_token")
          .eq("circle_id", access.circleId)
          .in("id", personIds);
  const personById = new Map(
    (peopleResult.data ?? []).map((person) => [person.id, person]),
  );
  const authorByMembership = new Map(
    memberships.map((membership) => {
      const person = personById.get(membership.person_id);
      return [
        membership.id,
        {
          name: person?.display_name ?? "Family",
          accent: mapDatabaseAccent(person?.accent_token ?? "slate"),
        },
      ] as const;
    }),
  );

  const notesByMoment = new Map<
    string,
    MomentConversationViewModel["notes"][number][]
  >();
  for (const note of notes) {
    const author = authorByMembership.get(note.author_membership_id);
    const authorName = author?.name ?? "Family";
    const list = notesByMoment.get(note.moment_id) ?? [];
    list.push({
      id: note.id,
      authorName,
      authorInitial: conversationAuthorInitial(authorName),
      authorAccent: author?.accent ?? "slate",
      body: note.body,
      displayDate: displayConversationDate(note.created_at),
      revision: note.revision,
      canChange: note.author_membership_id === access.membershipId,
    });
    notesByMoment.set(note.moment_id, list);
  }

  const reactionsByMoment = new Map<
    string,
    MomentConversationViewModel["reactions"][number][]
  >();
  for (const reaction of reactions) {
    if (!knownReactionIds.has(reaction.reaction_type as MomentReactionId)) {
      continue;
    }
    const author = authorByMembership.get(reaction.author_membership_id);
    const personName = author?.name ?? "Family";
    const list = reactionsByMoment.get(reaction.moment_id) ?? [];
    list.push({
      id: reaction.id,
      personName,
      personInitial: conversationAuthorInitial(personName),
      personAccent: author?.accent ?? "slate",
      reactionId: reaction.reaction_type as MomentReactionId,
      isCurrentMember: reaction.author_membership_id === access.membershipId,
    });
    reactionsByMoment.set(reaction.moment_id, list);
  }

  for (const id of uniqueIds) {
    conversations.set(id, {
      notes: notesByMoment.get(id) ?? [],
      reactions: reactionsByMoment.get(id) ?? [],
    });
  }
  return conversations;
}

export function mapTimelineRow(
  row: TimelineRow,
  today: string,
  visibility?: Readonly<{
    viewerPersonId?: string;
    viewingJournalPersonId?: string;
  }>,
  photos?: readonly MomentPhotoDescriptor[],
): TimelineMomentViewModel {
  const audience = normalizeMomentAudience(row.moment_audience);
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
  const journalPersonName = row.journal_person_name ?? "";
  const base = {
    id: row.moment_id,
    journalPersonId: row.moment_journal_person_id ?? "",
    audience,
    showJustMeBadge: showJustMeAudienceBadge({
      audience,
      viewerPersonId: visibility?.viewerPersonId,
      viewingJournalPersonId: visibility?.viewingJournalPersonId,
      momentJournalPersonId: row.moment_journal_person_id,
    }),
    personName: journalPersonName,
    personInitial:
      Array.from(journalPersonName.trim())[0]?.toLocaleUpperCase("en-US") ??
      "•",
    personAccent: mapDatabaseAccent(row.journal_person_accent ?? "slate"),
    displayTime: row.occurred_at
      ? formatPreciseTime(row.occurred_at, row.occurred_timezone)
      : undefined,
    displayDate: formatPlainDate(row.occurred_on, today),
    occurredOn: row.occurred_on,
    maxOccurredOn: today,
    kicker:
      row.moment_kind === "insight"
        ? "An insight"
        : row.recorder_person_id === row.moment_journal_person_id
          ? row.moment_kind === "milestone"
            ? "A milestone"
            : row.moment_kind === "location"
              ? "A place"
              : row.moment_kind === "photo"
                ? "A photo"
                : row.moment_kind === "video"
                  ? "A video"
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
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
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
  if (row.moment_kind === "photo") {
    const alt = `Photo in ${row.journal_person_name}’s journal from ${formatPlainDate(row.occurred_on, today)}`;
    const album = timelinePhotosFor(row.moment_id, alt, photos);
    const first = album[0];
    return {
      ...base,
      kind: "photo",
      image: {
        src: first?.src ?? `/api/media/moments/${row.moment_id}`,
        alt,
        badgeLabel: formatPlainDate(row.occurred_on, today),
        delivery: "private",
        width: first?.width,
        height: first?.height,
      },
      photos: album,
    };
  }
  if (row.moment_kind === "video") {
    return {
      ...base,
      kind: "video",
      video: {
        src: `/api/media/videos/${row.moment_id}`,
      },
    };
  }
  if (row.moment_kind === "insight") {
    const sourceUrl = row.source_url ?? undefined;
    return {
      ...base,
      kind: "insight",
      attribution: row.moment_title ?? "Insight",
      sourceUrl,
      sourceLabel: sourceUrl ? insightSourceLabel(sourceUrl) : undefined,
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

export async function loadMomentPhotosByMomentId(
  supabase: MomentPhotoClient,
  momentIds: readonly string[],
): Promise<Map<string, MomentPhotoDescriptor[]>> {
  const uniqueIds = [...new Set(momentIds.filter(Boolean))];
  const photosByMoment = new Map<string, MomentPhotoDescriptor[]>();
  if (uniqueIds.length === 0) return photosByMoment;
  if (typeof supabase.from !== "function") return photosByMoment;
  const { data, error } = await supabase
    .from("moment_photos")
    .select("id, moment_id, sort_order, display_width, display_height")
    .in("moment_id", uniqueIds)
    .order("sort_order", { ascending: true });
  if (error || !data) return photosByMoment;
  for (const row of data) {
    const parsed = parseMomentPhotoRows([row]);
    const photo = parsed[0];
    if (!photo || !("moment_id" in row) || typeof row.moment_id !== "string") {
      continue;
    }
    const current = photosByMoment.get(row.moment_id) ?? [];
    current.push(photo);
    photosByMoment.set(row.moment_id, current);
  }
  return photosByMoment;
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
  if (localJournalIsEnabled()) {
    const { loadLocalTimeline } = await import("@/lib/local-journal/views");
    return loadLocalTimeline(access, context, options);
  }
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
      {
        viewerPersonId: access.personId,
        viewingJournalPersonId: options.journalPersonId,
      },
      photosByMoment.get(row.moment_id),
    ),
  );
  const personalJournalIsWritable = Boolean(
    personal &&
    context.chrome.composer.journalPeople.some(
      (person) => person.id === personal.id,
    ),
  );
  const chrome = personal
    ? {
        ...context.chrome,
        accent: personal.accent,
        title: personal.name,
        composer: personalJournalIsWritable
          ? {
              ...context.chrome.composer,
              defaultJournalPersonId: personal.id,
            }
          : context.chrome.composer,
      }
    : context.chrome;
  return {
    chrome,
    switcher: [
      { label: "Family", href: "/family", current: !personal },
      ...context.people.map((person) => ({
        label: person.name,
        href: `/people/${person.id}`,
        current: personal?.id === person.id,
      })),
    ],
    timelineLabel: personal
      ? `Chronological moments for ${personal.name}`
      : "Chronological family moments",
    personalIntro: personal
      ? {
          initial: personal.initial,
          accent: personal.accent,
          title: `${personal.name}’s journal`,
          summary: "Chronological entries",
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
