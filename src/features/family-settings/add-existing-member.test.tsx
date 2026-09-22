import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AddExistingMember } from "./add-existing-member";
import type { FamilyCircleViewModel } from "./family-settings-view-model";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
const circle: FamilyCircleViewModel = {
  id: "target",
  name: "Home + Grandparents",
  memberCount: 1,
  currentMemberId: "me",
  canManageAccess: true,
  canRename: true,
  members: [],
  guardianOptions: [],
  pendingInvitations: [],
};
const source = { ...circle, id: "home", name: "Home" };

describe("add an existing member", () => {
  it("chooses a circle and person, then adds without an invitation or sign-in", async () => {
    const user = userEvent.setup();
    const actions = {
      list: vi.fn().mockResolvedValue({
        ok: true,
        message: "",
        members: [{ membership_id: "heidi", display_name: "Heidi" }],
      }),
      add: vi.fn().mockResolvedValue({ ok: true, message: "Member added." }),
    };
    render(
      <AddExistingMember
        circle={circle}
        groups={[circle, source]}
        actions={actions}
      />,
    );
    const summary = screen
      .getByText("Add from an existing circle")
      .closest("summary");
    expect(
      summary?.querySelector(".circle-accordion-chevron svg"),
    ).not.toBeNull();
    expect(summary?.parentElement).toHaveClass("settings-disclosure");
    await user.click(screen.getByText("Add from an existing circle"));
    await user.selectOptions(screen.getByLabelText("From circle"), "home");
    await user.selectOptions(await screen.findByLabelText("Person"), "heidi");
    await user.click(
      screen.getByRole("button", { name: "Add to Home + Grandparents" }),
    );
    await waitFor(() =>
      expect(actions.add).toHaveBeenCalledWith({
        sourceMembershipId: "heidi",
        targetCircleId: "target",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Member added");
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByRole("option", { name: "Heidi" })).toBeNull();
  });
  it("keeps selection available to retry a failed write", async () => {
    const user = userEvent.setup();
    const actions = {
      list: vi.fn().mockResolvedValue({
        ok: true,
        message: "",
        members: [{ membership_id: "heidi", display_name: "Heidi" }],
      }),
      add: vi
        .fn()
        .mockResolvedValue({ ok: false, message: "Please try again." }),
    };
    render(
      <AddExistingMember circle={circle} groups={[source]} actions={actions} />,
    );
    await user.click(screen.getByText("Add from an existing circle"));
    await user.selectOptions(screen.getByLabelText("From circle"), "home");
    await user.selectOptions(await screen.findByLabelText("Person"), "heidi");
    await user.click(
      screen.getByRole("button", { name: "Add to Home + Grandparents" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Please try again",
    );
    expect(screen.getByLabelText("Person")).toHaveValue("heidi");
    expect(refresh).not.toHaveBeenCalled();
  });
  it("hides the shortcut when no other circle is organized by this user", () => {
    render(
      <AddExistingMember
        circle={circle}
        groups={[circle, { ...source, canManageAccess: false }]}
        preview
      />,
    );
    expect(screen.queryByText("Add from an existing circle")).toBeNull();
  });
});
