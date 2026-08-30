// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getHeaders: vi.fn(),
  getClaims: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  rpc: vi.fn(),
  clearIntent: vi.fn(),
  expireAuthCookies: vi.fn(),
  readIntent: vi.fn(),
  writeIntent: vi.fn(),
  signOut: vi.fn(),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
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
  requestInviteCode,
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
    mocks.rpc.mockResolvedValue({ data: "membership-a", error: null });
    mocks.readIntent.mockResolvedValue(validToken);
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.expireAuthCookies.mockResolvedValue(undefined);
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        signInWithOtp: mocks.signInWithOtp,
        getClaims: mocks.getClaims,
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

  it("requests a code without allowing the browser to create an account", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(
      requestInviteCode(
        initialInviteActionState,
        form({ email: " INVITED@EXAMPLE.COM " }),
      ),
    ).resolves.toMatchObject({ status: "sent" });

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "invited@example.com",
      options: { shouldCreateUser: false },
    });
    expect(mocks.rpc).toHaveBeenCalledWith("preflight_invitation", {
      email: "invited@example.com",
      token: validToken,
    });
  });

  it("stages a valid fragment in the server-only intent", async () => {
    await expect(stageInvitationIntent(validToken)).resolves.toEqual({
      ready: true,
    });
    expect(mocks.writeIntent).toHaveBeenCalledWith(validToken);
  });

  it("clears a different current account before emailing a matched invite", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    mocks.getClaims.mockResolvedValueOnce({
      data: { claims: { sub: "current-user" } },
      error: null,
    });

    await expect(
      requestInviteCode(
        initialInviteActionState,
        form({ email: "invited@example.com" }),
      ),
    ).resolves.toMatchObject({ clearBrowserState: true, status: "sent" });

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.signOut.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.signInWithOtp.mock.invocationCallOrder[0],
    );
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
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "invited@example.com",
      token: "123456",
      type: "email",
    });
    expect(mocks.rpc).toHaveBeenCalledWith("accept_invitation", {
      token: validToken,
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/family");
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

  it("expires Auth cookies when a thrown acceptance cannot sign out through Auth", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("network failed"));
    mocks.signOut.mockRejectedValueOnce(new Error("network failed"));

    await expect(
      verifyAndAcceptInvitation(
        initialInviteActionState,
        form({ code: "123456", email: "invited@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "unavailable" });

    expect(mocks.expireAuthCookies).toHaveBeenCalledOnce();
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
      requestInviteCode(
        initialInviteActionState,
        form({ email: "invited@example.com" }),
      ),
    ).resolves.toMatchObject({ status: "denied" });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
