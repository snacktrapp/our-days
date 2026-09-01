import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
      name: /Open private notes for thought .* by Journal person/u,
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
        name: /Respond to thought .* by Journal person/u,
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
        name: /Open private notes for thought .* by Journal person/u,
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
        name: /Open private notes for thought .* by Journal person/u,
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
      name: /Open private notes for thought .* by Journal person/u,
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
      name: /Respond to thought .* by Journal person/u,
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
        name: /Open private notes for thought .* by Journal person/u,
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

  it("lazy-loads a connected conversation and persists one replaceable response", async () => {
    const user = userEvent.setup();
    const connectedConversation = {
      notes: [],
      reactions: [
        {
          id: "reaction-current",
          personName: "Current person",
          personInitial: "C",
          personAccent: "teal" as const,
          reactionId: "held-close" as const,
          isCurrentMember: true,
        },
      ],
    };
    const actions = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: connectedConversation,
        })
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: {
            notes: [],
            reactions: [
              {
                ...connectedConversation.reactions[0],
                reactionId: "made-me-smile" as const,
              },
            ],
          },
        }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn().mockResolvedValue({
        ok: true,
        message: "Response saved.",
      }),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: /Respond to thought .* by Journal person/u,
      }),
    );
    expect(
      await screen.findByText("Private to Cedar Circle"),
    ).toBeInTheDocument();
    const group = screen.getByRole("group", { name: "Your response" });
    expect(
      within(group).getByRole("button", { name: "Hold close" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(
      within(group).getByRole("button", { name: "Made me smile" }),
    );
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(actions.setReaction).toHaveBeenCalledWith({
      momentId: "moment-one",
      reactionId: "made-me-smile",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Response saved.");
    expect(screen.queryByText("Local preview · Nothing is saved")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.getByRole("button", {
        name: /Respond to thought .* by Journal person/u,
      }),
    ).toHaveTextContent("✦ Made me smile");
  });

  it("acknowledges a saved note on the closed moment without exposing its body", async () => {
    const user = userEvent.setup();
    const savedNote = {
      id: "saved-note",
      authorName: "Current person",
      authorInitial: "C",
      authorAccent: "teal" as const,
      body: "A newly saved private detail.",
      displayDate: "Aug 2, 2026",
      revision: 1,
      canChange: true,
    };
    const actions = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: { notes: [], reactions: [] },
        })
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: { notes: [savedNote], reactions: [] },
        }),
      createNote: vi.fn().mockResolvedValue({ ok: true as const }),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn(),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Open private notes for thought/u }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Your note to the family" }),
      savedNote.body,
    );
    await user.click(screen.getByRole("button", { name: "Save note" }));
    expect(await screen.findByText(savedNote.body)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(
      screen.getByRole("button", { name: /Open private notes for thought/u }),
    ).toHaveTextContent("Note saved");
    expect(screen.queryByText(savedNote.body)).toBeNull();
  });

  it("clears stale private bodies and disables mutations after a later load failure", async () => {
    const user = userEvent.setup();
    const actions = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: {
            notes: [
              {
                id: "private-note",
                authorName: "Family member",
                authorInitial: "F",
                authorAccent: "ochre" as const,
                body: noteCanary,
                displayDate: "Aug 2, 2026",
              },
            ],
            reactions: [],
          },
        })
        .mockResolvedValue({
          ok: false as const,
          message: "This moment is no longer available.",
        }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn(),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    const notesOpener = screen.getByRole("button", {
      name: /Open private notes for thought/u,
    });
    await user.click(notesOpener);
    expect(await screen.findByText(noteCanary)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(notesOpener);
    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent("This moment is no longer available.");
    expect(screen.queryByText(noteCanary)).toBeNull();
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Save response" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
  });

  it("restores stable focus after editing or removing an owned note", async () => {
    const user = userEvent.setup();
    const ownedNote = {
      id: "owned-note",
      authorName: "Current person",
      authorInitial: "C",
      authorAccent: "teal" as const,
      body: "My remembered detail.",
      displayDate: "Aug 2, 2026",
      revision: 1,
      canChange: true,
    };
    const actions = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: { notes: [ownedNote], reactions: [] },
        })
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: {
            notes: [
              { ...ownedNote, body: "My corrected detail.", revision: 2 },
            ],
            reactions: [],
          },
        })
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: { notes: [], reactions: [] },
        }),
      createNote: vi.fn(),
      updateNote: vi.fn().mockResolvedValue({ ok: true, revision: 2 }),
      trashNote: vi.fn().mockResolvedValue({ ok: true, revision: 3 }),
      setReaction: vi.fn(),
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Open private notes for thought/u }),
    );
    await user.click(await screen.findByRole("button", { name: /^Edit —/u }));
    const editBox = screen.getByRole("textbox", {
      name: "Edit your family note",
    });
    await user.clear(editBox);
    await user.type(editBox, "My corrected detail.");
    await user.click(screen.getAllByRole("button", { name: "Save note" })[0]);
    expect(
      await screen.findByRole("heading", { name: "Notes from family" }),
    ).toHaveFocus();
    await user.click(screen.getByRole("button", { name: /^Remove —/u }));
    expect(
      await screen.findByRole("heading", { name: "Notes from family" }),
    ).toHaveFocus();
    expect(screen.queryByText("My corrected detail.")).toBeNull();
  });

  it("protects an in-progress owned-note edit from every dialog dismissal", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ownedNote = {
      id: "owned-note",
      authorName: "Current person",
      authorInitial: "C",
      authorAccent: "teal" as const,
      body: "Original detail.",
      displayDate: "Aug 2, 2026",
      revision: 1,
      canChange: true,
    };
    const actions = {
      load: vi.fn().mockResolvedValue({
        ok: true as const,
        conversation: {
          notes: [ownedNote],
          reactions: [
            {
              id: "current-reaction",
              personName: "Current person",
              personInitial: "C",
              personAccent: "teal" as const,
              reactionId: "held-close" as const,
              isCurrentMember: true,
            },
          ],
        },
      }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn(),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Open private notes for thought/u }),
    );
    await user.click(await screen.findByRole("button", { name: /^Edit —/u }));
    const editBox = screen.getByRole("textbox", {
      name: "Edit your family note",
    });
    await user.clear(editBox);
    await user.type(editBox, "Changed but not saved.");

    fireEvent(
      screen.getByRole("dialog"),
      new Event("cancel", { cancelable: true }),
    );

    expect(confirm).toHaveBeenCalledWith("Discard this unsaved note?");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(editBox).toHaveValue("Changed but not saved.");
  });

  it("does not warn when an owned note was opened for editing but not changed", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const ownedNote = {
      id: "owned-note",
      authorName: "Current person",
      authorInitial: "C",
      authorAccent: "teal" as const,
      body: "Original detail.",
      displayDate: "Aug 2, 2026",
      revision: 1,
      canChange: true,
    };
    const actions = {
      load: vi.fn().mockResolvedValue({
        ok: true as const,
        conversation: { notes: [ownedNote], reactions: [] },
      }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn(),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    const opener = screen.getByRole("button", {
      name: /Open private notes for thought/u,
    });
    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: /^Edit —/u }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });

  it("describes a dirty response removal together with an unsaved note", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const actions = {
      load: vi.fn().mockResolvedValue({
        ok: true as const,
        conversation: {
          notes: [],
          reactions: [
            {
              id: "current-reaction",
              personName: "Current person",
              personInitial: "C",
              personAccent: "teal" as const,
              reactionId: "held-close" as const,
              isCurrentMember: true,
            },
          ],
        },
      }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn(),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Open private notes for thought/u }),
    );
    await user.type(
      await screen.findByRole("textbox", { name: "Your note to the family" }),
      "Keep this draft.",
    );
    await user.click(screen.getByRole("button", { name: "Hold close" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(confirm).toHaveBeenCalledWith(
      "Discard this unsaved note and response?",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("restores retry focus after repeated failure and section focus after recovery", async () => {
    const user = userEvent.setup();
    const actions = {
      load: vi
        .fn()
        .mockResolvedValueOnce({ ok: false as const, message: "Unavailable." })
        .mockResolvedValueOnce({
          ok: false as const,
          message: "Still unavailable.",
        })
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: { notes: [], reactions: [] },
        }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn(),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Open private notes for thought/u }),
    );
    const firstRetry = await screen.findByRole("button", { name: "Try again" });
    await user.click(firstRetry);
    const secondRetry = await screen.findByRole("button", {
      name: "Try again",
    });
    await waitFor(() => expect(secondRetry).toHaveFocus());

    await user.click(secondRetry);
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Notes from family" }),
      ).toHaveFocus(),
    );
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("announces durable reaction success and stays clean when refresh fails", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const actions = {
      load: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true as const,
          conversation: { notes: [], reactions: [] },
        })
        .mockResolvedValueOnce({
          ok: false as const,
          message: "Refresh unavailable.",
        }),
      createNote: vi.fn(),
      updateNote: vi.fn(),
      trashNote: vi.fn(),
      setReaction: vi.fn().mockResolvedValue({
        ok: true as const,
        message: "Response saved.",
      }),
    };
    render(
      <MomentConversationControl
        interaction={{ ...interaction, audienceName: "Cedar Circle" }}
        model={{ ...model, conversation: { notes: [], reactions: [] } }}
        actions={actions}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Respond to thought/u }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Made me smile" }),
    );
    await user.click(screen.getByRole("button", { name: "Save response" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your response was saved, but this conversation needs to be reopened.",
    );
    expect(
      screen.getByRole("heading", { name: "A quiet response" }),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
