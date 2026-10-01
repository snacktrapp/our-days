import type { SupabaseClient } from "@supabase/supabase-js";

import type { CircleMembership } from "./journal";
import { profileAccent } from "./profile-accent";

export type DirectoryRole = "organizer" | "member" | "operations";

export type DirectoryMember = Readonly<{
  id: string;
  membershipId: string | null;
  name: string;
  initial: string;
  accent: string;
  profileKind: "account" | "managed";
  role: DirectoryRole | null;
  relationshipLabel: string;
  guardianMembershipIds: readonly string[];
}>;

export type DirectoryInvitation = Readonly<{
  emailRequestId: string;
  displayName: string;
}>;

export type GuardianOption = Readonly<{
  membershipId: string;
  name: string;
  role: "organizer" | "member";
}>;

export type CircleDirectory = Readonly<{
  members: readonly DirectoryMember[];
  pending: readonly DirectoryInvitation[];
  guardians: readonly GuardianOption[];
  canRename: boolean;
}>;

type PersonRow = Readonly<{
  id: string;
  display_name: string;
  profile_kind: string | null;
  accent_token: string | null;
  circle_id: string;
}>;

type MembershipRow = Readonly<{
  id: string;
  person_id: string;
  role: string | null;
  directory_kind: string | null;
  circle_id: string;
}>;

type GuardianRow = Readonly<{
  managed_person_id: string;
  guardian_membership_id: string;
  circle_id: string;
}>;

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

export function hasOrganizerPrivilege(role: string | null | undefined) {
  return role === "organizer" || role === "operations";
}

function isOperations(role: string | null | undefined, directoryKind: string | null | undefined) {
  return role === "operations" || directoryKind === "operations";
}

export function relationshipLabel(
  profileKind: "account" | "managed",
  role: DirectoryRole | null,
) {
  if (profileKind === "managed") return "Managed journal";
  if (role === "organizer") return "Organizer";
  if (role === "operations") return "Operations";
  return "Member";
}

/** Subtitle only for organizers, operations, and managed journals. */
export function memberSubtitle(member: DirectoryMember) {
  if (
    member.role === "organizer" ||
    member.role === "operations" ||
    member.profileKind === "managed"
  ) {
    return member.relationshipLabel;
  }
  return undefined;
}

/**
 * Connected ··· rules from circles-directory.tsx. The viewer never manages
 * their own row. Operations can be removed. Managed journals open care.
 */
export function memberShowsMore(
  member: DirectoryMember,
  viewerMembershipId: string,
  canManageAccess: boolean,
) {
  if (!canManageAccess) return false;
  const canReviewRemoval =
    member.membershipId != null && member.membershipId !== viewerMembershipId;
  const canManageRole = canReviewRemoval && member.role !== "operations";
  const canManageJournal = member.profileKind === "managed";
  return canReviewRemoval || canManageRole || canManageJournal;
}

export function familyFacingCount(members: readonly DirectoryMember[]) {
  return members.filter((member) => member.role !== "operations").length;
}

export function addFromCircleLabel(names: readonly string[]) {
  if (names.length === 1) return `Add someone from ${names[0]}`;
  return "Add someone from another circle";
}

export function peopleCountLabel(count: number) {
  return count === 1 ? "1 person" : `${count} people`;
}

function presentedRole(
  role: string | null | undefined,
  directoryKind: string | null | undefined,
): DirectoryRole {
  if (isOperations(role, directoryKind)) return "operations";
  if (role === "organizer") return "organizer";
  return "member";
}

export function buildCircleDirectory(input: Readonly<{
  people: readonly PersonRow[];
  memberships: readonly MembershipRow[];
  guardians: readonly GuardianRow[];
  pending: readonly DirectoryInvitation[];
  canRename: boolean;
}>): CircleDirectory {
  const membershipByPerson = new Map(
    input.memberships.map((membership) => [membership.person_id, membership]),
  );
  const guardiansByPerson = new Map<string, string[]>();
  for (const guardian of input.guardians) {
    const ids = guardiansByPerson.get(guardian.managed_person_id) ?? [];
    ids.push(guardian.guardian_membership_id);
    guardiansByPerson.set(guardian.managed_person_id, ids);
  }
  const members = input.people.flatMap((person) => {
    if (!person.id || !person.display_name) return [];
    const membership = membershipByPerson.get(person.id);
    const managed = person.profile_kind === "managed";
    if (!membership && !managed) return [];
    const role = managed
      ? null
      : presentedRole(membership?.role, membership?.directory_kind);
    const profileKind = managed ? "managed" : "account";
    return [
      {
        id: person.id,
        membershipId: membership?.id ?? null,
        name: person.display_name,
        initial: initialFor(person.display_name),
        accent: profileAccent(person.accent_token),
        profileKind,
        role,
        relationshipLabel: relationshipLabel(profileKind, role),
        guardianMembershipIds: guardiansByPerson.get(person.id) ?? [],
      } satisfies DirectoryMember,
    ];
  });
  const guardians = input.memberships.flatMap((membership) => {
    const person = input.people.find((candidate) => candidate.id === membership.person_id);
    if (!person?.display_name || person.profile_kind === "managed") return [];
    return [
      {
        membershipId: membership.id,
        name: person.display_name,
        role: hasOrganizerPrivilege(membership.role) ? "organizer" : "member",
      } satisfies GuardianOption,
    ];
  });
  return {
    members,
    pending: input.pending,
    guardians,
    canRename: input.canRename,
  };
}

export async function loadCircleDirectory(
  supabase: SupabaseClient,
  circles: readonly CircleMembership[],
): Promise<ReadonlyMap<string, CircleDirectory>> {
  const loaded = new Map<string, CircleDirectory>();
  const ids = circles.map((circle) => circle.circleId);
  if (ids.length === 0) return loaded;
  const organizerIds = new Set(
    circles
      .filter((circle) => hasOrganizerPrivilege(circle.role))
      .map((circle) => circle.circleId),
  );
  const [peopleResult, membershipResult, circleResult, guardianResult] = await Promise.all([
    supabase
      .from("people")
      .select("id, display_name, profile_kind, accent_token, circle_id, created_at")
      .in("circle_id", ids)
      .order("created_at", { ascending: true }),
    supabase
      .from("circle_memberships")
      .select("id, person_id, role, directory_kind, circle_id, status")
      .in("circle_id", ids)
      .eq("status", "active"),
    supabase.from("circles").select("id, created_by_membership_id").in("id", ids),
    organizerIds.size > 0
      ? supabase
          .from("person_guardians")
          .select("managed_person_id, guardian_membership_id, circle_id")
          .in("circle_id", [...organizerIds])
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (peopleResult.error || membershipResult.error) return loaded;
  const pendingByCircle = new Map<string, DirectoryInvitation[]>();
  await Promise.all(
    [...organizerIds].map(async (circleId) => {
      const { data, error } = await supabase.rpc("list_pending_invitation_email_requests", {
        circle_id: circleId,
      });
      if (error || !Array.isArray(data)) return;
      pendingByCircle.set(
        circleId,
        data.flatMap((row) => {
          const item = row as {
            email_request_id?: string;
            invited_display_name?: string;
          };
          if (!item.email_request_id || !item.invited_display_name) return [];
          return [{ emailRequestId: item.email_request_id, displayName: item.invited_display_name }];
        }),
      );
    }),
  );
  const creatorByCircle = new Map(
    ((circleResult.data ?? []) as { id: string; created_by_membership_id: string | null }[]).map(
      (row) => [row.id, row.created_by_membership_id],
    ),
  );
  const people = (peopleResult.data ?? []) as PersonRow[];
  const memberships = (membershipResult.data ?? []) as MembershipRow[];
  const guardians = (guardianResult.data ?? []) as GuardianRow[];
  for (const circle of circles) {
    const canManage = hasOrganizerPrivilege(circle.role);
    loaded.set(
      circle.circleId,
      buildCircleDirectory({
        people: people.filter((person) => person.circle_id === circle.circleId),
        memberships: memberships.filter((membership) => membership.circle_id === circle.circleId),
        guardians: guardians.filter((guardian) => guardian.circle_id === circle.circleId),
        pending: pendingByCircle.get(circle.circleId) ?? [],
        canRename:
          canManage && creatorByCircle.get(circle.circleId) === circle.membershipId,
      }),
    );
  }
  return loaded;
}

export async function renameCircle(
  supabase: SupabaseClient,
  circleId: string,
  name: string,
) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) {
    return { ok: false as const, message: "A circle name is required." };
  }
  const { error } = await supabase.rpc("update_circle", {
    circle_id: circleId,
    circle_name: trimmed,
  });
  if (error) return { ok: false as const, message: "That circle could not be renamed." };
  return { ok: true as const, message: "Circle renamed." };
}

export async function setCircleArchived(
  supabase: SupabaseClient,
  circleId: string,
  archive: boolean,
) {
  const { error } = await supabase.rpc("set_circle_archived", {
    target_circle_id: circleId,
    archive,
  });
  if (error) {
    return { ok: false as const, message: "This circle couldn’t be updated. Please try again." };
  }
  return {
    ok: true as const,
    message: archive ? "Circle archived." : "Circle restored.",
  };
}

export async function setMembershipRole(
  supabase: SupabaseClient,
  membershipId: string,
  role: "member" | "organizer",
) {
  const { error } = await supabase.rpc("set_membership_role", {
    membership_id: membershipId,
    role,
  });
  if (error) {
    return {
      ok: false as const,
      message:
        error.code === "23514"
          ? "This circle must keep at least one organizer."
          : "That role could not be changed. Try again.",
    };
  }
  return {
    ok: true as const,
    message: role === "organizer" ? "Organizer access granted." : "Organizer access removed.",
  };
}

export async function revokeMembership(supabase: SupabaseClient, membershipId: string) {
  const { error } = await supabase.rpc("revoke_membership", { membership_id: membershipId });
  if (error) {
    return {
      ok: false as const,
      message:
        error.code === "23514"
          ? "This circle must keep at least one organizer."
          : "That access could not be removed. Try again.",
    };
  }
  return { ok: true as const, message: "Circle access removed." };
}

export async function withdrawInvitation(supabase: SupabaseClient, emailRequestId: string) {
  const { error } = await supabase.rpc("withdraw_invitation_email_request", {
    email_request_id: emailRequestId,
  });
  if (error) {
    return { ok: false as const, message: "That invitation could not be withdrawn. Try again." };
  }
  return { ok: true as const, message: "Invitation withdrawn." };
}

export async function listExistingMembers(
  supabase: SupabaseClient,
  sourceCircleId: string,
  targetCircleId: string,
) {
  const { data, error } = await supabase.rpc("list_existing_circle_members", {
    source_circle_id: sourceCircleId,
    target_circle_id: targetCircleId,
  });
  if (error || !Array.isArray(data)) {
    return { ok: false as const, message: "Members could not be loaded. Try again.", members: [] };
  }
  return {
    ok: true as const,
    message: "",
    members: data.flatMap((row) => {
      const item = row as { membership_id?: string; display_name?: string };
      if (!item.membership_id || !item.display_name) return [];
      return [{ membershipId: item.membership_id, name: item.display_name }];
    }),
  };
}

export async function addExistingMember(
  supabase: SupabaseClient,
  sourceMembershipId: string,
  targetCircleId: string,
) {
  const { error } = await supabase.rpc("add_existing_circle_member", {
    source_membership_id: sourceMembershipId,
    target_circle_id: targetCircleId,
  });
  if (error) {
    return {
      ok: false as const,
      message:
        "That person could not be added. Refresh the list and try again. Previously removed members need a new invitation.",
    };
  }
  return { ok: true as const, message: "Member added. No new invitation or sign-in is needed." };
}

export async function setPersonGuardian(
  supabase: SupabaseClient,
  input: Readonly<{
    managedPersonId: string;
    guardianMembershipId: string;
    grantAccess: boolean;
  }>,
) {
  const { error } = await supabase.rpc("set_person_guardian", {
    managed_person_id: input.managedPersonId,
    guardian_membership_id: input.guardianMembershipId,
    grant_access: input.grantAccess,
  });
  if (error) {
    return { ok: false as const, message: "That journal care could not be changed. Try again." };
  }
  return { ok: true as const, message: "Journal care updated." };
}
