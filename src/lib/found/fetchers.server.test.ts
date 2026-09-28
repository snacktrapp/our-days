// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ebibleChapterUrl, loadBiblePassage } from "./bible.server";
import { parseCaptionPayload } from "./youtube.server";
import {
  htmlToFoundText,
  isBlockedAddress,
  pageTitleFromHtml,
  publisherDisplayTitle,
} from "./web.server";

describe("Found source fetchers", () => {
  it("blocks private and link-local addresses", () => {
    expect(isBlockedAddress("127.0.0.1")).toBe(true);
    expect(isBlockedAddress("10.1.2.3")).toBe(true);
    expect(isBlockedAddress("192.168.1.9")).toBe(true);
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("100.64.0.1")).toBe(true);
    expect(isBlockedAddress("::1")).toBe(true);
    expect(isBlockedAddress("8.8.8.8")).toBe(false);
  });

  it("turns a page into text without script content", () => {
    const text = htmlToFoundText(
      "<html><script>secret token</script><p>The pursuit of excellence is a long game.</p></html>",
    );
    expect(text).toContain("pursuit of excellence");
    expect(text).not.toContain("secret token");
  });

  it("reads og:title before the document title", () => {
    const html =
      '<html><meta content="DHH on Lex" property="og:title"><title>Fallback</title></html>';
    expect(pageTitleFromHtml(html)).toBe("DHH on Lex");
    expect(
      pageTitleFromHtml("<html><title>Lex &amp; DHH</title><p>body</p></html>"),
    ).toBe("Lex & DHH");
    expect(pageTitleFromHtml("<p>no title</p>")).toBeUndefined();
  });

  it("strips a transcript prefix and the site suffix from a page title", () => {
    expect(
      publisherDisplayTitle(
        "Transcript for DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux | Lex Fridman Podcast #501 - Lex Fridman",
        "Lex Fridman",
      ),
    ).toBe(
      "DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux | Lex Fridman Podcast #501",
    );
    expect(publisherDisplayTitle("Transcript for ", "Lex Fridman")).toBe(
      undefined,
    );
  });

  it("reads timed captions and ignores a non-youtube caption host", () => {
    const cues = parseCaptionPayload(
      JSON.stringify({
        events: [
          {
            tStartMs: 6762000,
            dDurationMs: 11000,
            segs: [{ utf8: "the pursuit of excellence is a long game that" }],
          },
        ],
      }),
    );
    expect(cues[0]).toMatchObject({
      startSeconds: 6762,
      text: "the pursuit of excellence is a long game that",
    });
  });

  it("loads Psalm 23 from the bundled World English Bible", async () => {
    expect(ebibleChapterUrl("Psalm", 23)).toBe(
      "https://ebible.org/engwebp/PSA023.htm",
    );
    const passage = await loadBiblePassage("Psalms", 23, 1, 3);
    expect(passage?.text).toContain("The LORD is my shepherd");
    expect(passage?.sourceUrl).toBe("https://ebible.org/engwebp/PSA023.htm");
    expect(passage?.verseSpans[0]?.book).toBe("Psalm");
  });
});

describe("Found migration", () => {
  it("does not raise serialization failure and stores no query text", () => {
    const sql = readFileSync(
      "supabase/migrations/20260927220000_found_search_usage.sql",
      "utf8",
    );
    expect(sql).not.toContain("40001");
    expect(sql).not.toContain("query_text");
    expect(sql).toContain("usage_date");
    const refund = readFileSync(
      "supabase/migrations/20260928180000_found_search_refund.sql",
      "utf8",
    );
    expect(refund).not.toContain("40001");
    expect(refund).not.toContain("query_text");
    expect(refund).toContain("refund_found_search");
    expect(refund).toContain("usage.count < 50");
    expect(refund).toContain("interval '10 minutes'");
  });
});
