"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useOverlayOpenChrome } from "@/features/shell/use-overlay-open-chrome";
import { useVisualViewportFill } from "@/features/shell/use-visual-viewport-fill";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
};

type FullscreenMediaViewerProps = Readonly<{
  kind: "video";
  label: string;
  preview: ReactNode;
  fullscreenMedia: ReactNode;
  reactionTargetId?: string;
}>;

function playDialogVideo(dialog: HTMLDialogElement | null) {
  const video = dialog?.querySelector("video");
  if (!video) return;
  video.playsInline = true;
  void video.play().catch(() => undefined);
}

export function FullscreenMediaViewer({
  kind,
  label,
  preview,
  fullscreenMedia,
  reactionTargetId,
}: FullscreenMediaViewerProps) {
  const [open, setOpen] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeCleanupRef = useRef<() => void>(() => undefined);
  const titleId = useId();
  useVisualViewportFill(dialogRef, open);
  useOverlayOpenChrome(open);

  function openVideo() {
    flushSync(() => setOpen(true));
    const dialog = dialogRef.current;
    try {
      if (dialog && !dialog.open) dialog.showModal();
    } catch {
      // Some test environments expose dialog without modal helpers.
    }
    playDialogVideo(dialog);
    const video = dialog?.querySelector(
      "video",
    ) as WebkitFullscreenVideo | null;
    if (typeof video?.webkitEnterFullscreen === "function") {
      let beginFallback = window.setTimeout(() => {
        beginFallback = 0;
        setNativeFullscreen(false);
      }, 1_500);
      const onNativeBegin = () => {
        if (beginFallback) window.clearTimeout(beginFallback);
        beginFallback = 0;
        setNativeFullscreen(true);
      };
      const onNativeEnd = () => close();
      video.addEventListener("webkitbeginfullscreen", onNativeBegin);
      video.addEventListener("webkitendfullscreen", onNativeEnd);
      nativeCleanupRef.current = () => {
        if (beginFallback) window.clearTimeout(beginFallback);
        video.removeEventListener("webkitbeginfullscreen", onNativeBegin);
        video.removeEventListener("webkitendfullscreen", onNativeEnd);
      };
      flushSync(() => setNativeFullscreen(true));
      try {
        video.webkitEnterFullscreen();
        return;
      } catch {
        nativeCleanupRef.current();
        nativeCleanupRef.current = () => undefined;
        setNativeFullscreen(false);
      }
    }
  }

  const handlePreviewTap = usePairedTap({
    enabled: Boolean(reactionTargetId),
    onDoubleTap: () => {
      if (reactionTargetId) dispatchMomentHeart(reactionTargetId);
    },
    onSingleTap: openVideo,
  });

  function close() {
    nativeCleanupRef.current();
    nativeCleanupRef.current = () => undefined;
    dialogRef.current?.querySelector("video")?.pause();
    setNativeFullscreen(false);
    setOpen(false);
    document.getElementById("journal-focus-target")?.blur();
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    try {
      if (!dialog.open) dialog.showModal();
    } catch {
      // Some test environments expose dialog without modal helpers.
    }
    playDialogVideo(dialog);
    return () => {
      nativeCleanupRef.current();
      nativeCleanupRef.current = () => undefined;
      dialog.querySelector("video")?.pause();
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="media-viewer-trigger video-viewer-trigger"
        aria-label={`Open ${kind} full screen: ${label}`}
        onClick={(event) => {
          if (
            typeof HTMLVideoElement !== "undefined" &&
            typeof (HTMLVideoElement.prototype as WebkitFullscreenVideo)
              .webkitEnterFullscreen === "function"
          ) {
            openVideo();
            return;
          }
          handlePreviewTap(event.detail);
        }}
      >
        {preview}
        <span className="video-viewer-play" aria-hidden="true">
          ▶
        </span>
      </button>

      {open ? (
        <dialog
          ref={dialogRef}
          className="fullscreen-media-dialog"
          aria-labelledby={titleId}
          onKeyDown={containDialogFocus}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="media-viewer-dimmer" />
          <h2 id={titleId} className="sr-only">
            Full-screen video: {label}
          </h2>
          {nativeFullscreen ? null : (
            <button
              type="button"
              className="photo-lightbox-close media-viewer-close"
              aria-label="Close"
              onClick={close}
            >
              <span aria-hidden="true">×</span>
            </button>
          )}
          <div className="media-viewer-video">{fullscreenMedia}</div>
        </dialog>
      ) : null}
    </>
  );
}
