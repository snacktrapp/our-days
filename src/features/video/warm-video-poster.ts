"use client";

import {
  rememberVideoFrame,
  rememberVideoPoster,
} from "@/features/video/video-poster-store";
import { captureVideoPoster } from "@/features/video/capture-video-poster";
import { persistVideoPoster } from "@/features/video/persist-video-poster";

const warmTimeoutMs = 20_000;
const inFlight = new Set<string>();
const failed = new Set<string>();
let activeWarmups = 0;
const maximumConcurrentWarmups = 1;
const waiting: Array<() => void> = [];

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
  replaceExistingPoster?: boolean;
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
    const poster = await captureVideoPoster(video);
    if (!poster) {
      failed.add(momentId);
      return false;
    }
    rememberVideoPoster(momentId, poster.dataUrl);
    rememberVideoFrame(momentId, poster.width, poster.height);
    if (!poster.looksLikelyBlank) {
      void persistVideoPoster({
        momentId,
        posterDataUrl: poster.dataUrl,
        width: poster.width,
        height: poster.height,
        replaceExisting: input.replaceExistingPoster === true,
      });
    }
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
