import "server-only";

import type { JournalAccess } from "@/lib/auth/journal-access";
import { localJournalIsEnabled } from "../../config/our-days-environment";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type {
  ConnectedFamilySettingsPanelViewModel,
  FamilySettingsViewModel,
} from "@/features/family-settings/family-settings-view-model";
import {
  familyMembershipRoleLabel,
  hasOrganizerPrivilege,
  isOperationsMembership,
  presentedMembershipRole,
} from "@/lib/circle-roles";
import {
  mapDatabaseAccent,
  type ConnectedJournalContext,
} from "./journal-context.server";

type AuthenticatedAccess = Extract<JournalAccess, { mode: "authenticated" }>;

type FamilyAccessData = Readonly<{
  people: readonly Readonly<{
    id: string;
    displayName: string;
    profileKind: string;
    accentToken: string;
  }>[];
  memberships: readonly Readonly<{
    id: string;
    personId: string;
    role: string;
    directoryKind?: string | null;
  }>[];
  guardians: readonly Readonly<{
    managedPersonId: string;
    guardianMembershipId: string;
  }>[];
  pendingInvitations: readonly Readonly<{
    emailRequestId: string;
    displayName: string;
    state: "queued" | "provisioned" | "delivered";
    createdAt: string;
    expiresAt: string;
  }>[];
}>;

function invitationStatus(
  value: string,
): "queued" | "provisioned" | "delivered" | null {
  if (value === "queued" || value === "provisioned" || value === "delivered") {
    return value;
  }
  return null;
}

function invitationStatusLabel(state: "queued" | "provisioned" | "delivered") {
  void state;
  return "Pending";
}

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function invitationDateLabel(value: string, timeZone: string, prefix: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return prefix;
  return `${prefix} ${new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

export async function loadConnectedFamilyAccess(
  access: AuthenticatedAccess,
): Promise<FamilyAccessData> {
  if (localJournalIsEnabled()) {
    const { loadLocalFamilyAccess } = await import("@/lib/local-journal/views");
    return loadLocalFamilyAccess(access);
  }
  const supabase = await createOurDaysServerClient();
  const pendingPromise = hasOrganizerPrivilege(access.role)
    ? supabase.rpc("list_pending_invitation_email_requests", {
        circle_id: access.circleId,
      })
    : Promise.resolve({ data: [], error: null });
  const guardiansPromise = hasOrganizerPrivilege(access.role)
    ? supabase
        .from("person_guardians")
        .select("managed_person_id, guardian_membership_id")
        .eq("circle_id", access.circleId)
        .is("revoked_at", null)
    : Promise.resolve({ data: [], error: null });
  const [peopleResult, membershipsResult, guardiansResult, pendingResult] =
    await Promise.all([
      supabase
        .from("people")
        .select("id, display_name, profile_kind, accent_token")
        .eq("circle_id", access.circleId)
        .order("created_at", { ascending: true }),
      supabase
        .from("circle_memberships")
        .select("id, person_id, role, directory_kind")
        .eq("circle_id", access.circleId)
        .eq("status", "active")
        .order("joined_at", { ascending: true }),
      guardiansPromise,
      pendingPromise,
    ]);
  const error =
    peopleResult.error ??
    membershipsResult.error ??
    guardiansResult.error ??
    pendingResult.error;
  if (error) throw error;

  return {
    people: (peopleResult.data ?? []).map((person) => ({
      id: person.id,
      displayName: person.display_name,
      profileKind: person.profile_kind,
      accentToken: person.accent_token,
    })),
    memberships: (membershipsResult.data ?? []).map((membership) => ({
      id: membership.id,
      personId: membership.person_id,
      role: membership.role,
      directoryKind: membership.directory_kind,
    })),
    guardians: (guardiansResult.data ?? []).map((guardian) => ({
      managedPersonId: guardian.managed_person_id,
      guardianMembershipId: guardian.guardian_membership_id,
    })),
    pendingInvitations: (pendingResult.data ?? []).flatMap((invitation) => {
      const state = invitationStatus(invitation.state);
      if (!state) return [];
      return [
        {
          emailRequestId: invitation.email_request_id,
          displayName: invitation.invited_display_name,
          state,
          createdAt: invitation.requested_at,
          expiresAt: invitation.expires_at,
        },
      ];
    }),
  };
}

export function buildConnectedFamilySettingsModel(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
  data: FamilyAccessData,
  invitationDeliveryEnabled = false,
): FamilySettingsViewModel {
  const membershipByPerson = new Map(
    data.memberships.map((membership) => [membership.personId, membership]),
  );
  const canManageAccess = hasOrganizerPrivilege(access.role);
  const guardianMembershipIdsByPerson = new Map<string, string[]>();
  for (const guardian of data.guardians) {
    const ids =
      guardianMembershipIdsByPerson.get(guardian.managedPersonId) ?? [];
    ids.push(guardian.guardianMembershipId);
    guardianMembershipIdsByPerson.set(guardian.managedPersonId, ids);
  }
  const members: ConnectedFamilySettingsPanelViewModel["members"] =
    data.people.flatMap((person) => {
      const membership = membershipByPerson.get(person.id);
      if (!membership && person.profileKind !== "managed") return [];
      const isManaged = person.profileKind === "managed";
      const role = isManaged
        ? null
        : (presentedMembershipRole({
            role: membership?.role,
            directoryKind: membership?.directoryKind,
          }) ?? "member");
      return [
        {
          id: person.id,
          membershipId: membership?.id ?? null,
          profileKind: isManaged ? "managed" : "account",
          role,
          name: person.displayName,
          initial: initialFor(person.displayName),
          accent: mapDatabaseAccent(person.accentToken),
          relationshipLabel: isManaged
            ? "Managed journal"
            : familyMembershipRoleLabel(role),
          accessLabel: isManaged
            ? "Managed profile · No sign-in"
            : "Account · Can sign in",
          guardianMembershipIds:
            guardianMembershipIdsByPerson.get(person.id) ?? [],
          canManageRole:
            canManageAccess &&
            membership !== undefined &&
            membership.id !== access.membershipId &&
            !isOperationsMembership({
              role: membership.role,
              directoryKind: membership.directoryKind,
            }),
          canManageJournal: canManageAccess && isManaged,
          canReviewRemoval:
            canManageAccess &&
            membership !== undefined &&
            membership.id !== access.membershipId,
        },
      ];
    });

  return {
    chrome: {
      ...context.chrome,
      title: "Account",
      settingsHref: "/settings/family",
    },
    panel: {
      mode: "connected",
      intro:
        "A small, invitation-only circle. Everyone’s place and access should stay easy to understand.",
      currentMemberId: access.personId,
      canManageAccess,
      members,
      guardianOptions: canManageAccess
        ? data.memberships.flatMap((membership) => {
            const person = data.people.find(
              (candidate) => candidate.id === membership.personId,
            );
            if (!person || person.profileKind !== "account") {
              return [];
            }
            return [
              {
                membershipId: membership.id,
                personId: person.id,
                name: person.displayName,
                role: hasOrganizerPrivilege(membership.role)
                  ? "organizer"
                  : "member",
              } as const,
            ];
          })
        : [],
      pendingInvitations: data.pendingInvitations.map((invitation) => ({
        emailRequestId: invitation.emailRequestId,
        displayName: invitation.displayName,
        state: invitation.state,
        statusLabel: invitationStatusLabel(invitation.state),
        createdLabel: invitationDateLabel(
          invitation.createdAt,
          context.circleTimeZone,
          "Invited",
        ),
        expiresLabel: invitationDateLabel(
          invitation.expiresAt,
          context.circleTimeZone,
          "Expires",
        ),
      })),
      invitationDelivery: invitationDeliveryEnabled ? "enabled" : "disabled",
    },
  };
}
