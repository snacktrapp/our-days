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
    ).toHaveTextContent("❤️Molly");
    expect(
      screen.getByRole("list", { name: "Notes from family" }),
    ).toHaveTextContent("MollyThe quiet ride home was my favorite part.");
  });

  it("keeps long conversations compact and expands older notes inline", async () => {
    const user = userEvent.setup();
    renderControl(undefined, {
      notes: [
        ...initialConversation.notes,
        {
          ...initialConversation.notes[0],
          id: "note-two",
          body: "A second detail.",
        },
        {
          ...initialConversation.notes[0],
          id: "note-three",
          body: "An older detail.",
        },
      ],
      reactions: [],
    });

    const notes = screen.getByRole("list", { name: "Notes from family" });
    expect(within(notes).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(within(notes).getAllByRole("listitem")).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Show fewer notes" }));
    expect(within(notes).getAllByRole("listitem")).toHaveLength(2);
  });

  it("opens emoji choices on one tap and saves only the chosen response", async () => {
    const refreshedConversation = {
      notes: [],
      reactions: [
        {
          id: "reaction-brian",
          personName: "Brian",
          personInitial: "B",
          personAccent: "teal",
          reactionId: "held-close",
          isCurrentMember: true,
        },
      ],
    } as const satisfies MomentConversationViewModel;
    const emptyConversation = { notes: [], reactions: [] } as const;
    const actions = connectedActions(emptyConversation);
    actions.load
      .mockResolvedValueOnce({ ok: true, conversation: emptyConversation })
      .mockResolvedValue({
        ok: true,
        conversation: refreshedConversation,
      });
    const user = userEvent.setup();
    renderControl(actions);

    await user.click(
      screen.getByRole("button", {
        name: /Choose a reaction for photo .* entry 2 of 5/u,
      }),
    );
    expect(actions.setReaction).not.toHaveBeenCalled();
    const choices = screen.getByRole("menu", { name: "Choose a reaction" });
    await user.click(
      within(choices).getByRole("menuitemradio", { name: "Heart" }),
    );
    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "moment-one",
        reactionId: "held-close",
      }),
    );
    expect(
      screen.getByRole("button", { name: /Choose a reaction/u }),
    ).toHaveTextContent("❤️");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("❤️Brian");
  });

  it("shows the chosen extra reaction on the card before saving finishes", async () => {
    let finishSave: (value: { ok: true; message: string }) => void = () => {};
    const actions = connectedActions({ notes: [], reactions: [] });
    actions.load.mockResolvedValue({
      ok: true,
      conversation: { notes: [], reactions: [] },
    });
    actions.setReaction.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );
    const user = userEvent.setup();
    renderControl(actions, { notes: [], reactions: [] });

    await user.click(
      screen.getByRole("button", {
        name: /Choose a reaction for photo .* entry 2 of 5/u,
      }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "Choose a reaction" })).getByRole(
        "menuitemradio",
        { name: "Laugh" },
      ),
    );

    expect(actions.setReaction).toHaveBeenCalledWith({
      momentId: "moment-one",
      reactionId: "made-me-smile",
    });
    expect(
      screen.getByRole("button", { name: /Choose a reaction/u }),
    ).toHaveTextContent("😂");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("😂Brian");

    finishSave({ ok: true, message: "Saved" });
    await waitFor(() =>
      expect(
        screen.getByRole("list", { name: "Family responses" }),
      ).toHaveTextContent("😂Brian"),
    );
  });

  it("keeps the chosen reaction when a slow conversation load finishes later", async () => {
    let finishLoad: (value: {
      ok: true;
      conversation: MomentConversationViewModel;
    }) => void = () => {};
    const actions = connectedActions({ notes: [], reactions: [] });
    actions.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishLoad = resolve;
        }),
    );
    const user = userEvent.setup();
    renderControl(actions, { notes: [], reactions: [] });

    await user.click(
      screen.getByRole("button", {
        name: /Choose a reaction for photo/u,
      }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "Choose a reaction" })).getByRole(
        "menuitemradio",
        { name: "Meaningful" },
      ),
    );

    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("✨Brian");

    finishLoad({
      ok: true,
      conversation: { notes: [], reactions: [] },
    });

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "moment-one",
        reactionId: "remember-this",
      }),
    );
    expect(
      screen.getByRole("button", { name: /Choose a reaction/u }),
    ).toHaveTextContent("✨");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("✨Brian");
  });

  it("shows the chosen response on the card immediately without a network action", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(
      screen.getByRole("button", { name: /Choose a reaction for photo/u }),
    );
    await user.click(
      within(screen.getByRole("menu", { name: "Choose a reaction" })).getByRole(
        "menuitemradio",
        { name: "Laugh" },
      ),
    );

    expect(
      screen.getByRole("button", { name: /Choose a reaction/u }),
    ).toHaveTextContent("😂");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("❤️Molly");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("😂Brian");
  });

  it("shows standard emoji choices without relying on a long press", async () => {
    const user = userEvent.setup();
    renderControl();
    await user.click(
      screen.getByRole("button", { name: /Choose a reaction for photo/u }),
    );

    const choices = screen.getByRole("menu", { name: "Choose a reaction" });
    expect(within(choices).getAllByRole("menuitemradio")).toHaveLength(3);
    expect(
      within(choices).getByRole("menuitemradio", { name: "Heart" }),
    ).toHaveTextContent("❤️");
    expect(
      within(choices).getByRole("menuitemradio", { name: "Laugh" }),
    ).toHaveTextContent("😂");
    expect(
      within(choices).getByRole("menuitemradio", { name: "Meaningful" }),
    ).toHaveTextContent("✨");
  });

  it("hides the reaction menu as soon as the picker starts closing", async () => {
    const user = userEvent.setup();
    renderControl();
    const trigger = screen.getByRole("button", {
      name: /Choose a reaction for photo/u,
    });
    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Choose a reaction" })).toHaveClass(
      "overlay-popover",
    );
    expect(
      screen.getByRole("menu", { name: "Choose a reaction" }),
    ).toBeVisible();

    await user.click(trigger);

    expect(
      screen.queryByRole("menu", { name: "Choose a reaction" }),
    ).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".inline-reaction-picker")).toHaveClass(
      "is-closing",
    );
  });

  it("closes the reaction picker immediately when motion is reduced", async () => {
    const media = vi.mocked(window.matchMedia);
    media.mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      const user = userEvent.setup();
      renderControl();
      const trigger = screen.getByRole("button", {
        name: /Choose a reaction for photo/u,
      });
      await user.click(trigger);
      await user.click(trigger);

      expect(document.querySelector(".inline-reaction-picker")).toBeNull();
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    } finally {
      media.mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }
  });

  it("closes the picker and restores the prior response when saving fails", async () => {
    const actions = connectedActions();
    actions.setReaction.mockResolvedValue({
      ok: false,
      message: "That response could not be saved.",
    });
    const user = userEvent.setup();
    renderControl(actions);

    const trigger = screen.getByRole("button", {
      name: /Choose a reaction for photo/u,
    });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const choice = await screen.findByRole("menuitemradio", {
      name: "Meaningful",
    });
    await user.click(choice);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That response could not be saved.",
    );
    expect(
      screen.queryByRole("menu", { name: "Choose a reaction" }),
    ).toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("♡");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).toHaveTextContent("❤️Molly");
    expect(
      screen.getByRole("list", { name: "Family responses" }),
    ).not.toHaveTextContent("Brian");
  });

  it("loads connected comments without waiting for a reaction tap", async () => {
    const actions = connectedActions(initialConversation);
    renderControl(actions, { notes: [], reactions: [] });

    expect(
      await screen.findByRole("list", { name: "Notes from family" }),
    ).toHaveTextContent("The quiet ride home was my favorite part.");
    expect(actions.load).toHaveBeenCalledWith({ momentId: "moment-one" });
  });

  it("opens a compact note field inline with only Cancel and Save", async () => {
    const user = userEvent.setup();
    renderControl();

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    const note = screen.getByRole("textbox", { name: "Add a family note" });
    expect(note).toHaveFocus();
    const form = note.closest("form")!;
    expect(
      within(form)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Cancel", "Save"]);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.type(note, "Keep this draft?");
    await user.click(within(form).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("textbox", { name: "Add a family note" }),
    ).toBeNull();
  });

  it("saves a note inline and immediately shows its author and text", async () => {
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
    actions.load
      .mockResolvedValueOnce({ ok: true, conversation: empty })
      .mockResolvedValueOnce({ ok: true, conversation: saved });
    const user = userEvent.setup();
    renderControl(actions, empty);

    await user.click(
      screen.getByRole("button", { name: /Add a note to photo/u }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Add a family note" }),
      "The sky was even better in person.",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    await user.click(screen.getByRole("button", { name: "Save" }));

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
    actions.load
      .mockResolvedValueOnce({ ok: true, conversation: owned })
      .mockResolvedValue({ ok: true, conversation: updated });
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
