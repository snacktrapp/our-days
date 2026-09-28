// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const captions = vi.hoisted(() => vi.fn());
const page = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("./youtube.server", () => ({
  fetchYoutubeTranscript: captions,
  youtubeVideoId: (value: string) =>
    /^[A-Za-z0-9_-]{11}$/u.test(value.trim()) ? value.trim() : null,
}));
vi.mock("./web.server", () => ({
  readPublicPage: page,
}));

import { foundFixtureQuote } from "@/features/insights/found-fixture";
import { fetchFoundSource } from "./fetchers.server";

const lexPage = [
  "(00:00:12) Welcome back to the podcast with a few opening words today.",
  `(01:52:42) ${foundFixtureQuote}`,
  "[1:53:04] and then the conversation moves on to the next idea entirely.",
].join(" ");

describe("YouTube publisher transcript fallback", () => {
  beforeEach(() => {
    captions.mockReset();
    page.mockReset();
  });

  it("uses a transcript page when captions come back empty", async () => {
    captions.mockResolvedValue({
      cues: null,
      host: "www.youtube.com",
      fetchStatus: "http",
      httpStatus: 400,
    });
    page.mockResolvedValue({
      host: "lexfridman.com",
      fetchStatus: "ok",
      httpStatus: 200,
      page: {
        url: "https://lexfridman.com/dhh-2-transcript",
        text: lexPage,
      },
    });
    const result = await fetchFoundSource(
      {
        kind: "youtube",
        videoId: "abcdefghijk",
        transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
        speaker: "DHH",
        title: "Lex Fridman Podcast",
      },
      new AbortController().signal,
    );
    expect(result.source?.text).toContain("pursuit of excellence");
    expect(result.source?.sourceUrl).toBe(
      "https://lexfridman.com/dhh-2-transcript",
    );
    expect(result.source?.videoId).toBe("abcdefghijk");
    expect(
      result.source?.timedWords?.some((word) => word.cueStart === 6762),
    ).toBe(true);
    expect(result.attempts).toEqual([
      { host: "www.youtube.com", fetchStatus: "http", httpStatus: 400 },
      { host: "lexfridman.com", fetchStatus: "ok", httpStatus: 200 },
    ]);
  });

  it("does not fetch a transcript page when captions already match", async () => {
    captions.mockResolvedValue({
      cues: [
        {
          startSeconds: 1,
          endSeconds: 4,
          text: "the pursuit of excellence is a long game that rewards people",
        },
      ],
      host: "www.youtube.com",
      fetchStatus: "ok",
    });
    const result = await fetchFoundSource(
      {
        kind: "youtube",
        videoId: "abcdefghijk",
        transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
      },
      new AbortController().signal,
    );
    expect(page).not.toHaveBeenCalled();
    expect(result.source?.sourceUrl).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk",
    );
    expect(result.attempts).toEqual([
      { host: "www.youtube.com", fetchStatus: "ok" },
    ]);
  });
});
