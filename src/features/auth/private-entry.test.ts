// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  purge: vi.fn(),
  requestCode: vi.fn(),
  verifyCode: vi.fn(),
}));

vi.mock("@/lib/auth/browser-private-state", () => ({
  purgeOurDaysBrowserState: mocks.purge,
}));
vi.mock("./sign-in-actions", () => ({
  requestSignInLink: mocks.requestCode,
  verifySignInCode: mocks.verifyCode,
}));

import { PrivateEntry } from "./private-entry";

describe("sign-in cleanup gate", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not expose account entry while private IndexedDB remains blocked", async () => {
    mocks.purge.mockResolvedValueOnce(false);
    render(
      createElement(PrivateEntry, {
        cleanupIncomplete: true,
        connected: true,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Private browser data is still open in another Our Days tab.",
    );
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Sign in with Google" }),
    ).not.toBeInTheDocument();
  });

  it("shows Google and X first, with the email magic link as backup", () => {
    render(createElement(PrivateEntry, { connected: true }));

    expect(screen.getByText("Our Days")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Open your family journal." }),
    ).toBeVisible();
    const google = screen.getByRole("link", { name: "Sign in with Google" });
    const x = screen.getByRole("link", { name: "Sign in with X" });
    expect(google).toBeVisible();
    expect(google).toHaveAttribute("href", "/api/auth/oauth/google");
    expect(x).toBeVisible();
    expect(x).toHaveAttribute("href", "/api/auth/oauth/x");
    expect(google.closest("form")).toBeNull();
    expect(x.closest("form")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    ).toBeVisible();
    expect(
      screen.getByText("Use the Google or X account your family invited."),
    ).toBeVisible();
    expect(screen.getByText("Or email a private sign-in link")).toBeVisible();
  });

  it("keeps Google and X off the locked invitation-only gate", () => {
    render(createElement(PrivateEntry));

    expect(
      screen.queryByRole("link", { name: "Sign in with Google" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Our Days is invitation only." }),
    ).toBeVisible();
  });
});
