// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: vi.fn(),
}));

import { createOurDaysServerClient } from "@/lib/supabase/server";
import type { ConnectedJournalContext } from "./journal-context.server";
import {
  buildConnectedFamilySettingsModel,
  loadConnectedFamilyAccess,
} from "./family-settings.server";

const organizerAccess = {
  mode: "authenticated",
  membershipId: "40000000-0000-4000-8000-000000000001",
  circleId: "20000000-0000-4000-8000-000000000001",
  personId: "30000000-0000-4000-8000-000000000001",
  role: "organizer",
} as const;

const memberAccess = {
  ...organizerAccess,
  membershipId: "40000000-0000-4000-8000-000000000002",
  personId: "30000000-0000-4000-8000-000000000002",
  role: "member",
} as const;

const context: ConnectedJournalContext = {
  circleName: "Cedar Circle",
  circleTimeZone: "America/Los_Angeles",
  today: "2026-08-30",
  chrome: {
    accent: "teal",
    title: "Cedar Circle",
    eyebrow: "Our family",
    familyMark: [],
    settingsHref: "/settings/family",
    memoriesHref: "/memories",
    composer: {
      experience: "connected-family",
      previewToday: "2026-08-30",
      defaultJournalPersonId: organizerAccess.personId,
      recorderPersonId: organizerAccess.personId,
      recordedByName: "Parent One",
      journalPeople: [],
      taggablePeople: [],
    },
  },
  people: [],
};

const people = [
  {
    id: organizerAccess.personId,
    display_name: "Parent One",
    profile_kind: "account",
    accent_token: "sky",
  },
  {
    id: memberAccess.personId,
    display_name: "Parent Two",
    profile_kind: "account",
    accent_token: "sage",
  },
  {
    id: "30000000-0000-4000-8000-000000000003",
    display_name: "Child",
    profile_kind: "managed",
    accent_token: "gold",
  },
];

const memberships = [
  {
    id: organizerAccess.membershipId,
    person_id: organizerAccess.personId,
    role: "organizer",
  },
  {
    id: memberAccess.membershipId,
    person_id: memberAccess.personId,
    role: "member",
  },
];

function queryResult(data: unknown[], error: unknown = null) {
  const chain = {
    eq: vi.fn(),
    order: vi.fn(),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockResolvedValue({ data, error });
  return chain;
}

function guardianQueryResult(data: unknown[], error: unknown = null) {
  const chain = {
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.is.mockResolvedValue({ data, error });
  return chain;
}

function connectedClient({
  pending = [],
  pendingError = null,
  guardians = [],
  guardiansError = null,
}: {
  pending?: unknown[];
  pendingError?: unknown;
  guardians?: unknown[];
  guardiansError?: unknown;
} = {}) {
  const peopleQuery = queryResult(people);
  const membershipQuery = queryResult(memberships);
  const guardianQuery = guardianQueryResult(guardians, guardiansError);
  const rpc = vi.fn().mockResolvedValue({
    data: pending,
    error: pendingError,
  });
  const from = vi.fn((table: string) => {
    if (table === "people") return peopleQuery;
    if (table === "circle_memberships") return membershipQuery;
    if (table === "person_guardians") return guardianQuery;
    throw new Error(`Unexpected table: ${table}`);
  });
  vi.mocked(createOurDaysServerClient).mockResolvedValue({
    from,
    rpc,
  } as never);
  return { from, guardianQuery, membershipQuery, peopleQuery, rpc };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("connected family settings data", () => {
  it("loads only minimal pending-invitation fields for an organizer", async () => {
    const pending = [
      {
        email_request_id: "90000000-0000-4000-8000-000000000001",
        invited_display_name: "Grandparent",
        state: "delivered",
        requested_at: "2026-08-30T06:30:00.000Z",
        expires_at: "2026-09-01T06:30:00.000Z",
      },
    ];
    const guardians = [
      {
        managed_person_id: "30000000-0000-4000-8000-000000000003",
        guardian_membership_id: memberAccess.membershipId,
      },
    ];
    const { rpc } = connectedClient({ pending, guardians });

    const data = await loadConnectedFamilyAccess(organizerAccess);

    expect(rpc).toHaveBeenCalledWith("list_pending_invitation_email_requests", {
      circle_id: organizerAccess.circleId,
    });
    expect(data.pendingInvitations).toEqual([
      {
        emailRequestId: pending[0].email_request_id,
        displayName: "Grandparent",
        state: "delivered",
        createdAt: pending[0].requested_at,
        expiresAt: pending[0].expires_at,
      },
    ]);
    expect(data.pendingInvitations[0]).not.toHaveProperty("email");
    expect(data.pendingInvitations[0]).not.toHaveProperty("rawToken");
    expect(data.guardians).toEqual([
      {
        managedPersonId: guardians[0].managed_person_id,
        guardianMembershipId: guardians[0].guardian_membership_id,
      },
    ]);
  });

  it("does not call the organizer-only invitation RPC for a member", async () => {
    const { from, rpc } = connectedClient();

    const data = await loadConnectedFamilyAccess(memberAccess);

    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith("person_guardians");
    expect(data.pendingInvitations).toEqual([]);
    expect(data.guardians).toEqual([]);
  });

  it("builds organizer controls without allowing self or managed-profile removal", () => {
    const model = buildConnectedFamilySettingsModel(organizerAccess, context, {
      people: people.map((person) => ({
        id: person.id,
        displayName: person.display_name,
        profileKind: person.profile_kind,
        accentToken: person.accent_token,
      })),
      memberships: memberships.map((membership) => ({
        id: membership.id,
        personId: membership.person_id,
        role: membership.role,
      })),
      guardians: [
        {
          managedPersonId: "30000000-0000-4000-8000-000000000003",
          guardianMembershipId: memberAccess.membershipId,
        },
      ],
      pendingInvitations: [
        {
          emailRequestId: "90000000-0000-4000-8000-000000000001",
          displayName: "Grandparent",
          state: "delivered",
          createdAt: "2026-08-30T06:30:00.000Z",
          expiresAt: "2026-09-01T06:30:00.000Z",
        },
      ],
    });

    expect(model.chrome).toMatchObject({
      title: "Account",
      settingsHref: "/settings/family",
    });
    expect(model.panel).toMatchObject({
      mode: "connected",
      canManageAccess: true,
      invitationDelivery: "disabled",
    });
    if (model.panel.mode !== "connected") {
      throw new Error("Expected connected family settings");
    }
    expect(model.panel.members).toEqual([
      expect.objectContaining({
        id: organizerAccess.personId,
        membershipId: organizerAccess.membershipId,
        relationshipLabel: "Organizer",
        canManageRole: false,
        canReviewRemoval: false,
      }),
      expect.objectContaining({
        id: memberAccess.personId,
        membershipId: memberAccess.membershipId,
        relationshipLabel: "Family member",
        canManageRole: true,
        canReviewRemoval: true,
      }),
      expect.objectContaining({
        name: "Child",
        membershipId: null,
        relationshipLabel: "Managed journal",
        guardianMembershipIds: [memberAccess.membershipId],
        canManageJournal: true,
        canReviewRemoval: false,
      }),
    ]);
    expect(model.panel.pendingInvitations).toEqual([
      {
        emailRequestId: "90000000-0000-4000-8000-000000000001",
        displayName: "Grandparent",
        state: "delivered",
        statusLabel: "Sent",
        createdLabel: "Invited Aug 29, 2026",
        expiresLabel: "Expires Aug 31, 2026",
      },
    ]);
    expect(model.panel.guardianOptions).toEqual([
      expect.objectContaining({
        membershipId: organizerAccess.membershipId,
        role: "organizer",
      }),
      expect.objectContaining({
        membershipId: memberAccess.membershipId,
        role: "member",
      }),
    ]);
  });

  it("builds a read-only member model", () => {
    const model = buildConnectedFamilySettingsModel(memberAccess, context, {
      people: people.map((person) => ({
        id: person.id,
        displayName: person.display_name,
        profileKind: person.profile_kind,
        accentToken: person.accent_token,
      })),
      memberships: memberships.map((membership) => ({
        id: membership.id,
        personId: membership.person_id,
        role: membership.role,
      })),
      guardians: [],
      pendingInvitations: [],
    });

    expect(model.panel).toMatchObject({
      mode: "connected",
      canManageAccess: false,
      pendingInvitations: [],
    });
    if (model.panel.mode !== "connected") {
      throw new Error("Expected connected family settings");
    }
    expect(
      model.panel.members.every(
        (member) =>
          !member.canReviewRemoval &&
          !member.canManageRole &&
          !member.canManageJournal,
      ),
    ).toBe(true);
    expect(model.panel.guardianOptions).toEqual([]);
  });

  it("does not turn a pending-invitation RPC failure into an empty list", async () => {
    connectedClient({ pendingError: new Error("private list unavailable") });

    await expect(loadConnectedFamilyAccess(organizerAccess)).rejects.toThrow(
      "private list unavailable",
    );
  });

  it("skips an unrecognized invitation state instead of crashing Account", async () => {
    connectedClient({
      pending: [
        {
          email_request_id: "90000000-0000-4000-8000-000000000001",
          invited_display_name: "Grandparent",
          state: "delivered",
          requested_at: "2026-08-30T06:30:00.000Z",
          expires_at: "2026-09-01T06:30:00.000Z",
        },
        {
          email_request_id: "90000000-0000-4000-8000-000000000002",
          invited_display_name: "Neighbor",
          state: "unknown-worker-state",
          requested_at: "2026-08-30T06:30:00.000Z",
          expires_at: "2026-09-01T06:30:00.000Z",
        },
      ],
    });

    await expect(loadConnectedFamilyAccess(organizerAccess)).resolves.toEqual(
      expect.objectContaining({
        pendingInvitations: [
          {
            emailRequestId: "90000000-0000-4000-8000-000000000001",
            displayName: "Grandparent",
            state: "delivered",
            createdAt: "2026-08-30T06:30:00.000Z",
            expiresAt: "2026-09-01T06:30:00.000Z",
          },
        ],
      }),
    );
  });

  it("does not turn a guardian-query failure into an empty assignment list", async () => {
    connectedClient({ guardiansError: new Error("guardian list unavailable") });

    await expect(loadConnectedFamilyAccess(organizerAccess)).rejects.toThrow(
      "guardian list unavailable",
    );
  });
});
