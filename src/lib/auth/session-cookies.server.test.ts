// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  readConfig: vi.fn(),
  set: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ getAll: mocks.getAll, set: mocks.set })),
}));
vi.mock("@/lib/supabase/public-config", () => ({
  readSupabasePublicConfig: mocks.readConfig,
}));

import {
  expireOurDaysAuthCookies,
  hasOurDaysAuthSessionCookie,
} from "./session-cookies.server";

describe("Our Days Auth cookie fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("recognizes this project's Supabase auth cookies", async () => {
    mocks.readConfig.mockReturnValue({
      publishableKey: "test",
      url: "https://ourdaysref.supabase.co",
    });
    mocks.getAll.mockReturnValue([
      { name: "sb-proofref-auth-token.0", value: "other" },
      { name: "sb-ourdaysref-auth-token.0", value: "private" },
    ]);

    await expect(hasOurDaysAuthSessionCookie()).resolves.toBe(true);
  });

  it("ignores empty and unrelated cookie chunks", async () => {
    mocks.readConfig.mockReturnValue({
      publishableKey: "test",
      url: "https://ourdaysref.supabase.co",
    });
    mocks.getAll.mockReturnValue([
      { name: "sb-ourdaysref-auth-token.0", value: "   " },
      { name: "sb-proofref-auth-token.0", value: "unrelated" },
    ]);

    await expect(hasOurDaysAuthSessionCookie()).resolves.toBe(false);
  });

  it("expires every chunk for this Supabase project and preserves unrelated apps", async () => {
    mocks.readConfig.mockReturnValue({
      publishableKey: "test",
      url: "https://ourdaysref.supabase.co",
    });
    mocks.getAll.mockReturnValue([
      { name: "sb-ourdaysref-auth-token.0", value: "private" },
      { name: "sb-ourdaysref-auth-token.1", value: "private" },
      { name: "sb-proofref-auth-token.0", value: "unrelated" },
    ]);

    await expireOurDaysAuthCookies();

    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.set).toHaveBeenCalledWith(
      "sb-ourdaysref-auth-token.0",
      "",
      expect.objectContaining({ httpOnly: true, maxAge: 0, path: "/" }),
    );
    expect(mocks.set).not.toHaveBeenCalledWith(
      "sb-proofref-auth-token.0",
      expect.anything(),
      expect.anything(),
    );
  });
});
