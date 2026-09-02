import { describe, expect, it } from "vitest";
import {
  formatBibleVerseMoment,
  searchBibleVerses,
} from "./bible-verse-catalog";

describe("Bible verse catalog", () => {
  it("matches references and words without punctuation sensitivity", () => {
    expect(
      searchBibleVerses("John 3 16").map((verse) => verse.reference),
    ).toEqual(["John 3:16"]);
    expect(searchBibleVerses("love is patient")[0]?.reference).toBe(
      "1 Corinthians 13:4–7",
    );
  });

  it("formats a selected verse for the existing private written-moment path", () => {
    expect(formatBibleVerseMoment("John 3:16", "  A verse.  ")).toBe(
      "A verse.\n\n— John 3:16 · World English Bible",
    );
  });
});
