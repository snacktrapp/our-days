"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";

const motionMs = 180;
const dismissDistanceRatio = 0.2;
const flickVelocity = 0.65;
const dragScaleRange = 0.08;

type FullscreenMediaViewerProps = Readonly<{
  kind: "photo" | "video";
  label: string;
  preview: ReactNode;
  fullscreenMedia: ReactNode;
  reactionTargetId?: string;
}>;

type PhotoMotion =
  "opening" | "open" | "pulling" | "snap-back" | "swipe-out" | "closing";

function mediaFrame(node: HTMLElement | null) {
  if (!node) return null;
  const media = node.querySelector("img, video") ?? node;
  return media.getBoundingClientRect();
}

function flipTransform(from: DOMRect, to: DOMRect) {
  if (from.width < 1 || from.height < 1 || to.width < 1 || to.height < 1) {
    return "";
  }
  const scale = Math.min(from.width / to.width, from.height / to.height);
  const x = from.left + from.width / 2 - (to.left + to.width / 2);
  const y = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
}

function pullTransform(distance: number, viewportHeight: number) {
  const progress = Math.min(1, distance / Math.max(viewportHeight, 1));
  const scale = 1 - dragScaleRange * progress;
  return `translate3d(0, ${distance}px, 0) scale(${scale})`;
}

export function FullscreenMediaViewer({
  kind,
  label,
  preview,
  fullscreenMedia,
  reactionTargetId,
}: FullscreenMediaViewerProps) {
  const [open, setOpen] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [motion, setMotion] = useState<PhotoMotion>("open");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const photoRef = useRef<HTMLDivElement>(null);
  const dimmerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const originRef = useRef<DOMRect | null>(null);
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
  const handlePreviewTap = usePairedTap({
    enabled: Boolean(reactionTargetId),
    onDoubleTap: () => {
      if (reactionTargetId) dispatchMomentHeart(reactionTargetId);
    },
    onSingleTap: () => {
      originRef.current = mediaFrame(triggerRef.current);
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

  function setPhotoTransform(transform: string, transition: string) {
    const photo = photoRef.current;
    if (!photo) return;
    photo.style.transition = transition;
    photo.style.transform = transform;
  }

  function teardown() {
    clearCloseTimer();
    if (photoRef.current) {
      photoRef.current.style.transform = "";
      photoRef.current.style.transition = "";
    }
    if (dimmerRef.current) {
      dimmerRef.current.style.opacity = "";
      dimmerRef.current.style.transition = "";
    }
    openedRef.current = false;
    originRef.current = null;
    pullRef.current = null;
    setOpen(false);
    setZoomed(false);
    setMotion("open");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function closeToCard() {
    if (!isPhoto || overlayMotionReduced()) {
      teardown();
      return;
    }
    const photo = photoRef.current;
    const origin = mediaFrame(triggerRef.current);
    const current = photo ? photo.getBoundingClientRect() : null;
    const transform = origin && current ? flipTransform(origin, current) : "";
    if (!transform) {
      teardown();
      return;
    }
    setMotion("closing");
    setPhotoTransform(transform, `transform ${motionMs}ms ease-in`);
    setDimmer("0", `opacity ${motionMs}ms ease-in`);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(teardown, motionMs);
  }

  function close() {
    if (motion === "swipe-out" || motion === "closing") return;
    closeToCard();
  }

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    if (!dialog.open) dialog.showModal();
    if (!isPhoto || openedRef.current) return;
    openedRef.current = true;

    if (overlayMotionReduced()) {
      setDimmer("1", "none");
      setPhotoTransform("", "none");
      window.requestAnimationFrame(() => setMotion("open"));
      return;
    }

    const dest = photoRef.current?.getBoundingClientRect() ?? null;
    const origin = originRef.current;
    const transform = origin && dest ? flipTransform(origin, dest) : "";
    if (!transform) {
      setDimmer("1", "none");
      window.requestAnimationFrame(() => setMotion("open"));
      return;
    }

    setPhotoTransform(transform, "none");
    setDimmer("0", "none");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setPhotoTransform("", `transform ${motionMs}ms ease-out`);
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

    return () => {
      clearCloseTimer();
      if (!bodyWasLocked)
        document.body.classList.remove("media-viewer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  function startPull(event: React.PointerEvent<HTMLDivElement>) {
    if (!isPhoto || zoomed || event.pointerType === "mouse") return;
    if (motion === "closing" || motion === "swipe-out") {
      return;
    }
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
    setPhotoTransform(pullTransform(deltaY, viewportHeight), "none");
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
        setPhotoTransform("", `transform ${motionMs}ms ease-out`);
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
      setPhotoTransform("", `transform ${motionMs}ms ease-out`);
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
    setPhotoTransform(
      `translate3d(0, ${rest}px, 0) scale(0.88)`,
      `transform ${motionMs}ms ease-in`,
    );
    setDimmer("0", `opacity ${motionMs}ms ease-in`);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(teardown, motionMs);
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
