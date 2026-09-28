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
  foundSourceMessage,
  foundSearchTimeoutMs,
  foundTimeoutMessage,
  foundVerifiedBible,
  foundVerifiedSource,
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

  it("recovers the source wording when the model paraphrases the excellence line", async () => {
    const passage =
      "The pursuit of excellence deserves no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const paraphrase =
      "The pursuit of excellence needs no justification. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const page = `(01:52:27) ${passage} (01:53:04) and then the conversation moves on to the next idea entirely.`;
    const timed = timedTranscriptFromPage(page);
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const result = await runFoundSearch(
        "zebra-query-token",
        {
          generateLeads: async () => [
            {
              kind: "youtube",
              videoId: "NYFGCESmikA",
              transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
              speaker: "DHH",
              title: "Lex Fridman Podcast",
            },
          ],
          fetchSource: async () => ({
            source: {
              kind: "youtube",
              identity: "youtube:NYFGCESmikA",
              text: timed.text,
              sourceUrl: "https://lexfridman.com/dhh-2-transcript",
              videoId: "NYFGCESmikA",
              speaker: "DHH",
              title: "Lex Fridman Podcast",
              timedWords: timed.words,
            },
            attempts: [
              { host: "www.youtube.com", fetchStatus: "empty" },
              { host: "lexfridman.com", fetchStatus: "ok" },
            ],
          }),
          pickQuote: async () => ({ quote: paraphrase }),
        },
        5_000,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.candidates[0]?.quote).toContain("deserves no explanation");
      expect(result.candidates[0]?.quote).not.toContain(
        "needs no justification",
      );
      expect(result.candidates[0]?.quote).not.toBe(paraphrase);
      expect(timed.text).toContain(result.candidates[0]?.quote);
      expect(result.candidates[0]?.verifiedLabel).toBe(foundVerifiedTranscript);
      expect(result.candidates[0]?.sourceUrl).toContain(
        "https://www.youtube.com/watch?v=NYFGCESmikA",
      );
      expect(result.candidates[0]?.sourceUrl).toContain("t=6747");
      const logged = [...info.mock.calls, ...warn.mock.calls]
        .map((call) =>
          typeof call[0] === "string" ? call[0] : JSON.stringify(call[0]),
        )
        .join("\n");
      expect(logged).toContain('"dropReason":"near-match-recovered"');
      expect(logged).toContain('"similarity":');
      expect(logged).toContain(paraphrase.slice(0, 120));
      expect(logged).not.toContain("zebra-query-token");
      expect(logged).not.toContain("deserves no explanation");
    } finally {
      info.mockRestore();
      warn.mockRestore();
    }
  });

  it("drops the card when a supplied quote is not in the source", async () => {
    const deps = fixtureFoundDeps();
    const result = await runFoundSearch(
      "unrelated subject matter",
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
    expect(result.candidates[0]?.verifiedLabel).toBe(foundVerifiedTranscript);
  });

  it("labels an unconfirmed transcript as a source page", async () => {
    const page =
      "(01:52:42) the pursuit of excellence is a long game that rewards the people who stay with the work";
    const timed = timedTranscriptFromPage(page);
    const result = await runFoundSearch(
      "excellence",
      {
        generateLeads: async () => [
          {
            kind: "youtube",
            videoId: "abcdefghijk",
            transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
          },
        ],
        fetchSource: async () => ({
          source: {
            kind: "web",
            identity: "web:lex",
            text: timed.text,
            sourceUrl: "https://lexfridman.com/dhh-2-transcript",
          },
          attempts: [{ host: "lexfridman.com", fetchStatus: "ok" }],
        }),
        pickQuote: async () => ({ quote: foundFixtureQuote }),
      },
      5_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.verifiedLabel).toBe(foundVerifiedSource);
    expect(result.candidates[0]?.sourceUrl).toBe(
      "https://lexfridman.com/dhh-2-transcript",
    );
    expect(result.candidates[0]?.videoId).toBeUndefined();
    expect(result.candidates[0]?.sourceLabel).toBe("Read the source");
    expect(result.candidates[0]?.attribution).not.toBe("Source");
    expect(result.candidates[0]?.sourceSite).toBe("lexfridman.com");
    expect(result.candidates[0]?.speaker).toBeUndefined();
  });

  it("ranks the excellence passage ahead of the Lex intro", async () => {
    const intro =
      "DHH is at times controversial, but he's always fearless, brilliant, and fun to talk to.";
    const excellence =
      "The pursuit of excellence deserves no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const page = [
      `(00:00:12) ${intro}`,
      `(01:52:27) ${excellence}`,
      "(01:53:40) and then the conversation moves on to the next idea entirely.",
    ].join("\n");
    const timed = timedTranscriptFromPage(page);
    const result = await runFoundSearch(
      "DHH discussing excellence with Lex",
      {
        generateLeads: async () => [
          {
            kind: "youtube",
            videoId: "NYFGCESmikA",
            transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
            speaker: "DHH",
            title: "Source",
          },
        ],
        fetchSource: async () => ({
          source: {
            kind: "youtube",
            identity: "youtube:NYFGCESmikA",
            text: timed.text,
            sourceUrl: "https://lexfridman.com/dhh-2-transcript",
            videoId: "NYFGCESmikA",
            speaker: "DHH",
            title: "Source",
            fetchedTitle:
              "DHH: Programming, philosophy, and the pursuit of excellence | Lex Fridman Podcast",
            channelName: "Lex Fridman",
            timedWords: timed.words,
          },
          attempts: [{ host: "lexfridman.com", fetchStatus: "ok" }],
        }),
        pickQuote: async () => ({ quote: intro }),
      },
      5_000,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    const quotes = result.candidates.map((candidate) => candidate.quote);
    expect(new Set(quotes).size).toBe(quotes.length);
    const first = result.candidates[0]!;
    expect(first.quote).toContain("deserves no explanation");
    expect(first.quote).toContain("no need for justification");
    expect(first.quote).not.toContain("controversial");
    expect(first.speaker).toBe("DHH");
    expect(first.speakerInSource).toBe(true);
    expect(first.sourceTitle).toBe(
      "DHH: Programming, philosophy, and the pursuit of excellence | Lex Fridman Podcast",
    );
    expect(first.sourceSite).toBe("YouTube");
    expect(first.channelName).toBe("Lex Fridman");
    expect(first.atLabel).toBe("at 1:52:27");
    expect(first.attribution).not.toBe("Source");
    expect(first.attribution).toContain("DHH");
    expect(first.sourceUrl).toContain(
      "https://www.youtube.com/watch?v=NYFGCESmikA",
    );
    expect(first.sourceUrl).toContain("t=6747");
    const introIndex = result.candidates.findIndex((candidate) =>
      candidate.quote.includes("controversial"),
    );
    if (introIndex !== -1) expect(introIndex).toBeGreaterThan(0);
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
      expect(result).toEqual({
        ok: false,
        reason: "empty",
        message: foundSourceMessage,
      });
      const logged = [...info.mock.calls, ...warn.mock.calls]
        .map((call) =>
          typeof call[0] === "string" ? call[0] : JSON.stringify(call[0]),
        )
        .join("\n");
      expect(info).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(logged).toContain('"attempts":[');
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

  it("tries another lead when the only source cannot be opened", async () => {
    const prompts: string[] = [];
    const result = await runFoundSearch(
      "excellence",
      {
        generateLeads: async (query) => {
          prompts.push(query);
          if (prompts.length === 1) {
            return [
              {
                kind: "youtube",
                url: "https://www.youtube.com/watch?v=NYFGCESmikA&list=PLtoolong&t=6747s",
              },
            ];
          }
          return [
            {
              kind: "web",
              url: "https://lexfridman.com/dhh-2-transcript",
              speaker: "DHH",
            },
          ];
        },
        fetchSource: async (lead) => {
          if (lead.kind === "youtube") {
            expect(lead.videoId).toBe("NYFGCESmikA");
            expect(lead.url).toBe(
              "https://www.youtube.com/watch?v=NYFGCESmikA",
            );
            return {
              source: null,
              attempts: [
                {
                  host: "www.youtube.com",
                  fetchStatus: "http",
                  httpStatus: 400,
                  step: "player",
                  path: "/youtubei/v1/player",
                },
              ],
            };
          }
          return {
            source: {
              kind: "web",
              identity: "web:lex",
              text: foundFixtureQuote,
              sourceUrl: "https://lexfridman.com/dhh-2-transcript",
              speaker: "DHH",
              fetchedTitle: "DHH on Lex",
            },
            attempts: [
              {
                host: "lexfridman.com",
                fetchStatus: "ok",
                step: "transcript",
                path: "/dhh-2-transcript",
              },
            ],
          };
        },
        pickQuote: async () => ({ quote: foundFixtureQuote }),
      },
      5_000,
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("www.youtube.com/watch");
    expect(prompts[1]).toContain("Do not return that same page");
    expect(prompts[1]).toContain('include "excellence"');
    expect(prompts[1]).not.toContain("list=");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.quote).toBe(foundFixtureQuote);
  });

  it("asks for a transcript when the only page misses the topic", async () => {
    const prompts: string[] = [];
    const excellence =
      "The pursuit of excellence deserves no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const result = await runFoundSearch(
      "DHH discussing excellence with Lex",
      {
        generateLeads: async (query) => {
          prompts.push(query);
          if (prompts.length === 1) {
            return [
              {
                kind: "web",
                url: "https://lexfridman.com/dhh-david-heinemeier-hansson/",
              },
            ];
          }
          return [
            {
              kind: "web",
              url: "https://lexfridman.com/dhh-2-transcript",
              speaker: "DHH",
            },
          ];
        },
        fetchSource: async (lead) => {
          const transcript = lead.url?.includes("transcript");
          return {
            source: {
              kind: "web",
              identity: transcript ? "web:transcript" : "web:episode",
              text: transcript
                ? excellence
                : "Lex X / Twitter YouTube Transcript for DHH: Future of Programming with Lex Fridman.",
              sourceUrl: lead.url ?? "https://lexfridman.com/",
              speaker: "DHH",
              fetchedTitle: transcript
                ? "DHH on Lex Fridman"
                : "DHH: Future of Programming | Lex Fridman Podcast",
            },
            attempts: [
              {
                host: "lexfridman.com",
                fetchStatus: "ok",
                httpStatus: 200,
              },
            ],
          };
        },
        pickQuote: async () => ({ quote: excellence }),
      },
      5_000,
    );
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("did not contain");
    expect(prompts[1]).toContain("excellence");
    expect(prompts[1]).not.toContain("?");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidates[0]?.quote).toContain("deserves no explanation");
    expect(result.candidates[0]?.quote).not.toContain("Twitter");
  });

  it("drops a second page that also misses the topic", async () => {
    const prompts: string[] = [];
    const result = await runFoundSearch(
      "DHH discussing excellence with Lex",
      {
        generateLeads: async (query) => {
          prompts.push(query);
          return [
            {
              kind: "web" as const,
              url:
                prompts.length === 1
                  ? "https://lexfridman.com/dhh-david-heinemeier-hansson/"
                  : "https://lexfridman.com/other",
            },
          ];
        },
        fetchSource: async (lead) => ({
          source: {
            kind: "web" as const,
            identity: lead.url ?? "web",
            text: "Lex X / Twitter YouTube Transcript for DHH with Lex Fridman.",
            sourceUrl: lead.url ?? "https://lexfridman.com/",
            speaker: "DHH",
            fetchedTitle: "DHH on Lex",
          },
          attempts: [
            {
              host: "lexfridman.com",
              fetchStatus: "ok" as const,
              httpStatus: 200,
            },
          ],
        }),
        pickQuote: async () => ({
          quote: "Lex X / Twitter YouTube Transcript for DHH with Lex Fridman.",
        }),
      },
      5_000,
    );
    expect(prompts).toHaveLength(2);
    expect(result).toEqual({
      ok: false,
      reason: "empty",
      message: foundEmptyMessage,
    });
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
