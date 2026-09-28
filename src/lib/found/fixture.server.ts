import "server-only";

import {
  foundFixtureQuote,
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
      if (!located) return { start: -1, end: -1 };
      return { start: located.start, end: located.end };
    },
  };
}

export function runFixtureFoundSearch(query: string) {
  return runFoundSearch(query, fixtureFoundDeps(), 5_000);
}
