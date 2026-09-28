// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fetchYoutubeTranscript, normalizeYoutubeLead } from "./youtube.server";

const videoId = "NYFGCESmikA";

describe("YouTube transcript fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps a clean watch URL and a publisher transcript page", () => {
    expect(
      normalizeYoutubeLead({
        kind: "youtube",
        url: "https://m.youtube.com/watch?v=NYFGCESmikA&list=PLtoolong&t=6747s",
        transcriptUrl: "https://lexfridman.com/dhh-2-transcript?utm=1",
      }),
    ).toMatchObject({
      videoId,
      url: "https://www.youtube.com/watch?v=NYFGCESmikA",
      transcriptUrl: "https://lexfridman.com/dhh-2-transcript?utm=1",
    });
  });

  it("moves a publisher page out of the watch URL", () => {
    expect(
      normalizeYoutubeLead({
        kind: "youtube",
        videoId,
        url: "https://lexfridman.com/dhh-2-transcript",
      }),
    ).toMatchObject({
      videoId,
      url: "https://www.youtube.com/watch?v=NYFGCESmikA",
      transcriptUrl: "https://lexfridman.com/dhh-2-transcript",
    });
  });

  it("logs the player path when that request is the HTTP 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        const body = typeof init?.body === "string" ? init.body : "";
        if (
          url.pathname === "/youtubei/v1/player" &&
          body.includes("ANDROID")
        ) {
          return new Response(
            JSON.stringify({
              error: { code: 400, message: "Precondition check failed." },
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/youtubei/v1/player") {
          return new Response(
            JSON.stringify({
              playabilityStatus: {
                status: "LOGIN_REQUIRED",
                reason: "Sign in to confirm you're not a bot",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        if (url.pathname === "/watch") {
          return new Response("<html>consent</html>", { status: 200 });
        }
        return new Response("", { status: 200 });
      }),
    );
    const result = await fetchYoutubeTranscript(
      videoId,
      new AbortController().signal,
    );
    expect(result.cues).toBeNull();
    expect(result.fetchStatus).toBe("http");
    expect(result.httpStatus).toBe(400);
    expect(result.attempts).toContainEqual({
      host: "www.youtube.com",
      fetchStatus: "http",
      httpStatus: 400,
      step: "player",
      path: "/youtubei/v1/player",
    });
    expect(result.attempts).toContainEqual(
      expect.objectContaining({ step: "timedtext", path: "/api/timedtext" }),
    );
    expect(result.attempts).toContainEqual(
      expect.objectContaining({ step: "watch", path: "/watch" }),
    );
    const logged = JSON.stringify(result.attempts);
    expect(logged).not.toContain("prettyPrint");
    expect(logged).not.toContain(videoId);
  });
});
