/**
 * Photo and video frame height from globals.css.
 *
 * --timeline-media-max-height: min(90dvh, calc(min(100vw, 430px) * 16 / 9))
 * .photo-frame-sizer is an SVG viewBox at width 100% and height auto, so the
 * frame is min(that cap, laid-out width × viewBox height / viewBox width).
 * Missing dimensions use the web fallback viewBox 0 0 4 3 (video 16×9).
 */
/** globals.css --timeline-media-max-height */
export function mediaMaxHeight(viewportWidth: number, viewportHeight: number) {
  return Math.min(viewportHeight * 0.9, Math.min(viewportWidth, 430) * (16 / 9));
}

export function photoFrameHeight(
  options: Readonly<{
    frameWidth: number;
    imageWidth?: number;
    imageHeight?: number;
    viewportWidth: number;
    viewportHeight: number;
  }>,
) {
  const imageWidth = options.imageWidth && options.imageWidth > 0 ? options.imageWidth : 4;
  const imageHeight =
    options.imageHeight && options.imageHeight > 0 ? options.imageHeight : 3;
  const maxHeight = mediaMaxHeight(options.viewportWidth, options.viewportHeight);
  const natural = (options.frameWidth * imageHeight) / imageWidth;
  return Math.min(maxHeight, natural);
}
