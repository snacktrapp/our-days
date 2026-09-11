"use client";

import {
  rememberVideoFrame,
  rememberVideoPoster,
} from "@/features/video/video-poster-store";
import { persistVideoPoster } from "@/features/video/persist-video-poster";

const posterMaxWidth = 720;
const warmTimeoutMs = 20_000;
const inFlight = new Set<string>();
const failed = new Set<string>();
let activeWarmups = 0;
const maximumConcurrentWarmups = 1;
const waiting: Array<() => void> = [];

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
  try {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    return dataUrl.startsWith("data:image/jpeg")
      ? { dataUrl, width, height }
      : null;
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
        reject(new Error("Video frame could not be decoded."));
      };
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
    });
  }
}

function acquireWarmupSlot() {
  if (activeWarmups < maximumConcurrentWarmups) {
    activeWarmups += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    waiting.push(() => {
      activeWarmups += 1;
      resolve();
    });
  });
}

function releaseWarmupSlot() {
  activeWarmups = Math.max(0, activeWarmups - 1);
  const next = waiting.shift();
  if (next) next();
}

export async function warmVideoPoster(input: {
  momentId: string;
  src: string;
}) {
  const momentId = input.momentId.trim();
  const src = input.src.trim();
  if (!momentId || !src) return false;
  if (inFlight.has(momentId) || failed.has(momentId)) return false;
  if (typeof document === "undefined") return false;

  inFlight.add(momentId);
  await acquireWarmupSlot();
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("muted", "");
  // Same-origin /api/media/videos proxy keeps canvas capture readable on iPhone.
  video.src = src;

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error("Video poster warm-up timed out."));
      }, warmTimeoutMs);
      const finish = (callback: () => void) => {
        window.clearTimeout(timeout);
        callback();
      };
      video.addEventListener("loadeddata", () => finish(() => resolve()), {
        once: true,
      });
      video.addEventListener(
        "error",
        () => finish(() => reject(new Error("Video poster warm-up failed."))),
        { once: true },
      );
      video.load();
    });
    await decodeCurrentFrame(video);
    const poster = capturePoster(video);
    if (!poster) {
      failed.add(momentId);
      return false;
    }
    rememberVideoPoster(momentId, poster.dataUrl);
    rememberVideoFrame(momentId, poster.width, poster.height);
    void persistVideoPoster({
      momentId,
      posterDataUrl: poster.dataUrl,
      width: poster.width,
      height: poster.height,
    });
    return true;
  } catch {
    failed.add(momentId);
    return false;
  } finally {
    video.removeAttribute("src");
    video.load();
    inFlight.delete(momentId);
    releaseWarmupSlot();
  }
}

export function resetVideoPosterWarmupForTests() {
  inFlight.clear();
  failed.clear();
  activeWarmups = 0;
  waiting.length = 0;
}
