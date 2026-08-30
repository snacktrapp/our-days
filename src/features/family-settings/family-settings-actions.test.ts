// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getHeaders: vi.fn(),
  from: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  revalidatePath: vi.fn(),
  requireAccess: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.requireAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import {
  revokeFamilyInvitationAction,
  revokeFamilyMembershipAction,
} from "./family-settings-actions";

const organizerMembershipId = "40000000-0000-4000-8000-000000000001";
const otherMembershipId = "40000000-0000-4000-8000-000000000002";
const invitationId = "90000000-0000-4000-8000-000000000001";

describe("family settings actions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.requireAccess.mockResolvedValue({
      mode: "authenticated",
      membershipId: organizerMembershipId,
      circleId: "20000000-0000-4000-8000-000000000001",
      personId: "30000000-0000-4000-8000-000000000001",
      role: "organizer",
    });
    mocks.membershipMaybeSingle.mockResolvedValue({
      data: { id: otherMembershipId },
      error: null,
    });
    const membershipQuery = {
      eq: vi.fn(),
      maybeSingle: mocks.membershipMaybeSingle,
      select: vi.fn(),
    };
    membershipQuery.select.mockReturnValue(membershipQuery);
    membershipQuery.eq.mockReturnValue(membershipQuery);
    mocks.from.mockReturnValue(membershipQuery);
    mocks.rpc.mockImplementation(async (name: string) =>
      name === "list_pending_invitations"
        ? {
            data: [{ invitation_id: invitationId }],
            error: null,
          }
        : { data: null, error: null },
    );
    mocks.createClient.mockResolvedValue({ from: mocks.from, rpc: mocks.rpc });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("fails a hostile origin before reading access or opening Supabase", async () => {
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://attacker.invalid" }),
    );

    await expect(
      revokeFamilyMembershipAction({ membershipId: otherMembershipId }),
    ).resolves.toEqual({
      ok: false,
      message: "That access change was not allowed.",
    });
    expect(mocks.requireAccess).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("denies an ordinary member before opening Supabase", async () => {
    mocks.requireAccess.mockResolvedValueOnce({
      mode: "authenticated",
      membershipId: otherMembershipId,
      circleId: "20000000-0000-4000-8000-000000000001",
      personId: "30000000-0000-4000-8000-000000000002",
      role: "member",
    });

    await expect(
      revokeFamilyInvitationAction({ invitationId }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation change was not allowed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed membership ID", "not-a-uuid"],
    ["the organizer's own membership", organizerMembershipId],
  ])("denies %s before opening Supabase", async (_label, membershipId) => {
    await expect(
      revokeFamilyMembershipAction({ membershipId }),
    ).resolves.toEqual({
      ok: false,
      message: "That access change was not allowed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("denies a malformed invitation ID before opening Supabase", async () => {
    await expect(
      revokeFamilyInvitationAction({ invitationId: "not-a-uuid" }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation change was not allowed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([null, [], "membership", { membershipId: 7 }])(
    "denies malformed runtime membership input %# before opening Supabase",
    async (input) => {
      await expect(revokeFamilyMembershipAction(input)).resolves.toEqual({
        ok: false,
        message: "That access change was not allowed.",
      });
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

  it("maps the last-organizer database invariant without revalidating", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23514", message: "last organizer" },
    });

    await expect(
      revokeFamilyMembershipAction({ membershipId: otherMembershipId }),
    ).resolves.toEqual({
      ok: false,
      message: "This circle must keep at least one organizer.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("revoke_membership", {
      membership_id: otherMembershipId,
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps database authorization failures generic", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "wrong circle" },
    });

    await expect(
      revokeFamilyMembershipAction({ membershipId: otherMembershipId }),
    ).resolves.toEqual({
      ok: false,
      message: "That access could not be removed. Try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a membership outside the active circle before mutation", async () => {
    mocks.membershipMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    await expect(
      revokeFamilyMembershipAction({ membershipId: otherMembershipId }),
    ).resolves.toEqual({
      ok: false,
      message: "That access change was not allowed.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("revokes membership through the narrow RPC and refreshes every access surface", async () => {
    await expect(
      revokeFamilyMembershipAction({ membershipId: otherMembershipId }),
    ).resolves.toEqual({ ok: true, message: "Family access removed." });

    expect(mocks.rpc).toHaveBeenCalledWith("revoke_membership", {
      membership_id: otherMembershipId,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/settings/family"],
      ["/people"],
      ["/family"],
    ]);
  });

  it("maps invitation RPC failure without refreshing the settings view", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [{ invitation_id: invitationId }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "22023", message: "invitation unavailable" },
      });

    await expect(
      revokeFamilyInvitationAction({ invitationId }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation could not be withdrawn. Try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("withdraws an invitation and refreshes only family settings", async () => {
    await expect(
      revokeFamilyInvitationAction({ invitationId }),
    ).resolves.toEqual({ ok: true, message: "Invitation withdrawn." });

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "revoke_invitation", {
      invitation_id: invitationId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/settings/family",
    );
  });

  it("rejects an invitation outside the active circle before mutation", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    await expect(
      revokeFamilyInvitationAction({ invitationId }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation change was not allowed.",
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "list_pending_invitations",
      { circle_id: "20000000-0000-4000-8000-000000000001" },
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
