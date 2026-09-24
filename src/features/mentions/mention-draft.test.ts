import { describe, expect, it } from "vitest";
import {
  applyMentionTextChange,
  draftFromMentionDisplay,
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  mentionsForSavedBody,
  type DraftMention,
  type MentionCandidate,
} from "./mention-draft";

const molly: MentionCandidate = {
  userId: "user-molly",
  name: "Molly",
  initial: "M",
  accent: "sage",
};

describe("mention drafts", () => {
  it("opens a query at @ and filters circle members", () => {
    expect(mentionQueryAt("Hello @Mo", 9, [])).toEqual({
      start: 6,
      query: "Mo",
    });
    expect(mentionQueryAt("email@home", 10, [])).toBeNull();
    expect(
      filterMentionCandidates(
        [molly, { ...molly, userId: "user-mary", name: "Mary Ann" }],
        "mo",
      ).map((member) => member.name),
    ).toEqual(["Molly"]);
    expect(
      filterMentionCandidates(
        [
          molly,
          { ...molly, userId: "user-nana", name: "Nana", initial: "N" },
          { ...molly, userId: "user-ann", name: "Ann", initial: "A" },
        ],
        "an",
      ).map((member) => member.name),
    ).toEqual(["Ann", "Nana"]);
    expect(
      filterMentionCandidates(
        [molly, { ...molly, userId: "user-nana", name: "Nana" }],
        "",
      ),
    ).toHaveLength(2);
    expect(filterMentionCandidates([molly], "zzz")).toEqual([]);
  });

  it("inserts @Name with a trailing space and deletes the whole mention on backspace", () => {
    const inserted = insertMention("Hi @Mo", 6, 3, molly, []);
    expect(inserted.text).toBe("Hi @Molly ");
    expect(inserted.mentions).toEqual([
      { userId: "user-molly", name: "Molly", start: 3, end: 9 },
    ]);
    const cleared = applyMentionTextChange(
      inserted.text,
      "Hi @Moll ",
      inserted.mentions,
    );
    expect(cleared.mentions).toEqual([]);
    expect(cleared.text).not.toContain("@Molly");
    expect(cleared.text.startsWith("Hi ")).toBe(true);
  });

  it("keeps mentions that sit outside an edit and aligns them to the trimmed body", () => {
    const mentions: DraftMention[] = [
      { userId: "user-molly", name: "Molly", start: 3, end: 9 },
    ];
    const text = "Hi @Molly there";
    expect(applyMentionTextChange(text, "Hey @Molly there", mentions)).toEqual({
      text: "Hey @Molly there",
      mentions: [{ userId: "user-molly", name: "Molly", start: 4, end: 10 }],
      cursor: 3,
    });
    expect(
      mentionsForSavedBody(`  ${text}  `, [
        { userId: "user-molly", name: "Molly", start: 5, end: 11 },
      ]),
    ).toEqual([{ userId: "user-molly", start: 3, end: 9 }]);
  });

  it("stores emoji captions with Postgres character offsets and rewrites the editor in UTF-16", () => {
    const text = "🎂 @Molly";
    expect(
      mentionsForSavedBody(text, [
        { userId: "user-molly", name: "Molly", start: 3, end: 9 },
      ]),
    ).toEqual([{ userId: "user-molly", start: 2, end: 8 }]);
    const cleared = applyMentionTextChange(text, "🎂 @Moll", [
      { userId: "user-molly", name: "Molly", start: 3, end: 9 },
    ]);
    expect(cleared.text).toBe("🎂 ");
    expect(cleared.cursor).toBe(3);
    expect(
      draftFromMentionDisplay("🎂 @Molly", [
        {
          userId: "user-molly",
          start: 2,
          end: 8,
          name: "Molly",
          active: true,
        },
      ]).mentions,
    ).toEqual([{ userId: "user-molly", name: "Molly", start: 3, end: 9 }]);
  });
});
