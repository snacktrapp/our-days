// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  purgeState: vi.fn(),
  stageIntent: vi.fn(),
  verifyInvite: vi.fn(),
}));

vi.mock("./invite-actions", () => ({
  stageInvitationIntent: mocks.stageIntent,
  verifyAndAcceptInvitation: mocks.verifyInvite,
}));
vi.mock("@/lib/auth/browser-private-state", () => ({
  purgeOurDaysBrowserState: mocks.purgeState,
}));

import { InviteEntry } from "./invite-entry";

describe("invitation entry recovery", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.clearAllMocks();
  });

  it("asks for the admin invitation code directly without a legacy resend step", async () => {
    mocks.purgeState.mockResolvedValueOnce(true);
    window.history.replaceState(null, "", "/invite");
    render(createElement(InviteEntry, { hasStagedIntent: true }));

    expect(
      await screen.findByText(/organizer sent two private emails/iu),
    ).toBeVisible();
    expect(screen.getByLabelText("Email address")).toBeVisible();
    expect(screen.getByLabelText("Six-digit invitation code")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Join family journal" }),
    ).toBeEnabled();
    expect(screen.queryByText("Email me a code")).not.toBeInTheDocument();
  });

  it("turns a bare invite route into actionable incomplete-link guidance", async () => {
    window.history.replaceState(null, "", "/invite");
    render(createElement(InviteEntry));

    expect(
      await screen.findByText(/This invitation link is incomplete/u),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Sign in as a returning member" }),
    ).toHaveAttribute("href", "/sign-in");
  });

  it("fails a rejected staging action into recovery without retaining the fragment", async () => {
    const token = "a".repeat(43);
    window.history.replaceState(null, "", `/invite#${token}`);
    mocks.stageIntent.mockRejectedValueOnce(new Error("offline"));
    render(createElement(InviteEntry));

    expect(
      await screen.findByText(/This invitation link is incomplete/u),
    ).toBeVisible();
    await waitFor(() => expect(window.location.hash).toBe(""));
  });
});
