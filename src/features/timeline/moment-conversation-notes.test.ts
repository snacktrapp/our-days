import { describe, expect, it } from "vitest";
import {
  hiddenConversationNoteCount,
  visibleConversationNotes,
} from "./moment-conversation-notes";

describe("visibleConversationNotes", () => {
  const notes = ["oldest", "fourth", "third", "second", "newest"] as const;

  it("shows the four newest notes first in the collapsed window", () => {
    expect(visibleConversationNotes(notes, false)).toEqual([
      "newest",
      "second",
      "third",
      "fourth",
    ]);
    expect(hiddenConversationNoteCount(notes.length)).toBe(1);
    expect(hiddenConversationNoteCount(4)).toBe(0);
  });

  it("keeps newest-first order when Show more reveals older notes", () => {
    expect(visibleConversationNotes(notes, true)).toEqual([
      "newest",
      "second",
      "third",
      "fourth",
      "oldest",
    ]);
  });

  it("leaves a short thread unchanged except for newest-first order", () => {
    expect(visibleConversationNotes(["older", "newer"], false)).toEqual([
      "newer",
      "older",
    ]);
    expect(hiddenConversationNoteCount(4)).toBe(0);
    expect(visibleConversationNotes(["only"], false)).toEqual(["only"]);
  });
});
