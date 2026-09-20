// Completed images only, in this tab's memory. Never persist private media.
const maxBytes = 16 * 1024 * 1024;
const maxEntries = 24;
const lifetime = 60_000;
const images = new Map<string, { blob: Blob; expires: number }>();
let bytes = 0;
let generation = 0;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

function remove(src: string) {
  const item = images.get(src);
  if (item) bytes -= item.blob.size;
  images.delete(src);
}

function expire() {
  clearTimeout(expiryTimer);
  for (const [src, item] of images) if (item.expires <= Date.now()) remove(src);
  const next = Math.min(...Array.from(images.values(), (item) => item.expires));
  if (Number.isFinite(next))
    expiryTimer = setTimeout(expire, Math.max(1, next - Date.now()));
}

export function privateMediaGeneration() {
  return generation;
}

export function readPrivateMedia(src: string) {
  expire();
  const item = images.get(src);
  if (item) {
    images.delete(src);
    images.set(src, item);
  }
  return item?.blob;
}

export function rememberPrivateMedia(
  src: string,
  blob: Blob,
  requestGeneration: number,
) {
  if (
    requestGeneration !== generation ||
    blob.size > maxBytes ||
    !blob.type.startsWith("image/")
  )
    return;
  remove(src);
  images.set(src, { blob, expires: Date.now() + lifetime });
  bytes += blob.size;
  while (bytes > maxBytes || images.size > maxEntries)
    remove(images.keys().next().value!);
  expire();
}

export function clearPrivateMediaMemory() {
  generation += 1;
  images.clear();
  bytes = 0;
  clearTimeout(expiryTimer);
}

if (typeof window !== "undefined") {
  window.addEventListener(
    "our-days:clear-private-state",
    clearPrivateMediaMemory,
  );
}
