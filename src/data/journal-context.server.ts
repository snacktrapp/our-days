import "server-only";

import type { AccentToken } from "@/features/accent-token";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
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

function plainToday(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
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

export async function loadConnectedJournalContext(
  access: AuthenticatedAccess,
): Promise<ConnectedJournalContext> {
  const supabase = await createOurDaysServerClient();
  const [circleResult, peopleResult, membershipsResult, guardiansResult] =
    await Promise.all([
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
    ]);

  const error =
    circleResult.error ??
    peopleResult.error ??
    membershipsResult.error ??
    guardiansResult.error;
  if (error) throw error;
  if (!circleResult.data) throw new Error("Circle is unavailable");

  const memberships = membershipsResult.data ?? [];
  const people = peopleResult.data ?? [];
  const accountMembershipByPerson = new Map(
    memberships.map((membership) => [membership.person_id, membership]),
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
    settingsHref: null,
    memoriesHref: null,
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
