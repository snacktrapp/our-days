import { describe, expect, it, vi } from "vitest";
import { VideoUploadError } from "@/features/composer/video-upload";
import {
  prepareVideoUploadFile,
  type VideoCompressionSupport,
} from "./prepare-video-upload-file";
import { maximumStoredVideoBytes } from "./video-upload-policy";

function videoFile(size: number, type = "video/mp4", name = "clip.mp4") {
  const file = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  Object.defineProperty(file, "size", { configurable: true, value: size });
  return file;
}

const compressionSupport: VideoCompressionSupport = {
  captureMethod: "captureStream",
  canvasCapture: true,
  mimeType: "video/mp4",
};

describe("prepareVideoUploadFile", () => {
  it("applies compression when supported and needed", async () => {
    const source = videoFile(
      maximumStoredVideoBytes + 10_000,
      "video/quicktime",
      "ios.mov",
    );
    const compressed = videoFile(2 * 1024 * 1024, "video/mp4", "ios.mp4");
    const compress = vi.fn(async () => compressed);

    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: source,
          height: 2160,
          width: 3840,
        },
        {
          compress,
          resolveSupport: () => compressionSupport,
        },
      ),
    ).resolves.toEqual({
      file: compressed,
      compressed: true,
    });
    expect(compress).toHaveBeenCalledOnce();
  });

  it("refuses a large raw file when compression is unsupported", async () => {
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: videoFile(maximumStoredVideoBytes + 1),
          height: 1080,
          width: 1920,
        },
        { resolveSupport: () => null },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<VideoUploadError>>({
        message:
          "This browser cannot safely shrink that video yet. Please choose one under 32 MB.",
      }),
    );
  });

  it("allows a small raw file through when compression is unsupported", async () => {
    const source = videoFile(maximumStoredVideoBytes - 1, "video/mp4");
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: source,
          height: 720,
          width: 1280,
        },
        { resolveSupport: () => null },
      ),
    ).resolves.toEqual({
      file: source,
      compressed: false,
    });
  });
});
