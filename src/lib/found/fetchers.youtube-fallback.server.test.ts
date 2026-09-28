// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const captions = vi.hoisted(() => vi.fn());
const page = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("./youtube.server", async () => {
  const actual =
    await vi.importActual<typeof import("./youtube.server")>(
      "./youtube.server",
    );
  return { ...actual, fetchYoutubeTranscript: captions };
});
vi.mock("./web.server", async () => {
  const actual =
    await vi.importActual<typeof import("./web.server")>("./web.server");
  return { ...actual, readPublicPage: page };
});

import { foundFixtureQuote } from "@/features/insights/found-fixture";
import { fetchFoundSource } from "./fetchers.server";

const lexPage = [
  "(00:00:12) Welcome back to the podcast with a few opening words today.",
  `(01:52:42) ${foundFixtureQuote}`,
  "[1:53:04] and then the conversation moves on to the next idea entirely.",
].join(" ");

const pageUrl = "https://lexfridman.com/dhh-2-transcript";

async function fromTranscript(html: string, videoId = "abcdefghijk") {
  captions.mockResolvedValue({
    cues: null,
    host: "www.youtube.com",
    fetchStatus: "empty",
  });
  page.mockResolvedValue({
    host: "lexfridman.com",
    fetchStatus: "ok",
    httpStatus: 200,
    page: { url: pageUrl, text: lexPage, html },
  });
  return fetchFoundSource(
    {
      kind: "youtube",
      videoId,
      transcriptUrl: pageUrl,
      speaker: "DHH",
      title: "Lex Fridman Podcast",
    },
    new AbortController().signal,
  );
}

describe("YouTube publisher transcript fallback", () => {
  beforeEach(() => {
    captions.mockReset();
    page.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["plain text", "<p>see youtube.com/watch?v=abcdefghijk</p>"],
    [
      "an HTML comment",
      '<!-- <a href="https://www.youtube.com/watch?v=abcdefghijk">x</a> -->',
    ],
    [
      "another host's query",
      '<a href="https://evil.example/r?u=https://www.youtube.com/watch?v=abcdefghijk">x</a>',
    ],
    [
      "notyoutube.com",
      '<a href="https://notyoutube.com/watch?v=abcdefghijk">x</a>',
    ],
    ["myyoutu.be", '<a href="https://myyoutu.be/abcdefghijk">x</a>'],
  ])("ignores a video id in %s", async (label, html) => {
    const result = await fromTranscript(html);
    expect(result.source?.kind, label).toBe("web");
    expect(result.source?.videoId).toBeUndefined();
    expect(result.source?.sourceUrl).toBe(pageUrl);
    expect(result.source?.timedWords).toBeUndefined();
  });

  it("keeps a video linked with &amp;v= in an href", async () => {
    const result = await fromTranscript(
      '<a href="https://www.youtube.com/watch?list=PLabcdefghij&amp;v=abcdefghijk">watch</a>',
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.videoId).toBe("abcdefghijk");
  });

  it("keeps a video embedded in an iframe src", async () => {
    const result = await fromTranscript(
      '<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>',
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.videoId).toBe("abcdefghijk");
  });

  it("keeps a nocookie embed", async () => {
    const result = await fromTranscript(
      '<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk"></iframe>',
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.videoId).toBe("abcdefghijk");
  });

  it("keeps the Lex transcript link to NYFGCESmikA", async () => {
    const result = await fromTranscript(
      `<div class="ts-segment">
        <span class="ts-timestamp"><a href="https://youtube.com/watch?v=NYFGCESmikA&amp;t=6762">(01:52:42)</a></span>
        <span class="ts-text">${lexPage}</span>
      </div>`,
      "NYFGCESmikA",
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.videoId).toBe("NYFGCESmikA");
    expect(result.source?.sourceUrl).toBe(pageUrl);
    expect(
      result.source?.timedWords?.some((word) => word.cueStart === 6762),
    ).toBe(true);
  });

  it("keeps a fetched page title and ignores a bare Source title", async () => {
    const result = await fromTranscript(
      '<html><meta property="og:title" content="DHH on Lex Fridman"><a href="https://www.youtube.com/watch?v=abcdefghijk">watch</a></html>',
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.fetchedTitle).toBe("DHH on Lex Fridman");
    expect(result.source?.title).toBe("Lex Fridman Podcast");
  });

  it("reads a publisher page from the lead url when captions fail", async () => {
    captions.mockResolvedValue({
      cues: null,
      host: "www.youtube.com",
      fetchStatus: "http",
      httpStatus: 400,
      attempts: [
        {
          host: "www.youtube.com",
          fetchStatus: "http",
          httpStatus: 400,
          step: "player",
          path: "/youtubei/v1/player",
        },
      ],
    });
    page.mockResolvedValue({
      host: "lexfridman.com",
      fetchStatus: "ok",
      httpStatus: 200,
      page: {
        url: pageUrl,
        text: lexPage,
        html: '<a href="https://www.youtube.com/watch?v=abcdefghijk">watch</a>',
      },
    });
    const result = await fetchFoundSource(
      {
        kind: "youtube",
        videoId: "abcdefghijk",
        url: "https://lexfridman.com/dhh-2-transcript",
      },
      new AbortController().signal,
    );
    expect(page).toHaveBeenCalledWith(pageUrl, expect.any(AbortSignal));
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.sourceUrl).toBe(pageUrl);
    expect(result.attempts).toEqual([
      {
        host: "www.youtube.com",
        fetchStatus: "http",
        httpStatus: 400,
        step: "player",
        path: "/youtubei/v1/player",
      },
      {
        host: "lexfridman.com",
        fetchStatus: "ok",
        httpStatus: 200,
        step: "transcript",
        path: "/dhh-2-transcript",
      },
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

  it("prefers the timestamped video over a t=0 full-episode link", async () => {
    const result = await fromTranscript(
      `<a href="https://www.youtube.com/watch?v=abcdefghijk&amp;t=0">full episode</a>
       <a href="https://www.youtube.com/lexfridman">channel</a>
       <a href="https://youtube.com/watch?v=NYFGCESmikA&amp;t=6762">(01:52:42)</a>`,
      "abcdefghijk",
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.videoId).toBe("NYFGCESmikA");
    expect(
      result.source?.timedWords?.some((word) => word.cueStart === 6762),
    ).toBe(true);
  });

  it("maps a web transcript page onto the YouTube video and oEmbed title", async () => {
    page.mockResolvedValue({
      host: "lexfridman.com",
      fetchStatus: "ok",
      httpStatus: 200,
      page: {
        url: pageUrl,
        text: lexPage,
        html: `<html>
          <meta property="og:site_name" content="Lex Fridman">
          <meta property="og:title" content="Transcript for DHH: Future of Programming - Lex Fridman">
          <a href="https://www.youtube.com/lexfridman">Lex Fridman</a>
          <a href="https://youtube.com/watch?v=NYFGCESmikA&#038;t=6762">(01:52:42)</a>
        </html>`,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!url.includes("youtube.com/oembed")) throw new Error("offline");
        return new Response(
          JSON.stringify({
            title:
              "DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux | Lex Fridman Podcast #501",
            author_name: "Lex Fridman",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const result = await fetchFoundSource(
      { kind: "web", url: pageUrl },
      new AbortController().signal,
    );
    expect(result.source?.kind).toBe("youtube");
    expect(result.source?.videoId).toBe("NYFGCESmikA");
    expect(result.source?.sourceUrl).toBe(pageUrl);
    expect(result.source?.fetchedTitle).toBe(
      "DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux | Lex Fridman Podcast #501",
    );
    expect(result.source?.channelName).toBe("Lex Fridman");
    expect(result.source?.fetchedTitle).not.toContain("Transcript for");
    expect(
      result.source?.timedWords?.some((word) => word.cueStart === 6762),
    ).toBe(true);
  });

  it("keeps the page and strips the transcript title when no video is linked", async () => {
    page.mockResolvedValue({
      host: "lexfridman.com",
      fetchStatus: "ok",
      httpStatus: 200,
      page: {
        url: pageUrl,
        text: "The pursuit of excellence is a long game that rewards the people who stay with the work.",
        html: `<html>
          <meta property="og:site_name" content="Lex Fridman">
          <meta property="og:title" content="Transcript for DHH on Lex - Lex Fridman">
          <title>Transcript for DHH on Lex - Lex Fridman</title>
        </html>`,
      },
    });
    const result = await fetchFoundSource(
      { kind: "web", url: pageUrl },
      new AbortController().signal,
    );
    expect(result.source?.kind).toBe("web");
    expect(result.source?.videoId).toBeUndefined();
    expect(result.source?.sourceUrl).toBe(pageUrl);
    expect(result.source?.fetchedTitle).toBe("DHH on Lex");
    expect(result.source?.channelName).toBeUndefined();
    expect(result.source?.timedWords).toBeUndefined();
  });
});
