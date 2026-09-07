import "server-only";

import type { JournalAccess } from "@/lib/auth/journal-access";
import {
  readJournalCircleMemberships,
  type JournalCircleMembership,
} from "@/lib/auth/journal-access";
import { localJournalIsEnabled } from "../../config/our-days-environment";
import { createOurDaysServerClient } from "@/lib/supabase/server";
import type {
  ConnectedFamilySettingsPanelViewModel,
  FamilyAccessMemberViewModel,
  FamilyCircleViewModel,
  FamilySettingsViewModel,
  GuardianOptionViewModel,
  PendingFamilyInvitationViewModel,
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

export type FamilyAccessData = Readonly<{
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

function mapPendingInvitations(
  rows: readonly Readonly<{
    email_request_id: string;
    invited_display_name: string;
    state: string;
    requested_at: string;
    expires_at: string;
  }>[],
) {
  return rows.flatMap((invitation) => {
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
  });
}

export async function loadConnectedFamilyAccess(
  access: AuthenticatedAccess,
): Promise<FamilyAccessData> {
  const directory = await loadConnectedFamilyDirectory(access, [
    access.circleId,
  ]);
  return (
    directory.get(access.circleId) ?? {
      people: [],
      memberships: [],
      guardians: [],
      pendingInvitations: [],
    }
  );
}

export async function loadConnectedFamilyDirectory(
  access: AuthenticatedAccess,
  circleIds: readonly string[],
): Promise<ReadonlyMap<string, FamilyAccessData>> {
  const ids = [...new Set(circleIds.filter(Boolean))];
  const empty = new Map<string, FamilyAccessData>(
    ids.map((id) => [
      id,
      {
        people: [],
        memberships: [],
        guardians: [],
        pendingInvitations: [],
      },
    ]),
  );
  if (ids.length === 0) return empty;

  if (localJournalIsEnabled()) {
    const { loadLocalFamilyDirectory } =
      await import("@/lib/local-journal/views");
    return loadLocalFamilyDirectory(access, ids);
  }

  const viewerMemberships = await readJournalCircleMemberships();
  const organizerCircleIds = new Set(
    viewerMemberships
      .filter((membership) => hasOrganizerPrivilege(membership.role))
      .map((membership) => membership.circleId)
      .filter((circleId) => ids.includes(circleId)),
  );
  if (hasOrganizerPrivilege(access.role) && ids.includes(access.circleId)) {
    organizerCircleIds.add(access.circleId);
  }

  const supabase = await createOurDaysServerClient();
  const pendingPromise =
    organizerCircleIds.size > 0
      ? Promise.all(
          [...organizerCircleIds].map(async (circleId) => {
            const result = await supabase.rpc(
              "list_pending_invitation_email_requests",
              { circle_id: circleId },
            );
            return { circleId, result };
          }),
        )
      : Promise.resolve(
          [] as readonly Readonly<{
            circleId: string;
            result: { data: unknown; error: unknown };
          }>[],
        );
  const guardiansPromise =
    organizerCircleIds.size > 0
      ? supabase
          .from("person_guardians")
          .select("managed_person_id, guardian_membership_id, circle_id")
          .in("circle_id", [...organizerCircleIds])
          .is("revoked_at", null)
      : Promise.resolve({ data: [], error: null });
  const [peopleResult, membershipsResult, guardiansResult, pendingResults] =
    await Promise.all([
      supabase
        .from("people")
        .select("id, display_name, profile_kind, accent_token, circle_id")
        .in("circle_id", ids)
        .order("created_at", { ascending: true }),
      supabase
        .from("circle_memberships")
        .select("id, person_id, role, directory_kind, circle_id")
        .in("circle_id", ids)
        .eq("status", "active")
        .order("joined_at", { ascending: true }),
      guardiansPromise,
      pendingPromise,
    ]);
  const pendingError = pendingResults.find(({ result }) => result.error)?.result
    .error;
  const error =
    peopleResult.error ??
    membershipsResult.error ??
    guardiansResult.error ??
    pendingError;
  if (error) throw error;

  const directory = new Map(empty);
  const fallbackCircleId = ids.length === 1 ? ids[0] : null;
  for (const person of peopleResult.data ?? []) {
    const circleId = person.circle_id ?? fallbackCircleId;
    const current = circleId ? directory.get(circleId) : undefined;
    if (!current || !circleId) continue;
    directory.set(circleId, {
      ...current,
      people: [
        ...current.people,
        {
          id: person.id,
          displayName: person.display_name,
          profileKind: person.profile_kind,
          accentToken: person.accent_token,
        },
      ],
    });
  }
  for (const membership of membershipsResult.data ?? []) {
    const circleId = membership.circle_id ?? fallbackCircleId;
    const current = circleId ? directory.get(circleId) : undefined;
    if (!current || !circleId) continue;
    directory.set(circleId, {
      ...current,
      memberships: [
        ...current.memberships,
        {
          id: membership.id,
          personId: membership.person_id,
          role: membership.role,
          directoryKind: membership.directory_kind,
        },
      ],
    });
  }
  for (const guardian of guardiansResult.data ?? []) {
    const circleId = guardian.circle_id ?? fallbackCircleId;
    const current = circleId ? directory.get(circleId) : undefined;
    if (!current || !circleId) continue;
    directory.set(circleId, {
      ...current,
      guardians: [
        ...current.guardians,
        {
          managedPersonId: guardian.managed_person_id,
          guardianMembershipId: guardian.guardian_membership_id,
        },
      ],
    });
  }
  for (const { circleId, result } of pendingResults) {
    const current = directory.get(circleId);
    if (!current) continue;
    directory.set(circleId, {
      ...current,
      pendingInvitations: mapPendingInvitations(
        (result.data ?? []) as readonly Readonly<{
          email_request_id: string;
          invited_display_name: string;
          state: string;
          requested_at: string;
          expires_at: string;
        }>[],
      ),
    });
  }
  return directory;
}

export async function loadGroupMemberCounts(
  circleIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  const ids = [...new Set(circleIds.filter(Boolean))];
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return counts;

  if (localJournalIsEnabled()) {
    const { readLocalJournal } = await import("@/lib/local-journal/store");
    const document = await readLocalJournal();
    counts.set(document.circle.id, document.people.length);
    for (const extra of document.extraCircles ?? []) {
      counts.set(extra.id, 1);
    }
    return counts;
  }

  const supabase = await createOurDaysServerClient();
  const { data, error } = await supabase
    .from("people")
    .select("circle_id")
    .in("circle_id", ids);
  if (error) throw error;
  for (const person of data ?? []) {
    counts.set(person.circle_id, (counts.get(person.circle_id) ?? 0) + 1);
  }
  return counts;
}

function buildCircleMembers(
  data: FamilyAccessData,
  viewer: Readonly<{ membershipId: string; personId: string; role: string }>,
): readonly FamilyAccessMemberViewModel[] {
  const membershipByPerson = new Map(
    data.memberships.map((membership) => [membership.personId, membership]),
  );
  const canManageAccess = hasOrganizerPrivilege(viewer.role);
  const guardianMembershipIdsByPerson = new Map<string, string[]>();
  for (const guardian of data.guardians) {
    const ids =
      guardianMembershipIdsByPerson.get(guardian.managedPersonId) ?? [];
    ids.push(guardian.guardianMembershipId);
    guardianMembershipIdsByPerson.set(guardian.managedPersonId, ids);
  }
  return data.people.flatMap((person) => {
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
          membership.id !== viewer.membershipId &&
          !isOperationsMembership({
            role: membership.role,
            directoryKind: membership.directoryKind,
          }),
        canManageJournal: canManageAccess && isManaged,
        canReviewRemoval:
          canManageAccess &&
          membership !== undefined &&
          membership.id !== viewer.membershipId,
      },
    ];
  });
}

function buildGuardianOptions(
  data: FamilyAccessData,
  canManageAccess: boolean,
): readonly GuardianOptionViewModel[] {
  if (!canManageAccess) return [];
  return data.memberships.flatMap((membership) => {
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
        role: hasOrganizerPrivilege(membership.role) ? "organizer" : "member",
      } as const,
    ];
  });
}

function buildPendingInvitations(
  data: FamilyAccessData,
  timeZone: string,
): readonly PendingFamilyInvitationViewModel[] {
  return data.pendingInvitations.map((invitation) => ({
    emailRequestId: invitation.emailRequestId,
    displayName: invitation.displayName,
    state: invitation.state,
    statusLabel: invitationStatusLabel(invitation.state),
    createdLabel: invitationDateLabel(
      invitation.createdAt,
      timeZone,
      "Invited",
    ),
    expiresLabel: invitationDateLabel(
      invitation.expiresAt,
      timeZone,
      "Expires",
    ),
  }));
}

const emptyAccess: FamilyAccessData = {
  people: [],
  memberships: [],
  guardians: [],
  pendingInvitations: [],
};

export function buildConnectedFamilySettingsModel(
  access: AuthenticatedAccess,
  context: ConnectedJournalContext,
  data: FamilyAccessData,
  invitationDeliveryEnabled = false,
  memberCounts: ReadonlyMap<string, number> = new Map(),
  directory: ReadonlyMap<string, FamilyAccessData> = new Map([
    [access.circleId, data],
  ]),
  viewerMemberships: readonly JournalCircleMembership[] = [
    {
      membershipId: access.membershipId,
      circleId: access.circleId,
      personId: access.personId,
      role: access.role,
    },
  ],
): FamilySettingsViewModel {
  const viewerByCircle = new Map(
    viewerMemberships.map((membership) => [membership.circleId, membership]),
  );
  const groups: readonly FamilyCircleViewModel[] = (
    context.groups && context.groups.length > 0
      ? context.groups
      : [{ id: access.circleId, name: context.circleName }]
  ).map((group) => {
    const circleData = directory.get(group.id) ?? emptyAccess;
    const viewer = viewerByCircle.get(group.id) ??
      (group.id === access.circleId
        ? {
            membershipId: access.membershipId,
            circleId: access.circleId,
            personId: access.personId,
            role: access.role,
          }
        : undefined);
    const canManageAccess = hasOrganizerPrivilege(viewer?.role);
    const members = viewer
      ? buildCircleMembers(circleData, viewer)
      : buildCircleMembers(circleData, {
          membershipId: "",
          personId: access.personId,
          role: "member",
        });
    return {
      id: group.id,
      name: group.name,
      memberCount:
        memberCounts.get(group.id) ??
        (circleData.people.length > 0
          ? circleData.people.length
          : members.length),
      currentMemberId: viewer?.personId ?? access.personId,
      canManageAccess,
      members,
      guardianOptions: buildGuardianOptions(circleData, canManageAccess),
      pendingInvitations: buildPendingInvitations(
        circleData,
        context.circleTimeZone,
      ),
    };
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
      canManageAccess: hasOrganizerPrivilege(access.role),
      groups,
      invitationDelivery: invitationDeliveryEnabled ? "enabled" : "disabled",
    } satisfies ConnectedFamilySettingsPanelViewModel,
  };
}
