"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
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
      setOpen(true);
    },
  });

  function close() {
    setOpen(false);
    document.getElementById("journal-focus-target")?.blur();
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => {
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
          <h2 id={titleId} className="sr-only">
            Full-screen video: {label}
          </h2>
          <button
            type="button"
            className="media-viewer-close"
            aria-label="Close full-screen media"
            onClick={close}
          >
            ×
          </button>
          <div className="media-viewer-video">{fullscreenMedia}</div>
        </dialog>
      ) : null}
    </>
  );
}
