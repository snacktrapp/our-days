import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoUploadError } from "@/features/composer/video-upload";
import {
  discardPrimedVideoCompressionAudio,
  prepareVideoUploadFile,
  primeVideoCompressionAudio,
  type VideoCompressionSupport,
} from "./prepare-video-upload-file";
import {
  maximumStoredVideoBytes,
  targetAudioBitsPerSecond,
  targetVideoBitsPerSecond,
  unsupportedVideoCompressionMessage,
} from "./video-upload-policy";

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
  afterEach(() => {
    discardPrimedVideoCompressionAudio();
  });

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

  it("keeps an in-budget 720p file when compression is unavailable", async () => {
    const source = videoFile(8 * 1024 * 1024, "video/mp4");
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 40_000,
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

  it("uploads the original when this browser cannot compress", async () => {
    const source = videoFile(37 * 1024 * 1024, "video/mp4");
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 40_000,
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

  it("compresses a 720p clip that is still far above the bitrate budget", async () => {
    const source = videoFile(37 * 1024 * 1024, "video/mp4", "iphone.mp4");
    const compressed = videoFile(12 * 1024 * 1024, "video/mp4", "iphone.mp4");
    const compress = vi.fn(async () => compressed);
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 40_000,
          file: source,
          height: 720,
          width: 1280,
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

  it("keeps the original when the re-encode misses the bitrate budget", async () => {
    const source = videoFile(37 * 1024 * 1024, "video/mp4");
    const compress = vi.fn(async () =>
      videoFile(30 * 1024 * 1024, "video/mp4"),
    );
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 40_000,
          file: source,
          height: 720,
          width: 1280,
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

  it("falls back to an in-budget original when compression times out", async () => {
    const source = videoFile(4 * 1024 * 1024, "video/quicktime");
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

  it("refuses the original when compression fails and the file is over the backstop", async () => {
    const source = videoFile(maximumStoredVideoBytes + 1, "video/quicktime");
    const compress = vi.fn(async () => {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    });
    await expect(
      prepareVideoUploadFile(
        {
          durationMs: 40_000,
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
        message: unsupportedVideoCompressionMessage,
      }),
    );
  });

  it("falls back to an in-budget original when compression fails", async () => {
    const source = videoFile(4 * 1024 * 1024, "video/quicktime");
    const compress = vi.fn(async () => {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
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

    const recorderOptions: Array<MediaRecorderOptions | undefined> = [];
    class FakeRecorder {
      state: "inactive" | "recording" = "inactive";
      mimeType = "video/mp4";
      #listeners = new Map<string, Array<(event: unknown) => void>>();
      #stream: FakeMediaStream;

      constructor(stream: FakeMediaStream, options?: MediaRecorderOptions) {
        this.#stream = stream;
        recorderStreams.push(stream);
        recorderOptions.push(options);
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
      expect(recorderOptions[0]).toMatchObject({
        audioBitsPerSecond: targetAudioBitsPerSecond,
        videoBitsPerSecond: targetVideoBitsPerSecond,
      });
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

  it("still re-encodes when audio unlock times out instead of uploading the original", async () => {
    vi.useFakeTimers();
    const NativeAudioContext = (window as Window & { AudioContext?: unknown })
      .AudioContext;
    const NativeMediaRecorder = globalThis.MediaRecorder;
    const NativeMediaStream = globalThis.MediaStream;
    const createElement = document.createElement.bind(document);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-timeout");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const close = vi.fn(async () => undefined);
    const recordedStreams: FakeMediaStream[] = [];

    class TimeoutRecorder {
      state: "inactive" | "recording" = "inactive";
      mimeType = "video/mp4";
      #listeners = new Map<string, Array<(event: unknown) => void>>();

      constructor(stream: FakeMediaStream) {
        recordedStreams.push(stream);
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
      ).MediaRecorder = TimeoutRecorder as unknown as typeof MediaRecorder;

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

      const source = videoFile(37 * 1024 * 1024, "video/quicktime");
      const promise = prepareVideoUploadFile(
        {
          durationMs: 40_000,
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
      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;
      expect(result.compressed).toBe(true);
      expect(result.file).not.toBe(source);
      expect(recordedStreams.at(-1)?.getAudioTracks()).toHaveLength(0);
      expect(recordedStreams.at(-1)?.getVideoTracks()).toHaveLength(1);
      expect(close).toHaveBeenCalled();
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
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

  it("keeps a muted re-encode when the clip has no audio track", async () => {
    const NativeMediaRecorder = globalThis.MediaRecorder;
    const NativeMediaStream = globalThis.MediaStream;
    const NativeAudioContext = (window as Window & { AudioContext?: unknown })
      .AudioContext;
    const createElement = document.createElement.bind(document);
    const requestAnimationFrame = window.requestAnimationFrame;
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-muted");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    const recordedStreams: FakeMediaStream[] = [];
    let playAttempts = 0;

    class CanvasRecorder {
      state: "inactive" | "recording" = "inactive";
      mimeType = "video/mp4";
      #listeners = new Map<string, Array<(event: unknown) => void>>();

      constructor(stream: FakeMediaStream) {
        recordedStreams.push(stream);
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
      window.requestAnimationFrame = () => 1;
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
      ).MediaRecorder = CanvasRecorder as unknown as typeof MediaRecorder;
      (window as Window & { AudioContext?: unknown }).AudioContext = undefined;

      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
        drawImage: () => undefined,
      } as unknown as CanvasRenderingContext2D);
      const canvasPrototype =
        HTMLCanvasElement.prototype as HTMLCanvasElement & {
          captureStream?: (frameRate?: number) => MediaStream;
        };
      if (typeof canvasPrototype.captureStream !== "function") {
        Object.defineProperty(canvasPrototype, "captureStream", {
          configurable: true,
          writable: true,
          value: () => new MediaStream(),
        });
      }
      vi.spyOn(canvasPrototype, "captureStream").mockImplementation(
        () =>
          new FakeMediaStream([fakeTrack("video")]) as unknown as MediaStream,
      );

      const playback: { current: HTMLVideoElement | null } = { current: null };
      vi.spyOn(document, "createElement").mockImplementation((tagName) => {
        if (tagName !== "video") return createElement(tagName);
        const video = createElement("video");
        if (!playback.current) playback.current = video;
        Object.defineProperty(video, "audioTracks", {
          configurable: true,
          value: { length: 0 },
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
          value: vi.fn(() => {
            playAttempts += 1;
            if (playAttempts === 1) {
              return Promise.reject(
                new DOMException("blocked", "NotAllowedError"),
              );
            }
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                resolve();
                setTimeout(() => video.dispatchEvent(new Event("ended")), 0);
              }, 0);
            });
          }),
        });
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
        return video;
      });

      const source = videoFile(37 * 1024 * 1024, "video/quicktime", "clip.mov");
      const result = await prepareVideoUploadFile(
        {
          durationMs: 40_000,
          file: source,
          height: 1920,
          width: 1080,
        },
        {
          resolveSupport: () => ({
            captureMethod: null,
            canvasCapture: true,
            mimeType: "video/mp4",
          }),
        },
      );
      expect(result.compressed).toBe(true);
      expect(result.file).not.toBe(source);
      expect(result.file.type).toBe("video/mp4");
      expect(playAttempts).toBe(2);
      expect(playback.current?.muted).toBe(true);
      expect(recordedStreams.at(-1)?.getVideoTracks()).toHaveLength(1);
      expect(recordedStreams.at(-1)?.getAudioTracks()).toHaveLength(0);
    } finally {
      window.requestAnimationFrame = requestAnimationFrame;
      (window as Window & { AudioContext?: unknown }).AudioContext =
        NativeAudioContext;
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

  it("uploads the original when a clip with audio can only be re-encoded muted", async () => {
    const NativeMediaRecorder = globalThis.MediaRecorder;
    const NativeMediaStream = globalThis.MediaStream;
    const NativeAudioContext = (window as Window & { AudioContext?: unknown })
      .AudioContext;
    const createElement = document.createElement.bind(document);
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:test-keep-audio");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => undefined);
    let playAttempts = 0;

    class SilentFallbackRecorder {
      state: "inactive" | "recording" = "inactive";
      mimeType = "video/mp4";
      #listeners = new Map<string, Array<(event: unknown) => void>>();

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

    class RunningAudioContext {
      state: AudioContextState = "running";
      destination = { label: "speaker" };
      close = vi.fn(async () => undefined);
      resume = vi.fn(async () => undefined);
      createMediaElementSource = vi.fn(() => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      createMediaStreamDestination = vi.fn(() => ({
        stream: new FakeMediaStream([fakeTrack("audio")]),
        disconnect: vi.fn(),
      }));
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
      ).MediaRecorder =
        SilentFallbackRecorder as unknown as typeof MediaRecorder;
      (window as Window & { AudioContext?: typeof AudioContext }).AudioContext =
        RunningAudioContext as unknown as typeof AudioContext;

      vi.spyOn(document, "createElement").mockImplementation((tagName) => {
        if (tagName !== "video") return createElement(tagName);
        const video = createElement("video");
        Object.defineProperty(video, "audioTracks", {
          configurable: true,
          value: { length: 1 },
        });
        Object.defineProperty(video, "captureStream", {
          configurable: true,
          value: () =>
            new FakeMediaStream([
              fakeTrack("video"),
              fakeTrack("audio"),
            ]) as unknown as MediaStream,
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
          value: vi.fn(() => {
            playAttempts += 1;
            return Promise.reject(
              new DOMException("blocked", "NotAllowedError"),
            );
          }),
        });
        queueMicrotask(() => video.dispatchEvent(new Event("loadedmetadata")));
        return video;
      });

      const source = videoFile(37 * 1024 * 1024, "video/quicktime", "clip.mov");
      const result = await prepareVideoUploadFile(
        {
          durationMs: 40_000,
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
      expect(result).toEqual({ file: source, compressed: false });
      expect(playAttempts).toBe(1);
    } finally {
      (window as Window & { AudioContext?: unknown }).AudioContext =
        NativeAudioContext;
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

  it("resumes an AudioContext from the file-picker gesture", () => {
    const previous = (window as Window & { AudioContext?: unknown })
      .AudioContext;
    const resume = vi.fn(async () => undefined);
    class GestureAudioContext {
      state: AudioContextState = "suspended";
      resume = resume;
      close = vi.fn(async () => undefined);
    }
    try {
      (window as Window & { AudioContext?: typeof AudioContext }).AudioContext =
        GestureAudioContext as unknown as typeof AudioContext;
      primeVideoCompressionAudio();
      expect(resume).toHaveBeenCalledOnce();
    } finally {
      (window as Window & { AudioContext?: unknown }).AudioContext = previous;
    }
  });
});
