import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileColorSelector } from "./profile-color-selector";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("profile color selector", () => {
  it("previews a color and saves only on request", async () => {
    const save = vi
      .fn()
      .mockResolvedValue({ ok: true, message: "Color saved." });
    render(
      <ProfileColorSelector
        name="Brian"
        initial="B"
        accent="teal"
        saveColor={save}
      />,
    );
    expect(screen.getAllByRole("radio")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Save color" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Purple" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByText("B")).toHaveClass("dot-violet");
    fireEvent.click(screen.getByRole("button", { name: "Save color" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith("violet"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
  it("retains the chosen color for retry when saving fails", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    render(
      <ProfileColorSelector
        name="Brian"
        initial="B"
        accent="teal"
        saveColor={save}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Cyan" }));
    fireEvent.click(screen.getByRole("button", { name: "Save color" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("radio", { name: "Cyan" })).toBeChecked();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save color" })).toBeEnabled(),
    );
  });
});
