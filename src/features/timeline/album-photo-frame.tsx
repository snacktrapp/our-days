"use client";

import { useState, type ReactNode } from "react";
import { albumFrameBox } from "./photo-album-gesture";
import { PhotoCardPager } from "./photo-card-pager";
import type { PhotoMomentViewModel } from "./timeline-view-model";

export function AlbumPhotoFrame({
  moment,
  images,
  width,
  height,
  hasStoredRatio,
}: Readonly<{
  moment: PhotoMomentViewModel;
  images: readonly ReactNode[];
  width: number;
  height: number;
  hasStoredRatio: boolean;
}>) {
  const [fallbackRatio, setFallbackRatio] = useState<number | null>(null);
  const box = hasStoredRatio
    ? { width, height }
    : albumFrameBox([], fallbackRatio);
  const knownRatio = hasStoredRatio || fallbackRatio != null;
  return (
    <div
      className={`photo-frame has-reserved-frame is-album${
        knownRatio ? " has-known-ratio" : ""
      }`}
    >
      <svg
        className="photo-frame-sizer"
        viewBox={`0 0 ${box.width} ${box.height}`}
        aria-hidden="true"
        focusable="false"
      />
      <PhotoCardPager
        moment={moment}
        images={images}
        onIntrinsicRatio={hasStoredRatio ? undefined : setFallbackRatio}
      />
    </div>
  );
}
