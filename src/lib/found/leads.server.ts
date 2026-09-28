import "server-only";

import type { BibleVerseSpan } from "./bible.server";
import type { TimedWord } from "./vtt.server";

export type FoundLead = Readonly<{
  kind: "youtube" | "web" | "bible";
  url?: string;
  transcriptUrl?: string;
  videoId?: string;
  speaker?: string;
  title?: string;
  hintSeconds?: number;
  book?: string;
  chapter?: number;
  startVerse?: number;
  endVerse?: number;
}>;

export type FoundFetchStatus = "ok" | "empty" | "blocked" | "http";

export type FoundFetchAttempt = Readonly<{
  host?: string;
  fetchStatus: FoundFetchStatus;
  httpStatus?: number;
}>;

export type FoundFetchResult = Readonly<{
  source: FetchedSource | null;
  attempts: readonly FoundFetchAttempt[];
}>;

export type FetchedSource = Readonly<{
  kind: "youtube" | "web" | "bible";
  identity: string;
  text: string;
  sourceUrl: string;
  speaker?: string;
  title?: string;
  /** Title read from the page or the YouTube video, not from the model. */
  fetchedTitle?: string;
  channelName?: string;
  videoId?: string;
  timedWords?: readonly TimedWord[];
  verseSpans?: readonly BibleVerseSpan[];
}>;
