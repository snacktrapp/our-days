// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  foundFixtureEndSeconds,
  foundFixtureQuote,
  foundFixtureRejectedQuote,
  foundFixtureStartSeconds,
} from "@/features/insights/found-fixture";
import {
  foundEmptyMessage,
  foundRestingMessage,
  foundSearchTimeoutMs,
  foundTimeoutMessage,
  foundVerifiedBible,
  foundVerifiedTranscript,
} from "@/features/insights/found-types";
import { FoundBudgetError } from "./errors.server";
import { fixtureFoundDeps } from "./fixture.server";
import { runFoundSearch } from "./pipeline.server";
import type { FoundSearchDeps } from "./pipeline.server";
import { timedTranscriptFromPage } from "./transcript-page.server";

describe("Found search pipeline", () => {
  it("keeps the source slice when the quote matches", async () => {
    const result = await runFoundSearch(
      "excellence",
      fixtureFoundDeps(),
      5_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates).toHaveLength(1);
    const card = result.candidates[0]!;
    expect(card.quote).toBe(foundFixtureQuote);
    expect(card.quote).not.toBe(foundFixtureRejectedQuote);
    expect(JSON.stringify(result)).not.toContain(foundFixtureRejectedQuote);
    expect(card.verifiedLabel).toBe(foundVerifiedTranscript);
    expect(card.sourceUrl).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=6762",
    );
    expect(card.rangeLabel).toBe("1:52:42–1:53:04");
    expect(card.videoId).toBeUndefined();
    expect(foundFixtureStartSeconds).toBe(6762);
    expect(foundFixtureEndSeconds).toBe(6784);
  });

  it("drops the card when a supplied quote is not in the source", async () => {
    const deps = fixtureFoundDeps();
    const result = await runFoundSearch(
      "excellence",
      {
        ...deps,
        pickQuote: async () => ({
          quote: foundFixtureRejectedQuote,
          hintSeconds: foundFixtureStartSeconds,
        }),
      },
      5_000,
    );
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: foundEmptyMessage,
    });
  });

  it("returns resting and no cards when the gateway budget stops", async () => {
    const deps: FoundSearchDeps = {
      generateLeads: async () => {
        throw new FoundBudgetError();
      },
      pickQuote: async () => ({
        quote: foundFixtureRejectedQuote,
      }),
      fetchSource: async () => {
        throw new Error("fetcher should not run");
      },
    };
    const result = await runFoundSearch("excellence", deps, 5_000);
    expect(result).toEqual({
      ok: false,
      reason: "resting",
      message: foundRestingMessage,
    });
  });

  it("stops at 45 seconds and returns no partial cards", async () => {
    expect(foundSearchTimeoutMs).toBe(45_000);
    const deps: FoundSearchDeps = {
      generateLeads: async () => [
        { kind: "web", url: "https://example.com/talk", title: "Talk" },
      ],
      fetchSource: async () => ({
        source: {
          kind: "web",
          identity: "web:1",
          text: foundFixtureQuote,
          sourceUrl: "https://example.com/talk",
          title: "Talk",
        },
        attempts: [{ host: "example.com", fetchStatus: "ok" }],
      }),
      pickQuote: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            reject(
              new DOMException("The operation was aborted.", "AbortError"),
            );
          });
        }),
    };
    const started = Date.now();
    const result = await runFoundSearch("excellence", deps, 30);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(result).toEqual({
      ok: false,
      reason: "timeout",
      message: foundTimeoutMessage,
    });
  });

  it("finishes an instant search inside the p50 budget", async () => {
    const started = Date.now();
    const result = await runFoundSearch(
      "excellence",
      fixtureFoundDeps(),
      5_000,
    );
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(result.ok).toBe(true);
  });

  it("shows a World English Bible slice only from the catalog", async () => {
    const passage =
      "A Psalm by David. The LORD is my shepherd; I shall lack nothing. He makes me lie down in green pastures.";
    const deps: FoundSearchDeps = {
      generateLeads: async () => [
        {
          kind: "bible",
          book: "Psalm",
          chapter: 23,
          startVerse: 1,
          endVerse: 2,
        },
      ],
      fetchSource: async () => ({
        source: {
          kind: "bible",
          identity: "bible:psalm-23",
          text: passage,
          sourceUrl: "https://ebible.org/engwebp/PSA023.htm",
          verseSpans: [
            { book: "Psalm", chapter: 23, verse: 1, start: 0, end: 62 },
            {
              book: "Psalm",
              chapter: 23,
              verse: 2,
              start: 63,
              end: passage.length,
            },
          ],
        },
        attempts: [{ host: "ebible.org", fetchStatus: "ok" }],
      }),
      pickQuote: async () => {
        throw new Error("a short Bible passage does not need the model");
      },
    };
    const result = await runFoundSearch("a psalm about rest", deps, 5_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.quote).toContain("shepherd");
    expect(result.candidates[0]?.quote).not.toContain("cow");
    expect(result.candidates[0]?.verifiedLabel).toBe(foundVerifiedBible);
    expect(result.candidates[0]?.attribution).toContain("World English Bible");
  });

  it("links a publisher transcript to YouTube at the matched timestamp", async () => {
    const page = [
      "(00:00:12) Welcome back to the podcast with a few opening words today.",
      "(01:52:42) the pursuit of excellence is a long game that rewards the people who stay with the work",
      "[1:53:04] and then the conversation moves on to the next idea entirely.",
    ].join(" ");
    const timed = timedTranscriptFromPage(page);
    const result = await runFoundSearch(
      "excellence",
      {
        generateLeads: async () => [
          {
            kind: "youtube",
            videoId: "abcdefghijk",
            transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
            speaker: "DHH",
            title: "Lex Fridman Podcast",
          },
        ],
        fetchSource: async () => ({
          source: {
            kind: "youtube",
            identity: "youtube:abcdefghijk",
            text: timed.text,
            sourceUrl: "https://lexfridman.com/dhh-2-transcript",
            videoId: "abcdefghijk",
            speaker: "DHH",
            title: "Lex Fridman Podcast",
            timedWords: timed.words,
          },
          attempts: [
            { host: "www.youtube.com", fetchStatus: "http", httpStatus: 400 },
            { host: "lexfridman.com", fetchStatus: "ok" },
          ],
        }),
        pickQuote: async () => ({ quote: foundFixtureQuote }),
      },
      5_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.quote).toBe(foundFixtureQuote);
    expect(result.candidates[0]?.sourceUrl).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=6762",
    );
    expect(result.candidates[0]?.verifiedLabel).toBe(foundVerifiedTranscript);
    expect(result.candidates[0]?.rangeLabel).toBe("1:52:42–1:53:04");
  });

  it("keeps the transcript page when the episode has no video id", async () => {
    const page =
      "(01:52:42) the pursuit of excellence is a long game that rewards the people who stay with the work";
    const timed = timedTranscriptFromPage(page);
    const result = await runFoundSearch(
      "excellence",
      {
        generateLeads: async () => [
          {
            kind: "youtube",
            transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
          },
        ],
        fetchSource: async () => ({
          source: {
            kind: "web",
            identity: "web:lex",
            text: timed.text,
            sourceUrl: "https://lexfridman.com/dhh-2-transcript",
            timedWords: timed.words,
          },
          attempts: [{ host: "lexfridman.com", fetchStatus: "ok" }],
        }),
        pickQuote: async () => ({ quote: foundFixtureQuote }),
      },
      5_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.sourceUrl).toBe(
      "https://lexfridman.com/dhh-2-transcript",
    );
  });

  it("logs lead outcomes without the query or the quote", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await runFoundSearch(
        "zebra-query-token",
        {
          generateLeads: async () => [
            { kind: "web", url: "https://example.com/talk" },
          ],
          fetchSource: async () => ({
            source: null,
            attempts: [
              { host: "example.com", fetchStatus: "http", httpStatus: 403 },
            ],
          }),
          pickQuote: async () => ({ quote: foundFixtureQuote }),
        },
        5_000,
      );
      expect(result.ok).toBe(false);
      const logged = [...info.mock.calls, ...warn.mock.calls]
        .map((call) => JSON.stringify(call[0]))
        .join("\n");
      expect(logged).toContain('"leadCount":1');
      expect(logged).toContain('"fetchStatus":"http"');
      expect(logged).toContain('"httpStatus":403');
      expect(logged).toContain('"dropReason":"fetch-failed"');
      expect(logged).toContain('"cards":0');
      expect(logged).toContain('"host":"example.com"');
      expect(logged).not.toContain("zebra-query-token");
      expect(logged).not.toContain(foundFixtureQuote);
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it("returns the empty message when nothing verifies", async () => {
    const deps: FoundSearchDeps = {
      generateLeads: async () => [],
      pickQuote: async () => null,
      fetchSource: async () => ({ source: null, attempts: [] }),
    };
    const result = await runFoundSearch("nothing", deps, 5_000);
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: foundEmptyMessage,
    });
  });
});
