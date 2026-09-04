import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setSession: vi.fn(),
  getSession: vi.fn(),
  verifyOtp: vi.fn(),
  completeInvitedSignIn: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createOurDaysInviteCompletionClient: () => ({
    auth: {
      setSession: mocks.setSession,
      getSession: mocks.getSession,
      verifyOtp: mocks.verifyOtp,
    },
  }),
}));
vi.mock("@/features/auth/complete-invited-sign-in", () => ({
  completeInvitedSignIn: mocks.completeInvitedSignIn,
}));

import { CompleteInvitedSession } from "./complete-invited-session";

describe("CompleteInvitedSession", () => {
  afterEach(() => {
    window.location.hash = "";
    window.history.replaceState(window.history.state, "", "/auth/complete");
    vi.clearAllMocks();
  });

  it("stores implicit tokens from the hash and finishes sign-in", async () => {
    mocks.setSession.mockResolvedValue({ error: null });
    window.location.hash = "#access_token=access&refresh_token=refresh";
    render(<CompleteInvitedSession />);

    await waitFor(() =>
      expect(mocks.setSession).toHaveBeenCalledWith({
        access_token: "access",
        refresh_token: "refresh",
      }),
    );
    expect(mocks.completeInvitedSignIn).toHaveBeenCalledOnce();
  });

  it("redeems an emailed token hash without a PKCE verifier", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: null });
    window.history.replaceState(
      window.history.state,
      "",
      "/auth/complete?token_hash=hashed-token&type=magiclink",
    );
    render(<CompleteInvitedSession />);

    await waitFor(() =>
      expect(mocks.verifyOtp).toHaveBeenCalledWith({
        token_hash: "hashed-token",
        type: "magiclink",
      }),
    );
    expect(mocks.completeInvitedSignIn).toHaveBeenCalledOnce();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("rejects an implicit error hash without storing a session", async () => {
    const replace = vi.fn();
    vi.stubGlobal("location", {
      ...window.location,
      hash: "#error=access_denied&error_description=expired",
      replace,
    });
    render(<CompleteInvitedSession />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("/sign-in?link=invalid"),
    );
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.completeInvitedSignIn).not.toHaveBeenCalled();
  });
});
