// Accept clips under 40.5s so "0:40" recordings with metadata jitter still pass.
export const maximumVideoDurationMs = 40_499;
export const maximumVideoDurationSecondsExclusive = 40.5;
export const maximumVideoSourceBytes = 256 * 1024 * 1024;
// Hard backstop shared with the storage bucket and database checks.
export const maximumStoredVideoBytes = 128 * 1024 * 1024;
// 720p long edge. Re-encoded clips are scaled down to this.
export const preferredVideoLongEdgePx = 1280;
// ~2.5 Mbps H.264 + 96 kbps AAC. A 40s clip is about 13 MB of media data.
export const targetVideoBitsPerSecond = 2_500_000;
export const targetAudioBitsPerSecond = 96_000;

const uploadByteFloor = 8 * 1024 * 1024;
const containerAllowanceBytes = 512 * 1024;

function boundedDurationMs(durationMs: number) {
  if (!Number.isFinite(durationMs)) return 1;
  return Math.min(Math.max(durationMs, 1), maximumVideoDurationMs);
}

function nominalVideoBytes(durationMs: number) {
  const bitsPerSecond = targetVideoBitsPerSecond + targetAudioBitsPerSecond;
  return Math.ceil((bitsPerSecond * boundedDurationMs(durationMs)) / 8000);
}

function scaledBytes(bytes: number, percent: number) {
  return Math.ceil((bytes * percent) / 100);
}

// Clips already under this, and already <= 720p, can upload without re-encoding.
export function targetStoredVideoBytes(durationMs: number) {
  return Math.min(
    maximumStoredVideoBytes,
    scaledBytes(nominalVideoBytes(durationMs), 115),
  );
}

// Ceiling for a re-encoded file. Originals that keep their audio use the
// 128 MiB backstop instead of this budget.
export function maximumUploadVideoBytes(durationMs: number) {
  return Math.min(
    maximumStoredVideoBytes,
    Math.max(
      uploadByteFloor,
      scaledBytes(nominalVideoBytes(durationMs), 145) + containerAllowanceBytes,
    ),
  );
}

export const overDurationVideoMessage =
  "That video is over 40 seconds. Please trim it to 40 seconds or less.";
export const sourceVideoTooLargeMessage =
  "That video is too large to prepare on this device. Please pick a shorter clip.";
export const storedVideoTooLargeMessage =
  "That clip is too big to share right now. Please trim it and try again.";
export const unsupportedVideoCompressionMessage =
  "That clip is too big to share from this phone. Trim it in Photos or pick a shorter clip.";
