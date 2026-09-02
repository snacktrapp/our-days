// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readOAuthState: vi.fn(),
  expireOAuthState: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  createLocalJournalSession: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/oauth-state", () => ({
  readOAuthState: mocks.readOAuthState,
  expireOAuthState: mocks.expireOAuthState,
}));
vi.mock("@/lib/auth/oauth-protocol", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/oauth-protocol")>(
    "@/lib/auth/oauth-protocol",
  );
  return {
    ...actual,
    exchangeAuthorizationCode: mocks.exchangeAuthorizationCode,
  };
});
vi.mock("@/lib/local-journal/auth", () => ({
  createLocalJournalSession: mocks.createLocalJournalSession,
}));

import { OAuthIdentityError } from "@/lib/auth/oauth-protocol";
import { GET } from "./route";

describe("first-party OAuth callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    vi.stubEnv("OUR_DAYS_ENVIRONMENT", "local");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "detached");
    vi.stubEnv("OUR_DAYS_LOCAL_JOURNAL_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_ENABLE_DESIGN_PREVIEW", "false");
    vi.stubEnv("OUR_DAYS_GOOGLE_CLIENT_ID", "google-id");
    vi.stubEnv("OUR_DAYS_GOOGLE_CLIENT_SECRET", "google-secret");
    mocks.readOAuthState.mockResolvedValue({
      v: 1,
      provider: "google",
      verifier: "verifier",
      nonce: "nonce-1",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    mocks.expireOAuthState.mockResolvedValue(undefined);
    mocks.exchangeAuthorizationCode.mockResolvedValue("family@example.com");
    mocks.createLocalJournalSession.mockResolvedValue({
      membershipId: "membership-1",
      circleId: "circle-1",
      personId: "person-1",
      role: "organizer",
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("opens the journal only after an invited email is returned", async () => {
    const response = await GET(
      new Request(
        "https://journal.example.com/api/auth/oauth/callback?code=one-time&state=nonce-1",
      ),
    );

    expect(mocks.exchangeAuthorizationCode).toHaveBeenCalled();
    expect(mocks.createLocalJournalSession).toHaveBeenCalledWith(
      "family@example.com",
    );
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/family",
    );
  });

  it("does not open a family journal for an uninvited Google or X identity", async () => {
    mocks.exchangeAuthorizationCode.mockResolvedValueOnce(
      "stranger@example.com",
    );
    mocks.createLocalJournalSession.mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        "https://journal.example.com/api/auth/oauth/callback?code=one-time&state=nonce-1",
      ),
    );

    expect(mocks.createLocalJournalSession).toHaveBeenCalledWith(
      "stranger@example.com",
    );
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?oauth=no-access",
    );
  });

  it("rejects a missing or mismatched state before exchanging the code", async () => {
    mocks.readOAuthState.mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        "https://journal.example.com/api/auth/oauth/callback?code=one-time&state=nonce-1",
      ),
    );

    expect(mocks.exchangeAuthorizationCode).not.toHaveBeenCalled();
    expect(mocks.createLocalJournalSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?oauth=invalid",
    );
  });

  it("reports a provider identity that shares no email", async () => {
    mocks.exchangeAuthorizationCode.mockRejectedValueOnce(
      new OAuthIdentityError("no-email", "X did not share an email."),
    );

    const response = await GET(
      new Request(
        "https://journal.example.com/api/auth/oauth/callback?code=one-time&state=nonce-1",
      ),
    );

    expect(mocks.createLocalJournalSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?oauth=no-email",
    );
  });
});
