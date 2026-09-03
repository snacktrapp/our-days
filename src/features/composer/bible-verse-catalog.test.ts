import { describe, expect, it } from "vitest";
import {
  bibleBookNames,
  chaptersInBook,
  endingVersesInChapter,
  formatBibleVerseMoment,
  loadWebCatalog,
  previewBiblePassage,
  selectBiblePassage,
  versesInChapter,
} from "./bible-verse-catalog";

describe("Bible verse catalog", () => {
  it("exposes the Protestant 66-book World English Bible for cascaded pickers", async () => {
    const books = bibleBookNames();
    expect(books).toHaveLength(66);
    expect(books[0]).toBe("Genesis");
    expect(books.at(-1)).toBe("Revelation");
    expect(chaptersInBook("Psalm")).toHaveLength(150);
    expect(versesInChapter("John", 3)).toEqual(
      Array.from({ length: 36 }, (_, index) => index + 1),
    );
    expect(versesInChapter("Obadiah", 1).at(-1)).toBe(21);
    expect(chaptersInBook("Unknown")).toEqual([]);
    expect(versesInChapter("John", 99)).toEqual([]);

    await loadWebCatalog();
    expect(endingVersesInChapter("John", 3, 16)).toEqual(
      Array.from({ length: 21 }, (_, index) => index + 16),
    );
    expect(endingVersesInChapter("John", 3, 16)[0]).toBe(16);
  });

  it("fills a single verse and a same-chapter range from the public-domain WEB", async () => {
    const john = await selectBiblePassage("John", 3, 16, 16);
    expect(john).toEqual({
      reference: "John 3:16",
      text: "For God so loved the world, that he gave his only born Son, that whoever believes in him should not perish, but have eternal life.",
    });
    expect(previewBiblePassage("John", 3, 16, 17)?.text).toContain(
      "should be saved through him",
    );

    const corinthians = await selectBiblePassage("1 Corinthians", 13, 4, 7);
    expect(corinthians?.reference).toBe("1 Corinthians 13:4–7");
    expect(corinthians?.text).toContain("Love is patient");
    expect(corinthians?.text).toContain("endures all things.");

    expect(await selectBiblePassage("John", 3, 18, 16)).toBeNull();
    expect(await selectBiblePassage("John", 3, 16, 99)).toBeNull();
  });

  it("formats a selected verse for the existing private written-moment path", () => {
    expect(formatBibleVerseMoment("John 3:16", "  A verse.  ")).toBe(
      "A verse.\n\n— John 3:16 · World English Bible",
    );
  });
});
