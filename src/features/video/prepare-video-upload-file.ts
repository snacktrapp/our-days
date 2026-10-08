import { VideoUploadError } from "@/features/composer/video-upload";
import {
  maximumStoredVideoBytes,
  preferredVideoLongEdgePx,
  storedVideoTooLargeMessage,
  unsupportedVideoCompressionMessage,
} from "./video-upload-policy";

const fallbackPrepareMessage =
  "That video could not be prepared. Please try again.";

const preferredRecorderMimeTypes = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

type CaptureMethod = "captureStream" | "webkitCaptureStream";

export type VideoCompressionSupport = Readonly<{
  captureMethod: CaptureMethod;
  canvasCapture: boolean;
  mimeType: string;
}>;

type CompressionInput = Readonly<{
  file: File;
  durationMs: number;
  height: number;
  width: number;
  signal?: AbortSignal;
  support: VideoCompressionSupport;
}>;

type PrepareDependencies = Readonly<{
  compress?: (input: CompressionInput) => Promise<File>;
  resolveSupport?: () => VideoCompressionSupport | null;
}>;

export type PreparedVideoUploadFile = Readonly<{
  file: File;
  compressed: boolean;
}>;

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Video preparation was stopped.", "AbortError");
}

function recorderMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported === "function") {
    for (const mimeType of preferredRecorderMimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    }
    return null;
  }
  return preferredRecorderMimeTypes[0];
}

function captureMethod() {
  if (typeof HTMLVideoElement === "undefined") return null;
  const prototype = HTMLVideoElement.prototype as Partial<
    Record<CaptureMethod, unknown>
  >;
  if (typeof prototype.captureStream === "function") return "captureStream";
  if (typeof prototype.webkitCaptureStream === "function") {
    return "webkitCaptureStream";
  }
  return null;
}

function canvasCaptureSupported() {
  return (
    typeof HTMLCanvasElement !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function"
  );
}

function defaultCompressionSupport(): VideoCompressionSupport | null {
  if (typeof document === "undefined") return null;
  const mimeType = recorderMimeType();
  const method = captureMethod();
  if (!mimeType || !method) return null;
  return {
    captureMethod: method,
    canvasCapture: canvasCaptureSupported(),
    mimeType,
  };
}

function downscaledDimensions(width: number, height: number) {
  const longEdge = Math.max(width, height);
  const scale =
    longEdge > preferredVideoLongEdgePx ? preferredVideoLongEdgePx / longEdge : 1;
  const even = (value: number) => {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 === 0 ? rounded : rounded - 1;
  };
  return {
    width: even(width * scale),
    height: even(height * scale),
  };
}

function renamedFile(name: string, extension: "mp4" | "webm") {
  return name.replace(/\.[a-z0-9]+$/iu, "") + `.${extension}`;
}

async function waitForMetadata(video: HTMLVideoElement, signal?: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new VideoUploadError(fallbackPrepareMessage));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sourceStream(video: HTMLVideoElement, method: CaptureMethod) {
  const capture = (
    video as HTMLVideoElement &
      Partial<Record<CaptureMethod, () => MediaStream>>
  )[method];
  if (typeof capture !== "function") return null;
  try {
    return capture.call(video);
  } catch {
    return null;
  }
}

function tunedBitrates(durationMs: number) {
  const durationSeconds = Math.max(1, durationMs / 1000);
  const total = Math.floor(
    ((maximumStoredVideoBytes * 8) / durationSeconds) * 0.85,
  );
  const audio = 96_000;
  const video = Math.max(1_000_000, Math.min(3_500_000, total - audio));
  return { audioBitsPerSecond: audio, videoBitsPerSecond: video };
}

function createRecorder(
  stream: MediaStream,
  mimeType: string,
  durationMs: number,
  includeAudio: boolean,
) {
  const { videoBitsPerSecond, audioBitsPerSecond } = tunedBitrates(durationMs);
  const options: MediaRecorderOptions[] = [
    {
      mimeType,
      videoBitsPerSecond,
      ...(includeAudio ? { audioBitsPerSecond } : {}),
    },
    { mimeType },
    {},
  ];
  for (const option of options) {
    try {
      return new MediaRecorder(stream, option);
    } catch {
      continue;
    }
  }
  throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
}

async function compressWithMediaRecorder(input: CompressionInput): Promise<File> {
  throwIfAborted(input.signal);
  const url = URL.createObjectURL(input.file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.src = url;

  let output: MediaStream | null = null;
  let source: MediaStream | null = null;
  let stopDrawing = () => undefined;
  try {
    await waitForMetadata(video, input.signal);
    throwIfAborted(input.signal);
    source = sourceStream(video, input.support.captureMethod);
    if (!source) {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }

    if (input.support.canvasCapture) {
      const canvas = document.createElement("canvas");
      const target = downscaledDimensions(input.width, input.height);
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");
      if (!context) throw new VideoUploadError(fallbackPrepareMessage);
      output = canvas.captureStream(30);
      for (const track of source.getAudioTracks()) output.addTrack(track);
      let raf = 0;
      const draw = () => {
        context.drawImage(video, 0, 0, target.width, target.height);
        if (!video.ended) raf = window.requestAnimationFrame(draw);
      };
      draw();
      stopDrawing = () => {
        if (raf) window.cancelAnimationFrame(raf);
      };
    } else {
      output = source;
    }

    const recorder = createRecorder(
      output,
      input.support.mimeType,
      input.durationMs,
      source.getAudioTracks().length > 0,
    );
    const chunks: BlobPart[] = [];
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener(
        "error",
        () => reject(new VideoUploadError(fallbackPrepareMessage)),
        { once: true },
      );
    });

    const finishedPlayback = new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        cleanup();
        try {
          throwIfAborted(input.signal);
        } catch (error) {
          reject(error);
        }
      };
      const onEnded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new VideoUploadError(fallbackPrepareMessage));
      };
      const cleanup = () => {
        input.signal?.removeEventListener("abort", onAbort);
        video.removeEventListener("ended", onEnded);
        video.removeEventListener("error", onError);
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      video.addEventListener("ended", onEnded, { once: true });
      video.addEventListener("error", onError, { once: true });
    });

    recorder.start(750);
    const playback = video.play();
    if (playback) await playback;
    await finishedPlayback;
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    throwIfAborted(input.signal);

    const blob = new Blob(chunks, {
      type: recorder.mimeType || input.support.mimeType,
    });
    if (blob.size < 1) throw new VideoUploadError(fallbackPrepareMessage);
    const extension = /webm/iu.test(blob.type) ? "webm" : "mp4";
    const type = extension === "webm" ? "video/webm" : "video/mp4";
    return new File([blob], renamedFile(input.file.name, extension), {
      lastModified: input.file.lastModified,
      type,
    });
  } finally {
    stopDrawing();
    video.pause();
    video.removeAttribute("src");
    video.load();
    output?.getTracks().forEach((track) => track.stop());
    if (source && source !== output) {
      source.getTracks().forEach((track) => track.stop());
    }
    URL.revokeObjectURL(url);
  }
}

function shouldAttemptCompression(file: File, width: number, height: number) {
  const normalizedType = file.type.trim().toLowerCase();
  return (
    file.size > maximumStoredVideoBytes ||
    Math.max(width, height) > preferredVideoLongEdgePx ||
    normalizedType === "video/quicktime" ||
    normalizedType === "video/x-m4v"
  );
}

export async function prepareVideoUploadFile(
  input: Readonly<{
    file: File;
    durationMs: number;
    width: number;
    height: number;
    signal?: AbortSignal;
  }>,
  dependencies: PrepareDependencies = {},
): Promise<PreparedVideoUploadFile> {
  const resolveSupport = dependencies.resolveSupport ?? defaultCompressionSupport;
  const compress = dependencies.compress ?? compressWithMediaRecorder;
  const support = resolveSupport();
  const needsCompression = shouldAttemptCompression(
    input.file,
    input.width,
    input.height,
  );

  if (!support || !needsCompression) {
    if (input.file.size > maximumStoredVideoBytes) {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }
    return { file: input.file, compressed: false };
  }

  try {
    const compressed = await compress({
      ...input,
      support,
    });
    if (compressed.size > maximumStoredVideoBytes) {
      throw new VideoUploadError(storedVideoTooLargeMessage, false);
    }
    if (compressed.size < 1) {
      throw new VideoUploadError(fallbackPrepareMessage);
    }
    return { file: compressed, compressed: true };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof VideoUploadError) {
      if (error.message === storedVideoTooLargeMessage) throw error;
      if (input.file.size <= maximumStoredVideoBytes) {
        return { file: input.file, compressed: false };
      }
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }
    if (input.file.size <= maximumStoredVideoBytes) {
      return { file: input.file, compressed: false };
    }
    throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
  }
}
