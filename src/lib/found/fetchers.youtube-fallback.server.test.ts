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

  it.each([
    "https://www.youtube.com/watch?v=abcdefghijk&amp;t=6762",
    "https://www.youtube.com/embed/abcdefghijk",
    "https://youtu.be/abcdefghijk",
  ])("keeps the video when the transcript page links to %s", async (href) => {
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
        html: `<a href="${href}">${lexPage}</a>`,
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
    expect(result.source?.kind).toBe("youtube");
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

  it("treats a transcript page that does not link to the video as a web source", async () => {
    captions.mockResolvedValue({
      cues: null,
      host: "www.youtube.com",
      fetchStatus: "empty",
    });
    page.mockResolvedValue({
      host: "lexfridman.com",
      fetchStatus: "ok",
      httpStatus: 200,
      page: {
        url: "https://lexfridman.com/dhh-2-transcript",
        text: lexPage,
        html: `<p>abcdefghijk</p><a href="https://www.youtube.com/watch?v=NYFGCESmikA">other</a> ${lexPage}`,
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
    expect(result.source).toMatchObject({
      kind: "web",
      sourceUrl: "https://lexfridman.com/dhh-2-transcript",
      speaker: "DHH",
      title: "Lex Fridman Podcast",
    });
    expect(result.source?.videoId).toBeUndefined();
    expect(result.source?.timedWords).toBeUndefined();
    expect(result.source?.text).toContain("pursuit of excellence");
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
