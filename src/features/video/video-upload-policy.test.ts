import { describe, expect, it } from "vitest";
import {
  maximumStoredVideoBytes,
  maximumUploadVideoBytes,
  overDurationVideoMessage,
  sourceVideoTooLargeMessage,
  storedVideoTooLargeMessage,
  targetStoredVideoBytes,
  unsupportedVideoCompressionMessage,
} from "./video-upload-policy";

describe("video upload policy copy", () => {
  it("keeps all user-facing video limit messages free of MB wording", () => {
    const userCopy = [
      overDurationVideoMessage,
      sourceVideoTooLargeMessage,
      storedVideoTooLargeMessage,
      unsupportedVideoCompressionMessage,
    ];
    for (const message of userCopy) {
      expect(message).not.toMatch(/\b(?:mb|mib)\b/iu);
    }
  });

  it("budgets a 40 second re-encode near 13 MB", () => {
    expect(targetStoredVideoBytes(40_000)).toBe(14_927_000);
    expect(targetStoredVideoBytes(40_000)).toBeGreaterThan(10 * 1024 * 1024);
    expect(targetStoredVideoBytes(40_000)).toBeLessThan(15 * 1024 * 1024);
    expect(maximumUploadVideoBytes(40_000)).toBe(19_345_288);
    expect(maximumUploadVideoBytes(40_000)).toBeLessThan(37 * 1024 * 1024);
    expect(maximumUploadVideoBytes(40_000)).toBeLessThanOrEqual(
      maximumStoredVideoBytes,
    );
    expect(maximumUploadVideoBytes(1_000)).toBe(8 * 1024 * 1024);
  });
});
