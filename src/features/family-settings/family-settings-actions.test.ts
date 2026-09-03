// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAnonClient: vi.fn(),
  getHeaders: vi.fn(),
  from: vi.fn(),
  membershipMaybeSingle: vi.fn(),
  revalidatePath: vi.fn(),
  requireAccess: vi.fn(),
  rpc: vi.fn(),
  signInWithOtp: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/auth/journal-access", () => ({
  requireJournalAccess: mocks.requireAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createAnonClient,
}));

import {
  requestFamilyInvitationAction,
  revokeFamilyMembershipAction,
  setFamilyMembershipRoleAction,
  setManagedProfileGuardianAction,
  withdrawFamilyInvitationEmailRequestAction,
} from "./family-settings-actions";

const organizerMembershipId = "40000000-0000-4000-8000-000000000001";
const otherMembershipId = "40000000-0000-4000-8000-000000000002";
const emailRequestId = "90000000-0000-4000-8000-000000000001";
const requestKey = "90000000-0000-4000-8000-000000000002";
const managedPersonId = "30000000-0000-4000-8000-000000000008";

describe("family settings actions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    vi.stubEnv("OUR_DAYS_INVITATION_DELIVERY_MODE", "enabled");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
    );
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_environment_contract_fixture",
    );
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
      data: {
        id: otherMembershipId,
        person_id: "30000000-0000-4000-8000-000000000002",
        role: "member",
        status: "active",
      },
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
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.createAnonClient.mockReturnValue({
      auth: { signInWithOtp: mocks.signInWithOtp },
    });
    mocks.createClient.mockResolvedValue({
      from: mocks.from,
      rpc: mocks.rpc,
      auth: { signInWithOtp: mocks.signInWithOtp },
    });
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
      withdrawFamilyInvitationEmailRequestAction({ emailRequestId }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation change was not allowed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      "role changes",
      () =>
        setFamilyMembershipRoleAction({
          membershipId: organizerMembershipId,
          role: "member",
        }),
      "That role change was not allowed.",
    ],
    [
      "journal-care changes",
      () =>
        setManagedProfileGuardianAction({
          managedPersonId,
          guardianMembershipId: organizerMembershipId,
          grantAccess: true,
        }),
      "That journal care change was not allowed.",
    ],
  ])(
    "denies ordinary-member %s before opening Supabase",
    async (_label, action, message) => {
      mocks.requireAccess.mockResolvedValue({
        mode: "authenticated",
        membershipId: otherMembershipId,
        circleId: "20000000-0000-4000-8000-000000000001",
        personId: "30000000-0000-4000-8000-000000000002",
        role: "member",
      });

      await expect(action()).resolves.toEqual({ ok: false, message });
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );

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

  it("denies a malformed invitation request ID before opening Supabase", async () => {
    await expect(
      withdrawFamilyInvitationEmailRequestAction({
        emailRequestId: "not-a-uuid",
      }),
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
      ["/people/30000000-0000-4000-8000-000000000002"],
    ]);
  });

  it("maps invitation withdrawal failure without refreshing the settings view", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "invitation unavailable" },
    });

    await expect(
      withdrawFamilyInvitationEmailRequestAction({ emailRequestId }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation could not be withdrawn. Try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("withdraws any live invitation-request state and refreshes only family settings", async () => {
    await expect(
      withdrawFamilyInvitationEmailRequestAction({ emailRequestId }),
    ).resolves.toEqual({ ok: true, message: "Invitation withdrawn." });

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "withdraw_invitation_email_request",
      {
        email_request_id: emailRequestId,
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/settings/family",
    );
  });

  it("normalizes and requests an invitation with the caller's stable request key", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: emailRequestId, error: null });

    await expect(
      requestFamilyInvitationAction({
        displayName: "  Grandma  ",
        email: " GRANDMA@EXAMPLE.COM ",
        requestKey,
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Private invitation requested.",
    });

    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
      "request_invitation_email",
      {
        circle_id: "20000000-0000-4000-8000-000000000001",
        display_name: "Grandma",
        email: "grandma@example.com",
        request_key: requestKey,
      },
    );
    expect(mocks.createAnonClient).toHaveBeenCalledWith(
      "https://aaaaaaaaaaaaaaaaaaaa.supabase.co",
      "sb_publishable_environment_contract_fixture",
      expect.objectContaining({
        auth: expect.objectContaining({ flowType: "implicit" }),
      }),
    );
    expect(mocks.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "grandma@example.com",
      options: {
        emailRedirectTo: "https://journal.example.com/auth/callback",
        shouldCreateUser: false,
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/settings/family",
    );
  });

  it("uses the Vercel Preview origin when SITE_URL is a copied staging host", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://our-days-staging.vercel.app");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "our-days-git-preview.vercel.app");
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://our-days-git-preview.vercel.app" }),
    );
    mocks.rpc.mockResolvedValueOnce({ data: emailRequestId, error: null });

    await expect(
      requestFamilyInvitationAction({
        displayName: "Grandma",
        email: "grandma@example.com",
        requestKey,
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Private invitation requested.",
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "grandma@example.com",
      options: {
        emailRedirectTo:
          "https://our-days-git-preview.vercel.app/auth/callback",
        shouldCreateUser: false,
      },
    });
  });

  it("resends the magic link when the same email is already queued", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "22023",
        message: "Invitation email could not be requested",
      },
    });

    await expect(
      requestFamilyInvitationAction({
        displayName: "TARS",
        email: "tars-trapp@agentmail.to",
        requestKey,
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Private invitation requested.",
    });
    expect(mocks.signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "tars-trapp@agentmail.to",
      options: {
        emailRedirectTo: "https://journal.example.com/auth/callback",
        shouldCreateUser: false,
      },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/settings/family",
    );
  });

  it("keeps a queued invitation after the magic-link vendor fails to send", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: emailRequestId, error: null });
    mocks.signInWithOtp.mockResolvedValueOnce({
      error: { message: "rate limited" },
    });

    await expect(
      requestFamilyInvitationAction({
        displayName: "Grandma",
        email: "grandma@example.com",
        requestKey,
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Private invitation requested.",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/settings/family",
    );
  });

  it("keeps invitation creation disabled unless the private worker capability is explicit", async () => {
    vi.stubEnv("OUR_DAYS_INVITATION_DELIVERY_MODE", "disabled");

    await expect(
      requestFamilyInvitationAction({
        displayName: "Grandma",
        email: "grandma@example.com",
        requestKey,
      }),
    ).resolves.toEqual({
      ok: false,
      message: "That invitation could not be sent.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    { displayName: "", email: "grandma@example.com", requestKey },
    { displayName: "Grandma", email: "not-an-email", requestKey },
    {
      displayName: "Grandma\nInjected",
      email: "grandma@example.com",
      requestKey,
    },
    {
      displayName: "Grandma",
      email: "grandma@example.com",
      requestKey: "not-a-uuid",
    },
  ])("rejects malformed invitation request %#", async (input) => {
    await expect(requestFamilyInvitationAction(input)).resolves.toEqual({
      ok: false,
      message: "That invitation could not be sent.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("changes another active member role through the narrow RPC", async () => {
    mocks.membershipMaybeSingle.mockResolvedValueOnce({
      data: {
        id: otherMembershipId,
        person_id: "30000000-0000-4000-8000-000000000002",
        role: "member",
      },
      error: null,
    });

    await expect(
      setFamilyMembershipRoleAction({
        membershipId: otherMembershipId,
        role: "organizer",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Organizer access granted.",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("set_membership_role", {
      membership_id: otherMembershipId,
      role: "organizer",
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/settings/family"],
      ["/people"],
      ["/family"],
      ["/people/30000000-0000-4000-8000-000000000002"],
    ]);
  });

  it.each([
    [{ membershipId: organizerMembershipId, role: "member" }],
    [{ membershipId: otherMembershipId, role: "owner" }],
    [{ membershipId: "not-a-uuid", role: "organizer" }],
  ])("rejects malformed or self role input %#", async (input) => {
    await expect(setFamilyMembershipRoleAction(input)).resolves.toEqual({
      ok: false,
      message: "That role change was not allowed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("maps the last-organizer role invariant without refreshing", async () => {
    mocks.membershipMaybeSingle.mockResolvedValueOnce({
      data: {
        id: otherMembershipId,
        person_id: "30000000-0000-4000-8000-000000000002",
        role: "organizer",
      },
      error: null,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "23514", message: "last organizer" },
    });
    await expect(
      setFamilyMembershipRoleAction({
        membershipId: otherMembershipId,
        role: "member",
      }),
    ).resolves.toEqual({
      ok: false,
      message: "This circle must keep at least one organizer.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("reconciles a repeated role request without calling the mutation RPC", async () => {
    await expect(
      setFamilyMembershipRoleAction({
        membershipId: otherMembershipId,
        role: "member",
      }),
    ).resolves.toEqual({
      ok: true,
      message: "That person is already a family member.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/settings/family"],
      ["/people"],
      ["/family"],
      ["/people/30000000-0000-4000-8000-000000000002"],
    ]);
  });

  it("rejects a role target outside the active circle before mutation", async () => {
    mocks.membershipMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    await expect(
      setFamilyMembershipRoleAction({
        membershipId: otherMembershipId,
        role: "organizer",
      }),
    ).resolves.toEqual({
      ok: false,
      message: "That role change was not allowed.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reconciles an already-revoked same-circle membership after a lost response", async () => {
    mocks.membershipMaybeSingle.mockResolvedValueOnce({
      data: {
        id: otherMembershipId,
        person_id: "30000000-0000-4000-8000-000000000002",
        status: "revoked",
      },
      error: null,
    });

    await expect(
      revokeFamilyMembershipAction({ membershipId: otherMembershipId }),
    ).resolves.toEqual({
      ok: true,
      message: "Family access was already removed.",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/settings/family"],
      ["/people"],
      ["/family"],
      ["/people/30000000-0000-4000-8000-000000000002"],
    ]);
  });

  it("assigns journal care only after same-circle profile and membership preflights", async () => {
    await expect(
      setManagedProfileGuardianAction({
        managedPersonId,
        guardianMembershipId: otherMembershipId,
        grantAccess: true,
      }),
    ).resolves.toEqual({
      ok: true,
      message: "Journal guardian assigned.",
    });
    expect(mocks.from).toHaveBeenCalledWith("people");
    expect(mocks.from).toHaveBeenCalledWith("circle_memberships");
    expect(mocks.rpc).toHaveBeenCalledWith("set_person_guardian", {
      managed_person_id: managedPersonId,
      guardian_membership_id: otherMembershipId,
      grant_access: true,
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/settings/family"],
      ["/people"],
      ["/family"],
      [`/people/${managedPersonId}`],
    ]);
  });

  it.each([
    [{ managedPersonId, guardianMembershipId: otherMembershipId }],
    [
      {
        managedPersonId,
        guardianMembershipId: "not-a-uuid",
        grantAccess: true,
      },
    ],
    [
      {
        managedPersonId: "not-a-uuid",
        guardianMembershipId: otherMembershipId,
        grantAccess: false,
      },
    ],
  ])("rejects malformed journal care input %#", async (input) => {
    await expect(setManagedProfileGuardianAction(input)).resolves.toEqual({
      ok: false,
      message: "That journal care change was not allowed.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps journal care RPC failures generic and recoverable", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "wrong circle" },
    });
    await expect(
      setManagedProfileGuardianAction({
        managedPersonId,
        guardianMembershipId: otherMembershipId,
        grantAccess: false,
      }),
    ).resolves.toEqual({
      ok: false,
      message: "That journal care could not be changed. Try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it.each([
    ["managed journal", 1],
    ["guardian membership", 2],
  ])(
    "rejects an out-of-circle %s before journal-care mutation",
    async (_label, missingResult) => {
      if (missingResult === 1) {
        mocks.membershipMaybeSingle
          .mockResolvedValueOnce({ data: null, error: null })
          .mockResolvedValueOnce({
            data: { id: otherMembershipId },
            error: null,
          });
      } else {
        mocks.membershipMaybeSingle
          .mockResolvedValueOnce({ data: { id: managedPersonId }, error: null })
          .mockResolvedValueOnce({ data: null, error: null });
      }

      await expect(
        setManagedProfileGuardianAction({
          managedPersonId,
          guardianMembershipId: otherMembershipId,
          grantAccess: true,
        }),
      ).resolves.toEqual({
        ok: false,
        message: "That journal care change was not allowed.",
      });
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
});
