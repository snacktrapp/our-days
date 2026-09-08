import { describe, expect, it } from "vitest";
import {
  entryDraftCapMessage,
  entryDraftKindLabel,
  entryDraftPreviewText,
  formatEntryDraftRowLabel,
  isEntryDraftKind,
  maximumEntryDrafts,
} from "./entry-drafts";

describe("entry drafts helpers", () => {
  it("labels kinds and previews title before body", () => {
    expect(entryDraftKindLabel("thought")).toBe("Note");
    expect(entryDraftKindLabel("photo")).toBe("Photo");
    expect(
      entryDraftPreviewText({ title: "Park", body: "The kids ran." }),
    ).toBe("Park");
    expect(entryDraftPreviewText({ body: "The kids ran." })).toBe(
      "The kids ran.",
    );
    expect(entryDraftPreviewText({ mediaCount: 1 })).toBe("Media attached");
    expect(isEntryDraftKind("bible-verse")).toBe(true);
    expect(isEntryDraftKind("insight")).toBe(false);
  });

  it("formats a list row with type and saved time", () => {
    expect(
      formatEntryDraftRowLabel("thought", "2026-09-08T16:42:00.000Z"),
    ).toMatch(/^Note · /u);
    expect(maximumEntryDrafts).toBe(20);
    expect(entryDraftCapMessage).toMatch(/20/u);
  });
});
