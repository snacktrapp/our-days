import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoUploadError } from "@/features/composer/video-upload";
import { inspectVideoFile } from "./inspect-video-file";

const posterDataUrl =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIhwgMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAD//2Q==";

function stubInspectableVideo(options: {
  duration: number;
  videoWidth?: number;
  videoHeight?: number;
}) {
  const createElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(
    (tagName, options_) => {
      if (tagName !== "video") return createElement(tagName, options_);
      const video = createElement("video");
      Object.defineProperties(video, {
        duration: { configurable: true, get: () => options.duration },
        videoWidth: {
          configurable: true,
          get: () => options.videoWidth ?? 1920,
        },
        videoHeight: {
          configurable: true,
          get: () => options.videoHeight ?? 1080,
        },
        readyState: {
          configurable: true,
          get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
        },
        play: {
          configurable: true,
          value: vi.fn().mockResolvedValue(undefined),
        },
        pause: { configurable: true, value: vi.fn() },
        load: {
          configurable: true,
          value: () => {
            queueMicrotask(() => {
              video.onloadedmetadata?.(new Event("loadedmetadata"));
            });
          },
        },
      });
      return video;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    posterDataUrl,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("inspectVideoFile", () => {
  it("rejects a file that is not a short-video type", async () => {
    await expect(
      inspectVideoFile(new File(["nope"], "notes.txt", { type: "text/plain" })),
    ).rejects.toBeInstanceOf(VideoUploadError);
  });

  it("rejects an empty video", async () => {
    await expect(
      inspectVideoFile(new File([], "empty.mp4", { type: "video/mp4" })),
    ).rejects.toMatchObject({
      message: "That video is empty. Choose another one.",
    });
  });

  it("reads duration, size, and a JPEG poster from the first frame", async () => {
    stubInspectableVideo({ duration: 12.4 });
    const inspected = await inspectVideoFile(
      new File([new Uint8Array(24)], "wave.mp4", { type: "video/mp4" }),
    );
    expect(inspected).toEqual({
      durationMs: 12_400,
      width: 1920,
      height: 1080,
      posterDataUrl,
    });
  });

  it("rejects a clip longer than about 60 seconds", async () => {
    stubInspectableVideo({ duration: 61.2 });
    await expect(
      inspectVideoFile(
        new File([new Uint8Array(24)], "long.mp4", { type: "video/mp4" }),
      ),
    ).rejects.toMatchObject({
      message: "Choose a video about 60 seconds or shorter.",
    });
  });

  it("stops when the upload is aborted", async () => {
    stubInspectableVideo({ duration: 8 });
    const controller = new AbortController();
    controller.abort();
    await expect(
      inspectVideoFile(
        new File([new Uint8Array(24)], "wave.mp4", { type: "video/mp4" }),
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
