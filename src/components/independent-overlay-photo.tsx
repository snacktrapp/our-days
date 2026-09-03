"use client";

import { useEffect, useState } from "react";

export function useIndependentOverlayObjectUrl(src: string | undefined) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src) return;

    let cancelled = false;
    let created = "";

    void (async () => {
      try {
        const response = await globalThis.fetch(src, {
          cache: "force-cache",
          credentials: "same-origin",
        });
        if (!response.ok || cancelled) return;
        const blob = await response.blob();
        if (cancelled) return;
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        /* Overlay stays empty rather than decoding through the card <img>. */
      }
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);

  return src ? objectUrl : null;
}

export function IndependentOverlayPhoto({
  src,
  alt,
  width,
  height,
}: Readonly<{
  src: string;
  alt: string;
  width?: number;
  height?: number;
}>) {
  const objectUrl = useIndependentOverlayObjectUrl(src);
  if (!objectUrl) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={objectUrl} alt={alt} width={width} height={height} />
  );
}
