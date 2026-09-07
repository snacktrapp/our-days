"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const handlePreviewTap = usePairedTap({
    enabled: Boolean(reactionTargetId),
    onDoubleTap: () => {
      if (reactionTargetId) dispatchMomentHeart(reactionTargetId);
    },
    onSingleTap: () => {
      flushSync(() => setOpen(true));
      const dialog = dialogRef.current;
      try {
        if (dialog && !dialog.open) dialog.showModal();
      } catch {
        // Some test environments expose dialog without modal helpers.
      }
      playDialogVideo(dialog);
    },
  });

  function close() {
    dialogRef.current?.querySelector("video")?.pause();
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
        onClick={(event) => handlePreviewTap(event.detail)}
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
          <div className="media-viewer-chrome">
            <h2 id={titleId} className="sr-only">
              Full-screen video: {label}
            </h2>
            <button
              type="button"
              className="photo-lightbox-close media-viewer-close"
              onClick={close}
            >
              Done
            </button>
          </div>
          <div className="media-viewer-video">{fullscreenMedia}</div>
        </dialog>
      ) : null}
    </>
  );
}
