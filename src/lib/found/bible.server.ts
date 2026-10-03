import "server-only";

import {
  bibleBookNames,
  loadWebCatalog,
} from "@/features/composer/bible-verse-catalog";
import { canonicalFoundText } from "./normalize.server";

const ebibleCodes = [
  "GEN",
  "EXO",
  "LEV",
  "NUM",
  "DEU",
  "JOS",
  "JDG",
  "RUT",
  "1SA",
  "2SA",
  "1KI",
  "2KI",
  "1CH",
  "2CH",
  "EZR",
  "NEH",
  "EST",
  "JOB",
  "PSA",
  "PRO",
  "ECC",
  "SNG",
  "ISA",
  "JER",
  "LAM",
  "EZK",
  "DAN",
  "HOS",
  "JOL",
  "AMO",
  "OBA",
  "JON",
  "MIC",
  "NAM",
  "HAB",
  "ZEP",
  "HAG",
  "ZEC",
  "MAL",
  "MAT",
  "MRK",
  "LUK",
  "JHN",
  "ACT",
  "ROM",
  "1CO",
  "2CO",
  "GAL",
  "EPH",
  "PHP",
  "COL",
  "1TH",
  "2TH",
  "1TI",
  "2TI",
  "TIT",
  "PHM",
  "HEB",
  "JAS",
  "1PE",
  "2PE",
  "1JN",
  "2JN",
  "3JN",
  "JUD",
  "REV",
] as const;

const bookAliases: Readonly<Record<string, string>> = {
  psalms: "Psalm",
  "song of songs": "Song of Solomon",
  canticles: "Song of Solomon",
  revelations: "Revelation",
};

export type BibleVerseSpan = Readonly<{
  book: string;
  chapter: number;
  verse: number;
  start: number;
  end: number;
}>;

export function resolveBibleBook(name: string) {
  const trimmed = name.trim();
  const direct = bibleBookNames().find(
    (book) => book.toLowerCase() === trimmed.toLowerCase(),
  );
  if (direct) return direct;
  return bookAliases[trimmed.toLowerCase()] ?? null;
}

export function ebibleChapterUrl(book: string, chapter: number) {
  const index = bibleBookNames().indexOf(book);
  const code = ebibleCodes[index];
  if (!code || chapter < 1) return null;
  return `https://ebible.org/engwebp/${code}${String(chapter).padStart(3, "0")}.htm`;
}

export async function loadBiblePassage(
  bookName: string,
  chapter: number,
  startVerse: number,
  endVerse: number,
) {
  const book = resolveBibleBook(bookName);
  if (!book || !Number.isInteger(chapter) || chapter < 1) return null;
  const catalog = await loadWebCatalog();
  const chapters = catalog.books.find((item) => item.name === book)?.chapters;
  const verses = chapters?.[chapter - 1];
  if (!verses?.length) return null;
  const start = Math.max(1, Math.min(startVerse, verses.length));
  const end = Math.max(start, Math.min(endVerse, start + 11, verses.length));
  let text = "";
  const verseSpans: BibleVerseSpan[] = [];
  for (let verse = start; verse <= end; verse += 1) {
    const verseText = canonicalFoundText(verses[verse - 1] ?? "").trim();
    if (!verseText) continue;
    if (text) text += " ";
    const spanStart = text.length;
    text += verseText;
    verseSpans.push({
      book,
      chapter,
      verse,
      start: spanStart,
      end: text.length,
    });
  }
  if (!text) return null;
  const sourceUrl = ebibleChapterUrl(book, chapter);
  if (!sourceUrl) return null;
  return { book, chapter, text, verseSpans, sourceUrl };
}
