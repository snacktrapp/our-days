"use client";

import { useEffect, useRef, useState } from "react";

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
  const imageRef = useRef<HTMLImageElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);
  const [decoded, setDecoded] = useState<boolean | null>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return;
    if (image.complete && image.naturalHeight > 0) {
      setDecoded(true);
      return;
    }
    setDecoded(false);
  }, [attempt, src]);

  if (unavailable) {
    return (
      <div className="private-photo-unavailable" role="group" aria-label={alt}>
        <p>This photo couldn’t be opened.</p>
        <button
          type="button"
          onClick={() => {
            setUnavailable(false);
            setDecoded(null);
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
      ref={imageRef}
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={
        decoded === true
          ? "is-ready"
          : decoded === false
            ? "is-pending"
            : undefined
      }
      loading={highPriority ? "eager" : "lazy"}
      fetchPriority={highPriority ? "high" : undefined}
      onLoad={() => setDecoded(true)}
      onError={() => setUnavailable(true)}
    />
  );
}
