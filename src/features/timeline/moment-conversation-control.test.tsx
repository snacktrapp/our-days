import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { MomentConversationActions } from "@/features/moments/moment-action-types";
import { displayConversationDate } from "./display-conversation-date";
import { MomentConversationControl } from "./moment-conversation-control";
import type {
  MomentConversationViewModel,
  MomentDetailViewModel,
  MomentInteractionViewModel,
} from "./timeline-view-model";

const interaction = {
  currentPerson: { name: "Brian", initial: "B", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Held close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "⌣" },
    { id: "remember-this", label: "Remember this", symbol: "✦" },
  ],
} as const satisfies MomentInteractionViewModel;

const initialConversation = {
  notes: [
    {
      id: "note-one",
      authorName: "Molly",
      authorInitial: "M",
      authorAccent: "ochre",
      body: "The quiet ride home was my favorite part.",
      displayDate: "Aug 2, 2026",
    },
  ],
  reactions: [
    {
      id: "reaction-one",
      personName: "Molly",
      personInitial: "M",
      personAccent: "ochre",
      reactionId: "held-close",
    },
  ],
} as const satisfies MomentConversationViewModel;

const model = {
  id: "moment-one",
  kind: "photo",
  personName: "Brian",
  personAccent: "clay",
  displayDate: "Aug 1, 2026",
  kicker: "Photo",
  text: "Beautiful night.",
  conversation: initialConversation,
} as const satisfies MomentDetailViewModel;

function connectedActions(
  conversation: MomentConversationViewModel = initialConversation,
): MomentConversationActions & {
  load: ReturnType<typeof vi.fn>;
  createNote: ReturnType<typeof vi.fn>;
  setReaction: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn().mockResolvedValue({ ok: true, conversation }),
    createNote: vi.fn().mockResolvedValue({ ok: true, message: "Saved" }),
    updateNote: vi.fn().mockResolvedValue({ ok: true, message: "Saved" }),
    trashNote: vi.fn().mockResolvedValue({ ok: true, message: "Removed" }),
    setReaction: vi.fn().mockResolvedValue({ ok: true, message: "Saved" }),
  };
}

function renderControl(
  actions?: MomentConversationActions,
  conversation: MomentConversationViewModel = initialConversation,
) {
  return render(
    <MomentConversationControl
      interaction={interaction}
      model={{ ...model, conversation }}
      actions={actions}
      position={2}
      total={5}
    />,
  );
}

describe("MomentConversationControl", () => {
  it("shows family activity directly on the moment without a dialog", () => {
    renderControl();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("Molly");
    expect(
      screen.getByRole("list", { name: "Notes from family" }),
    ).toHaveTextContent(
      "MollyAug 2, 2026The quiet ride home was my favorite part.",
    );
  });

  it("shows a local date and time immediately after the author name", () => {
    const createdAt = "2026-08-02T14:55:00.000Z";
    const stamp = displayConversationDate(createdAt);
    renderControl(undefined, {
      notes: [
        {
          ...initialConversation.notes[0],
          createdAt,
          displayDate: stamp,
        },
      ],
      reactions: [],
    });

    const notes = screen.getByRole("list", { name: "Notes from family" });
    const when = notes.querySelector("time.inline-note-when");
    expect(when).toHaveAttribute("dateTime", createdAt);
    expect(when).toHaveTextContent(stamp);
    expect(notes).toHaveTextContent(
      `Molly${stamp}The quiet ride home was my favorite part.`,
    );
    expect(stamp).not.toMatch(/ago/iu);
  });

  it("keeps an optimistic note as Just now until a refresh replaces it", async () => {
    const user = userEvent.setup();
    renderControl(undefined, { notes: [], reactions: [] });

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Add a family note" }),
      "A fresh detail.",
    );
    await user.click(screen.getByRole("button", { name: "Post" }));

    const notes = screen.getByRole("list", { name: "Notes from family" });
    expect(within(notes).getByText("Brian")).toBeVisible();
    expect(notes.querySelector(".inline-note-when")).toHaveTextContent(
      "Just now",
    );
    expect(within(notes).getByText("A fresh detail.")).toBeVisible();
  });

  it("shows newest notes first and keeps older notes behind Show more", async () => {
    const user = userEvent.setup();
    renderControl(undefined, {
      notes: [
        {
          ...initialConversation.notes[0],
          id: "note-oldest",
          body: "Oldest family note.",
        },
        {
          ...initialConversation.notes[0],
          id: "note-middle",
          authorName: "Brian",
          authorInitial: "B",
          authorAccent: "teal",
          body: "A middle note.",
        },
        {
          ...initialConversation.notes[0],
          id: "note-newest",
          authorName: "Nana",
          authorInitial: "N",
          authorAccent: "clay",
          body: "Nana just replied.",
        },
      ],
      reactions: [],
    });

    const notes = screen.getByRole("list", { name: "Notes from family" });
    const collapsed = within(notes).getAllByRole("listitem");
    expect(collapsed).toHaveLength(2);
    expect(collapsed[0]).toHaveTextContent("Nana");
    expect(collapsed[0]).toHaveTextContent("Nana just replied.");
    expect(collapsed[0].querySelector(".note-avatar")).toBeNull();
    expect(collapsed[1]).toHaveTextContent("Brian");
    expect(collapsed[1]).toHaveTextContent("A middle note.");
    expect(collapsed[1].querySelector(".note-avatar")).toBeNull();
    expect(screen.queryByText("Oldest family note.")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show 1 more" }));
    const expanded = within(notes).getAllByRole("listitem");
    expect(expanded.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Nana just replied."),
      expect.stringContaining("A middle note."),
      expect.stringContaining("Oldest family note."),
    ]);
    expect(expanded[2].querySelector(".note-avatar")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show fewer notes" }));
    expect(within(notes).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("Oldest family note.")).toBeNull();
  });

  it("loves immediately with one tap, no picker, and undoes with another", async () => {
    const user = userEvent.setup();
    const actions = connectedActions();
    renderControl(actions);
    const heart = screen.getByRole("button", { name: /Love photo/u });
    await user.click(heart);
    expect(heart).toHaveAttribute("aria-pressed", "true");
    expect(actions.setReaction).toHaveBeenLastCalledWith({
      momentId: model.id,
      reactionId: "held-close",
    });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen
        .getByRole("list", { name: "Family responses" })
        .querySelectorAll(".heart-glyph"),
    ).toHaveLength(0);
    await user.click(heart);
    expect(actions.setReaction).toHaveBeenLastCalledWith({
      momentId: model.id,
      reactionId: null,
    });
    expect(heart).toHaveAttribute("aria-pressed", "false");
  });

  it("shows love optimistically while saving and prevents competing writes", async () => {
    const actions = connectedActions();
    let finish!: (result: { ok: true; message: string }) => void;
    actions.setReaction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderControl(actions, { notes: [], reactions: [] });
    const heart = screen.getByRole("button", { name: /Love photo/u });
    fireEvent.click(heart);
    expect(heart).toHaveAttribute("aria-pressed", "true");
    expect(heart).toBeDisabled();
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("Brian");
    finish({ ok: true, message: "Saved" });
    await waitFor(() => expect(heart).not.toBeDisabled());
  });

  it("double-tap adds love but never removes it", async () => {
    const actions = connectedActions();
    renderControl(actions, { notes: [], reactions: [] });
    const target = document.getElementById("moment-conversation-moment-one")!;
    fireEvent(target, new Event("our-days:heart"));
    await waitFor(() => expect(actions.setReaction).toHaveBeenCalledTimes(1));
    fireEvent(target, new Event("our-days:heart"));
    expect(actions.setReaction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Love photo/u })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("restores the prior reaction and reports a failed save", async () => {
    const actions = connectedActions();
    actions.setReaction.mockResolvedValue({
      ok: false,
      message: "Please try again.",
    });
    renderControl(actions, { notes: [], reactions: [] });
    fireEvent.click(screen.getByRole("button", { name: /Love photo/u }));
    await screen.findByRole("alert");
    expect(screen.getByRole("button", { name: /Love photo/u })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Please try again.");
  });

  it("preserves old non-heart reactions without offering new emoji choices", () => {
    renderControl(undefined, {
      notes: [],
      reactions: [
        { ...initialConversation.reactions[0], reactionId: "remember-this" },
      ],
    });
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("✨Molly");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("orders comment, heart, reaction names, then comments without avatars", () => {
    const { container } = renderControl();
    const reactions = screen.getByRole("list", { name: "Family responses" });
    const actions = container.querySelector(".soft-actions")!;
    const notes = screen.getByRole("list", { name: "Notes from family" });
    expect(
      container
        .querySelector(".quick-reaction-trigger")!
        .compareDocumentPosition(reactions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(actions.firstElementChild).toHaveClass("note-action-trigger");
    expect(
      actions.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(container.querySelector(".note-avatar")).toBeNull();
  });

  it("renders feed-payload comments on first paint without a follow-up load", () => {
    const actions = connectedActions(initialConversation);
    renderControl(actions, initialConversation);

    expect(
      screen.getByRole("list", { name: "Notes from family" }),
    ).toHaveTextContent("The quiet ride home was my favorite part.");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("Molly");
    expect(actions.load).not.toHaveBeenCalled();
  });

  it("keeps a quiet post short when the payload has no conversation", () => {
    const actions = connectedActions({ notes: [], reactions: [] });
    renderControl(actions, { notes: [], reactions: [] });

    expect(
      screen.queryByRole("list", { name: "Notes from family" }),
    ).toBeNull();
    expect(screen.queryByRole("list", { name: "Family responses" })).toBeNull();
    expect(document.querySelector(".conversation-summary-pending")).toBeNull();
    expect(actions.load).not.toHaveBeenCalled();
  });

  it("opens a comment drawer with Cancel and Post without scrolling the entry", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    renderControl();

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    const note = screen.getByRole("textbox", { name: "Add a family note" });
    expect(note).toHaveFocus();
    const form = note.closest("form")!;
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(form).toHaveClass("inline-note-form");
    expect(form).not.toHaveClass("overlay-popover");
    expect(form).not.toHaveClass("note-drawer");
    expect(
      within(form)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Cancel", "Post"]);
    expect(
      screen.getByRole("dialog", { name: "Add comment" }),
    ).toContainElement(form);
    expect(document.querySelector(".inline-conversation")).not.toContainElement(
      form,
    );

    await user.type(note, "Keep this draft?");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("textbox", { name: "Add a family note" }),
    ).toBeNull();
  });

  it("retains a draft after dismissing the drawer and restores focus", async () => {
    const user = userEvent.setup();
    renderControl();
    const trigger = screen.getByRole("button", {
      name: /Add a note to photo/u,
    });
    await user.click(trigger);
    await user.type(screen.getByRole("textbox"), "Keep this comment");
    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { bubbles: true, cancelable: true }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.click(trigger);
    expect(screen.getByRole("textbox")).toHaveValue("Keep this comment");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(trigger);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("saves a note and immediately shows its author and text in the timeline", async () => {
    const empty = { notes: [], reactions: [] } as const;
    const saved = {
      notes: [
        {
          id: "note-brian",
          authorName: "Brian",
          authorInitial: "B",
          authorAccent: "teal",
          body: "The sky was even better in person.",
          displayDate: "Today",
          canChange: true,
          revision: 1,
        },
      ],
      reactions: [],
    } as const satisfies MomentConversationViewModel;
    const actions = connectedActions(empty);
    actions.load.mockResolvedValue({ ok: true, conversation: saved });
    const user = userEvent.setup();
    renderControl(actions, empty);

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Add a family note" }),
      "The sky was even better in person.",
    );
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(actions.createNote).toHaveBeenCalledWith({
        momentId: "moment-one",
        body: "The sky was even better in person.",
      }),
    );
    expect(
      screen.queryByRole("textbox", { name: "Add a family note" }),
    ).toBeNull();
    const notes = screen.getByRole("list", { name: "Notes from family" });
    expect(within(notes).getByText("Brian")).toBeVisible();
    expect(
      within(notes).getByText("The sky was even better in person."),
    ).toBeVisible();
  });

  it("shows a newly saved note without expanding older notes", async () => {
    const existing = {
      notes: [
        {
          id: "note-oldest",
          authorName: "Molly",
          authorInitial: "M",
          authorAccent: "ochre",
          body: "Oldest family note.",
          displayDate: "Aug 2, 2026",
        },
        {
          id: "note-middle",
          authorName: "Brian",
          authorInitial: "B",
          authorAccent: "teal",
          body: "A middle note.",
          displayDate: "Aug 3, 2026",
          canChange: true,
          revision: 1,
        },
      ],
      reactions: [],
    } as const satisfies MomentConversationViewModel;
    const saved = {
      notes: [
        ...existing.notes,
        {
          id: "note-nana",
          authorName: "Nana",
          authorInitial: "N",
          authorAccent: "clay",
          body: "Nana just replied.",
          displayDate: "Today",
          canChange: false,
          revision: 1,
        },
      ],
      reactions: [],
    } as const satisfies MomentConversationViewModel;
    const actions = connectedActions(existing);
    actions.load.mockResolvedValue({ ok: true, conversation: saved });
    const user = userEvent.setup();
    renderControl(actions, existing);

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Add a family note" }),
      "Nana just replied.",
    );
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(actions.createNote).toHaveBeenCalledWith({
        momentId: "moment-one",
        body: "Nana just replied.",
      }),
    );
    const notes = screen.getByRole("list", { name: "Notes from family" });
    const items = within(notes).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Nana just replied.");
    expect(items[1]).toHaveTextContent("A middle note.");
    expect(screen.queryByText("Oldest family note.")).toBeNull();
    expect(screen.getByRole("button", { name: "Show 1 more" })).toBeVisible();
  });

  it("edits the newest owned note by revision without expanding older notes", async () => {
    const thread = {
      notes: [
        {
          id: "note-oldest",
          authorName: "Molly",
          authorInitial: "M",
          authorAccent: "ochre",
          body: "Oldest family note.",
          displayDate: "Aug 2, 2026",
        },
        {
          id: "note-middle",
          authorName: "Sam",
          authorInitial: "S",
          authorAccent: "slate",
          body: "A middle note.",
          displayDate: "Aug 3, 2026",
        },
        {
          id: "note-owned",
          authorName: "Brian",
          authorInitial: "B",
          authorAccent: "teal",
          body: "Original newest note.",
          displayDate: "Today",
          canChange: true,
          revision: 3,
        },
      ],
      reactions: [],
    } as const satisfies MomentConversationViewModel;
    const updated = {
      ...thread,
      notes: [
        thread.notes[0],
        thread.notes[1],
        { ...thread.notes[2], body: "Updated newest note.", revision: 4 },
      ],
    } as const satisfies MomentConversationViewModel;
    const actions = connectedActions(thread);
    actions.load.mockResolvedValue({ ok: true, conversation: updated });
    const user = userEvent.setup();
    renderControl(actions, thread);

    expect(screen.queryByText("Oldest family note.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Edit your note" });
    expect(editor).toHaveValue("Original newest note.");
    await user.clear(editor);
    await user.type(editor, "Updated newest note.");
    await user.click(
      within(editor.closest("form")!).getByRole("button", { name: "Save" }),
    );
    await waitFor(() =>
      expect(actions.updateNote).toHaveBeenCalledWith({
        noteId: "note-owned",
        revision: 3,
        body: "Updated newest note.",
      }),
    );
    expect(screen.getByText("Updated newest note.")).toBeVisible();
    expect(screen.queryByText("Oldest family note.")).toBeNull();
  });

  it("keeps a saved note visible when conversation reload fails", async () => {
    const empty = { notes: [], reactions: [] } as const;
    const actions = connectedActions(empty);
    const user = userEvent.setup();
    renderControl(actions, empty);

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    actions.load.mockResolvedValue({
      ok: false,
      message: "This family conversation could not be loaded. Try again.",
    });
    await user.type(
      screen.getByRole("textbox", { name: "Add a family note" }),
      "The porch light was on.",
    );
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() =>
      expect(actions.createNote).toHaveBeenCalledWith({
        momentId: "moment-one",
        body: "The porch light was on.",
      }),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("The porch light was on.")).toBeVisible();
    expect(screen.getByText("Brian")).toBeVisible();
  });

  it("retains the note and shows an actionable error when saving fails", async () => {
    const empty = { notes: [], reactions: [] } as const;
    const actions = connectedActions(empty);
    actions.createNote.mockResolvedValue({
      ok: false,
      message: "That note could not be saved.",
    });
    const user = userEvent.setup();
    renderControl(actions, empty);

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    const note = screen.getByRole("textbox", { name: "Add a family note" });
    await user.type(note, "Do not lose this.");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That note could not be saved.",
    );
    expect(note).toHaveValue("Do not lose this.");
  });

  it("edits an owned note in the original note field and removes it", async () => {
    const owned = {
      notes: [
        {
          id: "note-owned",
          authorName: "Brian",
          authorInitial: "B",
          authorAccent: "teal",
          body: "Original note.",
          displayDate: "Today",
          canChange: true,
          revision: 3,
        },
      ],
      reactions: [],
    } as const satisfies MomentConversationViewModel;
    const updated = {
      ...owned,
      notes: [{ ...owned.notes[0], body: "Updated note.", revision: 4 }],
    } as const satisfies MomentConversationViewModel;
    const actions = connectedActions(owned);
    actions.load.mockResolvedValue({ ok: true, conversation: updated });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderControl(actions, owned);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Edit your note" });
    expect(editor.closest("form")).toHaveClass("inline-note-form");
    expect(editor).toHaveValue("Original note.");
    expect(
      within(screen.getByRole("list", { name: "Notes from family" })).getByText(
        "Original note.",
      ),
    ).toBeVisible();
    await user.clear(editor);
    await user.type(editor, "Updated note.");
    await user.click(
      within(editor.closest("form")!).getByRole("button", { name: "Save" }),
    );
    await waitFor(() =>
      expect(actions.updateNote).toHaveBeenCalledWith({
        noteId: "note-owned",
        revision: 3,
        body: "Updated note.",
      }),
    );
    expect(screen.getByText("Updated note.")).toBeVisible();

    actions.load.mockResolvedValueOnce({
      ok: true,
      conversation: { notes: [], reactions: [] },
    });
    await user.click(screen.getByRole("button", { name: "Remove" }));
    expect(confirm).toHaveBeenCalledWith(
      "Remove this note from the family conversation?",
    );
    await waitFor(() =>
      expect(actions.trashNote).toHaveBeenCalledWith({
        noteId: "note-owned",
        revision: 4,
      }),
    );
    expect(
      screen.queryByRole("list", { name: "Notes from family" }),
    ).toBeNull();
  });

  it("renders note text literally", () => {
    const hostile = '<img data-note-injection src=x onerror="alert(1)">';
    renderControl(undefined, {
      notes: [
        {
          id: "literal-note",
          authorName: "Molly",
          authorInitial: "M",
          authorAccent: "ochre",
          body: hostile,
          displayDate: "Today",
        },
      ],
      reactions: [],
    });

    const list = screen.getByRole("list", { name: "Notes from family" });
    expect(list).toHaveTextContent(hostile);
    expect(list.querySelector("[data-note-injection]")).toBeNull();
  });
});
