"use client";

import { useSyncExternalStore } from "react";

const storagePrefix = "our-days:video-poster:";
const posters = new Map<string, string>();
const listeners = new Set<() => void>();

function storageKey(momentId: string) {
  return `${storagePrefix}${momentId}`;
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

export function peekVideoPoster(momentId: string) {
  return posters.get(momentId) ?? readStoredPoster(momentId);
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

export function clearVideoPosters() {
  if (typeof window !== "undefined") {
    try {
      const keys: string[] = [];
      for (let index = 0; index < window.sessionStorage.length; index += 1) {
        const key = window.sessionStorage.key(index);
        if (key?.startsWith(storagePrefix)) keys.push(key);
      }
      for (const key of keys) window.sessionStorage.removeItem(key);
    } catch {
      // Poster cache is best-effort and must never block sign-out.
    }
  }
  posters.clear();
  emit();
}

if (typeof window !== "undefined") {
  window.addEventListener("our-days:clear-private-state", clearVideoPosters);
}
