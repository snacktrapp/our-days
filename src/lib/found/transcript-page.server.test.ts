// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { foundFixtureQuote } from "@/features/insights/found-fixture";
import { htmlToFoundText } from "./web.server";
import { timedTranscriptFromPage } from "./transcript-page.server";
import { locateContiguousQuote } from "./verify.server";
import { timestampsForSlice } from "./vtt.server";

const lexHtml = `<div class="ts-segment">
  <span class="ts-name">DHH</span>
  <span class="ts-timestamp"><a href="https://youtube.com/watch?v=NYFGCESmikA&amp;t=6762">(01:52:42)</a></span>
  <span class="ts-text">the pursuit of excellence is a long game that rewards the people who stay with the work</span>
</div>
<div class="ts-segment">
  <span class="ts-timestamp"><a href="https://youtube.com/watch?v=NYFGCESmikA&amp;t=6784">[1:53:04]</a></span>
  <span class="ts-text">and then the conversation moves on to the next idea entirely.</span>
</div>`;

describe("publisher transcript pages", () => {
  it("matches a Lex-style passage and keeps the inline start time", () => {
    const page = [
      "(00:00:12) Welcome back to the podcast with a few opening words today.",
      "(01:52:42) the pursuit of excellence is a long game that rewards the people who stay with the work",
      "[1:53:04] and then the conversation moves on to the next idea entirely.",
    ].join("\n");
    const timed = timedTranscriptFromPage(page);
    expect(timed.text).toContain("pursuit of excellence");
    expect(timed.text).not.toContain("01:52:42");
    expect(timed.text).not.toContain("1:53:04");
    const located = locateContiguousQuote(timed.text, foundFixtureQuote);
    expect(located).not.toBeNull();
    const timing = timestampsForSlice(
      timed.words,
      located!.start,
      located!.end,
    );
    expect(timing).toEqual({ startSeconds: 6762, endSeconds: 6784 });
  });

  it("reads timestamps out of Lex transcript markup", () => {
    const timed = timedTranscriptFromPage(htmlToFoundText(lexHtml));
    const located = locateContiguousQuote(timed.text, foundFixtureQuote);
    expect(located?.quote).toBe(foundFixtureQuote);
    expect(
      timestampsForSlice(timed.words, located!.start, located!.end)
        ?.startSeconds,
    ).toBe(6762);
  });
});
