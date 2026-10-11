import { VideoUploadError } from "@/features/composer/video-upload";
import {
  maximumUploadVideoBytes,
  maximumVideoDurationMs,
  maximumStoredVideoBytes,
  overDurationVideoMessage,
  preferredVideoLongEdgePx,
  storedVideoTooLargeMessage,
  targetAudioBitsPerSecond,
  targetStoredVideoBytes,
  targetVideoBitsPerSecond,
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
const audioResumeTimeoutMs = 3_000;

const preferredRecorderMimeTypes = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp8,opus",
  "video/webm",
] as const;

type CaptureMethod = "captureStream" | "webkitCaptureStream";
type AudioContextConstructor = new () => AudioContext;

export type VideoCompressionSupport = Readonly<{
  captureMethod: CaptureMethod | null;
  canvasCapture: boolean;
  mimeType: string;
}>;

let primedAudioContext: AudioContext | null = null;

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
  const canvasCapture = canvasCaptureSupported();
  // iPhone Safari has canvas.captureStream and MediaRecorder without
  // HTMLVideoElement.captureStream. Either capture path is enough.
  if (!mimeType || (!method && !canvasCapture)) return null;
  return {
    captureMethod: method,
    canvasCapture,
    mimeType,
  };
}

export function primeVideoCompressionAudio() {
  const AudioContextCtor = webAudioContextConstructor();
  if (!AudioContextCtor) return;
  try {
    if (!primedAudioContext || primedAudioContext.state === "closed") {
      primedAudioContext = new AudioContextCtor();
    }
    void primedAudioContext.resume().catch(() => undefined);
  } catch {
    primedAudioContext = null;
  }
}

export function discardPrimedVideoCompressionAudio() {
  const context = primedAudioContext;
  primedAudioContext = null;
  if (!context || context.state === "closed") return;
  void context.close().catch(() => undefined);
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

function webAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const context = (
    window as Window &
      typeof globalThis & {
        webkitAudioContext?: AudioContextConstructor;
      }
  ).AudioContext;
  if (typeof context === "function") return context;
  const webkitContext = (
    window as Window &
      typeof globalThis & {
        webkitAudioContext?: AudioContextConstructor;
      }
  ).webkitAudioContext;
  return typeof webkitContext === "function" ? webkitContext : null;
}

async function resumeAudioContext(context: AudioContext, signal?: AbortSignal) {
  const isRunning = () => context.state === "running";
  if (isRunning()) return;
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new VideoUploadError(unsupportedVideoCompressionMessage, false));
    }, audioResumeTimeoutMs);
    const onAbort = () => {
      cleanup();
      try {
        throwIfAborted(signal);
      } catch (error) {
        reject(error);
      }
    };
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    void context
      .resume()
      .then(() => {
        cleanup();
        resolve();
      })
      .catch((error: unknown) => {
        cleanup();
        reject(error);
      });
  });
  if (!isRunning()) {
    throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
  }
}

function tunedBitrates() {
  return {
    audioBitsPerSecond: targetAudioBitsPerSecond,
    videoBitsPerSecond: targetVideoBitsPerSecond,
  };
}

function originalWithinBackstop(size: number) {
  return size >= 1 && size <= maximumStoredVideoBytes;
}

function reencodedWithinCeiling(size: number, durationMs: number) {
  return size >= 1 && size <= maximumUploadVideoBytes(durationMs);
}

function sourceHasAudioTrack(
  video: HTMLVideoElement,
  captured: MediaStream | null,
  captureMethod: CaptureMethod | null,
) {
  const listed = (
    video as HTMLVideoElement & { audioTracks?: { length: number } }
  ).audioTracks;
  if (listed) return listed.length > 0;
  const probed =
    captured ?? (captureMethod ? sourceStream(video, captureMethod) : null);
  if (!probed) {
    // Unknown on this browser. Assume the clip has sound so a muted
    // re-encode cannot replace it.
    return true;
  }
  const hasAudio = probed.getAudioTracks().length > 0;
  if (probed !== captured) {
    probed.getTracks().forEach((track) => track.stop());
  }
  return hasAudio;
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
  includeAudio: boolean,
) {
  const { videoBitsPerSecond, audioBitsPerSecond } = tunedBitrates();
  const options: MediaRecorderOptions[] = [
    {
      mimeType,
      bitsPerSecond:
        videoBitsPerSecond + (includeAudio ? audioBitsPerSecond : 0),
      videoBitsPerSecond,
      ...(includeAudio ? { audioBitsPerSecond } : {}),
    },
    { mimeType, videoBitsPerSecond },
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
    const durationMs = Math.floor(video.duration * 1000);
    if (!Number.isFinite(video.duration) || durationMs < 1) return null;
    return durationMs;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

function mountPlaybackVideo(video: HTMLVideoElement) {
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  // Off-screen, not opacity:0. iPhone Safari skips frames for invisible video.
  video.style.cssText =
    "position:fixed;left:-10000px;top:0;width:8px;height:8px;pointer-events:none;";
  document.body.append(video);
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
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

  let audioContext: AudioContext | null = null;
  let releaseAudioContext = false;
  let audioNode: MediaElementAudioSourceNode | null = null;
  let audioDestination: MediaStreamAudioDestinationNode | null = null;
  let recorder: MediaRecorder | null = null;
  let waitForRecorderStop: Promise<void> | null = null;
  let onRecorderData: ((event: BlobEvent) => void) | null = null;
  let onRecorderStop: (() => void) | null = null;
  let onRecorderError: (() => void) | null = null;
  let output: MediaStream | null = null;
  let source: MediaStream | null = null;
  let stopDrawing = () => undefined;
  let recordingGeneration = 0;
  const chunks: BlobPart[] = [];

  const detachRecorder = () => {
    if (recorder) {
      if (onRecorderData) {
        recorder.removeEventListener("dataavailable", onRecorderData);
      }
      if (onRecorderStop) recorder.removeEventListener("stop", onRecorderStop);
      if (onRecorderError) {
        recorder.removeEventListener("error", onRecorderError);
      }
    }
    onRecorderData = null;
    onRecorderStop = null;
    onRecorderError = null;
    recorder = null;
    waitForRecorderStop = null;
  };

  const abandonRecording = async () => {
    const stopping = waitForRecorderStop;
    const active = recorder;
    if (active && active.state !== "inactive") {
      try {
        active.stop();
      } catch {
        // Ignore invalid-state stops while restarting.
      }
    }
    if (stopping) {
      await Promise.race([
        stopping.catch(() => undefined),
        new Promise<void>((resolve) =>
          window.setTimeout(resolve, recorderStopTimeoutMs),
        ),
      ]);
    }
    detachRecorder();
  };

  try {
    mountPlaybackVideo(video);
    await waitForMetadata(video, input.signal);
    throwIfAborted(input.signal);

    let videoCaptureStream: MediaStream | null = null;
    if (input.support.canvasCapture) {
      const canvas = document.createElement("canvas");
      const target = downscaledDimensions(input.width, input.height);
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(video, 0, 0, target.width, target.height);
        try {
          videoCaptureStream = canvas.captureStream(30);
        } catch {
          videoCaptureStream = null;
        }
        let raf = 0;
        let drawing = true;
        const draw = () => {
          if (!drawing) return;
          context.drawImage(video, 0, 0, target.width, target.height);
          if (!video.ended) raf = window.requestAnimationFrame(draw);
        };
        if (videoCaptureStream) draw();
        stopDrawing = () => {
          drawing = false;
          if (raf) window.cancelAnimationFrame(raf);
        };
      }
    }
    if (!videoCaptureStream && input.support.captureMethod) {
      source = sourceStream(video, input.support.captureMethod);
      videoCaptureStream = source;
    }
    const captureVideoTrack = videoCaptureStream?.getVideoTracks()[0];
    if (!captureVideoTrack) {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }
    const sourceHasAudio = sourceHasAudioTrack(
      video,
      source,
      input.support.captureMethod,
    );

    const AudioContextCtor = webAudioContextConstructor();
    if (AudioContextCtor) {
      try {
        if (primedAudioContext && primedAudioContext.state !== "closed") {
          audioContext = primedAudioContext;
        } else {
          audioContext = new AudioContextCtor();
          releaseAudioContext = true;
        }
        audioNode = audioContext.createMediaElementSource(video);
        audioDestination = audioContext.createMediaStreamDestination();
        audioNode.connect(audioDestination);
        await resumeAudioContext(audioContext, input.signal);
      } catch (error) {
        audioNode?.disconnect();
        audioDestination?.disconnect();
        audioNode = null;
        audioDestination = null;
        if (releaseAudioContext) {
          await audioContext?.close().catch(() => undefined);
        }
        audioContext = null;
        releaseAudioContext = false;
        if (isAbortError(error)) throw error;
      }
    }
    if (sourceHasAudio && !audioDestination) {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }

    const startRecording = (withAudio: boolean) => {
      const generation = ++recordingGeneration;
      chunks.length = 0;
      const stream = new MediaStream();
      stream.addTrack(captureVideoTrack);
      if (withAudio && audioDestination && !video.muted) {
        const captureAudioTrack = audioDestination.stream.getAudioTracks()[0];
        if (captureAudioTrack) stream.addTrack(captureAudioTrack);
      }
      const activeRecorder = createRecorder(
        stream,
        input.support.mimeType,
        stream.getAudioTracks().length > 0,
      );
      recorder = activeRecorder;
      const stopped = new Promise<void>((resolve, reject) => {
        onRecorderData = (event: BlobEvent) => {
          if (generation !== recordingGeneration || event.data.size < 1) return;
          chunks.push(event.data);
        };
        onRecorderStop = () => resolve();
        onRecorderError = () =>
          reject(new VideoUploadError(fallbackPrepareMessage));
        activeRecorder.addEventListener("dataavailable", onRecorderData);
        activeRecorder.addEventListener("stop", onRecorderStop, {
          once: true,
        });
        activeRecorder.addEventListener("error", onRecorderError, {
          once: true,
        });
      });
      waitForRecorderStop = stopped;
      activeRecorder.start(750);
      return { recorder: activeRecorder, stopped, stream };
    };

    const playVideo = async () => {
      const playback = video.play();
      if (playback) await playback;
    };

    let recording = startRecording(Boolean(audioDestination));
    output = recording.stream;
    try {
      await playVideo();
    } catch (error) {
      if (isAbortError(error)) throw error;
      throwIfAborted(input.signal);
      // iPhone Safari rejects unmuted playback after the picker gesture ends.
      // A muted retry would record silence, so a clip that has audio keeps
      // the original instead. Silent clips can still re-encode muted.
      if (sourceHasAudio) {
        throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
      }
      await abandonRecording();
      video.pause();
      try {
        video.currentTime = 0;
      } catch {
        // Ignore seeks that race the first frame.
      }
      video.muted = true;
      recording = startRecording(false);
      output = recording.stream;
      try {
        await playVideo();
      } catch (playError) {
        if (isAbortError(playError)) throw playError;
        throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
      }
    }
    await waitForPlaybackFinished({
      signal: input.signal,
      timeoutMs: playbackTimeoutMs(input.durationMs),
      video,
    });
    if (recording.recorder.state !== "inactive") recording.recorder.stop();
    await recording.stopped;
    throwIfAborted(input.signal);
    if (sourceHasAudio && recording.stream.getAudioTracks().length < 1) {
      throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
    }

    const blob = new Blob(chunks, {
      type: recording.recorder.mimeType || input.support.mimeType,
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
    if (audioNode) audioNode.disconnect();
    if (audioDestination) audioDestination.disconnect();
    if (releaseAudioContext && audioContext) {
      await audioContext.close().catch(() => undefined);
    }
    await abandonRecording();
    stopDrawing();
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    output?.getTracks().forEach((track) => track.stop());
    if (source && source !== output) {
      source.getTracks().forEach((track) => track.stop());
    }
    URL.revokeObjectURL(url);
  }
}

function shouldAttemptCompression(
  file: File,
  width: number,
  height: number,
  durationMs: number,
) {
  return (
    file.size > targetStoredVideoBytes(durationMs) ||
    Math.max(width, height) > preferredVideoLongEdgePx
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
    input.durationMs,
  );
  const originalIsUploadable = originalWithinBackstop(input.file.size);

  if (!support || !needsCompression) {
    if (!originalIsUploadable) {
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
    if (compressed.size < 1) {
      throw new VideoUploadError(fallbackPrepareMessage);
    }
    const compressedIsUploadable = reencodedWithinCeiling(
      compressed.size,
      input.durationMs,
    );
    if (compressedIsUploadable && compressed.size < input.file.size) {
      return { file: compressed, compressed: true };
    }
    if (originalIsUploadable) {
      return { file: input.file, compressed: false };
    }
    if (compressedIsUploadable) {
      return { file: compressed, compressed: true };
    }
    logBackstopEdgeCase({
      durationMs: input.durationMs,
      fileSize: compressed.size,
      reason:
        compressed.size > maximumStoredVideoBytes
          ? "compressed_output_above_backstop"
          : "compressed_output_above_target",
      type: compressed.type,
    });
    throw new VideoUploadError(storedVideoTooLargeMessage, false);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof VideoUploadError) {
      if (
        error.message === storedVideoTooLargeMessage ||
        error.message === overDurationVideoMessage
      ) {
        throw error;
      }
      if (originalIsUploadable) {
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
    if (originalIsUploadable) {
      return { file: input.file, compressed: false };
    }
    throw new VideoUploadError(unsupportedVideoCompressionMessage, false);
  }
}
