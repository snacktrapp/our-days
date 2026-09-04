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
  onMoved,
}: Readonly<{
  latitude: number;
  longitude: number;
  title: string;
  className?: string;
  onMoved: (latitude: number, longitude: number) => void;
}>) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const onMovedRef = useRef(onMoved);

  useEffect(() => {
    onMovedRef.current = onMoved;
  }, [onMoved]);

  const postInit = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        source: MAP_PICKER_SOURCE,
        type: "init",
        latitude,
        longitude,
      },
      window.location.origin,
    );
  }, [latitude, longitude]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isMapPickerToParent(event.data)) return;
      if (event.data.type === "ready") {
        readyRef.current = true;
        postInit();
        return;
      }
      if (event.data.type === "moved") {
        onMovedRef.current(event.data.latitude, event.data.longitude);
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
      onLoad={postInit}
    />
  );
}
