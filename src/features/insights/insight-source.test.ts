import { describe, expect, it } from "vitest";
import {
  insightSourceLabel,
  parseInsightSourceUrl,
  validInsightAttribution,
  validInsightQuote,
} from "./insight-source";

describe("insight source helpers", () => {
  it("accepts https source URLs and treats blanks as omitted", () => {
    expect(parseInsightSourceUrl(null)).toEqual({ ok: true, url: null });
    expect(parseInsightSourceUrl("  ")).toEqual({ ok: true, url: null });
    expect(
      parseInsightSourceUrl(
        "  https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120  ",
      ),
    ).toEqual({
      ok: true,
      url: "https://www.youtube.com/watch?v=nm1TxQj9IsQ&t=120",
    });
  });

  it("rejects non-https or malformed source URLs", () => {
    expect(parseInsightSourceUrl("http://example.test/x")).toEqual({
      ok: false,
    });
    expect(parseInsightSourceUrl("javascript:alert(1)")).toEqual({ ok: false });
    expect(parseInsightSourceUrl("https://exa mple.test")).toEqual({
      ok: false,
    });
  });

  it("labels listen vs read from the host", () => {
    expect(insightSourceLabel("https://www.youtube.com/watch?v=abc&t=12")).toBe(
      "Listen",
    );
    expect(insightSourceLabel("https://open.spotify.com/episode/1")).toBe(
      "Listen",
    );
    expect(insightSourceLabel("https://hubermanlab.com/sleep")).toBe(
      "Read the source",
    );
  });

  it("keeps quote and attribution bounds aligned with the schema", () => {
    expect(validInsightQuote("Morning sunlight.")).toBe(true);
    expect(validInsightQuote("   ")).toBe(false);
    expect(validInsightAttribution("Huberman Lab — Sleep")).toBe(true);
    expect(validInsightAttribution("")).toBe(false);
  });
});
