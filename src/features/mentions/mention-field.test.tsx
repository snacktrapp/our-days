import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { MentionField } from "./mention-field";
import type { DraftMention, MentionCandidate } from "./mention-draft";

const members: MentionCandidate[] = [
  { userId: "molly", name: "Molly", initial: "M", accent: "clay" },
  { userId: "nana", name: "Nana", initial: "N", accent: "ochre" },
  { userId: "ann", name: "Ann", initial: "A", accent: "slate" },
];

function Harness({ enabled = true }: { enabled?: boolean }) {
  const [value, setValue] = useState("");
  const [mentions, setMentions] = useState<readonly DraftMention[]>([]);
  return (
    <MentionField
      aria-label="Add a family note"
      value={value}
      mentions={mentions}
      members={members}
      enabled={enabled}
      onValueChange={(next, nextMentions) => {
        setValue(next);
        setMentions(nextMentions);
      }}
    />
  );
}

describe("mention chip row", () => {
  it("filters prefix matches ahead of contains and inserts below the field", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Add a family note" });
    await user.type(field, "@");
    const row = screen.getByRole("listbox", {
      name: "Mention a circle member",
    });
    expect(
      field.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(row.querySelectorAll("button").length).toBe(3);

    await user.type(field, "an");
    expect(
      [...row.querySelectorAll("button")].map((button) =>
        button.getAttribute("aria-label"),
      ),
    ).toEqual(["Ann", "Nana"]);

    await user.click(screen.getByRole("option", { name: "Ann" }));
    expect(field).toHaveValue("@Ann ");
    expect(field).toHaveFocus();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("hides the row when nothing matches and when mentions are off", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    const field = screen.getByRole("textbox", { name: "Add a family note" });
    await user.type(field, "@zzz");
    expect(screen.queryByRole("listbox")).toBeNull();
    rerender(<Harness enabled={false} />);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
