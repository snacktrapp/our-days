import "server-only";

import type { AccentToken } from "@/features/accent-token";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import type {
  MemoriesViewModel,
  MemoryJourneyViewModel,
} from "@/features/memories/memories-view-model";
import {
  formatAnniversaryLabel,
  parseMemoryDate,
} from "@/features/memories/memory-date";
import type {
  MomentConversationViewModel,
  TimelineMomentViewModel,
  TimelineViewModel,
} from "@/features/timeline/timeline-view-model";
import type { ConnectedJournalContext } from "@/data/journal-context.server";
import {
  buildActivityNotifications,
  buildJournalPersonSurface,
  mapDatabaseAccent,
  plainToday,
} from "@/data/journal-context.server";
import { journalContextLabel } from "@/lib/circle-roles";
import {
  buildTimelineEntries,
  connectedTimelineInteraction,
  mapTimelineRow,
  requestedPageCount,
  requestedSnapshot,
  type TimelineRow,
} from "@/data/moments.server";
import type { TrashedMomentViewModel } from "@/data/trash.server";
import {
  compareTimelineMoments,
  readLocalJournal,
  type LocalAccess,
} from "./store";
import type { LocalMoment, LocalPerson } from "./types";

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function personName(people: readonly LocalPerson[], personId: string) {
  return (
    people.find((person) => person.id === personId)?.displayName ?? "Family"
  );
}

function membershipPersonName(
  document: Awaited<ReturnType<typeof readLocalJournal>>,
  membershipId: string,
) {
  const membership = document.memberships.find(
    (candidate) => candidate.id === membershipId,
  );
  return membership
    ? personName(document.people, membership.personId)
    : "Family";
}

function momentToTimelineRow(
  document: Awaited<ReturnType<typeof readLocalJournal>>,
  moment: LocalMoment,
  snapshotAt: string,
): TimelineRow {
  const journalPerson = document.people.find(
    (person) => person.id === moment.journalPersonId,
  );
  const recorderMembership = document.memberships.find(
    (membership) => membership.id === moment.recordedByMembershipId,
  );
  const recorderPerson = document.people.find(
    (person) => person.id === recorderMembership?.personId,
  );
  return {
    moment_id: moment.id,
    moment_journal_person_id: moment.journalPersonId,
    journal_person_name: journalPerson?.displayName ?? null,
    journal_person_accent: journalPerson?.accentToken ?? null,
    recorder_person_id:
      recorderMembership?.personId ?? moment.journalPersonId ?? "",
    source_url: moment.sourceUrl ?? null,
    recorder_person_name: recorderPerson?.displayName ?? "Family",
    body: moment.body,
    can_change: true,
    revision: moment.revision,
    occurred_on: moment.occurredOn,
    occurred_at: moment.occurredAt,
    occurred_timezone: moment.occurredTimezone,
    moment_kind: moment.kind,
    moment_title: moment.title || null,
    place_name: moment.placeName || null,
    latitude: moment.latitude ?? null,
    longitude: moment.longitude ?? null,
    tagged_people: moment.taggedPersonIds.flatMap((personId) => {
      const person = document.people.find(
        (candidate) => candidate.id === personId,
      );
      return person ? [{ id: person.id, name: person.displayName }] : [];
    }),
    feed_snapshot_at: snapshotAt,
  } as TimelineRow;
}

export async function loadLocalJournalContext(
  access: LocalAccess,
): Promise<ConnectedJournalContext> {
  const document = await readLocalJournal();
  const today = plainToday(document.circle.timeZone);
  const personNameById = new Map(
    document.people.map((person) => [person.id, person.displayName]),
  );
  const memberNames = new Map(
    document.memberships.map((membership) => [
      membership.id,
      personNameById.get(membership.personId) ?? "Family",
    ]),
  );
  const guardedPersonIds = new Set(
    document.guardians
      .filter(
        (guardian) => guardian.guardianMembershipId === access.membershipId,
      )
      .map((guardian) => guardian.managedPersonId),
  );
  const personOptions = document.people.map((person) => {
    const membership = document.memberships.find(
      (candidate) => candidate.personId === person.id,
    );
    const accent = mapDatabaseAccent(person.accentToken);
    return {
      id: person.id,
      name: person.displayName,
      initial: initialFor(person.displayName),
      accent,
      contextLabel: journalContextLabel(
        person.id === access.personId,
        person.profileKind,
        membership?.role,
      ),
      profileKind: person.profileKind,
      role: membership?.role,
    };
  });
  const recorder = personOptions.find(
    (person) => person.id === access.personId,
  );
  if (!recorder) throw new Error("Member profile is unavailable");
  const surface = buildJournalPersonSurface(
    personOptions,
    access,
    guardedPersonIds,
  );
  const composer: MomentComposerViewModel = {
    experience: "connected-family",
    circleId: document.circle.id,
    photoPostingEnabled: true,
    previewToday: today,
    defaultJournalPersonId: access.personId,
    recorderPersonId: access.personId,
    recordedByName: recorder.name,
    journalPeople: surface.journalPeople,
    taggablePeople: surface.taggablePeople,
  };
  const chrome: JournalChromeViewModel = {
    accent: recorder.accent,
    title: document.circle.name,
    eyebrow: "Our family",
    familyMark: surface.familyMark,
    composer,
    timelineOptionsHref: "/trash",
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    notifications: buildActivityNotifications(
      document.notes
        .filter((note) => note.trashedAt === null)
        .map((note) => ({
          id: note.id,
          moment_id: note.momentId,
          author_membership_id: note.authorMembershipId,
          created_at: note.createdAt,
        })),
      document.reactions
        .filter((reaction) => reaction.removedAt === null)
        .map((reaction) => ({
          id: reaction.id,
          moment_id: reaction.momentId,
          author_membership_id: reaction.authorMembershipId,
          created_at: reaction.createdAt,
          reaction_type: reaction.reactionType,
        })),
      new Set(
        document.moments
          .filter(
            (moment) =>
              moment.recordedByMembershipId === access.membershipId &&
              moment.trashedAt === null,
          )
          .map((moment) => moment.id),
      ),
      memberNames,
      document.moments
        .filter(
          (moment) =>
            moment.trashedAt === null &&
            moment.kind !== "insight" &&
            moment.recordedByMembershipId !== access.membershipId,
        )
        .map((moment) => ({
          id: moment.id,
          author_membership_id: moment.recordedByMembershipId,
          moment_kind: moment.kind,
          created_at: moment.createdAt,
        })),
      access.membershipId,
    ),
  };
  return {
    circleName: document.circle.name,
    circleTimeZone: document.circle.timeZone,
    today,
    chrome,
    people: surface.people,
  };
}

function visibleMoments(
  document: Awaited<ReturnType<typeof readLocalJournal>>,
  journalPersonId?: string,
) {
  return document.moments
    .filter(
      (moment) =>
        moment.trashedAt === null &&
        (!journalPersonId || moment.journalPersonId === journalPersonId),
    )
    .slice()
    .sort(compareTimelineMoments);
}

export async function loadLocalTimeline(
  access: LocalAccess,
  context: ConnectedJournalContext,
  options: Readonly<{
    journalPersonId?: string;
    pages: number;
    snapshotAt?: string;
  }>,
): Promise<TimelineViewModel> {
  const document = await readLocalJournal();
  const pageCount = requestedPageCount(options.pages);
  const snapshotAt =
    requestedSnapshot(options.snapshotAt) ?? new Date().toISOString();
  const personal = options.journalPersonId
    ? context.people.find((person) => person.id === options.journalPersonId)
    : undefined;
  const all = visibleMoments(document, options.journalPersonId);
  const pageSize = 20;
  const limit = pageCount * pageSize;
  const page = all.slice(0, limit);
  const hasMore = all.length > page.length;
  const moments = page.map((moment) =>
    mapTimelineRow(
      momentToTimelineRow(document, moment, snapshotAt),
      context.today,
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
  const queryPrefix = personal ? `/people/${personal.id}` : "/family";
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
    interaction: connectedTimelineInteraction(
      { mode: "authenticated", ...access },
      context,
    ),
    entries: buildTimelineEntries(
      moments,
      context.today,
      hasMore,
      personal?.name,
    ),
    pagination: hasMore
      ? {
          nextHref: `${queryPrefix}?pages=${pageCount + 1}&snapshot=${encodeURIComponent(snapshotAt)}`,
          label: "Show earlier days",
        }
      : undefined,
  };
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

export async function loadLocalMemories(
  access: LocalAccess,
  context: ConnectedJournalContext,
  options: Readonly<{ beforeYear?: number }> = {},
): Promise<MemoriesViewModel> {
  const document = await readLocalJournal();
  const today = parseMemoryDate(context.today);
  if (!today) throw new Error("Circle date is unavailable");
  const visible = visibleMoments(document);
  const years = [
    ...new Set(visible.map((moment) => Number(moment.occurredOn.slice(0, 4)))),
  ]
    .filter((year) => !options.beforeYear || year < options.beforeYear)
    .sort((left, right) => right - left);
  const yearPageSize = 40;
  const hasEarlierYears = years.length > yearPageSize;
  const visibleYears = years.slice(0, yearPageSize);
  const feature = visible.find((moment) => {
    const parsed = parseMemoryDate(moment.occurredOn);
    return parsed?.month === today.month && parsed.day === today.day;
  });
  const snapshotAt = new Date().toISOString();
  const featureMoment = feature
    ? mapTimelineRow(
        momentToTimelineRow(document, feature, snapshotAt),
        context.today,
      )
    : undefined;
  return {
    chrome: {
      ...context.chrome,
      title: "Memories",
      accent: "teal" as AccentToken,
    },
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
    years: visibleYears.map((year) => ({
      year: String(year),
      href: `/memories/years/${year}`,
      ariaLabel: `Browse memories from ${year}`,
    })),
    yearsEmptyMessage: options.beforeYear
      ? "No earlier years are kept here yet."
      : undefined,
    yearNavigation:
      options.beforeYear || (hasEarlierYears && visibleYears.at(-1))
        ? {
            newestHref: options.beforeYear ? "/memories" : undefined,
            earlierHref:
              hasEarlierYears && visibleYears.at(-1)
                ? `/memories?beforeYear=${visibleYears.at(-1)}`
                : undefined,
          }
        : undefined,
  };
}

export async function loadLocalMemoryJourney(
  access: LocalAccess,
  context: ConnectedJournalContext,
  options:
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
    | Readonly<{ mode: "milestones"; pages: number; snapshotAt?: string }>,
): Promise<MemoryJourneyViewModel> {
  const document = await readLocalJournal();
  const pageCount = requestedPageCount(options.pages);
  const snapshotAt =
    requestedSnapshot(options.snapshotAt) ?? new Date().toISOString();
  const today = parseMemoryDate(context.today);
  if (!today) throw new Error("Circle date is unavailable");
  const anniversary =
    options.mode === "anniversary"
      ? options.anniversaryKey
        ? parseMemoryDate(`2000-${options.anniversaryKey}`)
        : today
      : undefined;
  const visible = visibleMoments(document).filter((moment) => {
    if (options.mode === "year") {
      return Number(moment.occurredOn.slice(0, 4)) === options.year;
    }
    if (options.mode === "milestones") return moment.kind === "milestone";
    const parsed = parseMemoryDate(moment.occurredOn);
    return (
      parsed?.month === anniversary?.month && parsed.day === anniversary?.day
    );
  });
  const pageSize = 20;
  const page = visible.slice(0, pageCount * pageSize);
  const hasMore = visible.length > page.length;
  const moments = page.map((moment) =>
    mapTimelineRow(
      momentToTimelineRow(document, moment, snapshotAt),
      context.today,
    ),
  );
  const anniversaryKey = anniversary
    ? `${String(anniversary.month).padStart(2, "0")}-${String(anniversary.day).padStart(2, "0")}`
    : undefined;
  const title =
    options.mode === "year"
      ? String(options.year)
      : options.mode === "milestones"
        ? "Milestones"
        : formatAnniversaryLabel(anniversaryKey!);
  const chrome = {
    ...context.chrome,
    title: "Memories",
    accent: "teal" as AccentToken,
  };
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
  const queryPrefix =
    options.mode === "year"
      ? `/memories/years/${options.year}`
      : options.mode === "milestones"
        ? "/memories/milestones"
        : "/memories/on-this-day";
  const anniversaryQuery =
    options.mode === "anniversary"
      ? `&anniversary=${encodeURIComponent(anniversaryKey!)}`
      : "";
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
      interaction: connectedTimelineInteraction(
        { mode: "authenticated", ...access },
        context,
      ),
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
      pagination: hasMore
        ? {
            nextHref: `${queryPrefix}?pages=${pageCount + 1}&snapshot=${encodeURIComponent(snapshotAt)}${anniversaryQuery}`,
            label:
              options.mode === "milestones"
                ? "Show earlier milestones"
                : "Show earlier days",
          }
        : undefined,
    },
  };
}

export async function loadLocalTrash(
  access: LocalAccess,
): Promise<readonly TrashedMomentViewModel[]> {
  const document = await readLocalJournal();
  if (access.circleId !== document.circle.id) {
    throw new Error("That family is not available.");
  }
  return document.moments
    .filter((moment) => moment.trashedAt !== null)
    .sort((left, right) =>
      (right.trashedAt ?? "").localeCompare(left.trashedAt ?? ""),
    )
    .map((moment) => {
      const person = document.people.find(
        (candidate) => candidate.id === moment.journalPersonId,
      );
      return {
        id: moment.id,
        journalPersonName:
          moment.kind === "insight"
            ? "Insight"
            : (person?.displayName ?? "Family"),
        journalPersonAccent: mapDatabaseAccent(person?.accentToken ?? "clay"),
        kind:
          moment.kind === "milestone" ||
          moment.kind === "location" ||
          moment.kind === "insight"
            ? moment.kind
            : "thought",
        title: moment.title || undefined,
        body: moment.body,
        placeName: moment.placeName || undefined,
        occurredOn: moment.occurredOn,
        revision: moment.revision,
      };
    });
}

export async function loadLocalFamilyAccess(access: LocalAccess) {
  const document = await readLocalJournal();
  if (access.circleId !== document.circle.id) {
    throw new Error("That family is not available.");
  }
  return {
    people: document.people.map((person) => ({
      id: person.id,
      displayName: person.displayName,
      profileKind: person.profileKind,
      accentToken: person.accentToken,
    })),
    memberships: document.memberships.map((membership) => ({
      id: membership.id,
      personId: membership.personId,
      role: membership.role,
    })),
    guardians: document.guardians.map((guardian) => ({
      managedPersonId: guardian.managedPersonId,
      guardianMembershipId: guardian.guardianMembershipId,
    })),
    pendingInvitations: [],
  };
}

export async function loadLocalConversation(
  access: LocalAccess,
  momentId: string,
): Promise<MomentConversationViewModel> {
  const document = await readLocalJournal();
  const moment = document.moments.find(
    (candidate) => candidate.id === momentId && candidate.trashedAt === null,
  );
  if (!moment) throw new Error("That conversation could not be opened.");
  const displayDate = (value: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  return {
    notes: document.notes
      .filter((note) => note.momentId === momentId && note.trashedAt === null)
      .map((note) => {
        const authorName = membershipPersonName(
          document,
          note.authorMembershipId,
        );
        const author = document.people.find(
          (person) =>
            person.id ===
            document.memberships.find(
              (membership) => membership.id === note.authorMembershipId,
            )?.personId,
        );
        return {
          id: note.id,
          authorName,
          authorInitial: initialFor(authorName),
          authorAccent: mapDatabaseAccent(author?.accentToken ?? "clay"),
          body: note.body,
          displayDate: displayDate(note.createdAt),
          revision: note.revision,
          canChange: note.authorMembershipId === access.membershipId,
        };
      }),
    reactions: document.reactions
      .filter(
        (reaction) =>
          reaction.momentId === momentId && reaction.removedAt === null,
      )
      .map((reaction) => {
        const personNameValue = membershipPersonName(
          document,
          reaction.authorMembershipId,
        );
        const author = document.people.find(
          (person) =>
            person.id ===
            document.memberships.find(
              (membership) => membership.id === reaction.authorMembershipId,
            )?.personId,
        );
        return {
          id: reaction.id,
          personName: personNameValue,
          personInitial: initialFor(personNameValue),
          personAccent: mapDatabaseAccent(author?.accentToken ?? "clay"),
          reactionId: reaction.reactionType,
          isCurrentMember: reaction.authorMembershipId === access.membershipId,
        };
      }),
  };
}

export async function findLocalVisibleMoment(momentId: string) {
  const document = await readLocalJournal();
  return (
    document.moments.find(
      (moment) => moment.id === momentId && moment.trashedAt === null,
    ) ?? null
  );
}
