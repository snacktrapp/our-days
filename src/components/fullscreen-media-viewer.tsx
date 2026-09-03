"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";

type FullscreenMediaViewerProps = Readonly<{
  kind: "photo" | "video";
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
  const [zoomed, setZoomed] = useState(false);
  const [pulling, setPulling] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pullRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    distance: number;
  } | null>(null);
  const titleId = useId();
  const isPhoto = kind === "photo";
  const handlePreviewTap = usePairedTap({
    enabled: Boolean(reactionTargetId),
    onDoubleTap: () => {
      if (reactionTargetId) dispatchMomentHeart(reactionTargetId);
    },
    onSingleTap: () => setOpen(true),
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const bodyWasLocked = document.body.classList.contains(
      "media-viewer-scroll-locked",
    );
    document.body.classList.add("media-viewer-scroll-locked");
    if (!dialog.open) dialog.showModal();

    return () => {
      if (!bodyWasLocked)
        document.body.classList.remove("media-viewer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function close() {
    if (photoRef.current) photoRef.current.style.transform = "";
    setOpen(false);
    setZoomed(false);
    setPulling(false);
    pullRef.current = null;
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function startPull(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPhoto || zoomed || event.pointerType === "mouse") return;
    pullRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      distance: 0,
    };
    setPulling(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePull(event: React.PointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (!pull || pull.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pull.startX;
    const deltaY = Math.max(0, event.clientY - pull.startY);
    if (deltaY < Math.abs(deltaX)) return;
    event.preventDefault();
    pull.distance = Math.min(deltaY, 144);
    event.currentTarget.style.transform = `translate3d(0, ${pull.distance}px, 0)`;
  }

  function finishPull(event: React.PointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (!pull || pull.pointerId !== event.pointerId) return;
    pullRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.type === "pointerup" && pull.distance >= 96) close();
    else {
      setPulling(false);
      window.requestAnimationFrame(() => {
        if (photoRef.current) photoRef.current.style.transform = "";
      });
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`media-viewer-trigger ${isPhoto ? "photo-viewer-trigger" : "video-viewer-trigger"}`}
        aria-label={`Open ${kind} full screen: ${label}`}
        onClick={(event) => handlePreviewTap(event.detail)}
      >
        {preview}
        {isPhoto ? null : (
          <span className="video-viewer-play" aria-hidden="true">
            ▶
          </span>
        )}
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
          <h2 id={titleId} className="sr-only">
            {isPhoto ? "Full-screen photo" : "Full-screen video"}: {label}
          </h2>
          <button
            type="button"
            className="media-viewer-close"
            aria-label="Close full-screen media"
            onClick={close}
          >
            ×
          </button>
          {isPhoto ? (
            <div
              ref={photoRef}
              className={`media-viewer-photo ${zoomed ? "is-zoomed" : ""} ${pulling ? "is-pulling" : ""}`}
              onDoubleClick={() => setZoomed((current) => !current)}
              onPointerDown={startPull}
              onPointerMove={movePull}
              onPointerUp={finishPull}
              onPointerCancel={finishPull}
            >
              {fullscreenMedia}
            </div>
          ) : (
            <div className="media-viewer-video">{fullscreenMedia}</div>
          )}
        </dialog>
      ) : null}
    </>
  );
}
