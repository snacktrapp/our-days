import "server-only";

import type { BibleVerseSpan } from "./bible.server";
import type { TimedWord } from "./vtt.server";

export type FoundLead = Readonly<{
  kind: "youtube" | "web" | "bible";
  url?: string;
  videoId?: string;
  speaker?: string;
  title?: string;
  hintSeconds?: number;
  book?: string;
  chapter?: number;
  startVerse?: number;
  endVerse?: number;
}>;

export type FetchedSource = Readonly<{
  kind: "youtube" | "web" | "bible";
  identity: string;
  text: string;
  sourceUrl: string;
  speaker?: string;
  title?: string;
  videoId?: string;
  timedWords?: readonly TimedWord[];
  verseSpans?: readonly BibleVerseSpan[];
}>;
