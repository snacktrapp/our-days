"use client";

import { useState } from "react";

type PrivatePhotoImageProps = Readonly<{
  src: string;
  alt: string;
  width?: number;
  height?: number;
  highPriority?: boolean;
}>;

export function PrivatePhotoImage({
  src,
  alt,
  width,
  height,
  highPriority = false,
}: PrivatePhotoImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  if (unavailable) {
    return (
      <div className="private-photo-unavailable" role="group" aria-label={alt}>
        <p>This photo couldn’t be opened.</p>
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

  // Private media intentionally bypasses the Next image optimizer. Every
  // request must reach the same-origin authorization route.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={highPriority ? "eager" : "lazy"}
      fetchPriority={highPriority ? "high" : undefined}
      onError={() => setUnavailable(true)}
    />
  );
}
