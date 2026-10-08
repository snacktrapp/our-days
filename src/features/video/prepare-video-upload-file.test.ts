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

class FakeMediaStream {
  #tracks: Array<{ kind: string; stop: () => void }>;

  constructor(tracks: Array<{ kind: string; stop: () => void }> = []) {
    this.#tracks = [...tracks];
  }

  addTrack(track: { kind: string; stop: () => void }) {
    this.#tracks.push(track);
  }

  getAudioTracks() {
    return this.#tracks.filter((track) => track.kind === "audio");
  }

  getVideoTracks() {
    return this.#tracks.filter((track) => track.kind === "video");
  }

  getTracks() {
    return [...this.#tracks];
  }
}

type Track = { kind: "audio" | "video"; stop: () => void };

function fakeTrack(kind: "audio" | "video"): Track {
  return { kind, stop: () => undefined };
}

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
          "That clip is too big to share from this phone. Trim it in Photos or pick a shorter clip.",
      }),
    );
  });

  it("allows a large raw file under the backstop when compression is unsupported", async () => {
    const source = videoFile(120 * 1024 * 1024, "video/mp4");
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

  it("falls back to a small raw file when compression times out", async () => {
    const source = videoFile(maximumStoredVideoBytes - 1, "video/quicktime");
    const compress = vi.fn(async () => {
      throw new VideoUploadError(
        "This video took too long to prepare. Try again.",
      );
    });
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: source,
          height: 1080,
          width: 1920,
        },
        {
          compress,
          resolveSupport: () => compressionSupport,
        },
      ),
    ).resolves.toEqual({
      file: source,
      compressed: false,
    });
  });

  it("shows a clear message when timeout leaves a large raw file", async () => {
    const source = videoFile(maximumStoredVideoBytes + 1, "video/quicktime");
    const compress = vi.fn(async () => {
      throw new VideoUploadError(
        "This video took too long to prepare. Try again.",
      );
    });
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: source,
          height: 1080,
          width: 1920,
        },
        {
          compress,
          resolveSupport: () => compressionSupport,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<Partial<VideoUploadError>>({
        message:
          "That clip took too long to prepare on this phone. Trim it in Photos or pick a shorter clip.",
      }),
    );
  });

  it("falls back to the original file when supported compression fails under the backstop", async () => {
    const source = videoFile(120 * 1024 * 1024, "video/quicktime");
    const compress = vi.fn(async () => {
      throw new VideoUploadError(
        "That clip is too big to share from this phone. Trim it in Photos or pick a shorter clip.",
        false,
      );
    });
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: source,
          height: 1080,
          width: 1920,
        },
        {
          compress,
          resolveSupport: () => compressionSupport,
        },
      ),
    ).resolves.toEqual({
      file: source,
      compressed: false,
    });
  });

  it("routes audio only through MediaStreamDestination and keeps playback silent externally", async () => {
    const NativeAudioContext = (window as Window & { AudioContext?: unknown })
      .AudioContext;
    const NativeMediaRecorder = globalThis.MediaRecorder;
    const NativeMediaStream = globalThis.MediaStream;
    const createElement = document.createElement.bind(document);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const recorderStreams: unknown[] = [];
    const contexts: Array<{
      close: ReturnType<typeof vi.fn>;
      destination: { label: string };
    }> = [];
    const connectCalls: unknown[] = [];
    const streamDestinations: unknown[] = [];
    let firstVideo: HTMLVideoElement | null = null;
    const destinationAudioTrack = fakeTrack("audio");

    class FakeRecorder {
      state: "inactive" | "recording" = "inactive";
      mimeType = "video/mp4";
      #listeners = new Map<string, Array<(event: unknown) => void>>();
      #stream: FakeMediaStream;

      constructor(stream: FakeMediaStream) {
        this.#stream = stream;
        recorderStreams.push(stream);
      }

      addEventListener(name: string, callback: (event: unknown) => void) {
        this.#listeners.set(name, [
          ...(this.#listeners.get(name) ?? []),
          callback,
        ]);
      }

      removeEventListener(name: string, callback: (event: unknown) => void) {
        this.#listeners.set(
          name,
          (this.#listeners.get(name) ?? []).filter((item) => item !== callback),
        );
      }

      #emit(name: string, event: unknown) {
        for (const listener of this.#listeners.get(name) ?? []) listener(event);
      }

      start() {
        this.state = "recording";
        this.#emit("dataavailable", {
          data: new Blob([new Uint8Array([1])], { type: "video/mp4" }),
        });
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.#emit("stop", {});
      }
    }

    try {
      (
        globalThis as typeof globalThis & {
          MediaStream: typeof MediaStream;
          MediaRecorder: typeof MediaRecorder;
        }
      ).MediaStream = FakeMediaStream as unknown as typeof MediaStream;
      (
        globalThis as typeof globalThis & {
          MediaRecorder: typeof MediaRecorder;
        }
      ).MediaRecorder = FakeRecorder as unknown as typeof MediaRecorder;

      class FakeAudioContext {
        state: AudioContextState = "suspended";
        destination = { label: "speaker" };
        close = vi.fn(async () => undefined);
        createMediaElementSource = vi.fn(() => ({
          connect: vi.fn((target: unknown) => {
            connectCalls.push(target);
          }),
          disconnect: vi.fn(),
        }));
        createMediaStreamDestination = vi.fn(() => {
          const destination = {
            stream: new FakeMediaStream([destinationAudioTrack]),
            disconnect: vi.fn(),
          };
          streamDestinations.push(destination);
          return destination;
        });
        resume = vi.fn(async () => {
          this.state = "running";
        });

        constructor() {
          contexts.push({ close: this.close, destination: this.destination });
        }
      }

      (
        window as Window & {
          AudioContext?: typeof AudioContext;
        }
      ).AudioContext = FakeAudioContext as unknown as typeof AudioContext;

      vi.spyOn(document, "createElement").mockImplementation((tagName) => {
        if (tagName !== "video") return createElement(tagName);
        const video = createElement("video");
        if (!firstVideo) firstVideo = video;
        const capture = vi.fn(
          () =>
            new FakeMediaStream([
              fakeTrack("video"),
              fakeTrack("audio"),
            ]) as unknown as MediaStream,
        );
        Object.defineProperty(video, "captureStream", {
          configurable: true,
          value: capture,
        });
        Object.defineProperty(video, "readyState", {
          configurable: true,
          get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
        });
        Object.defineProperty(video, "duration", {
          configurable: true,
          get: () => Number.NaN,
        });
        Object.defineProperty(video, "play", {
          configurable: true,
          value: vi.fn(
            () =>
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  resolve();
                  setTimeout(() => video.dispatchEvent(new Event("ended")), 0);
                }, 0);
              }),
          ),
        });
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
        return video;
      });

      const source = videoFile(12 * 1024 * 1024, "video/quicktime");
      const resultPromise = prepareVideoUploadFile(
        {
          durationMs: 12_000,
          file: source,
          height: 1080,
          width: 1920,
        },
        {
          resolveSupport: () => ({
            captureMethod: "captureStream",
            canvasCapture: false,
            mimeType: "video/mp4",
          }),
        },
      );
      const result = await resultPromise;
      expect(result.compressed).toBe(true);

      const recorded = recorderStreams[0] as FakeMediaStream;
      expect(recorded.getAudioTracks()).toHaveLength(1);
      expect(recorded.getVideoTracks()).toHaveLength(1);
      expect(recorded.getAudioTracks()[0]).toBe(destinationAudioTrack);
      expect(connectCalls).toHaveLength(1);
      expect(connectCalls[0]).toBe(streamDestinations[0]);
      expect(connectCalls).not.toContain(contexts[0]?.destination);

      const observedVideo = firstVideo as HTMLVideoElement | null;
      expect(observedVideo).not.toBeNull();
      expect(observedVideo?.muted).toBe(false);
      expect(observedVideo?.defaultMuted).toBe(false);
      expect(observedVideo?.volume).toBeGreaterThan(0);
      expect(contexts[0]?.close).toHaveBeenCalled();
    } finally {
      (
        window as Window & {
          AudioContext?: unknown;
        }
      ).AudioContext = NativeAudioContext;
      (
        globalThis as typeof globalThis & {
          MediaRecorder: typeof MediaRecorder;
        }
      ).MediaRecorder = NativeMediaRecorder;
      (
        globalThis as typeof globalThis & {
          MediaStream: typeof MediaStream;
        }
      ).MediaStream = NativeMediaStream;
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it("falls back to can't-compress behavior when audio context resume times out", async () => {
    vi.useFakeTimers();
    const NativeAudioContext = (window as Window & { AudioContext?: unknown })
      .AudioContext;
    const NativeMediaStream = globalThis.MediaStream;
    const createElement = document.createElement.bind(document);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-timeout");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const close = vi.fn(async () => undefined);

    try {
      (
        globalThis as typeof globalThis & {
          MediaStream: typeof MediaStream;
        }
      ).MediaStream = FakeMediaStream as unknown as typeof MediaStream;

      class HangingAudioContext {
        state: AudioContextState = "suspended";
        destination = { label: "speaker" };
        close = close;
        createMediaElementSource = vi.fn(() => ({
          connect: vi.fn(),
          disconnect: vi.fn(),
        }));
        createMediaStreamDestination = vi.fn(() => ({
          stream: new FakeMediaStream([fakeTrack("audio")]),
          disconnect: vi.fn(),
        }));
        resume = vi.fn(() => new Promise<void>(() => undefined));
      }

      (
        window as Window & {
          AudioContext?: typeof AudioContext;
        }
      ).AudioContext = HangingAudioContext as unknown as typeof AudioContext;

      vi.spyOn(document, "createElement").mockImplementation((tagName) => {
        if (tagName !== "video") return createElement(tagName);
        const video = createElement("video");
        Object.defineProperty(video, "captureStream", {
          configurable: true,
          value: () => new FakeMediaStream([fakeTrack("video")]),
        });
        Object.defineProperty(video, "readyState", {
          configurable: true,
          get: () => HTMLMediaElement.HAVE_CURRENT_DATA,
        });
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
        return video;
      });

      const promise = prepareVideoUploadFile(
        {
          durationMs: 30_000,
          file: videoFile(maximumStoredVideoBytes + 1, "video/quicktime"),
          height: 1080,
          width: 1920,
        },
        {
          resolveSupport: () => ({
            captureMethod: "captureStream",
            canvasCapture: false,
            mimeType: "video/mp4",
          }),
        },
      );
      const rejection = expect(promise).rejects.toMatchObject({
        message:
          "That clip is too big to share from this phone. Trim it in Photos or pick a shorter clip.",
      });
      await vi.advanceTimersByTimeAsync(3_100);
      await rejection;
      expect(close).toHaveBeenCalled();
    } finally {
      (
        window as Window & {
          AudioContext?: unknown;
        }
      ).AudioContext = NativeAudioContext;
      (
        globalThis as typeof globalThis & {
          MediaStream: typeof MediaStream;
        }
      ).MediaStream = NativeMediaStream;
      createObjectURL.mockRestore();
      revokeObjectURL.mockRestore();
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });
});
