import { describe, expect, it } from "vitest";
import {
  overDurationVideoMessage,
  sourceVideoTooLargeMessage,
  storedVideoTooLargeMessage,
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
});
