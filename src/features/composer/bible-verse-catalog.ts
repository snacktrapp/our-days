import bibleBookIndex from "./data/web-index.json";

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

type WebIndexBook = Readonly<{
  name: string;
  verses: readonly number[];
}>;

type WebCatalogBook = Readonly<{
  name: string;
  chapters: readonly (readonly string[])[];
}>;

type WebCatalog = Readonly<{
  attribution: string;
  books: readonly WebCatalogBook[];
}>;

const momentBodyLimit = 4000;
const webIndex = bibleBookIndex as readonly WebIndexBook[];
const booksByName = new Map(webIndex.map((book) => [book.name, book]));

let catalogPromise: Promise<WebCatalog> | null = null;
let loadedCatalog: WebCatalog | null = null;

export const emptyBibleVerseSelection: BibleVerseSelection = {
  book: null,
  chapter: null,
  startVerse: null,
  endVerse: null,
};

export function bibleBookNames() {
  return webIndex.map((book) => book.name);
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

export function formatBibleVerseMoment(reference: string, text: string) {
  return `${text.trim()}\n\n— ${reference.trim()} · World English Bible`;
}

const bibleVerseMomentPattern =
  /^([\s\S]+)\n\n— ([^\n]+) · World English Bible$/u;

export function parseBibleVerseReference(
  reference: string,
): BibleVerseSelection | null {
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
  if (
    !available.includes(startVerse) ||
    !available.includes(endVerse) ||
    endVerse < startVerse
  ) {
    return null;
  }
  return { book, chapter, startVerse, endVerse };
}

export function parseBibleVerseMoment(body: string) {
  const match = bibleVerseMomentPattern.exec(body);
  if (!match) return null;
  const text = match[1];
  const reference = match[2];
  const selection = parseBibleVerseReference(reference);
  if (!selection) return null;
  return { text, reference, selection };
}

export function loadWebCatalog() {
  catalogPromise ??= import("./data/web-catalog.json").then((module) => {
    loadedCatalog = module.default as WebCatalog;
    return loadedCatalog;
  });
  return catalogPromise;
}

function passageFromLoadedCatalog(
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
  const texts = loadedCatalog?.books.find((item) => item.name === book)
    ?.chapters[chapter - 1];
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

export function previewBiblePassage(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
) {
  if (!loadedCatalog) return null;
  return passageFromLoadedCatalog(book, chapter, startVerse, endVerse);
}

export async function selectBiblePassage(
  book: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
) {
  await loadWebCatalog();
  return passageFromLoadedCatalog(book, chapter, startVerse, endVerse);
}

export function endingVersesInChapter(
  book: string,
  chapter: number,
  startVerse: number,
) {
  const candidates = versesInChapter(book, chapter).filter(
    (verse) => verse >= startVerse,
  );
  if (!loadedCatalog) return candidates;
  return candidates.filter((endVerse) =>
    passageFromLoadedCatalog(book, chapter, startVerse, endVerse),
  );
}
