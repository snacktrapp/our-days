// Accept clips under 40.5s so "0:40" recordings with metadata jitter still pass.
export const maximumVideoDurationMs = 40_499;
export const maximumVideoDurationSecondsExclusive = 40.5;
export const maximumVideoSourceBytes = 256 * 1024 * 1024;
export const maximumStoredVideoBytes = 128 * 1024 * 1024;
export const preferredVideoLongEdgePx = 1280;

export const overDurationVideoMessage =
  "That video is over 40 seconds. Please trim it to 40 seconds or less.";
export const sourceVideoTooLargeMessage =
  "That video is too large to prepare on this device. Please pick a shorter clip.";
export const storedVideoTooLargeMessage =
  "That clip is too big to share right now. Please trim it and try again.";
export const unsupportedVideoCompressionMessage =
  "That clip is too big to share from this phone. Trim it in Photos or pick a shorter clip.";
