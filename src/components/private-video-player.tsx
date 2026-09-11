"use client";

import { useState } from "react";

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
  const [unavailable, setUnavailable] = useState(false);

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
        <button type="button" onClick={() => setUnavailable(false)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <video
      src={src}
      poster={poster}
      aria-label={label}
      width={width}
      height={height}
      controls={controls}
      controlsList="nodownload noremoteplayback"
      disablePictureInPicture
      disableRemotePlayback
      playsInline
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
