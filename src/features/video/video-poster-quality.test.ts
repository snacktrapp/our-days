import { describe, expect, it } from "vitest";
import {
  posterDataUrlByteSize,
  posterDataUrlLooksLikelyBlank,
  posterLooksLikelyBlankByBytes,
} from "./video-poster-quality";

describe("video poster quality heuristics", () => {
  it("estimates data-url byte size", () => {
    expect(posterDataUrlByteSize("data:image/jpeg;base64,AAAA")).toBe(3);
    expect(posterDataUrlByteSize("data:image/jpeg;base64,AAA=")).toBe(2);
    expect(posterDataUrlByteSize("https://example.test/poster.jpg")).toBeNull();
  });

  it("flags suspiciously tiny HD posters", () => {
    expect(posterLooksLikelyBlankByBytes(5_549, 1280, 720)).toBe(true);
    expect(posterLooksLikelyBlankByBytes(22_000, 1280, 720)).toBe(false);
  });

  it("evaluates data-url candidates against frame dimensions", () => {
    const tinyJpeg = `data:image/jpeg;base64,${"A".repeat(5_000)}`;
    const richerJpeg = `data:image/jpeg;base64,${"A".repeat(20_000)}`;
    expect(posterDataUrlLooksLikelyBlank(tinyJpeg, 1280, 720)).toBe(true);
    expect(posterDataUrlLooksLikelyBlank(richerJpeg, 1280, 720)).toBe(false);
  });
});
