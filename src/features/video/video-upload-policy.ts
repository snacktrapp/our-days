export const maximumVideoDurationMs = 60_000;
export const maximumVideoSourceBytes = 256 * 1024 * 1024;
export const maximumStoredVideoBytes = 32 * 1024 * 1024;
export const preferredVideoLongEdgePx = 1280;

export const overDurationVideoMessage =
  "That clip is a little long for Our Days. Please choose one that is 60 seconds or less.";
export const sourceVideoTooLargeMessage =
  "That video is too large to prepare on this device. Please choose one under 256 MB.";
export const storedVideoTooLargeMessage =
  "Please choose or export a video under 32 MB before posting.";
export const unsupportedVideoCompressionMessage =
  "That clip is too big to share from this phone. Trim it in Photos or pick a shorter clip.";
