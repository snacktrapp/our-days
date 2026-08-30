// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.get, set: mocks.set })),
}));

import {
  clearInvitationIntent,
  readInvitationIntent,
  writeInvitationIntent,
} from "./invitation-intent.server";

describe("server-only invitation intent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("uses a short-lived HttpOnly same-origin cookie", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://journal.example.com");
    await writeInvitationIntent("private-token");

    expect(mocks.set).toHaveBeenCalledWith(
      "our-days-invitation-intent",
      "private-token",
      {
        httpOnly: true,
        maxAge: 600,
        path: "/invite",
        sameSite: "strict",
        secure: true,
      },
    );
  });

  it("reads and expires only the invitation intent cookie", async () => {
    mocks.get.mockReturnValueOnce({ value: "private-token" });
    await expect(readInvitationIntent()).resolves.toBe("private-token");

    await clearInvitationIntent();
    expect(mocks.set).toHaveBeenLastCalledWith(
      "our-days-invitation-intent",
      "",
      expect.objectContaining({ maxAge: 0, path: "/invite" }),
    );
  });
});
