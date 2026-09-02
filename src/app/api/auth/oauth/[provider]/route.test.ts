// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import { GET } from "./route";

describe("OAuth start route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.signInWithOAuth.mockResolvedValue({
      data: { url: "https://accounts.google.com/hosted" },
      error: null,
    });
    mocks.createClient.mockResolvedValue({
      auth: { signInWithOAuth: mocks.signInWithOAuth },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends a local journal Google start to the first-party authorize URL", async () => {
    vi.stubEnv("OUR_DAYS_ENVIRONMENT", "local");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "detached");
    vi.stubEnv("OUR_DAYS_LOCAL_JOURNAL_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_ENABLE_DESIGN_PREVIEW", "false");
    vi.stubEnv(
      "OUR_DAYS_GOOGLE_CLIENT_ID",
      "google-id.apps.googleusercontent.com",
    );
    vi.stubEnv("OUR_DAYS_GOOGLE_CLIENT_SECRET", "google-secret");

    const response = await GET(
      new Request("https://journal.example.com/api/auth/oauth/google"),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(response.headers.get("set-cookie")).toContain(
      "our-days-oauth-state=",
    );
    expect(response.headers.get("location")).toContain(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(response.headers.get("location")).toContain(
      "client_id=google-id.apps.googleusercontent.com",
    );
  });

  it("keeps unconfigured local OAuth on the invitation gate", async () => {
    vi.stubEnv("OUR_DAYS_ENVIRONMENT", "local");
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "detached");
    vi.stubEnv("OUR_DAYS_LOCAL_JOURNAL_MODE", "enabled");
    vi.stubEnv("OUR_DAYS_ENABLE_DESIGN_PREVIEW", "false");

    const response = await GET(
      new Request("https://journal.example.com/api/auth/oauth/x"),
      { params: Promise.resolve({ provider: "x" }) },
    );

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("location")).toBe(
      "https://journal.example.com/sign-in?oauth=unavailable",
    );
  });

  it("starts hosted Google through Supabase Auth and the existing callback", async () => {
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");

    const response = await GET(
      new Request("https://journal.example.com/api/auth/oauth/google"),
      { params: Promise.resolve({ provider: "google" }) },
    );

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://journal.example.com/auth/callback",
        skipBrowserRedirect: true,
        queryParams: { prompt: "select_account" },
      },
    });
    expect(response.headers.get("location")).toBe(
      "https://accounts.google.com/hosted",
    );
  });

  it("maps X to the Twitter Supabase provider", async () => {
    vi.stubEnv("OUR_DAYS_RESOURCE_MODE", "supabase");
    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { url: "https://twitter.com/i/oauth2/authorize" },
      error: null,
    });

    const response = await GET(
      new Request("https://journal.example.com/api/auth/oauth/x"),
      { params: Promise.resolve({ provider: "x" }) },
    );

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "twitter",
      options: {
        redirectTo: "https://journal.example.com/auth/callback",
        skipBrowserRedirect: true,
        queryParams: undefined,
      },
    });
    expect(response.headers.get("location")).toBe(
      "https://twitter.com/i/oauth2/authorize",
    );
  });
});
