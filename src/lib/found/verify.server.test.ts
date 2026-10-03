// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { foundFixtureVtt } from "@/features/insights/found-fixture";
import {
  formatFoundClock,
  formatFoundRange,
  foundMaximumQuoteLength,
} from "@/features/insights/found-types";
import { foundWords } from "./normalize.server";
import {
  locateContiguousQuote,
  recoverNearQuote,
  sliceFromIndexes,
  verifySpan,
} from "./verify.server";
import { parseVtt, transcriptFromCues, timestampsForSlice } from "./vtt.server";

const shepherd = "The LORD is my shepherd; I shall lack nothing extra today.";
const shepherdQuote =
  "The LORD is my shepherd I shall lack nothing extra today";

describe("Found verification", () => {
  it("accepts curly quotes, spacing, dashes, and punctuation", () => {
    const source =
      "The “pursuit” of excellence — is a long game, that rewards the people who stay.";
    const quote =
      "The pursuit of excellence is a long game that rewards the people who stay.";
    const located = locateContiguousQuote(source, quote);
    expect(located?.quote).toContain("“pursuit”");
    expect(located?.quote).toContain("excellence");
    expect(located?.quote.endsWith("stay")).toBe(true);
  });

  it("drops a supplied quote that is not contiguous and ignores offsets", () => {
    const source =
      "the pursuit of excellence is a long game that rewards the people who stay";
    expect(locateContiguousQuote(source, source)).not.toBeNull();
    expect(
      verifySpan(source, {
        quote: source.replace("excellence", "mediocrity"),
      }),
    ).toBeNull();
    expect(verifySpan(source, { hintSeconds: 1 })).toBeNull();
  });

  it("drops a match longer than 4000 characters instead of trimming it", () => {
    const source = Array.from({ length: 900 }, () => "alpha").join(" ");
    expect(source.length).toBeGreaterThan(foundMaximumQuoteLength);
    expect(locateContiguousQuote(source, source)).toBeNull();
    expect(sliceFromIndexes(source, 0, source.length)).toBeNull();
  });

  it("rejects one changed word", () => {
    expect(
      locateContiguousQuote(
        shepherd,
        shepherdQuote.replace("nothing", "something"),
      ),
    ).toBeNull();
    expect(
      locateContiguousQuote(
        "the pursuit of excellences is a long game that rewards people",
        "the pursuit of excellence is a long game that rewards people",
      ),
    ).toBeNull();
  });

  it("treats apostrophes as the same boundary on both sides", () => {
    const source =
      "We don’t quit the long work that rewards people who stay here.";
    const quote =
      "We don't quit the long work that rewards people who stay here.";
    expect(foundWords(source)).toEqual(foundWords(quote));
    expect(locateContiguousQuote(source, quote)?.quote).toContain("don’t");
  });

  it("reads the timestamp range from caption cues", () => {
    const cues = parseVtt(foundFixtureVtt);
    const transcript = transcriptFromCues(cues);
    const located = locateContiguousQuote(
      transcript.text,
      "the pursuit of excellence is a long game that rewards the people who stay with the work",
    );
    expect(located).not.toBeNull();
    const timing = timestampsForSlice(
      transcript.words,
      located!.start,
      located!.end,
    );
    expect(timing).toEqual({ startSeconds: 6762, endSeconds: 6784 });
    expect(formatFoundClock(6762)).toBe("1:52:42");
    expect(formatFoundRange(6762, 6784)).toBe("1:52:42–1:53:04");
    expect(formatFoundClock(90)).toBe("1:30");
  });

  it("recovers the DHH excellence passage from a two-word paraphrase", () => {
    const excellence =
      "The pursuit of excellence deserves no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const page = [
      "DHH (01:52:27) First, let me quote the line.",
      `“${excellence.split(". ")[0]}.”`,
      "DHH (01:52:40) Wanting to make something as good and as fast and as beautiful as possible has no need for justification.",
      "I thought if I could set up my entire system in 15 minutes, it would already be such a dramatic improvement over what came before it that I would be perfectly happy.",
    ].join(" ");
    const paraphrase =
      "The pursuit of excellence needs no justification. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const oneWord =
      "The pursuit of excellence needs no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    expect(locateContiguousQuote(page, paraphrase)).toBeNull();
    const recovered = recoverNearQuote(page, paraphrase);
    expect(recovered.ok).toBe(true);
    expect(recovered.similarity).toBeGreaterThanOrEqual(0.85);
    expect(recovered.located?.quote).toContain("deserves no explanation");
    expect(recovered.located?.quote).not.toContain("needs no justification");
    expect(page).toContain(recovered.located?.quote);
    const single = recoverNearQuote(page, oneWord);
    expect(single.ok).toBe(true);
    expect(single.located?.quote).toContain("deserves no explanation");
    expect(single.located?.quote).not.toContain("needs no explanation");
  });

  it("rejects an unrelated quote, another passage, and a common-word overlap", () => {
    const page = [
      "DHH (01:52:27) “The pursuit of excellence deserves no explanation.” Wanting to make something as good and as fast and as beautiful as possible has no need for justification.",
      "I thought if I could set up my entire system in 15 minutes, it would already be such a dramatic improvement over what came before it that I would be perfectly happy.",
    ].join(" ");
    expect(
      recoverNearQuote(
        page,
        "Bananas ripen slowly in a warm kitchen and then taste sweet after lunch today.",
      ).ok,
    ).toBe(false);
    expect(
      recoverNearQuote(
        page,
        "I remember the old computers took many minutes and the improvement was never something I would call perfectly happy.",
      ).ok,
    ).toBe(false);
    expect(
      recoverNearQuote(
        page,
        "The weather was cold and the train was late and the coffee was weak and the meeting ran long and nobody offered a real justification",
      ).ok,
    ).toBe(false);
  });

  it("finds a passage at the end of a long transcript quickly", () => {
    const passage =
      "The pursuit of excellence deserves no explanation. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.";
    const page = `${"alpha beta ".repeat(19_000)} ${passage}`;
    expect(page.length).toBeGreaterThan(200_000);
    const started = Date.now();
    const recovered = recoverNearQuote(
      page,
      "The pursuit of excellence needs no justification. Wanting to make something as good and as fast and as beautiful as possible has no need for justification.",
    );
    expect(Date.now() - started).toBeLessThan(500);
    expect(recovered.ok).toBe(true);
    expect(recovered.located?.quote).toContain("deserves no explanation");
  });

  it("drops rolling duplicate caption lines", () => {
    const transcript = transcriptFromCues(
      parseVtt(`WEBVTT

00:00:01.000 --> 00:00:02.000
the pursuit of excellence

00:00:02.000 --> 00:00:03.000
the pursuit of excellence is a long game that rewards
`),
    );
    expect(transcript.text).toBe(
      "the pursuit of excellence is a long game that rewards",
    );
  });
});
