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
  });
});
