import {
  maximumVideoBytes,
  maximumVideoDurationMs,
  VideoUploadError,
  acceptedVideoMime,
} from "@/features/composer/video-upload";

export type InspectedVideo = Readonly<{
  durationMs: number;
  width: number;
  height: number;
  posterDataUrl: string | null;
}>;

const inspectionTimeoutMs = 15_000;
const posterMaxWidth = 720;

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new DOMException("Video inspection was stopped.", "AbortError");
}

function capturePoster(video: HTMLVideoElement) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 1 || height < 1) return null;
  const scale = Math.min(1, posterMaxWidth / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return dataUrl.startsWith("data:image/jpeg") ? dataUrl : null;
  } catch {
    return null;
  }
}

async function decodeCurrentFrame(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  try {
    await video.play();
    video.pause();
  } catch {
    await new Promise<void>((resolve, reject) => {
      const onReady = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
        resolve();
      };
      const onError = () => {
        video.removeEventListener("loadeddata", onReady);
        video.removeEventListener("error", onError);
        reject(new VideoUploadError("This video could not be played.", false));
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }
}

export async function inspectVideoFile(
  file: File,
  signal?: AbortSignal,
): Promise<InspectedVideo> {
  throwIfAborted(signal);
  if (!acceptedVideoMime(file)) {
    throw new VideoUploadError(
      "Choose an MP4, MOV, M4V, or WebM video.",
      false,
    );
  }
  if (file.size < 1) {
    throw new VideoUploadError(
      "That video is empty. Choose another one.",
      false,
    );
  }
  if (file.size > maximumVideoBytes) {
    throw new VideoUploadError("Choose a video smaller than 100 MB.", false);
  }
  if (typeof document === "undefined") {
    throw new VideoUploadError("That video could not be prepared.", false);
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  try {
    const inspected = await new Promise<InspectedVideo>((resolve, reject) => {
      let settled = false;
      const timeout = window.setTimeout(() => {
        finish(() =>
          reject(
            new VideoUploadError(
              "This video took too long to inspect. Try again.",
              true,
            ),
          ),
        );
      }, inspectionTimeoutMs);
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        callback();
      };
      const onAbort = () => {
        finish(() => {
          try {
            throwIfAborted(signal);
          } catch (error) {
            reject(error);
          }
        });
      };
      video.onerror = () => {
        finish(() =>
          reject(
            new VideoUploadError(
              "This video could not be played. Choose another one.",
              false,
            ),
          ),
        );
      };
      video.onloadedmetadata = () => {
        void (async () => {
          try {
            throwIfAborted(signal);
            await decodeCurrentFrame(video);
            throwIfAborted(signal);
            const durationMs = Math.ceil(video.duration * 1000);
            if (
              !Number.isFinite(video.duration) ||
              !Number.isInteger(durationMs) ||
              durationMs < 1
            ) {
              throw new VideoUploadError(
                "This video's duration could not be read. Choose another one.",
                false,
              );
            }
            if (durationMs > maximumVideoDurationMs) {
              throw new VideoUploadError(
                "Choose a video about 60 seconds or shorter.",
                false,
              );
            }
            if (
              video.videoWidth <= 0 ||
              video.videoHeight <= 0 ||
              video.videoWidth * video.videoHeight > 9_000_000
            ) {
              throw new VideoUploadError(
                "This video's picture size is not supported.",
                false,
              );
            }
            finish(() =>
              resolve({
                durationMs,
                width: video.videoWidth,
                height: video.videoHeight,
                posterDataUrl: capturePoster(video),
              }),
            );
          } catch (error) {
            finish(() => reject(error));
          }
        })();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        onAbort();
        return;
      }
      video.src = url;
      video.load();
    });
    return inspected;
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
