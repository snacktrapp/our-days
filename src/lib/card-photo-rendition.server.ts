import "server-only";

import sharp from "sharp";
import type { TimelineCardPhotoWidth } from "@/features/moments/moment-photos";

const maxSourceEdge = 2560;
const maxCachedEntries = 32;
const maxCachedBytes = 16 * 1024 * 1024;
const maxEntryBytes = 2 * 1024 * 1024;

type CachedRendition = {
  sha: string;
  width: TimelineCardPhotoWidth;
  bytes: Uint8Array;
};

const cache: CachedRendition[] = [];

function cachedBytes() {
  return cache.reduce((total, entry) => total + entry.bytes.byteLength, 0);
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
  try {
    const source = Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
    const output = await sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: maxSourceEdge * maxSourceEdge,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    })
      .rotate()
      .resize({
        fit: "inside",
        width,
        withoutEnlargement: true,
      })
      .webp({
        effort: 4,
        quality: 73,
        smartSubsample: true,
      })
      .toBuffer();
    return new Uint8Array(output);
  } catch {
    return null;
  }
}
