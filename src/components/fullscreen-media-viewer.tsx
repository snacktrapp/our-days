"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import { useIndependentOverlayObjectUrl } from "./independent-overlay-photo";

const motionMs = 180;
const dismissDistanceRatio = 0.2;
const flickVelocity = 0.65;

type FullscreenMediaViewerProps = Readonly<{
  kind: "photo" | "video";
  label: string;
  preview: ReactNode;
  fullscreenMedia?: ReactNode;
  overlaySrc?: string;
  reactionTargetId?: string;
}>;

type PhotoMotion = "opening" | "open" | "pulling" | "snap-back" | "swipe-out";

function pullTranslate(distance: number) {
  return `translate3d(0, ${distance}px, 0)`;
}

export function FullscreenMediaViewer({
  kind,
  label,
  preview,
  fullscreenMedia,
  overlaySrc,
  reactionTargetId,
}: FullscreenMediaViewerProps) {
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [motion, setMotion] = useState<PhotoMotion>("open");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const dimmerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const pullRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    distance: number;
  } | null>(null);
  const titleId = useId();
  const isPhoto = kind === "photo";
  const overlayObjectUrl = useIndependentOverlayObjectUrl(
    isPhoto ? overlaySrc : undefined,
  );
  const handlePreviewTap = usePairedTap({
    enabled: Boolean(reactionTargetId),
    onDoubleTap: () => {
      if (reactionTargetId) dispatchMomentHeart(reactionTargetId);
    },
    onSingleTap: () => {
      setMotion("opening");
      setOpen(true);
    },
  });

  function clearCloseTimer() {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function setDimmer(opacity: string, transition: string) {
    const dimmer = dimmerRef.current;
    if (!dimmer) return;
    dimmer.style.transition = transition;
    dimmer.style.opacity = opacity;
  }

  function setOverlayLayer(
    transform: string,
    opacity: string,
    transition: string,
  ) {
    const photo = photoRef.current;
    if (!photo) return;
    photo.style.transition = transition;
    photo.style.transform = transform;
    photo.style.opacity = opacity;
  }

  function teardown() {
    clearCloseTimer();
    if (photoRef.current) {
      photoRef.current.style.transform = "";
      photoRef.current.style.transition = "";
      photoRef.current.style.opacity = "";
    }
    if (dimmerRef.current) {
      dimmerRef.current.style.opacity = "";
      dimmerRef.current.style.transition = "";
    }
    openedRef.current = false;
    pullRef.current = null;
    setOpen(false);
    setZoomed(false);
    setMotion("open");
    document.getElementById("journal-focus-target")?.blur();
    if (document.activeElement instanceof HTMLElement) {
      const active = document.activeElement;
      if (
        active.closest(".topbar") ||
        active.classList.contains("media-viewer-close")
      ) {
        active.blur();
      }
    }
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  }

  function fadeOutOverlay() {
    if (!isPhoto || overlayMotionReduced()) {
      teardown();
      return;
    }
    setMotion("swipe-out");
    setOverlayLayer("", "0", `opacity ${motionMs}ms ease-in`);
    setDimmer("0", `opacity ${motionMs}ms ease-in`);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(teardown, motionMs);
  }

  function close() {
    if (motion === "swipe-out") return;
    fadeOutOverlay();
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    if (!dialog.open) dialog.showModal();
    if (!isPhoto || openedRef.current) return;
    openedRef.current = true;

    if (overlayMotionReduced()) {
      setDimmer("1", "none");
      setOverlayLayer("", "1", "none");
      window.requestAnimationFrame(() => setMotion("open"));
      return;
    }

    setOverlayLayer("", "0", "none");
    setDimmer("0", "none");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setOverlayLayer("", "1", `opacity ${motionMs}ms ease-out`);
        setDimmer("1", `opacity ${motionMs}ms ease-out`);
        window.setTimeout(() => setMotion("open"), motionMs);
      });
    });
  }, [isPhoto, open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const bodyWasLocked = document.body.classList.contains(
      "media-viewer-scroll-locked",
    );
    document.body.classList.add("media-viewer-scroll-locked");

    const blockPageScroll = (event: TouchEvent) => {
      if (
        event.target instanceof Node &&
        photoRef.current?.contains(event.target) &&
        event.touches.length > 1
      ) {
        return;
      }
      event.preventDefault();
    };
    document.addEventListener("touchmove", blockPageScroll, { passive: false });

    return () => {
      clearCloseTimer();
      document.removeEventListener("touchmove", blockPageScroll);
      if (!bodyWasLocked)
        document.body.classList.remove("media-viewer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function startPull(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPhoto || zoomed || event.pointerType === "mouse") return;
    if (motion === "swipe-out") return;
    pullRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startTime: performance.now(),
      distance: 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePull(event: React.PointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (!pull || pull.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - pull.startX;
    const deltaY = Math.max(0, event.clientY - pull.startY);
    if (deltaY < Math.abs(deltaX)) return;
    event.preventDefault();
    pull.distance = deltaY;
    if (overlayMotionReduced()) return;
    setMotion("pulling");
    const viewportHeight = window.innerHeight;
    setOverlayLayer(pullTranslate(deltaY), "1", "none");
    setDimmer(
      String(Math.max(0.2, 1 - (deltaY / Math.max(viewportHeight, 1)) * 0.8)),
      "none",
    );
  }

  function finishPull(event: React.PointerEvent<HTMLDivElement>) {
    const pull = pullRef.current;
    if (!pull || pull.pointerId !== event.pointerId) return;
    pullRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.type !== "pointerup") {
      if (!overlayMotionReduced()) {
        setMotion("snap-back");
        setOverlayLayer("", "1", `transform ${motionMs}ms ease-out`);
        setDimmer("1", `opacity ${motionMs}ms ease-out`);
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(
          () => setMotion("open"),
          motionMs,
        );
      }
      return;
    }

    const elapsed = Math.max(1, performance.now() - pull.startTime);
    const velocity = pull.distance / elapsed;
    const threshold = window.innerHeight * dismissDistanceRatio;
    const flicked =
      elapsed >= 32 &&
      elapsed <= 320 &&
      velocity >= flickVelocity &&
      pull.distance > 24;
    const shouldDismiss = pull.distance >= threshold || flicked;

    if (!shouldDismiss) {
      if (overlayMotionReduced()) {
        setMotion("open");
        return;
      }
      setMotion("snap-back");
      setOverlayLayer("", "1", `transform ${motionMs}ms ease-out`);
      setDimmer("1", `opacity ${motionMs}ms ease-out`);
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(
        () => setMotion("open"),
        motionMs,
      );
      return;
    }

    if (overlayMotionReduced()) {
      teardown();
      return;
    }

    setMotion("swipe-out");
    const rest = Math.max(window.innerHeight, pull.distance + 120);
    setOverlayLayer(
      pullTranslate(rest),
      "1",
      `transform ${motionMs}ms ease-in`,
    );
    setDimmer("0", `opacity ${motionMs}ms ease-in`);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(teardown, motionMs);
  }

  const overlay =
    isPhoto && overlaySrc ? (
      overlayObjectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={overlayObjectUrl} alt={label} />
      ) : null
    ) : (
      fullscreenMedia
    );

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
          data-motion={isPhoto ? motion : undefined}
          onKeyDown={containDialogFocus}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div ref={dimmerRef} className="media-viewer-dimmer" />
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
              className={`media-viewer-photo ${zoomed ? "is-zoomed" : ""} ${motion === "pulling" ? "is-pulling" : ""}`}
              onDoubleClick={() => setZoomed((current) => !current)}
              onPointerDown={startPull}
              onPointerMove={movePull}
              onPointerUp={finishPull}
              onPointerCancel={finishPull}
            >
              {overlay}
            </div>
          ) : (
            <div className="media-viewer-video">{fullscreenMedia}</div>
          )}
        </dialog>
      ) : null}
    </>
  );
}
