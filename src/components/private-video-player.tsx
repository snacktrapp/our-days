"use client";

import { useState } from "react";

export function PrivateVideoPlayer({
  src,
  label,
  preload = "metadata",
  controls = true,
  width,
  height,
}: Readonly<{
  src: string;
  label: string;
  preload?: "none" | "metadata";
  controls?: boolean;
  width?: number;
  height?: number;
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
        <button type="button" onClick={() => setUnavailable(false)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <video
      src={src}
      aria-label={label}
      width={width}
      height={height}
      controls={controls}
      controlsList="nodownload noremoteplayback"
      disablePictureInPicture
      disableRemotePlayback
      playsInline
      preload={preload}
      onError={() => setUnavailable(true)}
    />
  );
}
