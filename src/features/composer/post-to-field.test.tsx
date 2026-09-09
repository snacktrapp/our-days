import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PostToChoices } from "./post-to-field";

const circles = [
  { id: "family", name: "Trapp Family", personId: "brian", memberCount: 5 },
  { id: "cousins", name: "Cousins", personId: "brian-cousins", memberCount: 2 },
] as const;

describe("Who can see this?", () => {
  it("selects one audience at a time without offering multi-share on the default screen", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PostToChoices
        circles={circles}
        selectedIds={["family"]}
        justMe={false}
        onChange={onChange}
      />,
    );

    expect(screen.getByText("Who can see this?")).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Trapp Family/ }),
    ).toBeChecked();
    expect(screen.getByText("5 people")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Share to more than one/u }),
    ).toBeNull();

    await user.click(screen.getByRole("checkbox", { name: /Cousins/ }));
    expect(onChange).toHaveBeenCalledWith({
      justMe: false,
      selectedIds: ["cousins"],
    });
  });

  it("keeps multi-select only when a moment is already shared to more than one family", () => {
    render(
      <PostToChoices
        circles={circles}
        selectedIds={["family", "cousins"]}
        justMe={false}
        onChange={() => undefined}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Share to more than one/u }),
    ).toBeNull();
    expect(
      screen.getByText("This moment will appear in each selected family."),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /Trapp Family/ }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Cousins/ })).toBeChecked();
  });
});
