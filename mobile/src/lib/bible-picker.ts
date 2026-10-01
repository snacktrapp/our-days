import {
  chaptersInBook,
  endingVersesInChapter,
  versesInChapter,
  bibleBookNames,
  type BibleVerseSelection,
} from "./bible";

/** Matthew is the first New Testament book in the WEB index. */
const newTestamentStart = "Matthew";

export type BibleBookGroup = Readonly<{
  testament: "Old Testament" | "New Testament";
  books: readonly string[];
}>;

/**
 * Books for the passage sheet, split into testaments. A query matches anywhere
 * in the name, so "john" finds John and the letters, and an empty query is the
 * full canon. Groups with no matches are left out.
 */
export function bibleBookGroups(query: string): readonly BibleBookGroup[] {
  const names = bibleBookNames();
  const split = names.indexOf(newTestamentStart);
  const oldEnd = split === -1 ? names.length : split;
  const needle = query.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  const groups: BibleBookGroup[] = [];
  const oldBooks = names.slice(0, oldEnd).filter(matches);
  const newBooks = names.slice(oldEnd).filter(matches);
  if (oldBooks.length > 0) groups.push({ testament: "Old Testament", books: oldBooks });
  if (newBooks.length > 0) groups.push({ testament: "New Testament", books: newBooks });
  return groups;
}

/** Sheet stays under the status bar and above the keyboard. */
export function passageSheetMaxHeight(
  input: Readonly<{ windowHeight: number; topInset: number; keyboardHeight: number }>,
) {
  return Math.max(
    160,
    input.windowHeight - input.topInset - Math.max(0, input.keyboardHeight) - 8,
  );
}

export function bibleNumberChoices(
  picker: "chapter" | "start" | "end",
  verse: BibleVerseSelection,
): readonly number[] {
  if (!verse.book) return [];
  if (picker === "chapter") return chaptersInBook(verse.book);
  if (!verse.chapter) return [];
  if (picker === "start") return versesInChapter(verse.book, verse.chapter);
  if (!verse.startVerse) return [];
  return endingVersesInChapter(verse.book, verse.chapter, verse.startVerse);
}
