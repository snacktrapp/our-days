import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MomentConversationControl } from "./moment-conversation-control";
import type {
  MomentDetailViewModel,
  MomentInteractionViewModel,
} from "./timeline-view-model";

const noteCanary = "The quiet ride home was my favorite part.";

const interaction = {
  currentPerson: { name: "Current person", initial: "C", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Hold close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "✦" },
    { id: "remember-this", label: "I remember", symbol: "↺" },
  ],
} as const satisfies MomentInteractionViewModel;

const model = {
  id: "moment-one",
  kind: "thought",
  personName: "Journal person",
  personAccent: "clay",
  displayDate: "Aug 1, 2026",
  kicker: "An ordinary evening",
  text: "Worth keeping exactly as it was.",
  taggedPeopleLabel: "Someone",
  conversation: {
    notes: [
      {
        id: "note-one",
        authorName: "Family member",
        authorInitial: "F",
        authorAccent: "ochre",
        body: noteCanary,
        displayDate: "Aug 2, 2026",
      },
    ],
    reactions: [
      {
        id: "reaction-one",
        personName: "Family member",
        personInitial: "F",
        personAccent: "ochre",
        reactionId: "held-close",
      },
    ],
  },
} as const satisfies MomentDetailViewModel;

function renderControl(overrides: Partial<MomentDetailViewModel> = {}) {
  return render(
    <MomentConversationControl
      interaction={interaction}
      model={{ ...model, ...overrides } as MomentDetailViewModel}
    />,
  );
}

describe("MomentConversationControl", () => {
  it("keeps private detail out of the closed DOM and opens Notes at its heading", async () => {
    const user = userEvent.setup();
    renderControl();

    expect(screen.queryByText(noteCanary)).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    const notes = screen.getByRole("button", {
      name: "Open private notes for An ordinary evening by Journal person",
    });
    await user.click(notes);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName(
      "Thought: “Worth keeping exactly as it was.” — Journal person, Aug 1, 2026",
    );
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      "moment-detail-moment-one-privacy",
    );
    expect(screen.getByText(noteCanary)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Notes from family" }),
    ).toHaveFocus();
    expect(document.body).toHaveClass("composer-scroll-locked");
    expect(screen.queryByText(/\d+ notes/u)).toBeNull();
  });

  it("uses one reversible response from the fixed, count-free vocabulary", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(
      screen.getByRole("button", {
        name: "Respond to An ordinary evening by Journal person",
      }),
    );

    expect(
      screen.getByRole("heading", { name: "A quiet response" }),
    ).toHaveFocus();
    const group = screen.getByRole("group", { name: "Your response" });
    const choices = within(group).getAllByRole("button");
    expect(choices.map((choice) => choice.textContent)).toEqual([
      "♡Hold close",
      "✦Made me smile",
      "↺I remember",
    ]);
    expect(
      choices.every(
        (choice) => choice.getAttribute("aria-pressed") === "false",
      ),
    ).toBe(true);

    await user.click(choices[0]);
    expect(choices[0]).toHaveAttribute("aria-pressed", "true");
    await user.click(choices[1]);
    expect(choices[0]).toHaveAttribute("aria-pressed", "false");
    expect(choices[1]).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Nothing was saved");
    await user.click(choices[1]);
    expect(choices[1]).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("rejects whitespace, focuses the note, and renders hostile text literally", async () => {
    const user = userEvent.setup();
    const hostileNote = '<img data-note-injection src=x onerror="alert(1)">';
    renderControl();
    await user.click(
      screen.getByRole("button", {
        name: "Open private notes for An ordinary evening by Journal person",
      }),
    );

    const note = screen.getByRole("textbox", {
      name: "Your note to the family",
    });
    await user.type(note, "   ");
    await user.click(screen.getByRole("button", { name: "Preview note" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write a note before previewing it.",
    );
    expect(note).toHaveFocus();

    await user.clear(note);
    await user.type(note, hostileNote);
    await user.click(screen.getByRole("button", { name: "Preview note" }));
    const preview = screen.getByRole("article", {
      name: "Your local note preview",
    });
    expect(preview).toHaveTextContent(hostileNote);
    expect(preview.querySelector("[data-note-injection]")).toBeNull();
    expect(preview).toHaveTextContent("Your local preview · Not saved");
  });

  it("edits and clears a segregated note preview", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(
      screen.getByRole("button", {
        name: "Open private notes for An ordinary evening by Journal person",
      }),
    );
    const note = screen.getByRole("textbox", {
      name: "Your note to the family",
    });
    await user.type(note, "A small detail.");
    await user.click(screen.getByRole("button", { name: "Preview note" }));
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(
      screen.getByRole("textbox", { name: "Your note to the family" }),
    ).toHaveValue("A small detail.");
    expect(
      screen.getByRole("textbox", { name: "Your note to the family" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Preview note" }));
    await user.click(screen.getByRole("button", { name: "Clear preview" }));
    expect(
      screen.queryByRole("article", { name: "Your local note preview" }),
    ).toBeNull();
    expect(
      screen.getByRole("textbox", { name: "Your note to the family" }),
    ).toHaveValue("");
  });

  it("protects dirty state and restores the exact opener after discard", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderControl();
    const notes = screen.getByRole("button", {
      name: "Open private notes for An ordinary evening by Journal person",
    });
    await user.click(notes);
    await user.type(
      screen.getByRole("textbox", { name: "Your note to the family" }),
      "Do not lose this yet.",
    );

    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(confirm).toHaveBeenCalledWith("Discard this unsaved note?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Your note to the family" }),
    ).toHaveValue("Do not lose this yet.");

    confirm.mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Close preview" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(notes).toHaveFocus();
    expect(document.body).not.toHaveClass("composer-scroll-locked");

    await user.click(notes);
    expect(
      screen.getByRole("textbox", { name: "Your note to the family" }),
    ).toHaveValue("");
  });

  it("handles pristine Escape and dirty backdrop dismissal consistently", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderControl();
    const respond = screen.getByRole("button", {
      name: "Respond to An ordinary evening by Journal person",
    });
    await user.click(respond);
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(respond).toHaveFocus();
    expect(confirm).not.toHaveBeenCalled();

    await user.click(respond);
    await user.click(screen.getByRole("button", { name: "Hold close" }));
    fireEvent.click(screen.getByRole("dialog"));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders a warm empty state without inventing note or response activity", async () => {
    const user = userEvent.setup();
    renderControl({ conversation: { notes: [], reactions: [] } });
    await user.click(
      screen.getByRole("button", {
        name: "Open private notes for An ordinary evening by Journal person",
      }),
    );
    expect(
      screen.getByText("No notes here yet. The moment can stay quiet."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No family responses are attached to this moment."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/be the first/iu)).toBeNull();
  });
});
