// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { acceptPendingInvitationForSession } from "./accept-pending-invitation.server";

describe("accept pending invitation for the current session", () => {
  it("treats a membership UUID as a successful acceptance", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: "40000000-0000-4000-8000-000000000099",
      error: null,
    });

    await expect(
      acceptPendingInvitationForSession({ rpc } as never),
    ).resolves.toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "accept_pending_invitation_for_current_user",
    );
  });

  it("does not open a journal when no pending invitation matches", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    await expect(
      acceptPendingInvitationForSession({ rpc } as never),
    ).resolves.toBe(false);
  });
});
