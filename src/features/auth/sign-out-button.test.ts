// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

const mocks = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("./sign-out-action", () => ({
  signOutCurrentDevice: mocks.signOut,
}));

import { purgeOurDaysBrowserState } from "@/lib/auth/browser-private-state";
import { SignOutButton } from "./sign-out-button";

describe("account-scoped browser cleanup", () => {
  const deleteCache = vi.fn();
  const deleteDatabase = vi.fn();

  beforeEach(() => {
    window.localStorage.setItem("our-days:draft", "private");
    window.localStorage.setItem("proof:draft", "unrelated");
    window.sessionStorage.setItem("our_days:selected-circle", "private");
    window.sessionStorage.setItem("unrelated", "keep");
    vi.stubGlobal("caches", {
      delete: deleteCache.mockResolvedValue(true),
      keys: vi.fn().mockResolvedValue(["our-days:media", "proof:assets"]),
    });
    vi.stubGlobal("indexedDB", {
      databases: vi
        .fn()
        .mockResolvedValue([{ name: "our-days:drafts" }, { name: "proof-db" }]),
      deleteDatabase: deleteDatabase.mockImplementation(() => {
        const request = new EventTarget();
        queueMicrotask(() => request.dispatchEvent(new Event("success")));
        return request;
      }),
    });
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("removes only Our Days private state from browser stores", async () => {
    const cleared = vi.fn();
    window.addEventListener("our-days:clear-private-state", cleared, {
      once: true,
    });

    await expect(purgeOurDaysBrowserState()).resolves.toBe(true);

    expect(window.localStorage.getItem("our-days:draft")).toBeNull();
    expect(window.localStorage.getItem("proof:draft")).toBe("unrelated");
    expect(
      window.sessionStorage.getItem("our_days:selected-circle"),
    ).toBeNull();
    expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
    expect(deleteCache).toHaveBeenCalledExactlyOnceWith("our-days:media");
    expect(deleteDatabase).toHaveBeenCalledExactlyOnceWith("our-days:drafts");
    expect(cleared).toHaveBeenCalledOnce();
  });

  it("reports a blocked private IndexedDB deletion instead of claiming success", async () => {
    deleteDatabase.mockImplementationOnce(() => {
      const request = new EventTarget();
      queueMicrotask(() => request.dispatchEvent(new Event("blocked")));
      return request;
    });

    await expect(purgeOurDaysBrowserState()).resolves.toBe(false);
  });

  it("keeps the user in place and surfaces a retry when sign-out fails", async () => {
    mocks.signOut.mockResolvedValueOnce({
      ok: false,
      message: "We could not sign out this device. Please try again.",
    });
    render(createElement(SignOutButton));

    await userEvent.click(
      screen.getByRole("button", { name: "Sign out and use another email" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not sign out this device. Please try again.",
    );
  });
});
