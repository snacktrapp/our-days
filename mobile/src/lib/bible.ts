import bookIndex from "../../../src/features/composer/data/web-index.json" with { type: "json" };

export type BibleVerse = Readonly<{
  reference: string;
  text: string;
}>;

export type BibleVerseSelection = Readonly<{
  book: string | null;
  chapter: number | null;
  startVerse: number | null;
  endVerse: number | null;
}>;

type IndexBook = Readonly<{ name: string; verses: readonly number[] }>;

type Catalog = Readonly<{
  books: readonly {
    name: string;
    chapters: readonly (readonly string[])[];
  }[];
}>;

const momentBodyLimit = 4000;
const books = bookIndex as readonly IndexBook[];
const booksByName = new Map(books.map((book) => [book.name, book]));

let catalog: Catalog | null = null;

export const emptyBibleVerseSelection: BibleVerseSelection = {
  book: null,
  chapter: null,
  startVerse: null,
  endVerse: null,
};

export function bibleBookNames() {
  return books.map((book) => book.name);
}

export function chaptersInBook(book: string) {
  const found = booksByName.get(book);
  if (!found) return [];
  return found.verses.map((_, index) => index + 1);
}

export function versesInChapter(book: string, chapter: number) {
  const count = booksByName.get(book)?.verses[chapter - 1];
  if (!count) return [];
  return Array.from({ length: count }, (_, index) => index + 1);
}

export function formatBibleVerseReference(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
) {
  if (startVerse === endVerse) return `${book} ${chapter}:${startVerse}`;
  return `${book} ${chapter}:${startVerse}–${endVerse}`;
}

/** Same body the web saves for a Bible verse. */
export function formatBibleVerseMoment(reference: string, text: string) {
  return `${text.trim()}\n\n— ${reference.trim()} · World English Bible`;
}

const bibleVerseMomentPattern = /^([\s\S]+)\n\n— ([^\n]+) · World English Bible$/u;

/** Web `parseBibleVerseReference`: "John 3:16–17" back to a selection. */
export function parseBibleVerseReference(reference: string): BibleVerseSelection | null {
  const trimmed = reference.trim();
  const book = [...bibleBookNames()]
    .sort((left, right) => right.length - left.length)
    .find((name) => trimmed === name || trimmed.startsWith(`${name} `));
  if (!book) return null;
  const rest = trimmed.slice(book.length).trim();
  const match = /^(\d+):(\d+)(?:[–-](\d+))?$/u.exec(rest);
  if (!match) return null;
  const chapter = Number(match[1]);
  const startVerse = Number(match[2]);
  const endVerse = match[3] ? Number(match[3]) : startVerse;
  const available = versesInChapter(book, chapter);
  if (!available.includes(startVerse) || !available.includes(endVerse) || endVerse < startVerse) {
    return null;
  }
  return { book, chapter, startVerse, endVerse };
}

/** Web `parseBibleVerseMoment`: a saved verse body back to its parts, so Edit opens the verse picker. */
export function parseBibleVerseMoment(body: string) {
  const match = bibleVerseMomentPattern.exec(body);
  if (!match?.[1] || !match[2]) return null;
  const selection = parseBibleVerseReference(match[2]);
  if (!selection) return null;
  return { text: match[1], reference: match[2], selection };
}

export async function loadBibleCatalog() {
  // Import a local module. A direct dynamic import of the JSON, which lives
  // outside this package, is rewritten to a path Metro cannot resolve.
  catalog ??= (await import("./bible-catalog")).default;
  return catalog;
}

function passageFromCatalog(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
): BibleVerse | null {
  const available = versesInChapter(book, chapter);
  if (
    !available.includes(startVerse) ||
    !available.includes(endVerse) ||
    endVerse < startVerse
  ) {
    return null;
  }
  const texts = catalog?.books.find((item) => item.name === book)?.chapters[
    chapter - 1
  ];
  if (!texts) return null;
  const text = texts
    .slice(startVerse - 1, endVerse)
    .join(" ")
    .trim();
  if (!text) return null;
  const reference = formatBibleVerseReference(
    book,
    chapter,
    startVerse,
    endVerse,
  );
  if (formatBibleVerseMoment(reference, text).length > momentBodyLimit) {
    return null;
  }
  return { reference, text };
}

export function endingVersesInChapter(
  book: string,
  chapter: number,
  startVerse: number,
) {
  const candidates = versesInChapter(book, chapter).filter(
    (verse) => verse >= startVerse,
  );
  if (!catalog) return candidates;
  return candidates.filter((endVerse) =>
    passageFromCatalog(book, chapter, startVerse, endVerse),
  );
}

export async function selectBiblePassage(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
) {
  await loadBibleCatalog();
  return passageFromCatalog(book, chapter, startVerse, endVerse);
}
