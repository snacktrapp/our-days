import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  formatBibleVerseMoment,
  selectBiblePassage,
} from "@/features/composer/bible-verse-catalog";
import { MomentCard } from "./moment-card";
import type {
  MomentInteractionViewModel,
  ThoughtMomentViewModel,
} from "./timeline-view-model";

vi.mock("next/navigation", () => ({
  usePathname: () => "/family",
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

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
