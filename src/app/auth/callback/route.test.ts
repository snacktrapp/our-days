// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));

import { GET } from "./route";

describe("magic-link callback", () => {
  beforeEach(() => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    mocks.limit.mockResolvedValue({
      data: [{ circle_id: "circle-a" }],
      error: null,
    });
    mocks.select.mockReturnValue({ limit: mocks.limit });
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession: mocks.exchangeCodeForSession,
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
