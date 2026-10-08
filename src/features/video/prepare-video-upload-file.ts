import { VideoUploadError } from "@/features/composer/video-upload";
import {
  maximumVideoDurationMs,
  maximumStoredVideoBytes,
  overDurationVideoMessage,
  preferredVideoLongEdgePx,
  storedVideoTooLargeMessage,
  unsupportedVideoCompressionMessage,
} from "./video-upload-policy";

const fallbackPrepareMessage =
  "That video could not be prepared. Please try again.";
const prepareTimeoutMessage = "This video took too long to prepare. Try again.";
const slowPrepareTooLargeMessage =
  "That clip took too long to prepare on this phone. Trim it in Photos or pick a shorter clip.";
const metadataTimeoutMs = 15_000;
const minimumPlaybackTimeoutMs = 45_000;
const playbackTimeoutMarginMs = 20_000;
const recorderStopTimeoutMs = 3_000;
const outputDurationProbeTimeoutMs = 8_000;

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
    longEdge > preferredVideoLongEdgePx
      ? preferredVideoLongEdgePx / longEdge
      : 1;
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
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new VideoUploadError(prepareTimeoutMessage, true));
    }, metadataTimeoutMs);
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
      window.clearTimeout(timeout);
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

function playbackTimeoutMs(durationMs: number) {
  return Math.max(
    minimumPlaybackTimeoutMs,
    durationMs + playbackTimeoutMarginMs,
  );
}

function logBackstopEdgeCase(
  context: Readonly<{
    durationMs: number;
    fileSize: number;
    reason: string;
    type: string;
  }>,
) {
  if (context.durationMs > maximumVideoDurationMs) return;
  console.warn("[video-upload] backstop_edge_case", context);
}

async function waitForPlaybackFinished(input: {
  signal?: AbortSignal;
  timeoutMs: number;
  video: HTMLVideoElement;
}) {
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new VideoUploadError(prepareTimeoutMessage, true));
    }, input.timeoutMs);
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
      window.clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
      input.video.removeEventListener("ended", onEnded);
      input.video.removeEventListener("error", onError);
    };
    input.signal?.addEventListener("abort", onAbort, { once: true });
    input.video.addEventListener("ended", onEnded, { once: true });
    input.video.addEventListener("error", onError, { once: true });
  });
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

async function readVideoDurationMs(file: File, signal?: AbortSignal) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        resolve();
      }, outputDurationProbeTimeoutMs);
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
        resolve();
      };
      const cleanup = () => {
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        video.removeEventListener("loadedmetadata", onLoadedMetadata);
        video.removeEventListener("error", onError);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      video.addEventListener("loadedmetadata", onLoadedMetadata, {
        once: true,
      });
      video.addEventListener("error", onError, { once: true });
    });
    const durationMs = Math.ceil(video.duration * 1000);
    if (!Number.isFinite(video.duration) || durationMs < 1) return null;
    return durationMs;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

async function compressWithMediaRecorder(
  input: CompressionInput,
): Promise<File> {
  throwIfAborted(input.signal);
  const url = URL.createObjectURL(input.file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.src = url;

  let recorder: MediaRecorder | null = null;
  let waitForRecorderStop: Promise<void> | null = null;
  let onRecorderData: ((event: BlobEvent) => void) | null = null;
  let onRecorderStop: (() => void) | null = null;
  let onRecorderError: (() => void) | null = null;
  let output: MediaStream | null = null;
  let source: MediaStream | null = null;
  let stopDrawing = () => undefined;
  const chunks: BlobPart[] = [];
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

    recorder = createRecorder(
      output,
      input.support.mimeType,
      input.durationMs,
      source.getAudioTracks().length > 0,
    );
    const activeRecorder = recorder;
    waitForRecorderStop = new Promise<void>((resolve, reject) => {
      onRecorderData = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      onRecorderStop = () => resolve();
      onRecorderError = () =>
        reject(new VideoUploadError(fallbackPrepareMessage));
      activeRecorder.addEventListener("dataavailable", onRecorderData);
      activeRecorder.addEventListener("stop", onRecorderStop, { once: true });
      activeRecorder.addEventListener("error", onRecorderError, {
        once: true,
      });
    });

    activeRecorder.start(750);
    const playback = video.play();
    try {
      if (playback) await playback;
    } catch {
      throw new VideoUploadError(prepareTimeoutMessage, true);
    }
    await waitForPlaybackFinished({
      signal: input.signal,
      timeoutMs: playbackTimeoutMs(input.durationMs),
      video,
    });
    if (recorder.state !== "inactive") recorder.stop();
    await waitForRecorderStop;
    throwIfAborted(input.signal);

    const blob = new Blob(chunks, {
      type: recorder.mimeType || input.support.mimeType,
    });
    if (blob.size < 1) throw new VideoUploadError(fallbackPrepareMessage);
    const extension = /webm/iu.test(blob.type) ? "webm" : "mp4";
    const type = extension === "webm" ? "video/webm" : "video/mp4";
    const file = new File([blob], renamedFile(input.file.name, extension), {
      lastModified: input.file.lastModified,
      type,
    });
    const outputDurationMs = await readVideoDurationMs(file, input.signal);
    if (outputDurationMs && outputDurationMs > maximumVideoDurationMs) {
      throw new VideoUploadError(overDurationVideoMessage, false);
    }
    return file;
  } finally {
    if (recorder) {
      if (onRecorderData) {
        recorder.removeEventListener("dataavailable", onRecorderData);
      }
      if (onRecorderStop) recorder.removeEventListener("stop", onRecorderStop);
      if (onRecorderError) {
        recorder.removeEventListener("error", onRecorderError);
      }
      if (recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          // Ignore invalid-state stops while cleaning up.
        }
      }
    }
    if (waitForRecorderStop) {
      await Promise.race([
        waitForRecorderStop.catch(() => undefined),
        new Promise<void>((resolve) =>
          window.setTimeout(resolve, recorderStopTimeoutMs),
        ),
      ]);
    }
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
  const resolveSupport =
    dependencies.resolveSupport ?? defaultCompressionSupport;
  const compress = dependencies.compress ?? compressWithMediaRecorder;
  const support = resolveSupport();
  const needsCompression = shouldAttemptCompression(
    input.file,
    input.width,
    input.height,
  );

  if (!support || !needsCompression) {
    if (input.file.size > maximumStoredVideoBytes) {
      logBackstopEdgeCase({
        durationMs: input.durationMs,
        fileSize: input.file.size,
        reason: "compression_unavailable",
        type: input.file.type,
      });
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
      logBackstopEdgeCase({
        durationMs: input.durationMs,
        fileSize: compressed.size,
        reason: "compressed_output_above_backstop",
        type: compressed.type,
      });
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
      if (
        error.message === storedVideoTooLargeMessage ||
        error.message === overDurationVideoMessage
      ) {
        throw error;
      }
      if (input.file.size <= maximumStoredVideoBytes) {
        return { file: input.file, compressed: false };
      }
      if (error.message === prepareTimeoutMessage) {
        logBackstopEdgeCase({
          durationMs: input.durationMs,
          fileSize: input.file.size,
          reason: "compression_timeout",
          type: input.file.type,
        });
        throw new VideoUploadError(slowPrepareTooLargeMessage, false);
      }
      logBackstopEdgeCase({
        durationMs: input.durationMs,
        fileSize: input.file.size,
        reason: "compression_failed",
        type: input.file.type,
      });
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }
    if (input.file.size <= maximumStoredVideoBytes) {
      return { file: input.file, compressed: false };
    }
    throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
  }
}
