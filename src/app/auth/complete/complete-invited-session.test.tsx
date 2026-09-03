import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setSession: vi.fn(),
  getSession: vi.fn(),
  completeInvitedSignIn: vi.fn(),
}));

vi.mock("@/lib/supabase/browser", () => ({
  createOurDaysBrowserClient: () => ({
    auth: {
      setSession: mocks.setSession,
      getSession: mocks.getSession,
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
});
