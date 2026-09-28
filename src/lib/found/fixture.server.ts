import "server-only";

import {
  foundFixtureQuote,
  foundFixtureStartSeconds,
  foundFixtureVideoId,
  foundFixtureVtt,
} from "@/features/insights/found-fixture";
import type { FoundSearchDeps } from "./pipeline.server";
import { runFoundSearch } from "./pipeline.server";
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
      source: {
        kind: "youtube",
        identity: `fixture:${foundFixtureVideoId}`,
        text: fixtureTranscript.text,
        sourceUrl: `https://www.youtube.com/watch?v=${foundFixtureVideoId}`,
        speaker: "DHH",
        title: "Lex Fridman Podcast",
        timedWords: fixtureTranscript.words,
      },
      attempts: [{ host: "www.youtube.com", fetchStatus: "ok" }],
    }),
    pickQuote: async () => ({ quote: foundFixtureQuote }),
  };
}

export function runFixtureFoundSearch(query: string) {
  return runFoundSearch(query, fixtureFoundDeps(), 5_000);
}
