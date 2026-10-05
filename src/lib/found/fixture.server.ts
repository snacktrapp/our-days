import "server-only";

import {
  foundFixtureQuote,
  foundFixtureStartSeconds,
  foundFixtureVideoId,
  foundFixtureVtt,
} from "@/features/insights/found-fixture";
import type { FoundSourceKind } from "@/features/insights/found-types";
import { loadBiblePassage } from "./bible.server";
import type { FoundSearchDeps } from "./pipeline.server";
import { runFoundSearch } from "./pipeline.server";
import { parseVtt, transcriptFromCues } from "./vtt.server";

const fixtureTranscript = transcriptFromCues(parseVtt(foundFixtureVtt));

export const foundFixtureArticleQuote =
  "A public article can hold a sentence that is worth keeping word for word.";
export const foundFixtureArticleUrl = "https://example.com/a-kept-sentence";

export function fixtureFoundDeps(
  sourceKind: FoundSourceKind = "youtube",
): FoundSearchDeps {
  if (sourceKind === "bible") {
    return {
      generateLeads: async () => [
        {
          kind: "bible",
          book: "Psalm",
          chapter: 62,
          startVerse: 1,
          endVerse: 1,
        },
      ],
      fetchSource: async () => {
        const passage = await loadBiblePassage("Psalm", 62, 1, 1);
        if (!passage) {
          return {
            source: null,
            attempts: [{ host: "ebible.org", fetchStatus: "empty" as const }],
          };
        }
        return {
          source: {
            kind: "bible" as const,
            identity: "fixture:psalm-62-1",
            text: passage.text,
            sourceUrl: passage.sourceUrl,
            title: "Psalm",
            verseSpans: passage.verseSpans,
          },
          attempts: [{ host: "ebible.org", fetchStatus: "ok" as const }],
        };
      },
      pickQuote: async () => ({ quote: "" }),
    };
  }
  if (sourceKind === "text") {
    return {
      generateLeads: async () => [
        {
          kind: "web",
          url: foundFixtureArticleUrl,
          speaker: "Ada Lovelace",
          title: "A note on the engine",
        },
      ],
      fetchSource: async () => ({
        source: {
          kind: "web",
          identity: "fixture:article",
          text: foundFixtureArticleQuote,
          sourceUrl: foundFixtureArticleUrl,
          speaker: "Ada Lovelace",
          title: "A note on the engine",
          fetchedTitle: "A note on the engine",
        },
        attempts: [{ host: "example.com", fetchStatus: "ok" }],
      }),
      pickQuote: async () => ({ quote: foundFixtureArticleQuote }),
    };
  }
  return {
    generateLeads: async () => [
      {
        kind: "youtube",
        videoId: foundFixtureVideoId,
        speaker: "DHH",
        title: "Lex Fridman Podcast",
        hintSeconds: foundFixtureStartSeconds,
      },
    ],
    fetchSource: async () => ({
      source: {
        kind: "youtube",
        identity: `fixture:${foundFixtureVideoId}`,
        text: fixtureTranscript.text,
        sourceUrl: `https://www.youtube.com/watch?v=${foundFixtureVideoId}`,
        speaker: "DHH",
        title: "Lex Fridman Podcast",
        fetchedTitle:
          "DHH: Programming, philosophy, and the pursuit of excellence | Lex Fridman Podcast",
        channelName: "Lex Fridman",
        videoId: foundFixtureVideoId,
        timedWords: fixtureTranscript.words,
      },
      attempts: [{ host: "www.youtube.com", fetchStatus: "ok" }],
    }),
    pickQuote: async () => ({ quote: foundFixtureQuote }),
  };
}

export function runFixtureFoundSearch(
  query: string,
  sourceKind: FoundSourceKind = "youtube",
) {
  return runFoundSearch(query, fixtureFoundDeps(sourceKind), 5_000, sourceKind);
}
