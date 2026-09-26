"use client";

import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
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
  const [rescueWithBlob, setRescueWithBlob] = useState(false);
  const placeholderRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const shouldLoad =
    highPriority || nearViewport || typeof IntersectionObserver === "undefined";
  useEffect(() => {
    if (shouldLoad) return;
    const placeholder = placeholderRef.current;
    if (!placeholder) return;
    // Observe the album, not its hidden slides: the swipe controller expects
    // neighboring images to be ready once the carousel reaches the viewport.
    const target = placeholder.closest(".photo-card-pager") ?? placeholder;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [shouldLoad]);
  const deliverySrc = privateMediaRetrySrc(src, attempt);
  const discoverInDocument = highPriority && deliverySrc.startsWith("/");
  const loadThroughBlob = !discoverInDocument || rescueWithBlob;
  if (discoverInDocument && !rescueWithBlob) {
    preload(deliverySrc, { as: "image", fetchPriority: "high" });
  }
  const { objectUrl, failed } = usePrivateMediaObjectUrl(
    unavailable || !shouldLoad || !loadThroughBlob ? undefined : deliverySrc,
    highPriority ? "high" : "auto",
  );

  if (unavailable || failed) {
    return (
      <div
        className="private-photo-unavailable"
        data-media-state="error"
        role="group"
        aria-label={alt}
      >
        <p>This photo couldn’t be opened.</p>
        <button
          type="button"
          onClick={() => {
            setUnavailable(false);
            setDecoded(null);
            setRescueWithBlob(false);
            setAttempt((current) => current + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  // The first photo's delivery URL is in the document, the same way a video
  // poster is, so the browser starts it with the HTML. A successful load is
  // the only request. If that response is a pinned iOS 404, the no-store blob
  // fetch is the rescue and the API URL does not stay on the img.
  if (discoverInDocument && !rescueWithBlob) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={attempt}
        src={deliverySrc}
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
        fetchPriority="high"
        onLoad={() => setDecoded(true)}
        onError={() => {
          setDecoded(null);
          setRescueWithBlob(true);
        }}
      />
    );
  }

  if (!objectUrl) {
    return (
      <div
        ref={placeholderRef}
        className="private-photo-unavailable is-pending"
        aria-hidden="true"
      />
    );
  }

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
