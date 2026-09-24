import "server-only";

import type { AccentToken } from "@/features/accent-token";
import { profileColorAccent } from "@/features/profile-color";
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
  retryTransientFamilySessionQuery,
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

export function mapDatabaseAccent(value: string): AccentToken {
  return profileColorAccent(value);
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
  user_id?: string | null;
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
  groups?: readonly Readonly<{
    id: string;
    name: string;
    createdByMembershipId?: string;
    archivedAt?: string | null;
    memberCount?: number;
  }>[];
  viewerMembershipIds?: readonly string[];
  viewerPersonIds?: readonly string[];
  memberNames?: Readonly<Record<string, string>>;
  memberAccents?: Readonly<Record<string, AccentToken>>;
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

export function switcherPeopleFromRosters(
  allPeople: readonly PersonRow[],
  allMemberships: readonly MembershipRow[],
  access: Readonly<{ circleId: string; personId: string }>,
  viewerPersonIds: ReadonlySet<string>,
): PersonSummaryViewModel[] {
  const membershipByPerson = new Map(
    allMemberships.map((membership) => [membership.person_id, membership]),
  );
  const visible = allPeople.filter((person) => {
    const membership = membershipByPerson.get(person.id);
    return !isOperationsMembership({
      role: membership?.role,
      directoryKind: membership?.directory_kind,
    });
  });
  const ranked = [...visible].sort((left, right) => {
    const leftHome =
      circleIdOf(left, access.circleId) === access.circleId ? 0 : 1;
    const rightHome =
      circleIdOf(right, access.circleId) === access.circleId ? 0 : 1;
    if (leftHome !== rightHome) return leftHome - rightHome;
    return (
      left.display_name.localeCompare(right.display_name) ||
      left.id.localeCompare(right.id)
    );
  });
  const seenUserIds = new Set<string>();
  const people: PersonSummaryViewModel[] = [];
  for (const person of ranked) {
    const membership = membershipByPerson.get(person.id);
    if (!viewerPersonIds.has(person.id)) {
      const userId = membership?.user_id;
      if (userId) {
        if (seenUserIds.has(userId)) continue;
        seenUserIds.add(userId);
      }
    }
    people.push({
      id: person.id,
      name: person.display_name,
      initial: initialFor(person.display_name),
      accent: mapDatabaseAccent(person.accent_token),
      roleLabel: journalDirectoryRoleLabel(
        person.profile_kind,
        membership?.role,
      ),
      journalHref: `/people/${person.id}`,
    });
  }
  return people;
}

type ActivityNote = Readonly<{
  id: string;
  moment_id: string;
  author_membership_id: string;
  created_at: string;
  circle_id?: string;
}>;

type ActivityReaction = ActivityNote & Readonly<{ reaction_type: string }>;

type ActivityMoment = Readonly<{
  id: string;
  author_membership_id: string;
  moment_kind: string;
  created_at: string;
  audience?: string;
  circle_id?: string;
}>;

export function buildActivityNotifications(
  notes: readonly ActivityNote[],
  reactions: readonly ActivityReaction[],
  ownedMomentIds: ReadonlySet<string>,
  memberNames: ReadonlyMap<string, string>,
  familyMoments: readonly ActivityMoment[] = [],
  viewerMembershipId?: string,
  commentedSince: ReadonlyMap<string, string> = new Map(),
  postAuthorNames: ReadonlyMap<string, string> = new Map(),
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
        href: activityMomentHref(moment.id, moment.circle_id),
        createdAt: moment.created_at,
      })),
    ...notes
      .filter(
        (note) =>
          note.author_membership_id !== viewerMembershipId &&
          (ownedMomentIds.has(note.moment_id) ||
            (commentedSince.has(note.moment_id) &&
              note.created_at > commentedSince.get(note.moment_id)!)),
      )
      .map((note) => ({
        id: `note:${note.id}`,
        actorName: memberNames.get(note.author_membership_id) ?? "Family",
        message: ownedMomentIds.has(note.moment_id)
          ? entryCommentMessage
          : postAuthorNames.get(note.moment_id)
            ? `also commented on ${postAuthorNames.get(note.moment_id)}’s post.`
            : "also commented on a post.",
        displayDate: displayDate(note.created_at),
        href: activityMomentHref(note.moment_id, note.circle_id),
        createdAt: note.created_at,
      })),
    ...reactions
      .filter(
        (reaction) =>
          ownedMomentIds.has(reaction.moment_id) &&
          reaction.author_membership_id !== viewerMembershipId,
      )
      .map((reaction) => ({
        id: `reaction:${reaction.id}:${reaction.reaction_type}`,
        actorName: memberNames.get(reaction.author_membership_id) ?? "Family",
        message: entryReactionMessage(reaction.reaction_type),
        displayDate: displayDate(reaction.created_at),
        href: activityMomentHref(reaction.moment_id, reaction.circle_id),
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
      createdAt: notification.createdAt,
    }));
}

type JournalClient = Awaited<ReturnType<typeof createOurDaysServerClient>>;

const emptyOptionalActivity = {
  notes: [] as ActivityNote[],
  reactions: [] as ActivityReaction[],
  ownedMomentIds: new Set<string>(),
  commentedSince: new Map<string, string>(),
  postAuthorNames: new Map<string, string>(),
  familyMoments: [] as ActivityMoment[],
};
const activityScanLimit = 200;

async function loadOptionalJournalActivity(
  supabase: JournalClient,
  access: AuthenticatedAccess,
  myMembershipIds: ReadonlySet<string>,
  circleIds: readonly string[],
  strict = false,
) {
  try {
    const [ownedMomentsResult, linkedMomentsResult, ownNotesResult] =
      await Promise.all([
        supabase
          .from("moments")
          .select("id, moment_circles(circle_id)")
          .in("recorded_by_membership_id", [...myMembershipIds])
          .order("created_at", { ascending: false })
          .limit(activityScanLimit)
          .is("trashed_at", null),
        supabase
          .from("moments")
          .select(
            "id, recorded_by_membership_id, kind, created_at, audience, moment_circles!inner(circle_id)",
          )
          .in("moment_circles.circle_id", [...circleIds])
          .eq("audience", "family")
          .neq("kind", "insight")
          .not(
            "recorded_by_membership_id",
            "in",
            `(${[...myMembershipIds].join(",")})`,
          )
          .is("trashed_at", null)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("moment_notes")
          .select(
            "moment_id, created_at, moments!moment_notes_moment_fkey!inner(id, recorded_by_membership_id, moment_circles(circle_id), author:circle_memberships!moments_recorded_by_membership_fkey(people!circle_memberships_person_fkey(display_name)))",
          )
          .in("author_membership_id", [...myMembershipIds])
          .order("created_at", { ascending: false })
          .limit(activityScanLimit)
          .is("trashed_at", null),
      ]);
    if (ownedMomentsResult.error) throw ownedMomentsResult.error;
    if (linkedMomentsResult.error) throw linkedMomentsResult.error;
    if (ownNotesResult.error) throw ownNotesResult.error;
    const ownedFromCircle = ownedMomentsResult.data ?? [];
    const linkedMoments = linkedMomentsResult.data ?? [];

    const visibleCircleByMomentId = new Map<string, string>();
    const commentedSince = new Map<string, string>();
    const postAuthorNames = new Map<string, string>();
    const missingPostAuthorIds = [
      ...new Set(
        (ownNotesResult.data ?? [])
          .filter((note) => !note.moments.author?.people?.display_name)
          .map((note) => note.moments.recorded_by_membership_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const resolvedPostAuthorNames = new Map<string, string>();
    if (missingPostAuthorIds.length > 0) {
      const result = await supabase.rpc("visible_moment_authors", {
        membership_ids: missingPostAuthorIds,
      });
      if (result.error) throw result.error;
      for (const author of result.data ?? []) {
        resolvedPostAuthorNames.set(author.membership_id, author.display_name);
      }
    }
    for (const note of ownNotesResult.data ?? []) {
      const authorName =
        note.moments.author?.people?.display_name ??
        resolvedPostAuthorNames.get(note.moments.recorded_by_membership_id);
      if (authorName) postAuthorNames.set(note.moment_id, authorName);
      const first = commentedSince.get(note.moment_id);
      if (!first || note.created_at < first)
        commentedSince.set(note.moment_id, note.created_at);
    }
    for (const moment of [
      ...ownedFromCircle,
      ...linkedMoments,
      ...(ownNotesResult.data ?? []).map((note) => note.moments),
    ]) {
      const links = moment.moment_circles ?? [];
      const circle =
        links.find((link) => link.circle_id === access.circleId) ??
        links.find((link) => circleIds.includes(link.circle_id));
      if (circle) visibleCircleByMomentId.set(moment.id, circle.circle_id);
    }
    const ownedMomentIds = new Set(ownedFromCircle.map((moment) => moment.id));
    const conversationMomentIds = [
      ...new Set([...ownedMomentIds, ...commentedSince.keys()]),
    ];
    const [notesResult, reactionsResult] =
      conversationMomentIds.length === 0
        ? [
            { data: [] as ActivityNote[], error: null },
            { data: [] as ActivityReaction[], error: null },
          ]
        : await Promise.all([
            supabase
              .from("moment_notes")
              .select(
                "id, moment_id, author_membership_id, created_at, circle_id",
              )
              .in("moment_id", conversationMomentIds)
              .not(
                "author_membership_id",
                "in",
                `(${[...myMembershipIds].join(",")})`,
              )
              .is("trashed_at", null)
              .order("created_at", { ascending: false })
              .limit(40),
            ownedMomentIds.size === 0
              ? Promise.resolve({ data: [] as ActivityReaction[], error: null })
              : supabase
                  .from("moment_reactions")
                  .select(
                    "id, moment_id, author_membership_id, reaction_type, created_at, circle_id",
                  )
                  .in("moment_id", [...ownedMomentIds])
                  .not(
                    "author_membership_id",
                    "in",
                    `(${[...myMembershipIds].join(",")})`,
                  )
                  .is("removed_at", null)
                  .order("created_at", { ascending: false })
                  .limit(40),
          ]);
    if (notesResult.error) throw notesResult.error;
    if (reactionsResult.error) throw reactionsResult.error;
    const visibleCircleOf = (momentId: string, fallback?: string) =>
      visibleCircleByMomentId.get(momentId) ?? fallback;
    const notes = (notesResult.data ?? [])
      .filter((note) => !myMembershipIds.has(note.author_membership_id))
      .map((note) => ({
        ...note,
        circle_id: visibleCircleOf(note.moment_id, note.circle_id),
      }));
    const reactions = (reactionsResult.data ?? [])
      .filter((reaction) => !myMembershipIds.has(reaction.author_membership_id))
      .map((reaction) => ({
        ...reaction,
        circle_id: visibleCircleOf(reaction.moment_id, reaction.circle_id),
      }));

    return {
      notes,
      reactions,
      ownedMomentIds,
      commentedSince,
      postAuthorNames,
      familyMoments: linkedMoments
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
          circle_id: visibleCircleByMomentId.get(moment.id),
        })),
    };
  } catch (error) {
    if (strict) throw error;
    return emptyOptionalActivity;
  }
}

export async function loadJournalActivityNotifications(
  access: AuthenticatedAccess,
  memberNames: Readonly<Record<string, string>> = {},
  options?: Readonly<{ strict?: boolean }>,
): Promise<NonNullable<JournalChromeViewModel["notifications"]>> {
  if (localJournalIsEnabled()) {
    const { loadLocalJournalContext } =
      await import("@/lib/local-journal/views");
    return (await loadLocalJournalContext(access)).chrome.notifications ?? [];
  }
  try {
    const supabase = await createOurDaysServerClient({ readTimeoutMs: 8000 });
    const circleMemberships = await readJournalCircleMemberships();
    const myMembershipIds = new Set([
      access.membershipId,
      ...circleMemberships.map((membership) => membership.membershipId),
    ]);
    const circleIds = [
      ...new Set([
        access.circleId,
        ...circleMemberships.map((membership) => membership.circleId),
      ]),
    ];
    const activity = await loadOptionalJournalActivity(
      supabase,
      access,
      myMembershipIds,
      circleIds,
      options?.strict,
    );
    const names = new Map(Object.entries(memberNames));
    const actorIds = [
      ...new Set([
        ...activity.notes.map((note) => note.author_membership_id),
        ...activity.reactions.map((reaction) => reaction.author_membership_id),
        ...activity.familyMoments.map((moment) => moment.author_membership_id),
      ]),
    ].filter((id) => !names.has(id));
    if (actorIds.length > 0) {
      const result = await supabase
        .from("circle_memberships")
        .select("id, people!circle_memberships_person_fkey!inner(display_name)")
        .in("id", actorIds);
      if (result.error) throw result.error;
      for (const row of result.data ?? [])
        names.set(row.id, row.people.display_name);
      const missingIds = actorIds.filter((id) => !names.has(id));
      if (missingIds.length > 0) {
        const visible = await supabase.rpc("visible_moment_authors", {
          membership_ids: missingIds,
        });
        if (visible.error) throw visible.error;
        for (const author of visible.data ?? [])
          names.set(author.membership_id, author.display_name);
      }
    }
    return buildActivityNotifications(
      activity.notes,
      activity.reactions,
      activity.ownedMomentIds,
      names,
      activity.familyMoments,
      access.membershipId,
      activity.commentedSince,
      activity.postAuthorNames,
    );
  } catch (error) {
    if (options?.strict) throw error;
    return [];
  }
}

export async function loadConnectedJournalContext(
  access: AuthenticatedAccess,
  options?: Readonly<{ includeActivity?: boolean }>,
): Promise<ConnectedJournalContext> {
  if (localJournalIsEnabled()) {
    const { loadLocalJournalContext } =
      await import("@/lib/local-journal/views");
    return loadLocalJournalContext(access);
  }
  const includeActivity = options?.includeActivity !== false;
  const supabase = await createOurDaysServerClient({ readTimeoutMs: 8000 });
  const circleMemberships = await readJournalCircleMemberships();
  const rosterCircleIds =
    circleMemberships.length > 0
      ? [...new Set(circleMemberships.map((membership) => membership.circleId))]
      : [access.circleId];
  const myMembershipIds = new Set([
    access.membershipId,
    ...circleMemberships.map((membership) => membership.membershipId),
  ]);
  const groupsPromise =
    rosterCircleIds.length === 0
      ? Promise.resolve({
          data: [] as {
            id: string;
            name: string;
            created_by_membership_id?: string;
            archived_at?: string | null;
          }[],
          error: null,
        })
      : retryTransientFamilySessionQuery(() =>
          supabase
            .from("circles")
            .select("id, name, created_by_membership_id, archived_at")
            .in("id", rosterCircleIds),
        );
  const [
    circleResult,
    peopleResult,
    membershipsResult,
    guardiansResult,
    groupsResult,
    activity,
  ] = await Promise.all([
    retryTransientFamilySessionQuery(() =>
      supabase
        .from("circles")
        .select("id, name, time_zone")
        .eq("id", access.circleId)
        .single(),
    ),
    retryTransientFamilySessionQuery(() =>
      supabase
        .from("people")
        .select("id, display_name, profile_kind, accent_token, circle_id")
        .in("circle_id", rosterCircleIds)
        .order("created_at", { ascending: true }),
    ),
    retryTransientFamilySessionQuery(() =>
      supabase
        .from("circle_memberships")
        .select(
          "id, person_id, role, status, directory_kind, circle_id, user_id",
        )
        .in("circle_id", rosterCircleIds),
    ),
    retryTransientFamilySessionQuery(() =>
      supabase
        .from("person_guardians")
        .select("managed_person_id, guardian_membership_id")
        .eq("circle_id", access.circleId)
        .is("revoked_at", null),
    ),
    groupsPromise,
    includeActivity
      ? loadOptionalJournalActivity(
          supabase,
          access,
          myMembershipIds,
          rosterCircleIds,
        )
      : Promise.resolve(emptyOptionalActivity),
  ]);

  const error =
    circleResult.error ??
    peopleResult.error ??
    membershipsResult.error ??
    guardiansResult.error ??
    groupsResult.error;
  if (error) throw error;
  if (!circleResult.data) throw new Error("Circle is unavailable");
  const groupNameById = new Map(
    (groupsResult.data ?? []).map((circle) => [circle.id, circle.name]),
  );
  const createdByById = new Map(
    (groupsResult.data ?? []).map((circle) => [
      circle.id,
      circle.created_by_membership_id,
    ]),
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
    createdByMembershipId: createdByById.get(membership.circleId),
    archivedAt: groupsResult.data?.find(
      (circle) => circle.id === membership.circleId,
    )?.archived_at,
  }));

  const allPeople = peopleResult.data ?? [];
  const allMemberships = membershipsResult.data ?? [];
  const people = allPeople.filter(
    (person) => circleIdOf(person, access.circleId) === access.circleId,
  );
  const memberships = allMemberships.filter(
    (membership) => circleIdOf(membership, access.circleId) === access.circleId,
  );
  const allPersonNameById = new Map(
    allPeople.map((person) => [person.id, person.display_name]),
  );
  const memberNameById = new Map(
    allMemberships.map((membership) => [
      membership.id,
      allPersonNameById.get(membership.person_id) ?? "Family",
    ]),
  );
  const allPersonAccentById = new Map(
    allPeople.map((person) => [
      person.id,
      mapDatabaseAccent(person.accent_token),
    ]),
  );
  const memberAccentById = new Map(
    allMemberships.map((membership) => [
      membership.id,
      allPersonAccentById.get(membership.person_id) ?? "slate",
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
    const membership = allMemberships.find(
      (candidate) =>
        candidate.person_id === person.id &&
        circleIdOf(candidate, access.circleId) === personCircleId,
    );
    if (
      membership &&
      isOperationsMembership({
        role: membership.role,
        directoryKind: membership.directory_kind,
      })
    ) {
      continue;
    }
    memberCountByCircle.set(
      personCircleId,
      (memberCountByCircle.get(personCircleId) ?? 0) + 1,
    );
  }
  const postableCircles: readonly PostableCircle[] = (
    circleMemberships.length > 0
      ? circleMemberships
      : [{ circleId: access.circleId, personId: access.personId }]
  )
    .filter(
      (membership) =>
        !groups.find((group) => group.id === membership.circleId)?.archivedAt,
    )
    .map((membership) => ({
      id: membership.circleId,
      name:
        groups.find((group) => group.id === membership.circleId)?.name ??
        (membership.circleId === access.circleId
          ? circleResult.data.name
          : "Circle"),
      personId: membership.personId,
      memberCount: memberCountByCircle.get(membership.circleId),
    }));
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
  const viewerPersonIds = [
    ...new Set(
      [
        access.personId,
        ...circleMemberships.map((membership) => membership.personId),
      ].filter(Boolean),
    ),
  ];
  const switcherPeople = switcherPeopleFromRosters(
    allPeople,
    allMemberships,
    access,
    new Set(viewerPersonIds),
  );
  const groupsWithCounts = groups.map((group) => ({
    ...group,
    memberCount: memberCountByCircle.get(group.id),
  }));
  const chrome: JournalChromeViewModel = {
    accent: recorder.accent,
    title: circleResult.data.name,
    eyebrow: "Our Days",
    familyMark: surface.familyMark,
    composer,
    timelineOptionsHref: "/trash",
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    notifications: buildActivityNotifications(
      activity.notes,
      activity.reactions,
      activity.ownedMomentIds,
      memberNameById,
      activity.familyMoments,
      access.membershipId,
      activity.commentedSince,
      activity.postAuthorNames,
    ),
  };

  return {
    circleName: circleResult.data.name,
    circleTimeZone: circleResult.data.time_zone,
    today: composer.previewToday,
    groups: groupsWithCounts,
    chrome,
    people: switcherPeople,
    viewerMembershipIds: [...myMembershipIds],
    viewerPersonIds,
    memberNames: Object.fromEntries(memberNameById),
    memberAccents: Object.fromEntries(memberAccentById),
  };
}
