/**
 * Native port of the web album rules in
 * src/features/timeline/photo-album-gesture.ts (PRs #197 and #199).
 *
 * One fixed frame per multi-photo album, sized to the tallest photo and capped
 * at 3:4 (height = width × 4/3). Every photo is contained inside it on the
 * theme background. A swipe pages the album once it leaves an 8 px slop box
 * within 45° of horizontal; steeper swipes scroll the feed.
 */

/** Web `axisLockPx`. */
export const albumAxisLockPx = 8;
/** Web `swipeThreshold`: a drag this far pages, a shorter one springs back. */
export const albumSwipeThresholdPx = 36;
/** A short fast flick also pages (points per second). */
export const albumSwipeVelocity = 300;
/** Web `slideMs`. */
export const albumSlideMs = 200;
/** Web `albumFrameMaxHeightRatio`: a multi-photo frame is never taller than 3:4. */
export const albumFrameMaxHeightRatio = 4 / 3;
/** Web fallback sizer viewBox 0 0 4 3 until the first photo reports its size. */
export const albumFallbackHeightRatio = 3 / 4;

/** Web `swipeAxis`: null inside the slop box, then "x" within 45° of horizontal. */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < albumAxisLockPx && ay < albumAxisLockPx) return null;
  return ax > ay ? "x" : "y";
}

export function wrapIndex(next: number, length: number) {
  if (length <= 0) return 0;
  return ((next % length) + length) % length;
}

type Sized = Readonly<{ width?: number; height?: number }>;

export function photoHeightRatio(width?: number, height?: number) {
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  return height / width;
}

/** Tallest stored photo, capped at 3:4. Null when no photo has dimensions. */
export function albumFrameHeightRatio(photos: readonly Sized[]) {
  let tallest = 0;
  for (const photo of photos) {
    const ratio = photoHeightRatio(photo.width, photo.height);
    if (ratio != null && ratio > tallest) tallest = ratio;
  }
  return tallest > 0 ? Math.min(albumFrameMaxHeightRatio, tallest) : null;
}

/** Frame height in points for a card `frameWidth` wide. */
export function albumFrameHeight(
  frameWidth: number,
  photos: readonly Sized[],
  fallbackRatio?: number | null,
) {
  const stored = albumFrameHeightRatio(photos);
  const fallback =
    fallbackRatio != null && Number.isFinite(fallbackRatio) && fallbackRatio > 0
      ? Math.min(albumFrameMaxHeightRatio, fallbackRatio)
      : null;
  return Math.round(frameWidth * (stored ?? fallback ?? albumFallbackHeightRatio));
}

/** -1 = show the next photo, 1 = the previous one, 0 = spring back. */
export function albumSwipeStep(dx: number, velocityX: number): -1 | 0 | 1 {
  const committed =
    Math.abs(dx) >= albumSwipeThresholdPx ||
    (Math.abs(dx) > albumAxisLockPx &&
      Math.abs(velocityX) >= albumSwipeVelocity &&
      Math.sign(velocityX) === Math.sign(dx));
  if (!committed) return 0;
  return dx < 0 ? -1 : 1;
}
