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

import { expireOurDaysAuthCookies } from "./session-cookies.server";

describe("Our Days Auth cookie fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
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
