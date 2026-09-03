// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  signOut: vi.fn(),
  acceptPending: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/auth/accept-pending-invitation.server", () => ({
  acceptPendingInvitationForSession: mocks.acceptPending,
}));

import { GET } from "./route";

describe("magic-link callback", () => {
  beforeEach(() => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.verifyOtp.mockResolvedValue({ error: null });
    mocks.limit.mockResolvedValue({
      data: [{ circle_id: "circle-a" }],
      error: null,
    });
    mocks.select.mockReturnValue({ limit: mocks.limit });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.acceptPending.mockResolvedValue(false);
    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        verifyOtp: mocks.verifyOtp,
        signOut: mocks.signOut,
      },
      from: vi.fn(() => ({ select: mocks.select })),
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("exchanges one auth code, checks membership, and opens the journal", async () => {
    const response = await GET(
      new Request("https://journal.example.com/auth/callback?code=one-time"),
    );

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("one-time");
    expect(mocks.select).toHaveBeenCalledWith("circle_id");
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/family",
    );
  });

  it("rejects a missing or invalid one-time code", async () => {
    const missing = await GET(
      new Request("https://journal.example.com/auth/callback"),
    );
    expect(missing.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?link=invalid",
    );

    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      error: new Error("expired"),
    });
    const invalid = await GET(
      new Request("https://journal.example.com/auth/callback?code=expired"),
    );
    expect(invalid.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?link=invalid",
    );
  });

  it("redeems an emailed token hash without a PKCE verifier", async () => {
    const response = await GET(
      new Request(
        "https://journal.example.com/auth/callback?token_hash=hashed-token&type=magiclink",
      ),
    );

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "hashed-token",
      type: "magiclink",
    });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/family",
    );
  });

  it("opens the journal after an invited account accepts a pending invitation", async () => {
    mocks.limit.mockResolvedValueOnce({ data: [], error: null });
    mocks.acceptPending.mockResolvedValueOnce(true);

    const response = await GET(
      new Request("https://journal.example.com/auth/callback?code=one-time"),
    );

    expect(mocks.acceptPending).toHaveBeenCalledOnce();
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/family",
    );
  });

  it("keeps an authenticated non-member outside the family timeline", async () => {
    mocks.limit.mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(
      new Request("https://journal.example.com/auth/callback?code=one-time"),
    );

    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/access-unavailable",
    );
  });

  it("clears the local session when membership verification fails", async () => {
    mocks.limit.mockResolvedValueOnce({
      data: null,
      error: new Error("database unavailable"),
    });

    const response = await GET(
      new Request("https://journal.example.com/auth/callback?code=one-time"),
    );

    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?link=unavailable",
    );
  });
});
