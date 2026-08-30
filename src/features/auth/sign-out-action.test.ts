// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getHeaders: vi.fn(),
  expireAuthCookies: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.getHeaders }));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/auth/session-cookies.server", () => ({
  expireOurDaysAuthCookies: mocks.expireAuthCookies,
}));

import { signOutCurrentDevice } from "./sign-out-action";

describe("local sign out", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    mocks.getHeaders.mockResolvedValue(
      new Headers({ origin: "https://journal.example.com" }),
    );
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.expireAuthCookies.mockResolvedValue(undefined);
    mocks.createClient.mockResolvedValue({
      auth: { signOut: mocks.signOut },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("clears only this device before returning to sign in", async () => {
    await expect(signOutCurrentDevice()).resolves.toEqual({ ok: true });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("fails a cross-origin mutation closed before touching Auth", async () => {
    mocks.getHeaders.mockResolvedValueOnce(
      new Headers({ origin: "https://attacker.example" }),
    );

    await expect(signOutCurrentDevice()).resolves.toEqual({
      ok: false,
      message: "Sign out could not be verified.",
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("uses direct cookie expiry when Supabase sign-out reports an error", async () => {
    mocks.signOut.mockResolvedValueOnce({ error: new Error("offline") });
    await expect(signOutCurrentDevice()).resolves.toEqual({ ok: true });
    expect(mocks.expireAuthCookies).toHaveBeenCalled();
  });

  it("does not claim success when the Auth cookie fallback also fails", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("offline"));
    mocks.expireAuthCookies.mockRejectedValueOnce(new Error("cookie failed"));
    await expect(signOutCurrentDevice()).resolves.toMatchObject({ ok: false });
  });
});
