"use client";

import { useState } from "react";
import { privateMediaRetrySrc } from "@/lib/private-media-delivery";
import { usePrivateMediaObjectUrl } from "@/lib/use-private-media-object-url";

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
  const [decoded, setDecoded] = useState<boolean | null>(null);
  const deliverySrc = privateMediaRetrySrc(src, attempt);
  const { objectUrl, failed } = usePrivateMediaObjectUrl(
    unavailable ? undefined : deliverySrc,
  );

  if (unavailable || failed) {
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

  if (!objectUrl) {
    return (
      <div className="private-photo-unavailable is-pending" aria-hidden="true" />
    );
  }

  // Private media is fetched with credentials + no-store, then shown from a
  // blob URL so iPhone PWA cannot pin a stale 404 on the authorized route.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={attempt}
      src={objectUrl}
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
      loading="eager"
      fetchPriority={highPriority ? "high" : undefined}
      onLoad={() => setDecoded(true)}
      onError={() => setUnavailable(true)}
    />
  );
}
