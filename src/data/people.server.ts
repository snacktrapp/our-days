import "server-only";

import type { ConnectedJournalContext } from "./journal-context.server";
import { mapDatabaseAccent } from "./journal-context.server";
import type { JournalAccess } from "@/lib/auth/journal-access";
import { readJournalCircleMemberships } from "@/lib/auth/journal-access";
import {
  hasOrganizerPrivilege,
  isOperationsMembership,
  journalDirectoryRoleLabel,
} from "@/lib/circle-roles";
import { localJournalIsEnabled } from "../../config/our-days-environment";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import {
  buildPeopleViewModel,
  type PeopleViewModel,
  type PersonSummaryViewModel,
} from "@/features/people/people-view-model";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function toMember(person: {
  id: string;
  name: string;
  accentToken: string;
  profileKind: string;
  role: string | null | undefined;
}): PersonSummaryViewModel {
  return {
    id: person.id,
    name: person.name,
    initial: initialFor(person.name),
    accent: mapDatabaseAccent(person.accentToken),
    roleLabel: journalDirectoryRoleLabel(person.profileKind, person.role),
    journalHref: `/people/${person.id}`,
  };
}

export async function loadPeopleDirectory(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
): Promise<PeopleViewModel> {
  if (localJournalIsEnabled()) {
    const { loadLocalPeopleDirectory } =
      await import("@/lib/local-journal/views");
    return loadLocalPeopleDirectory(access, context);
  }

  const memberships = await readJournalCircleMemberships();
  const groups =
    context.groups && context.groups.length > 0
      ? context.groups
      : [{ id: access.circleId, name: context.circleName }];
  const groupIds = [
    ...new Set([
      ...groups.map((group) => group.id),
      ...memberships.map((membership) => membership.circleId),
    ]),
  ];
  const supabase = await createOurDaysServerClient();
  const [peopleResult, membershipsResult] = await Promise.all([
    supabase
      .from("people")
      .select("id, display_name, profile_kind, accent_token, circle_id")
      .in("circle_id", groupIds)
      .order("created_at", { ascending: true }),
    supabase
      .from("circle_memberships")
      .select("person_id, role, directory_kind, circle_id, status")
      .in("circle_id", groupIds)
      .eq("status", "active"),
  ]);
  const error = peopleResult.error ?? membershipsResult.error;
  if (error) throw error;

  const membershipByPersonCircle = new Map(
    (membershipsResult.data ?? []).map((membership) => [
      `${membership.circle_id}:${membership.person_id}`,
      membership,
    ]),
  );
  const organizerCircleIds = new Set(
    memberships
      .filter((membership) => hasOrganizerPrivilege(membership.role))
      .map((membership) => membership.circleId),
  );

  return buildPeopleViewModel({
    chrome: context.chrome,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      canInvite: organizerCircleIds.has(group.id),
      members: (peopleResult.data ?? []).flatMap((person) => {
        if (person.circle_id !== group.id) return [];
        const membership = membershipByPersonCircle.get(
          `${person.circle_id}:${person.id}`,
        );
        if (
          isOperationsMembership({
            role: membership?.role,
            directoryKind: membership?.directory_kind,
          })
        ) {
          return [];
        }
        return [
          toMember({
            id: person.id,
            name: person.display_name,
            accentToken: person.accent_token,
            profileKind: person.profile_kind,
            role: membership?.role,
          }),
        ];
      }),
    })),
  });
}
