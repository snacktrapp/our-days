import {
  posterDataUrlByteSize,
  posterDataUrlLooksLikelyBlank,
} from "./video-poster-quality";

const posterMaxWidth = 720;
const seekTimeoutMs = 1_500;
const posterProbeSeconds = [0.18, 0.36, 0.72, 1.2] as const;

export type CapturedVideoPoster = Readonly<{
  dataUrl: string;
  width: number;
  height: number;
  byteSize: number;
  looksLikelyBlank: boolean;
}>;

function captureCurrentVideoPoster(
  video: HTMLVideoElement,
): CapturedVideoPoster | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (width < 1 || height < 1) return null;
  const scale = Math.min(1, posterMaxWidth / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    if (!dataUrl.startsWith("data:image/jpeg")) return null;
    return {
      dataUrl,
      width,
      height,
      byteSize: posterDataUrlByteSize(dataUrl) ?? 0,
      looksLikelyBlank: posterDataUrlLooksLikelyBlank(dataUrl, width, height),
    };
  } catch {
    return null;
  }
}

async function seekVideoForPoster(
  video: HTMLVideoElement,
  targetSeconds: number,
) {
  if (!Number.isFinite(video.duration) || video.duration <= 0) return false;
  const clamped = Math.max(0, Math.min(targetSeconds, video.duration - 0.05));
  if (!Number.isFinite(clamped) || clamped <= 0) return false;
  if (Math.abs(video.currentTime - clamped) < 0.04) return true;
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => finish(false), seekTimeoutMs);
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
      resolve(result);
    };
    const onSeeked = () => finish(true);
    const onError = () => finish(false);
    video.addEventListener("seeked", onSeeked, { once: true });
    video.addEventListener("error", onError, { once: true });
    try {
      video.currentTime = clamped;
    } catch {
      finish(false);
    }
  });
}

export async function captureVideoPoster(video: HTMLVideoElement) {
  const captures: CapturedVideoPoster[] = [];
  const initial = captureCurrentVideoPoster(video);
  if (initial) {
    captures.push(initial);
    if (!initial.looksLikelyBlank) return initial;
  }

  for (const offsetSeconds of posterProbeSeconds) {
    const seeked = await seekVideoForPoster(video, offsetSeconds);
    if (!seeked) continue;
    const captured = captureCurrentVideoPoster(video);
    if (!captured) continue;
    captures.push(captured);
    if (!captured.looksLikelyBlank) return captured;
  }

  if (captures.length === 0) return null;
  return captures.reduce((best, current) =>
    current.byteSize > best.byteSize ? current : best,
  );
}
