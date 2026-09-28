// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { foundFixtureVtt } from "@/features/insights/found-fixture";
import {
  formatFoundClock,
  formatFoundRange,
} from "@/features/insights/found-types";
import { foundWords } from "./normalize.server";
import { locateContiguousQuote } from "./verify.server";
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
