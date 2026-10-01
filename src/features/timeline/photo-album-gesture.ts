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
  slideWidth?: number;
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
  if (!frame) return () => {};
  let cancelInner: (() => void) | null = null;
  const observer = new MutationObserver(check);
  function check() {
    const next = frameImage(frame);
    if (next) {
      observer.disconnect();
      cancelInner = waitForImageReady(next, onReady);
      return;
    }
    // A failed authenticated fetch has a retry control, not an <img>. Let the
    // user reach that control rather than leaving the swipe waiting forever.
    if (frame?.querySelector('[data-media-state="error"]')) {
      observer.disconnect();
      onReady();
    }
  }
  observer.observe(frame, { childList: true, subtree: true, attributes: true });
  check();

  return () => {
    observer.disconnect();
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

/** Pixel track math for a stage whose slides are exactly `slideWidth` wide. */
export function pairSlideTransform(
  pair: AlbumPair,
  slideWidth: number,
): string {
  const usePx = slideWidth > 0;
  const start = pair.direction === 1 ? 0 : usePx ? -slideWidth : -100;
  const end = pair.direction === 1 ? (usePx ? -slideWidth : -100) : 0;
  const unit = usePx ? "px" : "%";
  if (pair.mode === "drag" || pair.mode === "pending") {
    return usePx
      ? `translateX(${start + pair.dx}px)`
      : `translateX(calc(${start}% + ${pair.dx}px))`;
  }
  if (pair.mode === "snap") {
    return `translateX(${end}${unit})`;
  }
  return `translateX(${start}${unit})`;
}

export function albumSlideWidth(
  stage: HTMLElement | null,
  track: HTMLElement | null = null,
) {
  if (track && track.clientWidth > 0) return track.clientWidth;
  if (!stage) return 0;
  if (typeof window === "undefined") return stage.clientWidth;
  const styles = window.getComputedStyle(stage);
  const padded =
    stage.clientWidth -
    (Number.parseFloat(styles.paddingLeft) || 0) -
    (Number.parseFloat(styles.paddingRight) || 0);
  return padded > 0 ? padded : stage.clientWidth;
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

/** Tallest album frame is 3:4 (height = 4/3 × width). Shortest is 2:1. */
export const albumFrameMinHeightRatio = 0.5;
export const albumFrameMaxHeightRatio = 4 / 3;

export function clampAlbumHeightRatio(heightOverWidth: number) {
  if (!Number.isFinite(heightOverWidth) || heightOverWidth <= 0) return 0.75;
  return Math.min(
    albumFrameMaxHeightRatio,
    Math.max(albumFrameMinHeightRatio, heightOverWidth),
  );
}

export function albumPhotoHeightRatio(width?: number, height?: number) {
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  return height / width;
}

/** Cover fills the frame from 2:1 through 3:4. Anything outside that
 *  (taller than 3:4, or wider than 2:1) is contained on the theme background. */
export function albumFrameFit(
  width?: number,
  height?: number,
): "cover" | "contain" {
  const ratio = albumPhotoHeightRatio(width, height);
  if (
    ratio == null ||
    ratio < albumFrameMinHeightRatio ||
    ratio > albumFrameMaxHeightRatio
  ) {
    return "contain";
  }
  return "cover";
}

export function albumSlideFrameHeight(
  stageWidth: number,
  heightOverWidth: number,
) {
  if (stageWidth <= 0) return 0;
  return stageWidth * clampAlbumHeightRatio(heightOverWidth);
}

export function albumGestureFrameHeight(
  stageWidth: number,
  fromHeightOverWidth: number,
  toHeightOverWidth: number,
  mode: AlbumPair["mode"] | "idle",
  dx: number,
) {
  const fromHeight = albumSlideFrameHeight(stageWidth, fromHeightOverWidth);
  const toHeight = albumSlideFrameHeight(stageWidth, toHeightOverWidth);
  if (mode === "snap") return toHeight;
  if (mode !== "drag" || stageWidth <= 0) return fromHeight;
  const progress = Math.min(1, Math.max(0, Math.abs(dx) / stageWidth));
  return fromHeight + (toHeight - fromHeight) * progress;
}

/** SVG sizer box. Within the clamp this is the photo; past it, the clamped frame. */
export function clampedAlbumFrameBox(width?: number, height?: number) {
  const ratio = albumPhotoHeightRatio(width, height);
  if (ratio == null || width == null || height == null) {
    return { width: 4, height: 3 };
  }
  const clamped = clampAlbumHeightRatio(ratio);
  if (Math.abs(clamped - ratio) < 0.0005) return { width, height };
  return { width: 10000, height: Math.round(clamped * 10000) };
}
