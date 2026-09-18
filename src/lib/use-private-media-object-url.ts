"use client";

import { useEffect, useState } from "react";

function inlineMediaSrc(src: string | undefined) {
  if (!src) return null;
  return src.startsWith("data:") || src.startsWith("blob:") ? src : null;
}

export function usePrivateMediaObjectUrl(
  src: string | undefined,
  priority: "high" | "auto" = "auto",
) {
  const inline = inlineMediaSrc(src);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string>();

  useEffect(() => {
    if (!src || inline) return;

    const handle = { cancelled: false, created: null as string | null };
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20000);
    void (async () => {
      try {
        const response = await fetch(src, {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
          priority,
        });
        if (!response.ok) {
          if (!handle.cancelled) {
            setFailed(true);
            setLoadedSrc(src);
          }
          return;
        }
        const blob = await response.blob();
        if (blob.size < 1) {
          if (!handle.cancelled) {
            setFailed(true);
            setLoadedSrc(src);
          }
          return;
        }
        handle.created = URL.createObjectURL(blob);
        if (handle.cancelled) {
          URL.revokeObjectURL(handle.created);
          return;
        }
        setRemoteUrl(handle.created);
        setFailed(false);
        setLoadedSrc(src);
      } catch {
        if (!handle.cancelled) {
          setFailed(true);
          setLoadedSrc(src);
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    return () => {
      handle.cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
      if (handle.created) URL.revokeObjectURL(handle.created);
    };
  }, [inline, src, priority]);

  const current = loadedSrc === src;
  return {
    objectUrl: inline ?? (current ? remoteUrl : null),
    failed: Boolean(src) && !inline && current && failed,
  };
}
