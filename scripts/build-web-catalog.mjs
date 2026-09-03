import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Official World English Bible, public domain. 2020 stable Protestant text
// from eBible.org (engwebp). Download:
// https://ebible.org/Scriptures/engwebp_vpl.zip
const books = [
  ["GEN", "Genesis"],
  ["EXO", "Exodus"],
  ["LEV", "Leviticus"],
  ["NUM", "Numbers"],
  ["DEU", "Deuteronomy"],
  ["JOS", "Joshua"],
  ["JDG", "Judges"],
  ["RUT", "Ruth"],
  ["1SA", "1 Samuel"],
  ["2SA", "2 Samuel"],
  ["1KI", "1 Kings"],
  ["2KI", "2 Kings"],
  ["1CH", "1 Chronicles"],
  ["2CH", "2 Chronicles"],
  ["EZR", "Ezra"],
  ["NEH", "Nehemiah"],
  ["EST", "Esther"],
  ["JOB", "Job"],
  ["PSA", "Psalm"],
  ["PRO", "Proverbs"],
  ["ECC", "Ecclesiastes"],
  ["SOL", "Song of Solomon"],
  ["ISA", "Isaiah"],
  ["JER", "Jeremiah"],
  ["LAM", "Lamentations"],
  ["EZE", "Ezekiel"],
  ["DAN", "Daniel"],
  ["HOS", "Hosea"],
  ["JOE", "Joel"],
  ["AMO", "Amos"],
  ["OBA", "Obadiah"],
  ["JON", "Jonah"],
  ["MIC", "Micah"],
  ["NAH", "Nahum"],
  ["HAB", "Habakkuk"],
  ["ZEP", "Zephaniah"],
  ["HAG", "Haggai"],
  ["ZEC", "Zechariah"],
  ["MAL", "Malachi"],
  ["MAT", "Matthew"],
  ["MAR", "Mark"],
  ["LUK", "Luke"],
  ["JOH", "John"],
  ["ACT", "Acts"],
  ["ROM", "Romans"],
  ["1CO", "1 Corinthians"],
  ["2CO", "2 Corinthians"],
  ["GAL", "Galatians"],
  ["EPH", "Ephesians"],
  ["PHI", "Philippians"],
  ["COL", "Colossians"],
  ["1TH", "1 Thessalonians"],
  ["2TH", "2 Thessalonians"],
  ["1TI", "1 Timothy"],
  ["2TI", "2 Timothy"],
  ["TIT", "Titus"],
  ["PHM", "Philemon"],
  ["HEB", "Hebrews"],
  ["JAM", "James"],
  ["1PE", "1 Peter"],
  ["2PE", "2 Peter"],
  ["1JO", "1 John"],
  ["2JO", "2 John"],
  ["3JO", "3 John"],
  ["JUD", "Jude"],
  ["REV", "Revelation"],
];

const vplPath = process.argv[2];
if (!vplPath) {
  console.error(
    "Usage: node scripts/build-web-catalog.mjs /path/to/engwebp_vpl.txt",
  );
  process.exit(1);
}

const codeToName = new Map(books);
const versesByBook = new Map(books.map(([, name]) => [name, new Map()]));

for (const line of readFileSync(vplPath, "utf8").split(/\r?\n/u)) {
  if (!line.trim()) continue;
  const bookCode = line.slice(0, line.indexOf(" "));
  const rest = line.slice(bookCode.length + 1);
  const split = rest.indexOf(" ");
  const chapterVerse = rest.slice(0, split);
  const text = rest.slice(split + 1);
  const name = codeToName.get(bookCode);
  if (!name) {
    throw new Error(`Unexpected book code ${bookCode}`);
  }
  const [chapterText, verseText] = chapterVerse.split(":");
  const chapter = Number(chapterText);
  const verse = Number(verseText);
  const book = versesByBook.get(name);
  if (!book.has(chapter)) book.set(chapter, new Map());
  const chapterMap = book.get(chapter);
  if (chapterMap.has(verse)) {
    throw new Error(`Duplicate ${name} ${chapter}:${verse}`);
  }
  chapterMap.set(verse, text.trim().replace(/\s+/gu, " "));
}

const catalogBooks = [];
const indexBooks = [];
for (const [, name] of books) {
  const chapters = versesByBook.get(name);
  if (!chapters.size) throw new Error(`Missing ${name}`);
  const chapterNumbers = [...chapters.keys()].sort((a, b) => a - b);
  if (
    chapterNumbers[0] !== 1 ||
    chapterNumbers.at(-1) !== chapterNumbers.length
  ) {
    throw new Error(`Chapter gap in ${name}`);
  }
  const chapterTexts = [];
  const verseCounts = [];
  for (const chapter of chapterNumbers) {
    const verses = chapters.get(chapter);
    const verseNumbers = [...verses.keys()].sort((a, b) => a - b);
    if (verseNumbers[0] !== 1 || verseNumbers.at(-1) !== verseNumbers.length) {
      throw new Error(`Verse gap in ${name} ${chapter}`);
    }
    chapterTexts.push(verseNumbers.map((verse) => verses.get(verse)));
    verseCounts.push(verseNumbers.length);
  }
  catalogBooks.push({ name, chapters: chapterTexts });
  indexBooks.push({ name, verses: verseCounts });
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "src/features/composer/data");
writeFileSync(
  join(dataDir, "web-catalog.json"),
  JSON.stringify({
    attribution:
      "World English Bible, public domain. 2020 stable text from eBible.org (engwebp).",
    books: catalogBooks,
  }),
);
writeFileSync(join(dataDir, "web-index.json"), JSON.stringify(indexBooks));
console.log(
  `Wrote ${catalogBooks.length} books and ${indexBooks.reduce(
    (total, book) => total + book.verses.reduce((sum, count) => sum + count, 0),
    0,
  )} verses.`,
);
