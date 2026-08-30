import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FamilySettingsPanel } from "./family-settings-panel";

const model = {
  mode: "preview",
  intro: "A small, invitation-only circle.",
  currentMemberId: "current",
  members: [
    {
      id: "current",
      membershipId: "current-membership",
      profileKind: "account",
      role: "organizer",
      name: "Current person",
      initial: "C",
      accent: "teal",
      relationshipLabel: "Co-organizer",
      accessLabel: "Account · Can sign in",
      guardianMembershipIds: [],
      canManageRole: false,
      canManageJournal: false,
      canReviewRemoval: false,
    },
    {
      id: "other",
      membershipId: "other-membership",
      profileKind: "account",
      role: "organizer",
      name: "Other organizer",
      initial: "O",
      accent: "clay",
      relationshipLabel: "Co-organizer",
      accessLabel: "Account · Can sign in",
      guardianMembershipIds: [],
      canManageRole: false,
      canManageJournal: false,
      canReviewRemoval: true,
    },
    {
      id: "child",
      membershipId: null,
      profileKind: "managed",
      role: null,
      name: "Child profile",
      initial: "C",
      accent: "ochre",
      relationshipLabel: "Child journal",
      accessLabel: "Managed profile · No sign-in",
      guardianMembershipIds: [],
      canManageRole: false,
      canManageJournal: false,
      canReviewRemoval: false,
    },
  ],
} as const;

const connectedOrganizerModel = {
  mode: "connected",
  intro: "A small, invitation-only circle.",
  currentMemberId: "current",
  canManageAccess: true,
  members: model.members.map((member) => ({
    ...member,
    guardianMembershipIds:
      member.profileKind === "managed"
        ? ["current-membership", "other-membership"]
        : [],
    canManageRole: member.profileKind === "account" && member.id !== "current",
    canManageJournal: member.profileKind === "managed",
  })),
  guardianOptions: [
    {
      membershipId: "current-membership",
      personId: "current",
      name: "Current person",
      role: "organizer",
    },
    {
      membershipId: "other-membership",
      personId: "other",
      name: "Other organizer",
      role: "organizer",
    },
  ],
  pendingInvitations: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "Grandma",
      createdLabel: "Invited Aug 20, 2026",
      expiresLabel: "Expires Sep 3, 2026",
    },
  ],
  invitationDelivery: "worker-required",
} as const;

const connectedMemberModel = {
  ...connectedOrganizerModel,
  canManageAccess: false,
  members: connectedOrganizerModel.members.map((member) => ({
    ...member,
    canManageRole: false,
    canManageJournal: false,
    canReviewRemoval: false,
  })),
  guardianOptions: [],
  pendingInvitations: [],
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
    expect(screen.getByText(/Child journals have no sign-in/u)).toBeVisible();
    expect(
      screen.getByText(/no accounts or permissions are active/u),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", {
        name: "Review access for Other organizer",
      }),
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

    await user.click(
      screen.getByRole("button", { name: "Review access for Other organizer" }),
    );
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
    expect(
      screen.getByRole("button", { name: "Review access for Other organizer" }),
    ).toHaveFocus();

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

  it("removes reviewed access with the exact membership id and keeps failures recoverable", async () => {
    const user = userEvent.setup();
    const revokeMembership = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "Try again." })
      .mockResolvedValueOnce({ ok: true, message: "Family access removed." });
    render(
      <FamilySettingsPanel
        model={connectedOrganizerModel}
        actions={{
          revokeMembership,
          revokeInvitation: vi.fn(),
          setMembershipRole: vi.fn(),
          setGuardian: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByText(/Local design preview/u)).toBeNull();
    expect(screen.getByText(/Access changes take effect/u)).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Manage role and access for Other organizer",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Manage Other organizer" }),
    ).toHaveFocus();
    expect(screen.getByText(/guardian authority/u)).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Remove access for Other organizer" }),
    );
    expect(revokeMembership).toHaveBeenLastCalledWith({
      membershipId: "other-membership",
    });
    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent("Try again.");
    expect(error).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Remove access for Other organizer" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Remove access for Other organizer" }),
    );
    const success = await screen.findByRole("status");
    expect(success).toHaveTextContent(
      "Other organizer can no longer open this family.",
    );
    expect(success).toHaveFocus();
    expect(
      screen.queryByRole("button", {
        name: "Remove access for Other organizer",
      }),
    ).toBeNull();
  });

  it("withdraws only the reviewed invitation and exposes no invitation-creation control", async () => {
    const user = userEvent.setup();
    const revokeInvitation = vi.fn().mockResolvedValue({
      ok: true,
      message: "Invitation withdrawn.",
    });
    render(
      <FamilySettingsPanel
        model={connectedOrganizerModel}
        actions={{
          revokeMembership: vi.fn(),
          revokeInvitation,
          setMembershipRole: vi.fn(),
          setGuardian: vi.fn(),
        }}
      />,
    );

    expect(screen.queryByRole("textbox", { name: /email/u })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /send|create invitation/u }),
    ).toBeNull();
    expect(
      screen.getByText(/New invitations are not connected yet/u),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Review invite for Grandma" }),
    );
    expect(
      screen.getByRole("heading", {
        name: "Review Grandma’s invitation",
      }),
    ).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "Withdraw invitation for Grandma" }),
    );

    expect(revokeInvitation).toHaveBeenCalledWith({
      invitationId: "11111111-1111-4111-8111-111111111111",
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Grandma’s invitation was withdrawn.",
    );
  });

  it("keeps a rejected access request beside its retry controls", async () => {
    const user = userEvent.setup();
    const revokeMembership = vi
      .fn()
      .mockRejectedValue(new Error("transport unavailable"));
    render(
      <FamilySettingsPanel
        model={connectedOrganizerModel}
        actions={{
          revokeMembership,
          revokeInvitation: vi.fn(),
          setMembershipRole: vi.fn(),
          setGuardian: vi.fn(),
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Manage role and access for Other organizer",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove access for Other organizer" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That access could not be removed. Try again.",
    );
    expect(alert).toHaveFocus();
    expect(
      screen.getByRole("button", { name: "Remove access for Other organizer" }),
    ).toBeEnabled();
  });

  it("explains and applies a reviewed role change with exact target identity", async () => {
    const user = userEvent.setup();
    const setMembershipRole = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, message: "Role stayed the same." })
      .mockResolvedValueOnce({
        ok: true,
        message: "Organizer access removed.",
      });
    render(
      <FamilySettingsPanel
        model={connectedOrganizerModel}
        actions={{
          revokeMembership: vi.fn(),
          revokeInvitation: vi.fn(),
          setMembershipRole,
          setGuardian: vi.fn(),
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Manage role and access for Other organizer",
      }),
    );
    expect(screen.getByText(/Current role: Organizer/u)).toBeVisible();
    expect(
      screen.getByText(/Explicit care for Child profile will remain/u),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Change to family member: Other organizer",
      }),
    );
    expect(setMembershipRole).toHaveBeenLastCalledWith({
      membershipId: "other-membership",
      role: "member",
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Role stayed the same.",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Change to family member: Other organizer",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Other organizer is now a family member.",
    );
    expect(
      screen.queryByRole("heading", { name: "Manage Other organizer" }),
    ).toBeNull();
  });

  it("shows effective child-journal care and changes one explicit guardian at a time", async () => {
    const user = userEvent.setup();
    const setGuardian = vi.fn().mockResolvedValue({
      ok: true,
      message: "Journal guardian removed.",
    });
    render(
      <FamilySettingsPanel
        model={connectedOrganizerModel}
        actions={{
          revokeMembership: vi.fn(),
          revokeInvitation: vi.fn(),
          setMembershipRole: vi.fn(),
          setGuardian,
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Manage journal for Child profile",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Care for Child profile’s journal" }),
    ).toHaveFocus();
    expect(
      screen.getByText(/Organizers can care for every child journal/u),
    ).toBeVisible();
    expect(
      screen.getByRole("group", { name: "Assigned guardians" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Remove Other organizer as guardian for Child profile",
      }),
    );
    expect(setGuardian).toHaveBeenCalledWith({
      managedPersonId: "child",
      guardianMembershipId: "other-membership",
      grantAccess: false,
    });
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Other organizer no longer has care access to Child profile’s journal.",
    );
    expect(status).toHaveFocus();
    expect(status.closest(".access-review")).not.toBeNull();
  });

  it("keeps a rejected journal-care transport beside its retry control", async () => {
    const user = userEvent.setup();
    const setGuardian = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <FamilySettingsPanel
        model={connectedOrganizerModel}
        actions={{
          revokeMembership: vi.fn(),
          revokeInvitation: vi.fn(),
          setMembershipRole: vi.fn(),
          setGuardian,
        }}
      />,
    );

    await user.click(
      screen.getByRole("button", {
        name: "Manage journal for Child profile",
      }),
    );
    const retry = screen.getByRole("button", {
      name: "Remove Other organizer as guardian for Child profile",
    });
    await user.click(retry);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That journal care could not be changed. Try again.",
    );
    expect(alert).toHaveFocus();
    expect(retry).toBeEnabled();
  });

  it("shows ordinary members the access list without organizer controls or pending invitations", () => {
    render(
      <FamilySettingsPanel
        model={connectedMemberModel}
        actions={{
          revokeMembership: vi.fn(),
          revokeInvitation: vi.fn(),
          setMembershipRole: vi.fn(),
          setGuardian: vi.fn(),
        }}
      />,
    );

    expect(screen.getByText("Other organizer")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Review access for/u }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Manage (?:role and access|journal) for/u,
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Review invite for/u }),
    ).toBeNull();
    expect(
      screen.getByText(/An organizer can withdraw pending invitations/u),
    ).toBeVisible();
    expect(screen.queryByText("Grandma")).toBeNull();
  });
});
