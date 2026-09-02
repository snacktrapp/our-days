"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const singleTapTimerRef = useRef<number | null>(null);
  const titleId = useId();
  const isPhoto = kind === "photo";

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

  useEffect(
    () => () => {
      if (singleTapTimerRef.current !== null) {
        window.clearTimeout(singleTapTimerRef.current);
      }
    },
    [],
  );

  function heartFromDoubleTap() {
    if (!reactionTargetId) return;
    document
      .getElementById(`moment-conversation-${reactionTargetId}`)
      ?.dispatchEvent(new Event("our-days:heart", { bubbles: false }));
  }

  function openFromTap(detail: number) {
    if (!reactionTargetId || detail === 0) {
      setOpen(true);
      return;
    }
    if (singleTapTimerRef.current !== null) {
      window.clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = null;
      heartFromDoubleTap();
      return;
    }
    singleTapTimerRef.current = window.setTimeout(() => {
      singleTapTimerRef.current = null;
      setOpen(true);
    }, 240);
  }

  function close() {
    setOpen(false);
    setZoomed(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`media-viewer-trigger ${isPhoto ? "photo-viewer-trigger" : "video-viewer-trigger"}`}
        aria-label={`Open ${kind} full screen: ${label}`}
        onClick={(event) => openFromTap(event.detail)}
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
              className={`media-viewer-photo ${zoomed ? "is-zoomed" : ""}`}
              onDoubleClick={() => setZoomed((current) => !current)}
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
