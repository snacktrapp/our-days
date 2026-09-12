import { describe, expect, it } from "vitest";
import {
  hiddenConversationNoteCount,
  visibleConversationNotes,
} from "./moment-conversation-notes";

describe("visibleConversationNotes", () => {
  const notes = ["oldest", "middle", "newest"] as const;

  it("shows the newest notes first in the collapsed window", () => {
    expect(visibleConversationNotes(notes, false)).toEqual([
      "newest",
      "middle",
    ]);
    expect(hiddenConversationNoteCount(notes.length)).toBe(1);
  });

  it("keeps newest-first order when Show more reveals older notes", () => {
    expect(visibleConversationNotes(notes, true)).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("leaves a short thread unchanged except for newest-first order", () => {
    expect(visibleConversationNotes(["older", "newer"], false)).toEqual([
      "newer",
      "older",
    ]);
    expect(hiddenConversationNoteCount(2)).toBe(0);
    expect(visibleConversationNotes(["only"], false)).toEqual(["only"]);
  });
});
