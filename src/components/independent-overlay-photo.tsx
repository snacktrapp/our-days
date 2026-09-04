"use client";

import { useEffect, useState } from "react";

const objectUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

export function peekIndependentOverlayObjectUrl(src: string) {
  return objectUrls.get(src) ?? null;
}

export function resetIndependentOverlayObjectUrlCache() {
  objectUrls.clear();
  inflight.clear();
}

export function prefetchIndependentOverlayObjectUrl(src: string) {
  const existing = objectUrls.get(src);
  if (existing) return Promise.resolve(existing);
  const pending = inflight.get(src);
  if (pending) return pending;

  const work = (async () => {
    try {
      const response = await globalThis.fetch(src, {
        cache: "force-cache",
        credentials: "same-origin",
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      const created = URL.createObjectURL(blob);
      objectUrls.set(src, created);
      return created;
    } catch {
      return null;
    } finally {
      inflight.delete(src);
    }
  })();

  inflight.set(src, work);
  return work;
}

export function useIndependentOverlayObjectUrl(src: string | undefined) {
  const [objectUrl, setObjectUrl] = useState<string | null>(() =>
    src ? (peekIndependentOverlayObjectUrl(src) ?? null) : null,
  );

  useEffect(() => {
    if (!src || peekIndependentOverlayObjectUrl(src)) return;
    let cancelled = false;
    void prefetchIndependentOverlayObjectUrl(src).then((next) => {
      if (!cancelled && next) setObjectUrl(next);
    });
    return () => {
      cancelled = true;
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
