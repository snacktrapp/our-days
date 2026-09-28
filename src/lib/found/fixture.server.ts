import "server-only";

import {
  foundFixtureQuote,
  foundFixtureRejectedQuote,
  foundFixtureStartSeconds,
  foundFixtureVideoId,
  foundFixtureVtt,
} from "@/features/insights/found-fixture";
import type { FoundSearchDeps } from "./pipeline.server";
import { runFoundSearch } from "./pipeline.server";
import { locateContiguousQuote } from "./verify.server";
import { parseVtt, transcriptFromCues } from "./vtt.server";

const fixtureTranscript = transcriptFromCues(parseVtt(foundFixtureVtt));

export function fixtureFoundDeps(): FoundSearchDeps {
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
      kind: "youtube",
      identity: `fixture:${foundFixtureVideoId}`,
      text: fixtureTranscript.text,
      sourceUrl: `https://www.youtube.com/watch?v=${foundFixtureVideoId}`,
      speaker: "DHH",
      title: "Lex Fridman Podcast",
      timedWords: fixtureTranscript.words,
    }),
    pickSpan: async ({ window }) => {
      const located = locateContiguousQuote(window, foundFixtureQuote);
      return {
        quote: foundFixtureRejectedQuote,
        start: located?.start ?? -1,
        end: located?.end ?? -1,
      };
    },
  };
}

export function runFixtureFoundSearch(query: string) {
  return runFoundSearch(query, fixtureFoundDeps(), 5_000);
}
