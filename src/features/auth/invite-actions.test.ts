// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getHeaders: vi.fn(),
  rpc: vi.fn(),
  clearIntent: vi.fn(),
  expireAuthCookies: vi.fn(),
  readIntent: vi.fn(),
  writeIntent: vi.fn(),
  signOut: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/auth/invitation-intent.server", () => ({
  clearInvitationIntent: mocks.clearIntent,
  readInvitationIntent: mocks.readIntent,
  writeInvitationIntent: mocks.writeIntent,
}));
vi.mock("@/lib/auth/session-cookies.server", () => ({
  expireOurDaysAuthCookies: mocks.expireAuthCookies,
}));

import {
  stageInvitationIntent,
  verifyAndAcceptInvitation,
} from "./invite-actions";

const initialInviteActionState = { status: "idle" } as const;
const validToken = "a".repeat(43);

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("invitation acceptance actions", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.rpc.mockResolvedValue({
      data: "40000000-0000-4000-8000-000000000071",
      error: null,
    });
    mocks.readIntent.mockResolvedValue(validToken);
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.expireAuthCookies.mockResolvedValue(undefined);
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        signOut: mocks.signOut,
        verifyOtp: mocks.verifyOtp,
      },
      rpc: mocks.rpc,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("stages a valid fragment in the server-only intent", async () => {
    await expect(stageInvitationIntent(validToken)).resolves.toEqual({
      ready: true,
    });
    expect(mocks.writeIntent).toHaveBeenCalledWith(validToken);
  });

  it("verifies identity before atomically consuming the matching invite", async () => {
    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({
          code: "123456",
          email: "invited@example.com",
        }),
      ),
    ).resolves.toEqual({
      status: "accepted",
      email: "invited@example.com",
    });

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "invited@example.com",
      token: "123456",
      type: "invite",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("accept_invitation", {
      token: validToken,
    });
    expect(mocks.clearIntent).toHaveBeenCalledOnce();
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.verifyOtp.mock.invocationCallOrder[0],
    );
  });

  it("accepts a no-create sign-in code for an existing confirmed account", async () => {
    mocks.verifyOtp
      .mockResolvedValueOnce({ error: { code: "otp_expired" } })
      .mockResolvedValueOnce({ error: null });

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({ code: "654321", email: "returning@example.com" }),
      ),
    ).resolves.toMatchObject({
      status: "accepted",
      email: "returning@example.com",
    });

    expect(mocks.verifyOtp).toHaveBeenNthCalledWith(1, {
      email: "returning@example.com",
      token: "654321",
      type: "invite",
    });
    expect(mocks.verifyOtp).toHaveBeenNthCalledWith(2, {
      email: "returning@example.com",
      token: "654321",
      type: "email",
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it("does not consume the family invitation when both Auth code types fail", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({ code: "654321", email: "invited@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "denied" });

    expect(mocks.verifyOtp).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("does not call Auth with a malformed secret or code", async () => {
    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({
          code: "12345",
          email: "invited@example.com",
        }),
      ),
    ).resolves.toMatchObject({ status: "invalid" });

    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("keeps a wrong, expired, revoked, or replayed invite indistinguishable", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "Invitation is not available" },
    });

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({
          code: "123456",
          email: "invited@example.com",
        }),
      ),
    ).resolves.toEqual({
      status: "denied",
      email: "invited@example.com",
      message: "This invitation or code is no longer available.",
    });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.expireAuthCookies).toHaveBeenCalled();
    expect(mocks.clearIntent).toHaveBeenCalled();
  });

  it.each([null, "membership-a", {}, []])(
    "rejects a non-membership acceptance result %j and clears the new session",
    async (data) => {
      mocks.rpc.mockResolvedValueOnce({ data, error: null });

      await expect(
        verifyAndAcceptInvitation(
          initialInviteActionState,
          form({ code: "123456", email: "invited@example.com" }),
        ),
      ).resolves.toMatchObject({ status: "denied" });

      expect(mocks.signOut).toHaveBeenCalledTimes(2);
      expect(mocks.clearIntent).toHaveBeenCalledOnce();
    },
  );

  it("expires Auth cookies when a thrown acceptance cannot sign out through Auth", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("network failed"));
    mocks.signOut.mockRejectedValueOnce(new Error("network failed"));

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({ code: "123456", email: "invited@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "unavailable" });

    expect(mocks.expireAuthCookies).toHaveBeenCalledTimes(2);
  });

  it("gives explicit safety recovery if both cleanup mechanisms fail", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("network failed"));
    mocks.expireAuthCookies.mockRejectedValueOnce(new Error("cookie failed"));

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({ code: "123456", email: "invited@example.com" }),
      ),
    ).resolves.toEqual({
      status: "unavailable",
      email: "invited@example.com",
      message: "For safety, clear this site's browser data before continuing.",
    });
  });

  it("fails cross-origin invite mutations before touching Auth", async () => {
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://attacker.example" }),
    );

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({ code: "123456", email: "invited@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "denied" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
