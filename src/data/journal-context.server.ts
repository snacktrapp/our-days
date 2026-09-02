import "server-only";

import type { AccentToken } from "@/features/accent-token";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import { photoPostingIsEnabled } from "../../config/our-days-environment";
import type { PeopleViewModel } from "@/features/people/people-view-model";
import type { JournalChromeViewModel } from "@/features/shell/shell-view-model";
import type { JournalAccess } from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";

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
  people: PeopleViewModel["people"];
}>;

type ActivityNote = Readonly<{
  id: string;
  moment_id: string;
  author_membership_id: string;
  created_at: string;
}>;

type ActivityReaction = ActivityNote & Readonly<{ reaction_type: string }>;

export function buildActivityNotifications(
  notes: readonly ActivityNote[],
  reactions: readonly ActivityReaction[],
  ownedMomentIds: ReadonlySet<string>,
  memberNames: ReadonlyMap<string, string>,
): NonNullable<JournalChromeViewModel["notifications"]> {
  const displayDate = (createdAt: string) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(createdAt));
  const reactionMessages: Readonly<Record<string, string>> = {
    "held-close": "loved your entry.",
    "made-me-smile": "smiled at your entry.",
    "remember-this": "remembered your entry.",
  };

  return [
    ...notes
      .filter((note) => ownedMomentIds.has(note.moment_id))
      .map((note) => ({
        id: `note:${note.id}`,
        actorName: memberNames.get(note.author_membership_id) ?? "Family",
        message: "commented on your entry.",
        displayDate: displayDate(note.created_at),
        href: `/family#moment-${note.moment_id}`,
        createdAt: note.created_at,
      })),
    ...reactions
      .filter((reaction) => ownedMomentIds.has(reaction.moment_id))
      .map((reaction) => ({
        id: `reaction:${reaction.id}:${reaction.reaction_type}`,
        actorName: memberNames.get(reaction.author_membership_id) ?? "Family",
        message:
          reactionMessages[reaction.reaction_type] ?? "reacted to your entry.",
        displayDate: displayDate(reaction.created_at),
        href: `/family#moment-${reaction.moment_id}`,
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
  const supabase = await createOurDaysServerClient();
  const [
    circleResult,
    peopleResult,
    membershipsResult,
    guardiansResult,
    momentsResult,
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
      .select("id, display_name, profile_kind, accent_token")
      .eq("circle_id", access.circleId)
      .order("created_at", { ascending: true }),
    supabase
      .from("circle_memberships")
      .select("id, person_id, role, status")
      .eq("circle_id", access.circleId),
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
    notesResult.error ??
    reactionsResult.error;
  if (error) throw error;
  if (!circleResult.data) throw new Error("Circle is unavailable");

  const memberships = membershipsResult.data ?? [];
  const people = peopleResult.data ?? [];
  const accountMembershipByPerson = new Map(
    memberships.map((membership) => [membership.person_id, membership]),
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
  const personOptions = people.map((person) => {
    const membership = accountMembershipByPerson.get(person.id);
    const accent = mapDatabaseAccent(person.accent_token);
    return {
      id: person.id,
      name: person.display_name,
      initial: initialFor(person.display_name),
      accent,
      contextLabel:
        person.id === access.personId
          ? "You"
          : person.profile_kind === "managed"
            ? "Managed journal"
            : membership?.role === "organizer"
              ? "Organizer"
              : "Family member",
      profileKind: person.profile_kind,
      role: membership?.role,
    };
  });
  const recorder = personOptions.find(
    (person) => person.id === access.personId,
  );
  if (!recorder) throw new Error("Member profile is unavailable");

  const journalPeople = personOptions.filter(
    (person) =>
      person.id === access.personId ||
      (person.profileKind === "managed" &&
        (access.role === "organizer" || guardedPersonIds.has(person.id))),
  );
  const composer: MomentComposerViewModel = {
    experience: "connected-family",
    circleId: access.circleId,
    photoPostingEnabled: photoPostingIsEnabled(),
    previewToday: plainToday(circleResult.data.time_zone),
    defaultJournalPersonId: access.personId,
    recorderPersonId: access.personId,
    recordedByName: recorder.name,
    journalPeople,
    taggablePeople: personOptions.map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.initial,
      accent: person.accent,
      contextLabel: person.contextLabel,
    })),
  };
  const familyMark = personOptions.slice(0, 5).map((person) => ({
    id: person.id,
    initial: person.initial,
    accent: person.accent,
  }));
  const chrome: JournalChromeViewModel = {
    accent: recorder.accent,
    title: circleResult.data.name,
    eyebrow: "Our family",
    familyMark,
    composer,
    timelineOptionsHref: "/trash",
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    notifications: buildActivityNotifications(
      notesResult.data ?? [],
      reactionsResult.data ?? [],
      new Set((momentsResult.data ?? []).map((moment) => moment.id)),
      memberNames,
    ),
  };

  return {
    circleName: circleResult.data.name,
    circleTimeZone: circleResult.data.time_zone,
    today: composer.previewToday,
    chrome,
    people: personOptions.map((person) => ({
      id: person.id,
      name: person.name,
      initial: person.initial,
      accent: person.accent,
      roleLabel:
        person.profileKind === "managed"
          ? "Managed profile · No sign-in"
          : person.role === "organizer"
            ? "Organizer"
            : "Family member",
      journalHref: `/people/${person.id}`,
    })),
  };
}
