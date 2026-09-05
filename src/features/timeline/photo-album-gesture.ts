export const swipeThreshold = 36;
export const axisLockPx = 8;
export const slideMs = 200;
export const mountAlbumLimit = 6;

export type AlbumPair = Readonly<{
  from: number;
  to: number;
  direction: 1 | -1;
  mode: "pending" | "drag" | "snap" | "spring";
  dx: number;
}>;

export function wrapIndex(next: number, length: number) {
  return (next + length) % length;
}

export function albumIndexes(length: number) {
  return Array.from({ length }, (_, index) => index);
}

export function mountedAlbumIndexes(index: number, length: number) {
  if (length <= mountAlbumLimit) return albumIndexes(length);
  return [
    ...new Set(
      [-2, -1, 0, 1, 2].map((delta) => wrapIndex(index + delta, length)),
    ),
  ];
}

export function frameImage(frame: Element | null): HTMLImageElement | null {
  if (!frame) return null;
  return frame.querySelector("img");
}

export function isImageReady(img: HTMLImageElement | null): boolean {
  if (!img) return true;
  return img.complete && img.naturalWidth > 0;
}

export function waitForImageReady(
  img: HTMLImageElement | null,
  onReady: () => void,
): () => void {
  if (!img || isImageReady(img)) {
    onReady();
    return () => {};
  }

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    img.removeEventListener("load", onLoad);
    img.removeEventListener("error", onError);
    onReady();
  };
  const onLoad = () => {
    if (img.naturalWidth > 0) settle();
  };
  const onError = () => settle();

  img.addEventListener("load", onLoad);
  img.addEventListener("error", onError);

  if (typeof img.decode === "function") {
    void img
      .decode()
      .then(() => {
        if (img.naturalWidth > 0) settle();
      })
      .catch(() => {
        if (isImageReady(img)) settle();
      });
  }

  if (isImageReady(img)) settle();

  return () => {
    settled = true;
    img.removeEventListener("load", onLoad);
    img.removeEventListener("error", onError);
  };
}

export function waitForFrameReady(
  frame: Element | null,
  onReady: () => void,
): () => void {
  const img = frameImage(frame);
  if (img) return waitForImageReady(img, onReady);
  if (!frame) return () => {};

  let cancelled = false;
  let cancelInner: (() => void) | null = null;
  let raf = 0;

  const retry = () => {
    if (cancelled) return;
    const next = frameImage(frame);
    if (next) {
      cancelInner = waitForImageReady(next, onReady);
      return;
    }
    raf = requestAnimationFrame(retry);
  };
  raf = requestAnimationFrame(retry);

  return () => {
    cancelled = true;
    cancelAnimationFrame(raf);
    cancelInner?.();
  };
}

export function pairTransform(pair: AlbumPair): string {
  const base = pair.direction === 1 ? 0 : -50;
  if (pair.mode === "drag" || pair.mode === "pending") {
    return `translateX(calc(${base}% + ${pair.dx}px))`;
  }
  if (pair.mode === "snap") {
    return pair.direction === 1 ? "translateX(-50%)" : "translateX(0%)";
  }
  return pair.direction === 1 ? "translateX(0%)" : "translateX(-50%)";
}

export function clampDragDx(
  dx: number,
  direction: 1 | -1,
  width: number,
): number {
  if (width <= 0) return dx;
  return direction === 1
    ? Math.min(0, Math.max(-width, dx))
    : Math.max(0, Math.min(width, dx));
}
