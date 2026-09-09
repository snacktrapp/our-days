export const OPERATIONS_ROLE = "operations" as const;
export const OPERATIONS_DIRECTORY = "operations" as const;

export type CircleMembershipRole = "member" | "organizer" | "operations";
export type MembershipDirectoryKind = "journal" | "operations";

export function isOperationsRole(
  role: string | null | undefined,
): role is typeof OPERATIONS_ROLE {
  return role === OPERATIONS_ROLE;
}

export function isOperationsDirectory(
  directoryKind: string | null | undefined,
) {
  return directoryKind === OPERATIONS_DIRECTORY;
}

export function isOperationsMembership(
  membership: Readonly<{
    role?: string | null;
    directoryKind?: string | null;
    directory_kind?: string | null;
  }>,
) {
  return (
    isOperationsDirectory(
      membership.directoryKind ?? membership.directory_kind,
    ) || isOperationsRole(membership.role)
  );
}

/** Family-facing lists and counts omit Operations (TARS). Auth stays. */
export function isFamilyFacingMembership(
  membership:
    | Readonly<{
        role?: string | null;
        directoryKind?: string | null;
        directory_kind?: string | null;
      }>
    | null
    | undefined,
) {
  return !membership || !isOperationsMembership(membership);
}

export function countFamilyFacingMembers(
  members: readonly Readonly<{
    role?: string | null;
    directoryKind?: string | null;
  }>[],
) {
  return members.filter((member) => isFamilyFacingMembership(member)).length;
}

export function countFamilyFacingPeople(
  people: readonly Readonly<{ id: string }>[],
  memberships: readonly Readonly<{
    personId?: string;
    person_id?: string;
    role?: string | null;
    directoryKind?: string | null;
    directory_kind?: string | null;
  }>[],
) {
  const membershipByPerson = new Map<
    string,
    Readonly<{
      role?: string | null;
      directoryKind?: string | null;
      directory_kind?: string | null;
    }>
  >();
  for (const membership of memberships) {
    const personId = membership.personId ?? membership.person_id;
    if (!personId) continue;
    membershipByPerson.set(personId, membership);
  }
  return people.filter((person) =>
    isFamilyFacingMembership(membershipByPerson.get(person.id)),
  ).length;
}

export function hasOrganizerPrivilege(role: string | null | undefined) {
  return role === "organizer" || role === OPERATIONS_ROLE;
}

export function canCreateInsight(role: string | null | undefined) {
  return hasOrganizerPrivilege(role);
}

export function familyMembershipRoleLabel(
  role: string | null | undefined,
): "Organizer" | "Operations" | "Family member" {
  if (role === "organizer") return "Organizer";
  if (role === OPERATIONS_ROLE) return "Operations";
  return "Family member";
}

export function journalDirectoryRoleLabel(
  profileKind: string,
  role: string | null | undefined,
) {
  if (profileKind === "managed") return "Managed profile · No sign-in";
  return familyMembershipRoleLabel(role);
}

export function journalContextLabel(
  isViewer: boolean,
  profileKind: string,
  role: string | null | undefined,
) {
  if (isViewer) return "You";
  if (profileKind === "managed") return "Managed journal";
  return familyMembershipRoleLabel(role);
}

export function parseCircleMembershipRole(
  role: string | null | undefined,
): CircleMembershipRole | null {
  if (role === "member" || role === "organizer" || role === OPERATIONS_ROLE) {
    return role;
  }
  return null;
}

export function presentedMembershipRole(
  membership: Readonly<{
    role?: string | null;
    directoryKind?: string | null;
  }>,
): CircleMembershipRole | null {
  if (isOperationsMembership(membership)) return OPERATIONS_ROLE;
  return parseCircleMembershipRole(membership.role);
}
