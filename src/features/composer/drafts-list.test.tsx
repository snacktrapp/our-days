import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DraftsList } from "./drafts-list";
import type { EntryDraftListItem } from "./entry-drafts";

const draft: EntryDraftListItem = {
  id: "draft-1",
  kind: "thought",
  previewText: "A porch morning.",
  updatedAt: "2026-09-08T16:42:00.000Z",
};

describe("DraftsList", () => {
  it("opens from the row or edit icon and deletes without opening", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(<DraftsList drafts={[draft]} onOpen={onOpen} onDelete={onDelete} />);

    expect(
      screen.queryByRole("button", { name: /Draft options/u }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("⋯")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Open Note · /u }));
    await user.click(screen.getByRole("button", { name: /^Edit Note · /u }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /^Delete Note · /u }));
    expect(onDelete).toHaveBeenCalledWith("draft-1");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
