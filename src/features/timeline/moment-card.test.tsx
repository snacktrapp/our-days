import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  formatBibleVerseMoment,
  selectBiblePassage,
} from "@/features/composer/bible-verse-catalog";
import { MomentCard } from "./moment-card";
import { thoughtCopyOverflows } from "./thought-copy-overflow";
import type {
  MomentInteractionViewModel,
  ThoughtMomentViewModel,
} from "./timeline-view-model";

vi.mock("./thought-copy-overflow", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./thought-copy-overflow")>();
  return {
    ...actual,
    thoughtCopyOverflows: vi.fn(actual.thoughtCopyOverflows),
  };
});

const interaction = {
  currentPerson: { name: "Brian", initial: "B", accent: "teal" },
  reactionOptions: [
    { id: "held-close", label: "Held close", symbol: "♡" },
    { id: "made-me-smile", label: "Made me smile", symbol: "⌣" },
    { id: "remember-this", label: "Remember this", symbol: "✦" },
  ],
} as const satisfies MomentInteractionViewModel;

const thought = {
  id: "thought-moment",
  journalPersonId: "person-1",
  kind: "thought",
  personName: "Molly",
  personInitial: "M",
  personAccent: "clay",
  displayDate: "Aug 28, 2026",
  occurredOn: "2026-08-28",
  kicker: "A thought",
  text: "Worth keeping.",
  conversation: { notes: [], reactions: [] },
} as const satisfies ThoughtMomentViewModel;

function conversationActions() {
  return {
    load: vi.fn().mockResolvedValue({
      ok: true,
      conversation: { notes: [], reactions: [] },
    }),
    createNote: vi.fn(),
    updateNote: vi.fn(),
    trashNote: vi.fn(),
    setReaction: vi.fn().mockResolvedValue({ ok: true, message: "Saved" }),
  };
}

function doubleTap(target: Element) {
  fireEvent.click(target, { detail: 1 });
  fireEvent.click(target, { detail: 2 });
}

describe("MomentCard double-tap heart", () => {
  it("hearts another family member's note with the existing heart reaction", async () => {
    const actions = conversationActions();
    render(
      <MomentCard
        interaction={interaction}
        conversationActions={actions}
        moment={thought}
      />,
    );

    doubleTap(screen.getByText(/Worth keeping/u).closest("blockquote")!);

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "thought-moment",
        reactionId: "held-close",
      }),
    );
  });

  it("hearts a Bible verse on double-tap of the verse text", async () => {
    const actions = conversationActions();
    const passage = await selectBiblePassage("Isaiah", 40, 28, 28);
    expect(passage).not.toBeNull();
    render(
      <MomentCard
        interaction={interaction}
        conversationActions={actions}
        moment={{
          ...thought,
          id: "verse-moment",
          text: formatBibleVerseMoment(passage!.reference, passage!.text),
        }}
      />,
    );

    doubleTap(screen.getByText(/everlasting God/u).closest("blockquote")!);

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "verse-moment",
        reactionId: "held-close",
      }),
    );
  });
});

describe("MomentCard long thought copy", () => {
  it("leaves a short note unclamped", () => {
    render(<MomentCard moment={thought} />);

    expect(
      screen.queryByRole("button", { name: "See more" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Worth keeping/u).closest("blockquote"),
    ).not.toHaveClass("thought-copy-clamped");
  });

  it("shows five lines then See more on a long note, and See less after expand", async () => {
    vi.mocked(thoughtCopyOverflows).mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MomentCard
        moment={{
          ...thought,
          text: "Tonight the kitchen was loud enough to fill the whole screen.",
        }}
      />,
    );

    const quote = screen.getByText(/kitchen was loud/u).closest("blockquote");
    expect(quote).toHaveClass("thought-copy-clamped");
    const more = screen.getByRole("button", { name: "See more" });
    expect(more).toHaveClass("thought-more");
    expect(more).toHaveAttribute("aria-expanded", "false");

    await user.click(more);
    expect(quote).not.toHaveClass("thought-copy-clamped");
    expect(screen.getByRole("button", { name: "See less" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "See less" }));
    expect(quote).toHaveClass("thought-copy-clamped");
    expect(screen.getByRole("button", { name: "See more" })).toBeVisible();
    vi.mocked(thoughtCopyOverflows).mockReset();
  });

  it("keeps double-tap heart on a clamped Bible verse", async () => {
    vi.mocked(thoughtCopyOverflows).mockReturnValue(true);
    const actions = conversationActions();
    const passage = await selectBiblePassage("Leviticus", 12, 1, 8);
    expect(passage).not.toBeNull();
    render(
      <MomentCard
        interaction={interaction}
        conversationActions={actions}
        moment={{
          ...thought,
          id: "long-verse-moment",
          text: formatBibleVerseMoment(passage!.reference, passage!.text),
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "See more" })).toBeVisible();
    doubleTap(screen.getByText(/Leviticus/u).closest("blockquote")!);

    await waitFor(() =>
      expect(actions.setReaction).toHaveBeenCalledWith({
        momentId: "long-verse-moment",
        reactionId: "held-close",
      }),
    );
    vi.mocked(thoughtCopyOverflows).mockReset();
  });
});
