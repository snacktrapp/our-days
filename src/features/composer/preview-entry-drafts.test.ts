import { afterEach, describe, expect, it } from "vitest";
import { emptyBibleVerseSelection } from "./bible-verse-catalog";
import { entryDraftCapMessage, maximumEntryDrafts } from "./entry-drafts";
import {
  createPreviewEntryDraftActions,
  resetPreviewEntryDrafts,
} from "./preview-entry-drafts";
import { emptyPlaceSelection } from "@/lib/place-coordinates";

function sampleInput(index = 1) {
  return {
    kind: "thought" as const,
    title: `Draft ${index}`,
    body: `Body ${index}`,
    audience: "family" as const,
    circleIds: [],
    journalPersonId: "person",
    taggedPersonIds: [],
    place: emptyPlaceSelection(),
    occurredOn: "2026-09-08",
    occurredTime: "09:15",
    occurredTimezone: "UTC",
    media: [],
    verse: emptyBibleVerseSelection,
  };
}

afterEach(() => {
  resetPreviewEntryDrafts();
});

describe("preview entry drafts", () => {
  it("saves, lists, updates, and deletes a draft", async () => {
    const actions = createPreviewEntryDraftActions();
    const saved = await actions.save(sampleInput());
    expect(saved.ok).toBe(true);
    const listed = await actions.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.previewText).toBe("Draft 1");
    const loaded = await actions.load(saved.id!);
    expect(loaded?.body).toBe("Body 1");
    await actions.save({ ...sampleInput(), id: saved.id, body: "Updated" });
    expect(await actions.list()).toHaveLength(1);
    expect((await actions.load(saved.id!))?.body).toBe("Updated");
    await actions.remove(saved.id!);
    expect(await actions.list()).toHaveLength(0);
  });

  it("refuses a 21st draft", async () => {
    const actions = createPreviewEntryDraftActions();
    for (let index = 1; index <= maximumEntryDrafts; index += 1) {
      const result = await actions.save(sampleInput(index));
      expect(result.ok).toBe(true);
    }
    const overflow = await actions.save(sampleInput(21));
    expect(overflow).toEqual({
      ok: false,
      message: entryDraftCapMessage,
    });
  });
});
