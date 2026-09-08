"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  MAP_PICKER_PATH,
  MAP_PICKER_SOURCE,
  isMapPickerToParent,
} from "./map-picker-protocol";

export function MapPickerFrame({
  latitude,
  longitude,
  title,
  className,
  interactive = true,
  onMoved,
  onEscape,
}: Readonly<{
  latitude: number;
  longitude: number;
  title: string;
  className?: string;
  interactive?: boolean;
  onMoved?: (latitude: number, longitude: number) => void;
  onEscape?: () => void;
}>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const onMovedRef = useRef(onMoved);
  const onEscapeRef = useRef(onEscape);

  useEffect(() => {
    onMovedRef.current = onMoved;
    onEscapeRef.current = onEscape;
  }, [onEscape, onMoved]);

  const postInit = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: MAP_PICKER_SOURCE,
        type: "init",
        latitude,
        longitude,
        interactive,
      },
      window.location.origin,
    );
  }, [interactive, latitude, longitude]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isMapPickerToParent(event.data)) return;
      if (event.data.type === "ready") {
        readyRef.current = true;
        postInit();
        return;
      }
      if (event.data.type === "escape") {
        onEscapeRef.current?.();
        return;
      }
      if (event.data.type === "moved") {
        onMovedRef.current?.(event.data.latitude, event.data.longitude);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postInit]);

  useEffect(() => {
    if (!readyRef.current) return;
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: MAP_PICKER_SOURCE,
        type: "set-place",
        latitude,
        longitude,
      },
      window.location.origin,
    );
  }, [latitude, longitude]);

  return (
    <iframe
      ref={iframeRef}
      className={className}
      title={title}
      src={MAP_PICKER_PATH}
      loading="eager"
      onLoad={postInit}
    />
  );
}
