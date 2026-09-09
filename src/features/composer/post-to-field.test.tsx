import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PostToChoices } from "./post-to-field";

const circles = [
  { id: "family", name: "Trapp Family", personId: "brian", memberCount: 5 },
  { id: "cousins", name: "Cousins", personId: "brian-cousins", memberCount: 2 },
] as const;

describe("Post to choices", () => {
  it("selects one ring at a time until advanced multi-share is opened", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <PostToChoices
        circles={circles}
        selectedIds={["family"]}
        justMe={false}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /Trapp Family/ }),
    ).toBeChecked();
    expect(screen.getByText("5 people")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Share to more than one ring" }),
    ).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: /Cousins/ }));
    expect(onChange).toHaveBeenCalledWith({
      justMe: false,
      selectedIds: ["cousins"],
    });

    rerender(
      <PostToChoices
        circles={circles}
        selectedIds={["cousins"]}
        justMe={false}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Share to more than one ring" }),
    );
    await user.click(screen.getByRole("checkbox", { name: /Trapp Family/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      justMe: false,
      selectedIds: ["cousins", "family"],
    });
  });

  it("opens advanced when a moment is already shared to more than one ring", () => {
    render(
      <PostToChoices
        circles={circles}
        selectedIds={["family", "cousins"]}
        justMe={false}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Share to more than one ring" }),
    ).toBeNull();
    expect(
      screen.getByText("This moment will appear in each selected ring."),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Trapp Family/ }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Cousins/ })).toBeChecked();
  });
});
