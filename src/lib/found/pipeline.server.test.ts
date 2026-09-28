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

describe("Found search pipeline", () => {
  it("drops a model quote that is not in the transcript and keeps the source slice", async () => {
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

  it("returns resting and no cards when the gateway budget stops", async () => {
    const deps: FoundSearchDeps = {
      generateLeads: async () => {
        throw new FoundBudgetError();
      },
      pickSpan: async () => ({
        start: 0,
        end: 10,
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
        kind: "web",
        identity: "web:1",
        text: foundFixtureQuote,
        sourceUrl: "https://example.com/talk",
        title: "Talk",
      }),
      pickSpan: ({ signal }) =>
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
      }),
      pickSpan: async ({ window }) => ({
        start: 0,
        end: window.length,
        quote: "A Psalm by David. The LORD is my cow; I shall lack nothing.",
      }),
    };
    const result = await runFoundSearch("a psalm about rest", deps, 5_000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.quote).toContain("shepherd");
    expect(result.candidates[0]?.quote).not.toContain("cow");
    expect(result.candidates[0]?.verifiedLabel).toBe(foundVerifiedBible);
    expect(result.candidates[0]?.attribution).toContain("World English Bible");
  });

  it("returns the empty message when nothing verifies", async () => {
    const deps: FoundSearchDeps = {
      generateLeads: async () => [],
      pickSpan: async () => null,
      fetchSource: async () => null,
    };
    const result = await runFoundSearch("nothing", deps, 5_000);
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: foundEmptyMessage,
    });
  });
});
