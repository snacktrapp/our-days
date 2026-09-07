"use client";

import { useSyncExternalStore } from "react";

const storagePrefix = "our-days:video-poster:";
const frameStoragePrefix = "our-days:video-frame:";
const posters = new Map<string, string>();
const frames = new Map<string, VideoFrameSize>();
const listeners = new Set<() => void>();

export type VideoFrameSize = Readonly<{ width: number; height: number }>;

function storageKey(momentId: string) {
  return `${storagePrefix}${momentId}`;
}

function frameStorageKey(momentId: string) {
  return `${frameStoragePrefix}${momentId}`;
}

function emit() {
  for (const listener of listeners) listener();
}

function readStoredPoster(momentId: string) {
  const memory = posters.get(momentId);
  if (memory) return memory;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(storageKey(momentId));
    if (!stored) return null;
    posters.set(momentId, stored);
    return stored;
  } catch {
    return null;
  }
}

export function rememberVideoPoster(momentId: string, posterDataUrl: string) {
  if (!momentId || !posterDataUrl.startsWith("data:image/")) return;
  posters.set(momentId, posterDataUrl);
  try {
    window.sessionStorage.setItem(storageKey(momentId), posterDataUrl);
  } catch {
    // Poster cache is best-effort and must never block upload or playback.
  }
  emit();
}

export function rememberVideoFrame(
  momentId: string,
  width: number,
  height: number,
) {
  if (!momentId || width < 1 || height < 1) return;
  const next = { width, height };
  const previous = frames.get(momentId);
  if (previous?.width === width && previous.height === height) return;
  frames.set(momentId, next);
  try {
    window.sessionStorage.setItem(
      frameStorageKey(momentId),
      `${width}x${height}`,
    );
  } catch {
    // Frame cache is best-effort and must never block upload or playback.
  }
  emit();
}

export function peekVideoPoster(momentId: string) {
  return posters.get(momentId) ?? readStoredPoster(momentId);
}

function readStoredFrame(momentId: string) {
  const memory = frames.get(momentId);
  if (memory) return memory;
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(frameStorageKey(momentId));
    const match = stored?.match(/^(\d+)x(\d+)$/u);
    if (!match) return null;
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (width < 1 || height < 1) return null;
    const next = { width, height };
    frames.set(momentId, next);
    return next;
  } catch {
    return null;
  }
}

export function peekVideoFrame(momentId: string) {
  return frames.get(momentId) ?? readStoredFrame(momentId);
}

export function subscribeToVideoPosters(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVideoPoster(momentId: string) {
  return useSyncExternalStore(
    subscribeToVideoPosters,
    () => peekVideoPoster(momentId),
    () => null,
  );
}

export function useVideoFrame(momentId: string) {
  return useSyncExternalStore(
    subscribeToVideoPosters,
    () => peekVideoFrame(momentId),
    () => null,
  );
}

export function clearVideoPosters() {
  if (typeof window !== "undefined") {
    try {
      const keys: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (
          key?.startsWith(storagePrefix) ||
          key?.startsWith(frameStoragePrefix)
        ) {
          keys.push(key);
        }
      }
      for (const key of keys) window.sessionStorage.removeItem(key);
    } catch {
      // Poster cache is best-effort and must never block sign-out.
    }
  }
  posters.clear();
  frames.clear();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("our-days:clear-private-state", clearVideoPosters);
}
