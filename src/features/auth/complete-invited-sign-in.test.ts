// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  acceptPending: vi.fn(),
  getUser: vi.fn(),
  select: vi.fn(),
  limit: vi.fn(),
  signOut: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createOurDaysServerClient: mocks.createClient,
}));
vi.mock("@/lib/auth/accept-pending-invitation.server", () => ({
  acceptPendingInvitationForSession: mocks.acceptPending,
}));

import { completeInvitedSignIn } from "./complete-invited-sign-in";

describe("completeInvitedSignIn", () => {
  beforeEach(() => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-one" } },
      error: null,
    });
    mocks.limit.mockResolvedValue({ data: [], error: null });
    mocks.select.mockReturnValue({ limit: mocks.limit });
    mocks.acceptPending.mockResolvedValue(true);
    mocks.signOut.mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: { getUser: mocks.getUser, signOut: mocks.signOut },
      from: vi.fn(() => ({ select: mocks.select })),
    });
  });

  it("accepts a pending invitation and opens the journal", async () => {
    await expect(completeInvitedSignIn()).rejects.toThrow("REDIRECT:/family");
    expect(mocks.acceptPending).toHaveBeenCalledOnce();
  });

  it("keeps a signed-in member without a pending invite", async () => {
    mocks.limit.mockResolvedValueOnce({
      data: [{ circle_id: "circle-a" }],
      error: null,
    });
    await expect(completeInvitedSignIn()).rejects.toThrow("REDIRECT:/family");
    expect(mocks.acceptPending).not.toHaveBeenCalled();
  });

  it("rejects a missing session", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(completeInvitedSignIn()).rejects.toThrow(
      "REDIRECT:/sign-in?link=invalid",
    );
  });
});
