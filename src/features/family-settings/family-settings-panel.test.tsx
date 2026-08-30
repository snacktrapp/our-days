import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FamilySettingsPanel } from "./family-settings-panel";

const model = {
  intro: "A small, invitation-only circle.",
  currentMemberId: "current",
  members: [
    {
      id: "current",
      name: "Current person",
      initial: "C",
      accent: "teal",
      relationshipLabel: "Co-organizer",
      accessLabel: "Account · Can sign in",
      canPreviewRemoval: false,
    },
    {
      id: "other",
      name: "Other organizer",
      initial: "O",
      accent: "clay",
      relationshipLabel: "Co-organizer",
      accessLabel: "Account · Can sign in",
      canPreviewRemoval: true,
    },
    {
      id: "child",
      name: "Child profile",
      initial: "C",
      accent: "ochre",
      relationshipLabel: "Child journal",
      accessLabel: "Managed profile · No sign-in",
      canPreviewRemoval: false,
    },
  ],
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("FamilySettingsPanel", () => {
  it("distinguishes account access from managed journal profiles", () => {
    render(<FamilySettingsPanel model={model} />);

    expect(screen.getAllByText("Account · Can sign in")).toHaveLength(2);
    expect(screen.getByText("Managed profile · No sign-in")).toBeVisible();
    expect(
      screen.getByText(/Managed profiles hold a child’s journal/u),
    ).toBeVisible();
    expect(
      screen.getByText(/no accounts or permissions are active/u),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: "Review access" }),
    ).toHaveLength(1);
  });

  it("validates, trims, previews, edits, and clears an invitation locally", async () => {
    const user = userEvent.setup();
    render(<FamilySettingsPanel model={model} />);
    const input = screen.getByRole("textbox", { name: "Email address" });

    await user.type(input, "not-an-email");
    await user.click(screen.getByRole("button", { name: "Review invitation" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a complete email address.",
    );
    expect(input).toHaveFocus();

    await user.clear(input);
    await user.type(input, "  relative@example.com  ");
    await user.click(screen.getByRole("button", { name: "Review invitation" }));
    const inviteHeading = screen.getByRole("heading", {
      name: "relative@example.com",
    });
    expect(inviteHeading).toBeVisible();
    expect(inviteHeading).toHaveFocus();
    expect(
      screen.getByText(/see its family moments, photos, notes, people/u),
    ).toBeVisible();
    expect(
      screen.getByText(/Our Days did not send email or create an invite/u),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /send/u })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    const restoredInput = screen.getByRole("textbox", {
      name: "Email address",
    });
    await waitFor(() => expect(restoredInput).toHaveFocus());
    expect(restoredInput).toHaveValue("relative@example.com");

    await user.click(screen.getByRole("button", { name: "Review invitation" }));
    await user.click(screen.getByRole("button", { name: "Clear preview" }));
    const clearedInput = screen.getByRole("textbox", {
      name: "Email address",
    });
    await waitFor(() => expect(clearedInput).toHaveFocus());
    expect(clearedInput).toHaveValue("");
  });

  it("renders adversarial invitation text literally without creating markup", async () => {
    const user = userEvent.setup();
    const { container } = render(<FamilySettingsPanel model={model} />);
    const candidate = "family+<script>@example.com";

    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      candidate,
    );
    await user.click(screen.getByRole("button", { name: "Review invitation" }));

    expect(screen.getByRole("heading", { name: candidate })).toBeVisible();
    expect(container.querySelector("script")).toBeNull();
  });

  it("only previews access consequences and performs no browser-side mutation", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    const socket = vi.fn();
    const indexedDbOpen = vi.fn();
    const indexedDbDelete = vi.fn();
    const cacheOpen = vi.fn();
    const cacheDelete = vi.fn();
    const cacheKeys = vi.fn();
    vi.stubGlobal("fetch", fetch);
    vi.stubGlobal("WebSocket", socket);
    vi.stubGlobal("indexedDB", {
      open: indexedDbOpen,
      deleteDatabase: indexedDbDelete,
    });
    vi.stubGlobal("caches", {
      open: cacheOpen,
      delete: cacheDelete,
      keys: cacheKeys,
    });
    const localStorageWrite = vi.spyOn(Storage.prototype, "setItem");
    const storageRemove = vi.spyOn(Storage.prototype, "removeItem");
    const storageClear = vi.spyOn(Storage.prototype, "clear");
    const historyWrite = vi.spyOn(history, "pushState");
    const historyReplace = vi.spyOn(history, "replaceState");
    const cookieWrite = vi.spyOn(Document.prototype, "cookie", "set");
    render(<FamilySettingsPanel model={model} />);

    await user.click(screen.getByRole("button", { name: "Review access" }));
    const reviewHeading = screen.getByRole("heading", {
      name: "Review Other organizer’s access",
    });
    expect(reviewHeading).toBeVisible();
    expect(reviewHeading).toHaveFocus();
    expect(
      screen.getByText(
        /Access removal does not delete their account or content/u,
      ),
    ).toBeVisible();
    expect(screen.queryByText(/organizer separately deletes/u)).toBeNull();
    expect(screen.getByText(/No access is changed/u)).toBeVisible();
    expect(screen.queryByRole("button", { name: /remove/u })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close review" }));
    expect(screen.getByRole("button", { name: "Review access" })).toHaveFocus();

    await user.type(
      screen.getByRole("textbox", { name: "Email address" }),
      "relative@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Review invitation" }));

    expect(fetch).not.toHaveBeenCalled();
    expect(socket).not.toHaveBeenCalled();
    expect(indexedDbOpen).not.toHaveBeenCalled();
    expect(indexedDbDelete).not.toHaveBeenCalled();
    expect(cacheOpen).not.toHaveBeenCalled();
    expect(cacheDelete).not.toHaveBeenCalled();
    expect(cacheKeys).not.toHaveBeenCalled();
    expect(localStorageWrite).not.toHaveBeenCalled();
    expect(storageRemove).not.toHaveBeenCalled();
    expect(storageClear).not.toHaveBeenCalled();
    expect(historyWrite).not.toHaveBeenCalled();
    expect(historyReplace).not.toHaveBeenCalled();
    expect(cookieWrite).not.toHaveBeenCalled();
  });
});
