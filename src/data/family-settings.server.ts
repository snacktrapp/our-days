import "server-only";

import type { JournalAccess } from "@/lib/auth/journal-access";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type {
  ConnectedFamilySettingsPanelViewModel,
  FamilySettingsViewModel,
} from "@/features/family-settings/family-settings-view-model";
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
  }>[];
  pendingInvitations: readonly Readonly<{
    invitationId: string;
    displayName: string;
    createdAt: string;
    expiresAt: string;
  }>[];
}>;

function initialFor(name: string) {
  return Array.from(name.trim())[0]?.toLocaleUpperCase("en-US") ?? "•";
}

function invitationDateLabel(value: string, timeZone: string, prefix: string) {
  return `${prefix} ${new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))}`;
}

export async function loadConnectedFamilyAccess(
  access: AuthenticatedAccess,
): Promise<FamilyAccessData> {
  const supabase = await createOurDaysServerClient();
  const pendingPromise =
    access.role === "organizer"
      ? supabase.rpc("list_pending_invitations", {
          circle_id: access.circleId,
        })
      : Promise.resolve({ data: [], error: null });
  const [peopleResult, membershipsResult, pendingResult] = await Promise.all([
    supabase
      .from("people")
      .select("id, display_name, profile_kind, accent_token")
      .eq("circle_id", access.circleId)
      .order("created_at", { ascending: true }),
    supabase
      .from("circle_memberships")
      .select("id, person_id, role")
      .eq("circle_id", access.circleId)
      .eq("status", "active")
      .order("joined_at", { ascending: true }),
    pendingPromise,
  ]);
  const error =
    peopleResult.error ?? membershipsResult.error ?? pendingResult.error;
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
    })),
    pendingInvitations: (pendingResult.data ?? []).map((invitation) => ({
      invitationId: invitation.invitation_id,
      displayName: invitation.display_name,
      createdAt: invitation.created_at,
      expiresAt: invitation.expires_at,
    })),
  };
}

export function buildConnectedFamilySettingsModel(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
  data: FamilyAccessData,
): FamilySettingsViewModel {
  const membershipByPerson = new Map(
    data.memberships.map((membership) => [membership.personId, membership]),
  );
  const canManageAccess = access.role === "organizer";
  const members: ConnectedFamilySettingsPanelViewModel["members"] =
    data.people.flatMap((person) => {
      const membership = membershipByPerson.get(person.id);
      if (!membership && person.profileKind !== "managed") return [];
      const isManaged = person.profileKind === "managed";
      return [
        {
          id: person.id,
          membershipId: membership?.id ?? null,
          name: person.displayName,
          initial: initialFor(person.displayName),
          accent: mapDatabaseAccent(person.accentToken),
          relationshipLabel: isManaged
            ? "Managed journal"
            : membership?.role === "organizer"
              ? "Organizer"
              : "Family member",
          accessLabel: isManaged
            ? "Managed profile · No sign-in"
            : "Account · Can sign in",
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
      title: "Family settings",
      settingsHref: "/settings/family",
    },
    panel: {
      mode: "connected",
      intro:
        "A small, invitation-only circle. Everyone’s place and access should stay easy to understand.",
      currentMemberId: access.personId,
      canManageAccess,
      members,
      pendingInvitations: data.pendingInvitations.map((invitation) => ({
        id: invitation.invitationId,
        displayName: invitation.displayName,
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
      invitationDelivery: "worker-required",
    },
  };
}
