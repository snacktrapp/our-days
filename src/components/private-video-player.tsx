"use client";

import { useState } from "react";
import { privateMediaRetrySrc } from "@/lib/private-media-delivery";

export function PrivateVideoPlayer({
  src,
  label,
  preload = "metadata",
  controls = true,
  autoPlay = false,
  poster,
  width,
  height,
  onReadyFrame,
}: Readonly<{
  src: string;
  label: string;
  preload?: "none" | "metadata";
  controls?: boolean;
  autoPlay?: boolean;
  poster?: string;
  width?: number;
  height?: number;
  onReadyFrame?: (frame: {
    posterDataUrl: string;
    width: number;
    height: number;
  }) => void;
}>) {
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const deliverySrc = privateMediaRetrySrc(src, attempt);
  const deliveryPoster = poster
    ? privateMediaRetrySrc(poster, attempt)
    : undefined;

  if (unavailable) {
    return (
      <div
        className="private-video-unavailable"
        role="group"
        aria-label={label}
      >
        <p>This video couldn’t be opened.</p>
        <p className="private-video-unavailable-hint">
          iPhone clips often need Safari, or an MP4 copy.
        </p>
        <button
          type="button"
          onClick={() => {
            setUnavailable(false);
            setAttempt((current) => current + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <video
      key={attempt}
      src={deliverySrc}
      poster={deliveryPoster}
      aria-label={label}
      width={width}
      height={height}
      controls={controls}
      controlsList="nodownload noremoteplayback"
      disablePictureInPicture
      disableRemotePlayback
      playsInline
      webkit-playsinline=""
      preload={preload}
      autoPlay={autoPlay}
      onError={() => setUnavailable(true)}
      onLoadedData={(event) => {
        if (!onReadyFrame) return;
        const video = event.currentTarget;
        if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) return;
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const posterDataUrl = canvas.toDataURL("image/jpeg", 0.72);
          if (!posterDataUrl.startsWith("data:image/jpeg")) return;
          onReadyFrame({
            posterDataUrl,
            width: video.videoWidth,
            height: video.videoHeight,
          });
        } catch {
          // Cross-origin or decode failures leave the dark mat in place.
        }
      }}
    />
  );
}
