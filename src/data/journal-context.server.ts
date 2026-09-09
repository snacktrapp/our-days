import "server-only";

import type { AccentToken } from "@/features/accent-token";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import type { PostableCircle } from "@/features/composer/post-to";
import {
  localJournalIsEnabled,
  photoPostingIsEnabled,
} from "../../config/our-days-environment";
import type { PersonSummaryViewModel } from "@/features/people/people-view-model";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import {
  readJournalCircleMemberships,
  type JournalAccess,
} from "@/lib/auth/journal-access";
import {
  hasOrganizerPrivilege,
  isOperationsMembership,
  journalContextLabel,
  journalDirectoryRoleLabel,
} from "@/lib/circle-roles";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  activityMomentHref,
  entryCommentMessage,
  entryReactionMessage,
  familyMomentPostedMessage,
  isNotifiableFamilyMoment,
} from "@/lib/activity-notifications";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

const accentMap: Readonly<Record<string, AccentToken>> = {
  clay: "clay",
  gold: "ochre",
  plum: "clay",
  rose: "ochre",
  sage: "moss",
  sky: "teal",
};

export function mapDatabaseAccent(value: string): AccentToken {
  return accentMap[value] ?? "slate";
}

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

type PersonRow = Readonly<{
  id: string;
  display_name: string;
  profile_kind: string;
  accent_token: string;
  circle_id?: string | null;
}>;

type MembershipRow = Readonly<{
  id: string;
  person_id: string;
  role: string | null;
  directory_kind?: string | null;
  circle_id?: string | null;
}>;

function circleIdOf(
  row: Readonly<{ circle_id?: string | null }>,
  fallbackCircleId: string,
) {
  return row.circle_id ?? fallbackCircleId;
}

function journalPersonOptionsForCircle(
  people: readonly PersonRow[],
  memberships: readonly MembershipRow[],
  viewerPersonId: string,
): JournalPersonOption[] {
  const membershipByPerson = new Map(
    memberships.map((membership) => [membership.person_id, membership]),
  );
  return people.map((person) => {
    const membership = membershipByPerson.get(person.id);
    return {
      id: person.id,
      name: person.display_name,
      initial: initialFor(person.display_name),
      accent: mapDatabaseAccent(person.accent_token),
      contextLabel: journalContextLabel(
        person.id === viewerPersonId,
        person.profile_kind,
        membership?.role,
      ),
      profileKind: person.profile_kind,
      role: membership?.role,
      directoryKind: membership?.directory_kind,
    };
  });
}

export function buildTaggablePeopleByCircle(
  rosterCircleIds: readonly string[],
  people: readonly PersonRow[],
  memberships: readonly MembershipRow[],
  viewerByCircle: ReadonlyMap<
    string,
    Readonly<{ personId: string; role: string }>
  >,
  fallbackCircleId: string,
  fallbackViewer: Readonly<{ personId: string; role: string }>,
) {
  const byCircle: Record<
    string,
    ReturnType<typeof buildJournalPersonSurface>["taggablePeople"]
  > = {};
  for (const circleId of rosterCircleIds) {
    const viewer = viewerByCircle.get(circleId) ?? fallbackViewer;
    const circlePeople = people.filter(
      (person) => circleIdOf(person, fallbackCircleId) === circleId,
    );
    const circleMemberships = memberships.filter(
      (membership) => circleIdOf(membership, fallbackCircleId) === circleId,
    );
    byCircle[circleId] = buildJournalPersonSurface(
      journalPersonOptionsForCircle(
        circlePeople,
        circleMemberships,
        viewer.personId,
      ),
      viewer,
      new Set(),
    ).taggablePeople;
  }
  return byCircle;
}

export function plainToday(timeZone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (!year || !month || !day) throw new Error("Circle date is unavailable");
  return `${year}-${month}-${day}`;
}

export type ConnectedJournalContext = Readonly<{
  circleName: string;
  circleTimeZone: string;
  today: string;
  chrome: JournalChromeViewModel;
  people: readonly PersonSummaryViewModel[];
  groups?: readonly Readonly<{ id: string; name: string }>[];
}>;

export type JournalPersonOption = Readonly<{
  id: string;
  name: string;
  initial: string;
  accent: AccentToken;
  contextLabel: string;
  profileKind: string;
  role?: string | null;
  directoryKind?: string | null;
}>;

export function buildJournalPersonSurface(
  personOptions: readonly JournalPersonOption[],
  access: Readonly<{ personId: string; role: string }>,
  guardedPersonIds: ReadonlySet<string>,
) {
  const visible = personOptions.filter(
    (person) => !isOperationsMembership(person),
  );
  return {
    people: visible.map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.initial,
      accent: person.accent,
      roleLabel: journalDirectoryRoleLabel(person.profileKind, person.role),
      journalHref: `/people/${person.id}`,
    })),
    familyMark: visible.slice(0, 5).map((person) => ({
      id: person.id,
      initial: person.initial,
      accent: person.accent,
    })),
    journalPeople: visible.filter(
      (person) =>
        person.id === access.personId ||
        (person.profileKind === "managed" &&
          (hasOrganizerPrivilege(access.role) ||
            guardedPersonIds.has(person.id))),
    ),
    taggablePeople: visible.map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.initial,
      accent: person.accent,
      contextLabel: person.contextLabel,
    })),
  };
}

type ActivityNote = Readonly<{
  id: string;
  moment_id: string;
  author_membership_id: string;
  created_at: string;
}>;

type ActivityReaction = ActivityNote & Readonly<{ reaction_type: string }>;

type ActivityMoment = Readonly<{
  id: string;
  author_membership_id: string;
  moment_kind: string;
  created_at: string;
  audience?: string;
}>;

export function buildActivityNotifications(
  notes: readonly ActivityNote[],
  reactions: readonly ActivityReaction[],
  ownedMomentIds: ReadonlySet<string>,
  memberNames: ReadonlyMap<string, string>,
  familyMoments: readonly ActivityMoment[] = [],
  viewerMembershipId?: string,
): NonNullable<JournalChromeViewModel["notifications"]> {
  const displayDate = (createdAt: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(createdAt));
  return [
    ...familyMoments
      .filter((moment) =>
        isNotifiableFamilyMoment({
          authorMembershipId: moment.author_membership_id,
          viewerMembershipId,
          momentKind: moment.moment_kind,
          audience: moment.audience,
        }),
      )
      .map((moment) => ({
        id: `moment:${moment.id}`,
        actorName: memberNames.get(moment.author_membership_id) ?? "Family",
        message: familyMomentPostedMessage(moment.moment_kind),
        displayDate: displayDate(moment.created_at),
        href: activityMomentHref(moment.id),
        createdAt: moment.created_at,
      })),
    ...notes
      .filter((note) => ownedMomentIds.has(note.moment_id))
      .map((note) => ({
        id: `note:${note.id}`,
        actorName: memberNames.get(note.author_membership_id) ?? "Family",
        message: entryCommentMessage,
        displayDate: displayDate(note.created_at),
        href: activityMomentHref(note.moment_id),
        createdAt: note.created_at,
      })),
    ...reactions
      .filter((reaction) => ownedMomentIds.has(reaction.moment_id))
      .map((reaction) => ({
        id: `reaction:${reaction.id}:${reaction.reaction_type}`,
        actorName: memberNames.get(reaction.author_membership_id) ?? "Family",
        message: entryReactionMessage(reaction.reaction_type),
        displayDate: displayDate(reaction.created_at),
        href: activityMomentHref(reaction.moment_id),
        createdAt: reaction.created_at,
      })),
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 20)
    .map((notification) => ({
      id: notification.id,
      actorName: notification.actorName,
      message: notification.message,
      displayDate: notification.displayDate,
      href: notification.href,
    }));
}

export async function loadConnectedJournalContext(
  access: AuthenticatedAccess,
): Promise<ConnectedJournalContext> {
  if (localJournalIsEnabled()) {
    const { loadLocalJournalContext } =
      await import("@/lib/local-journal/views");
    return loadLocalJournalContext(access);
  }
  const supabase = await createOurDaysServerClient();
  const circleMemberships = await readJournalCircleMemberships();
  const rosterCircleIds =
    circleMemberships.length > 0
      ? [...new Set(circleMemberships.map((membership) => membership.circleId))]
      : [access.circleId];
  const [
    circleResult,
    peopleResult,
    membershipsResult,
    guardiansResult,
    momentsResult,
    familyMomentsResult,
    notesResult,
    reactionsResult,
  ] = await Promise.all([
    supabase
      .from("circles")
      .select("id, name, time_zone")
      .eq("id", access.circleId)
      .single(),
    supabase
      .from("people")
      .select("id, display_name, profile_kind, accent_token, circle_id")
      .in("circle_id", rosterCircleIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("circle_memberships")
      .select("id, person_id, role, status, directory_kind, circle_id")
      .in("circle_id", rosterCircleIds),
    supabase
      .from("person_guardians")
      .select("managed_person_id, guardian_membership_id")
      .eq("circle_id", access.circleId)
      .is("revoked_at", null),
    supabase
      .from("moments")
      .select("id")
      .eq("circle_id", access.circleId)
      .eq("recorded_by_membership_id", access.membershipId)
      .is("trashed_at", null),
    supabase
      .from("moment_circles")
      .select("moment_id")
      .eq("circle_id", access.circleId),
    supabase
      .from("moment_notes")
      .select("id, moment_id, author_membership_id, created_at")
      .eq("circle_id", access.circleId)
      .neq("author_membership_id", access.membershipId)
      .is("trashed_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("moment_reactions")
      .select("id, moment_id, author_membership_id, reaction_type, created_at")
      .eq("circle_id", access.circleId)
      .neq("author_membership_id", access.membershipId)
      .is("removed_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const error =
    circleResult.error ??
    peopleResult.error ??
    membershipsResult.error ??
    guardiansResult.error ??
    momentsResult.error ??
    familyMomentsResult.error ??
    notesResult.error ??
    reactionsResult.error;
  if (error) throw error;
  if (!circleResult.data) throw new Error("Circle is unavailable");

  const groupIds = rosterCircleIds;
  const groupsResult =
    groupIds.length === 0
      ? { data: [] as { id: string; name: string }[], error: null }
      : await supabase.from("circles").select("id, name").in("id", groupIds);
  if (groupsResult.error) throw groupsResult.error;
  const groupNameById = new Map(
    (groupsResult.data ?? []).map((circle) => [circle.id, circle.name]),
  );
  const groups = (
    circleMemberships.length > 0
      ? circleMemberships
      : [{ circleId: access.circleId }]
  ).map((membership) => ({
    id: membership.circleId,
    name:
      groupNameById.get(membership.circleId) ??
      (membership.circleId === access.circleId
        ? circleResult.data.name
        : "Circle"),
  }));

  const allPeople = peopleResult.data ?? [];
  const allMemberships = membershipsResult.data ?? [];
  const people = allPeople.filter(
    (person) => circleIdOf(person, access.circleId) === access.circleId,
  );
  const memberships = allMemberships.filter(
    (membership) => circleIdOf(membership, access.circleId) === access.circleId,
  );
  const personNameById = new Map(
    people.map((person) => [person.id, person.display_name]),
  );
  const memberNames = new Map(
    memberships.map((membership) => [
      membership.id,
      personNameById.get(membership.person_id) ?? "Family",
    ]),
  );
  const guardedPersonIds = new Set(
    (guardiansResult.data ?? [])
      .filter(
        (guardian) => guardian.guardian_membership_id === access.membershipId,
      )
      .map((guardian) => guardian.managed_person_id),
  );
  const personOptions = journalPersonOptionsForCircle(
    people,
    memberships,
    access.personId,
  );
  const recorder = personOptions.find(
    (person) => person.id === access.personId,
  );
  if (!recorder) throw new Error("Member profile is unavailable");

  const surface = buildJournalPersonSurface(
    personOptions,
    access,
    guardedPersonIds,
  );
  const memberCountByCircle = new Map<string, number>();
  for (const person of allPeople) {
    const personCircleId = circleIdOf(person, access.circleId);
    memberCountByCircle.set(
      personCircleId,
      (memberCountByCircle.get(personCircleId) ?? 0) + 1,
    );
  }
  const postableCircles: readonly PostableCircle[] = (
    circleMemberships.length > 0
      ? circleMemberships
      : [{ circleId: access.circleId, personId: access.personId }]
  ).map((membership) => ({
    id: membership.circleId,
    name:
      groups.find((group) => group.id === membership.circleId)?.name ??
      (membership.circleId === access.circleId
        ? circleResult.data.name
        : "Circle"),
    personId: membership.personId,
    memberCount: memberCountByCircle.get(membership.circleId),
  }));
  const linkedMomentIds = [
    ...new Set((familyMomentsResult.data ?? []).map((row) => row.moment_id)),
  ];
  const linkedMomentsResult =
    linkedMomentIds.length === 0
      ? {
          data: [] as {
            id: string;
            recorded_by_membership_id: string;
            kind: string;
            created_at: string;
            audience?: string;
          }[],
          error: null,
        }
      : await supabase
          .from("moments")
          .select("id, recorded_by_membership_id, kind, created_at, audience")
          .in("id", linkedMomentIds)
          .eq("audience", "family")
          .is("trashed_at", null)
          .order("created_at", { ascending: false })
          .limit(40);
  if (linkedMomentsResult.error) throw linkedMomentsResult.error;
  const myMembershipIds = new Set(
    circleMemberships.map((membership) => membership.membershipId),
  );
  const composer: MomentComposerViewModel = {
    experience: "connected-family",
    circleId: access.circleId,
    photoPostingEnabled: photoPostingIsEnabled(),
    previewToday: plainToday(circleResult.data.time_zone),
    defaultJournalPersonId: access.personId,
    recorderPersonId: access.personId,
    recordedByName: recorder.name,
    journalPeople: surface.journalPeople,
    taggablePeople: surface.taggablePeople,
    taggablePeopleByCircle: {
      ...buildTaggablePeopleByCircle(
        rosterCircleIds,
        allPeople,
        allMemberships,
        new Map(
          circleMemberships.map((membership) => [
            membership.circleId,
            { personId: membership.personId, role: membership.role },
          ]),
        ),
        access.circleId,
        access,
      ),
      [access.circleId]: surface.taggablePeople,
    },
    postableCircles,
  };
  const chrome: JournalChromeViewModel = {
    accent: recorder.accent,
    title: circleResult.data.name,
    eyebrow: "Our family",
    familyMark: surface.familyMark,
    composer,
    timelineOptionsHref: "/trash",
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    notifications: buildActivityNotifications(
      notesResult.data ?? [],
      reactionsResult.data ?? [],
      new Set([
        ...(momentsResult.data ?? []).map((moment) => moment.id),
        ...(linkedMomentsResult.data ?? [])
          .filter((moment) =>
            myMembershipIds.has(moment.recorded_by_membership_id),
          )
          .map((moment) => moment.id),
      ]),
      memberNames,
      (linkedMomentsResult.data ?? [])
        .filter(
          (moment) =>
            moment.kind !== "insight" &&
            !myMembershipIds.has(moment.recorded_by_membership_id),
        )
        .map((moment) => ({
          id: moment.id,
          author_membership_id: moment.recorded_by_membership_id,
          moment_kind: moment.kind,
          created_at: moment.created_at,
          audience: moment.audience,
        })),
      access.membershipId,
    ),
  };

  return {
    circleName: circleResult.data.name,
    circleTimeZone: circleResult.data.time_zone,
    today: composer.previewToday,
    groups,
    chrome,
    people: surface.people,
  };
}
