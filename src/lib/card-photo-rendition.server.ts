import "server-only";

import type { TimelineCardPhotoWidth } from "@/features/moments/moment-photos";
import { renderCardWebp } from "../../scripts/lib/card-photo-rendition.mjs";

const maxCachedEntries = 32;
const maxCachedBytes = 16 * 1024 * 1024;
const maxEntryBytes = 2 * 1024 * 1024;
const maxCardSharp = 2;

type CachedRendition = {
  sha: string;
  width: TimelineCardPhotoWidth;
  bytes: Uint8Array;
};

type RenderedCard = {
  bytes: Uint8Array;
  height: number;
  width: number;
};

const cache: CachedRendition[] = [];
let cardSharpActive = 0;
const cardSharpWaiters: Array<() => void> = [];

function cachedBytes() {
  return cache.reduce((total, entry) => total + entry.bytes.byteLength, 0);
}

export function cardSharpActiveCount() {
  return cardSharpActive;
}

export function withCardSharpPermit<T>(task: () => Promise<T>) {
  const run = () => {
    cardSharpActive += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => {
        cardSharpActive -= 1;
        cardSharpWaiters.shift()?.();
      });
  };
  if (cardSharpActive < maxCardSharp) return run();
  return new Promise<T>((resolve, reject) => {
    cardSharpWaiters.push(() => {
      run().then(resolve, reject);
    });
  });
}

export function readCachedCardRendition(
  sha: string,
  width: TimelineCardPhotoWidth,
) {
  const index = cache.findIndex(
    (entry) => entry.sha === sha && entry.width === width,
  );
  if (index < 0) return null;
  const [hit] = cache.splice(index, 1);
  if (!hit) return null;
  cache.push(hit);
  return hit.bytes;
}

export function rememberCardRendition(
  sha: string,
  width: TimelineCardPhotoWidth,
  bytes: Uint8Array,
) {
  if (bytes.byteLength === 0 || bytes.byteLength > maxEntryBytes) return;
  const existing = cache.findIndex(
    (entry) => entry.sha === sha && entry.width === width,
  );
  if (existing >= 0) cache.splice(existing, 1);
  cache.push({ sha, width, bytes });
  while (
    cache.length > 0 &&
    (cache.length > maxCachedEntries || cachedBytes() > maxCachedBytes)
  ) {
    cache.shift();
  }
}

export function clearCardRenditionCache() {
  cache.length = 0;
}

export async function renderCardPhoto(
  bytes: Uint8Array,
  width: TimelineCardPhotoWidth,
) {
  const queuedAt = performance.now();
  let queueMs = 0;
  let resizeMs = 0;
  let rendered: RenderedCard | null = null;
  try {
    rendered = await withCardSharpPermit(async () => {
      queueMs = Math.max(0, performance.now() - queuedAt);
      const resizeStarted = performance.now();
      try {
        return await renderCardWebp(bytes, width);
      } finally {
        resizeMs = Math.max(0, performance.now() - resizeStarted);
      }
    });
  } catch {
    rendered = null;
  }
  return {
    bytes: rendered?.bytes ?? null,
    queueMs,
    resizeMs,
  };
}

export async function renderCardPhotoDetails(
  bytes: Uint8Array,
  width: TimelineCardPhotoWidth,
) {
  try {
    return await renderCardWebp(bytes, width);
  } catch {
    return null;
  }
}
