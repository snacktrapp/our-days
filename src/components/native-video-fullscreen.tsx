"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { PrivateVideoPlayer } from "./private-video-player";

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitSupportsFullscreen?: boolean;
};

type NativeVideoFullscreenProps = Readonly<{
  src: string;
  label: string;
  preview: ReactNode;
  poster?: string;
  preload?: "none" | "metadata";
  width?: number;
  height?: number;
  onReadyFrame?: (frame: {
    posterDataUrl: string;
    width: number;
    height: number;
  }) => void;
}>;

type TimelineScrollSnapshot = Readonly<{
  windowX: number;
  windowY: number;
  stage: HTMLElement | null;
  stageLeft: number;
  stageTop: number;
}>;

export function NativeVideoFullscreen({
  src,
  label,
  preview,
  poster,
  preload = "metadata",
  width,
  height,
  onReadyFrame,
}: NativeVideoFullscreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cleanupRef = useRef<() => void>(() => undefined);
  const scrollSnapshotRef = useRef<TimelineScrollSnapshot | null>(null);
  const [inlineControls, setInlineControls] = useState(false);
  const [nativePresentation, setNativePresentation] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  function cleanupFullscreenListeners() {
    cleanupRef.current();
    cleanupRef.current = () => undefined;
  }

  function restoreTimeline(video: HTMLVideoElement) {
    cleanupFullscreenListeners();
    video.pause();
    video.controls = false;
    setInlineControls(false);
    setNativePresentation(false);
    const snapshot = scrollSnapshotRef.current;
    const restoreScroll = () => {
      if (!snapshot) return;
      if (
        window.scrollX !== snapshot.windowX ||
        window.scrollY !== snapshot.windowY
      ) {
        window.scrollTo(snapshot.windowX, snapshot.windowY);
      }
      if (snapshot.stage) {
        snapshot.stage.scrollLeft = snapshot.stageLeft;
        snapshot.stage.scrollTop = snapshot.stageTop;
      }
    };
    restoreScroll();
    window.requestAnimationFrame(() => {
      restoreScroll();
      triggerRef.current?.focus({ preventScroll: true });
    });
  }

  function playInlineFallback(video: HTMLVideoElement) {
    setInlineControls(true);
    void video.play().catch(() => {
      video.controls = false;
      setInlineControls(false);
      cleanupFullscreenListeners();
    });
  }

  function openNativeFullscreen() {
    const video = videoRef.current as WebkitFullscreenVideo | null;
    if (!video) return;

    cleanupFullscreenListeners();
    const stage = document.querySelector<HTMLElement>(".phone-stage");
    scrollSnapshotRef.current = {
      windowX: window.scrollX,
      windowY: window.scrollY,
      stage,
      stageLeft: stage?.scrollLeft ?? 0,
      stageTop: stage?.scrollTop ?? 0,
    };
    video.controls = true;
    let nativePresentationStarted = false;
    let startFallback = window.setTimeout(() => {
      startFallback = 0;
      if (!nativePresentationStarted) setInlineControls(true);
    }, 1_000);

    const markNativeStart = () => {
      nativePresentationStarted = true;
      if (startFallback) window.clearTimeout(startFallback);
      startFallback = 0;
      setInlineControls(false);
      setNativePresentation(true);
    };
    const handleWebkitEnd = () => restoreTimeline(video);
    const handleStandardChange = () => {
      if (document.fullscreenElement === video) {
        markNativeStart();
      } else if (nativePresentationStarted) {
        restoreTimeline(video);
      }
    };

    video.addEventListener("webkitbeginfullscreen", markNativeStart);
    video.addEventListener("webkitendfullscreen", handleWebkitEnd);
    document.addEventListener("fullscreenchange", handleStandardChange);
    cleanupRef.current = () => {
      if (startFallback) window.clearTimeout(startFallback);
      video.removeEventListener("webkitbeginfullscreen", markNativeStart);
      video.removeEventListener("webkitendfullscreen", handleWebkitEnd);
      document.removeEventListener("fullscreenchange", handleStandardChange);
    };

    try {
      if (
        typeof video.webkitEnterFullscreen === "function" &&
        video.webkitSupportsFullscreen !== false
      ) {
        video.webkitEnterFullscreen();
        void video.play().catch(() => undefined);
        return;
      }

      if (typeof video.webkitEnterFullscreen === "function") {
        playInlineFallback(video);
        return;
      }

      if (typeof video.requestFullscreen === "function") {
        const fullscreenRequest = video.requestFullscreen();
        void video.play().catch(() => undefined);
        void fullscreenRequest.catch(() => playInlineFallback(video));
        return;
      }

      playInlineFallback(video);
    } catch {
      playInlineFallback(video);
    }
  }

  useEffect(
    () => () => {
      cleanupFullscreenListeners();
      videoRef.current?.pause();
    },
    [],
  );

  return (
    <div
      className={`media-viewer-trigger native-video-viewer${
        inlineControls ? " is-inline" : ""
      }${nativePresentation ? " is-native" : ""}`}
    >
      <PrivateVideoPlayer
        src={src}
        label={label}
        poster={poster}
        preload={preload}
        controls={inlineControls}
        playsInline={false}
        width={width}
        height={height}
        onReadyFrame={onReadyFrame}
        onUnavailableChange={setUnavailable}
        videoRef={videoRef}
      />
      {!unavailable && !inlineControls ? (
        <div className="native-video-preview" aria-hidden="true">
          {preview}
        </div>
      ) : null}
      {!unavailable && !inlineControls ? (
        <button
          ref={triggerRef}
          type="button"
          className="native-video-trigger"
          aria-label={`Open video full screen: ${label}`}
          onClick={openNativeFullscreen}
        >
          <span className="video-viewer-play" aria-hidden="true">
            ▶
          </span>
        </button>
      ) : null}
    </div>
  );
}
