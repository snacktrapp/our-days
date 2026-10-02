"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { photoAlbum } from "@/features/moments/moment-photos";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import {
  albumIndexes,
  albumSlideWidth,
  axisLockPx,
  clampDragDx,
  pairSlideTransform,
  slideMs,
  swipeAxis,
  swipeThreshold,
  waitForFrameReady,
  wrapIndex,
  type AlbumPair,
} from "./photo-album-gesture";
import type { PhotoMomentViewModel } from "./timeline-view-model";

export function PhotoCardPager({
  moment,
  images,
  onIntrinsicRatio,
}: Readonly<{
  moment: PhotoMomentViewModel;
  images: readonly ReactNode[];
  /** Used once when an album has no stored width/height. */
  onIntrinsicRatio?: (heightOverWidth: number) => void;
}>) {
  const photos = photoAlbum(moment);
  const [index, setIndex] = useState(0);
  // Keep mounted images for the life of this card: revisiting a slide must not
  // revoke its blob URL and download it again. Empty frames cost no requests.
  const [requested, setRequested] = useState(() => new Set([0]));
  const [pair, setPair] = useState<AlbumPair | null>(null);
  const [axis, setAxis] = useState<"x" | "y" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const reportedRatioRef = useRef(false);
  const slideWidthRef = useRef(0);
  const pairRef = useRef<AlbumPair | null>(null);
  const pendingToRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const cancelReadyRef = useRef<(() => void) | null>(null);
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    axis: "x" | "y" | null;
    dx: number;
  } | null>(null);
  const pendingDragRef = useRef<{
    to: number;
    direction: 1 | -1;
    dx: number;
    commit: boolean;
  } | null>(null);

  function requestPhoto(photoIndex: number) {
    setRequested((current) =>
      current.has(photoIndex) ? current : new Set([...current, photoIndex]),
    );
  }

  useEffect(() => {
    if (photos.length < 2) return;
    const stage = stageRef.current;
    if (!stage) return;
    // Warm this album before the reader arrives, without waiting for the
    // cover to finish or for each swipe. Distant albums stay unmounted.
    const warmAlbum = () => {
      setRequested((current) =>
        current.size === photos.length
          ? current
          : new Set(Array.from({ length: photos.length }, (_, i) => i)),
      );
    };
    if (typeof IntersectionObserver === "undefined") {
      warmAlbum();
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        warmAlbum();
        observer.disconnect();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(stage);
    return () => observer.disconnect();
  }, [photos.length]);
  function writePair(next: AlbumPair | null) {
    if (next && (next.slideWidth == null || next.slideWidth <= 0)) {
      const width = readSlideWidth();
      next = width > 0 ? { ...next, slideWidth: width } : next;
    }
    pairRef.current = next;
    setPair(next);
  }

  function readSlideWidth() {
    const next = albumSlideWidth(stageRef.current);
    if (next > 0) slideWidthRef.current = next;
    return slideWidthRef.current;
  }

  indexRef.current = index;

  function rememberImage(img: HTMLImageElement) {
    if (reportedRatioRef.current || !onIntrinsicRatio) return;
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    reportedRatioRef.current = true;
    onIntrinsicRatio(img.naturalHeight / img.naturalWidth);
  }

  const displayIndex =
    pair?.mode === "snap" || pair?.mode === "drag" ? pair.to : index;
  function frameEl(photoIndex: number): HTMLElement | null {
    return (
      stageRef.current?.querySelector(`[data-photo-index="${photoIndex}"]`) ??
      null
    );
  }

  function clearFinishTimer() {
    if (finishTimerRef.current == null) return;
    window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = null;
  }

  function clearReadyWait() {
    cancelReadyRef.current?.();
    cancelReadyRef.current = null;
  }

  function finishPair() {
    const nextIndex = pendingToRef.current;
    if (nextIndex == null) return;
    pendingToRef.current = null;
    pendingDragRef.current = null;
    clearFinishTimer();
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    writePair(null);
    setAxis(null);
  }

  useEffect(() => {
    if (!onIntrinsicRatio || photos.length < 2 || reportedRatioRef.current) {
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    stage.querySelectorAll("img").forEach((node) => {
      if (!(node instanceof HTMLImageElement) || !node.complete) return;
      if (reportedRatioRef.current) return;
      if (node.naturalWidth <= 0 || node.naturalHeight <= 0) return;
      reportedRatioRef.current = true;
      onIntrinsicRatio(node.naturalHeight / node.naturalWidth);
    });
  }, [onIntrinsicRatio, photos.length]);

  useEffect(() => {
    if (photos.length < 2) return;
    const root = rootRef.current;
    if (!root) return;
    // iOS Safari decides `touch-action: pan-y` at touchstart, so any swipe
    // with a little vertical drift became a page scroll (and a pointercancel).
    // Cancel the native pan from a non-passive touchmove once the gesture has
    // locked horizontal, using the same 45° rule as the pointer handlers.
    let touch: {
      id: number;
      x: number;
      y: number;
      axis: "x" | "y" | null;
    } | null = null;
    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        touch = null;
        return;
      }
      const t = event.touches[0];
      touch = { id: t.identifier, x: t.clientX, y: t.clientY, axis: null };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!touch) return;
      if (event.touches.length !== 1) {
        touch = null;
        return;
      }
      const t = Array.from(event.touches).find(
        (candidate) => candidate.identifier === touch?.id,
      );
      if (!t) return;
      if (touch.axis == null) {
        touch.axis =
          pointerRef.current?.axis ??
          swipeAxis(t.clientX - touch.x, t.clientY - touch.y);
      }
      if (touch.axis === "x" && event.cancelable) event.preventDefault();
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length === 0) touch = null;
    };
    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd, { passive: true });
    root.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [photos.length]);

  useEffect(
    () => () => {
      clearFinishTimer();
      clearReadyWait();
    },
    [],
  );

  function startSettle(next: AlbumPair) {
    pendingToRef.current = next.mode === "snap" ? next.to : next.from;
    writePair(next);
    clearFinishTimer();
    finishTimerRef.current = window.setTimeout(finishPair, slideMs + 40);
  }

  function startSnap(from: number, to: number, direction: 1 | -1) {
    if (overlayMotionReduced()) {
      pendingToRef.current = null;
      pendingDragRef.current = null;
      indexRef.current = to;
      setIndex(to);
      writePair(null);
      return;
    }
    pendingToRef.current = to;
    writePair({ from, to, direction, mode: "pending", dx: 0 });
    requestAnimationFrame(() => {
      startSettle({ from, to, direction, mode: "snap", dx: 0 });
    });
  }

  function applyDrag(to: number, direction: 1 | -1, dx: number) {
    writePair({ from: index, to, direction, mode: "drag", dx });
  }

  function onIncomingReadyForDrag() {
    const pending = pendingDragRef.current;
    if (!pending) return;
    const pointer = pointerRef.current;
    const shouldCommit =
      pending.commit || (!pointer && Math.abs(pending.dx) >= swipeThreshold);
    if (!pointer || shouldCommit) {
      pendingDragRef.current = null;
      if (shouldCommit) {
        startSnap(index, pending.to, pending.direction);
        return;
      }
      pendingToRef.current = null;
      return;
    }
    applyDrag(pending.to, pending.direction, pending.dx);
  }

  function beginHorizontalDrag(rawDx: number) {
    const direction: 1 | -1 = rawDx < 0 ? 1 : -1;
    const to = wrapIndex(index + direction, photos.length);
    const dx = clampDragDx(rawDx, direction, readSlideWidth());
    pendingToRef.current = to;
    pendingDragRef.current = { to, direction, dx, commit: false };
    requestPhoto(to);
    if (overlayMotionReduced()) return;
    clearReadyWait();
    cancelReadyRef.current = waitForFrameReady(
      frameEl(to),
      onIncomingReadyForDrag,
    );
  }

  function moveHorizontalDrag(rawDx: number) {
    const direction: 1 | -1 =
      rawDx === 0 ? (pairRef.current?.direction ?? 1) : rawDx < 0 ? 1 : -1;
    const to = wrapIndex(index + direction, photos.length);
    const dx = clampDragDx(rawDx, direction, readSlideWidth());
    if (pointerRef.current) pointerRef.current.dx = dx;
    const pending = pendingDragRef.current;
    const changedPendingTarget = pending != null && pending.to !== to;
    if (pending) {
      pending.to = to;
      pending.direction = direction;
      pending.dx = dx;
    }
    const currentPair = pairRef.current;
    if (currentPair?.mode === "drag") {
      if (currentPair.to === to) {
        writePair({ ...currentPair, dx });
        return;
      }
      pendingToRef.current = to;
      pendingDragRef.current = { to, direction, dx, commit: false };
      clearReadyWait();
      requestPhoto(to);
      cancelReadyRef.current = waitForFrameReady(
        frameEl(to),
        onIncomingReadyForDrag,
      );
      return;
    }
    if (!pending || changedPendingTarget) {
      beginHorizontalDrag(rawDx);
    }
  }

  function onTrackTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName && event.propertyName !== "transform") return;
    finishPair();
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      photos.length < 2 ||
      pair ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      axis: null,
      dx: 0,
    };
    setAxis(null);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    if (!start || start.id !== event.pointerId) return;
    const rawDx = event.clientX - start.x;
    const rawDy = event.clientY - start.y;
    if (start.axis == null) {
      const locked = swipeAxis(rawDx, rawDy);
      if (locked == null) return;
      if (locked === "y") {
        start.axis = "y";
        setAxis("y");
        return;
      }
      start.axis = "x";
      setAxis("x");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* jsdom */
      }
      beginHorizontalDrag(rawDx);
      return;
    }
    if (start.axis !== "x") return;
    moveHorizontalDrag(rawDx);
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    pointerRef.current = null;
    setAxis(null);
    if (!start || start.id !== event.pointerId || start.axis !== "x") {
      pendingDragRef.current = null;
      if (!pair) pendingToRef.current = null;
      return;
    }
    const rawDx = event.clientX - start.x;
    const currentPair = pairRef.current;
    const pending = pendingDragRef.current;
    const dx = currentPair?.dx ?? pending?.dx ?? rawDx;
    const commit = Math.abs(dx) >= swipeThreshold;
    if (commit || Math.abs(dx) > axisLockPx) event.preventDefault();
    if (overlayMotionReduced()) {
      pendingDragRef.current = null;
      if (!commit) {
        pendingToRef.current = null;
        return;
      }
      const direction: 1 | -1 = dx < 0 ? 1 : -1;
      const to = wrapIndex(index + direction, photos.length);
      clearReadyWait();
      requestPhoto(to);
      cancelReadyRef.current = waitForFrameReady(frameEl(to), () =>
        startSnap(index, to, direction),
      );
      return;
    }
    if (!currentPair && pending) {
      pending.commit = commit;
      if (!commit) {
        clearReadyWait();
        pendingDragRef.current = null;
        pendingToRef.current = null;
      }
      return;
    }
    if (!currentPair || currentPair.mode !== "drag") return;
    if (commit) {
      pendingDragRef.current = null;
      startSettle({ ...currentPair, mode: "snap", dx: 0 });
      return;
    }
    pendingToRef.current = currentPair.from;
    pendingDragRef.current = null;
    startSettle({ ...currentPair, mode: "spring", dx: 0 });
  }

  const reserved = new Set(pair ? [pair.from, pair.to] : [index]);
  const parkedIndexes = albumIndexes(photos.length).filter(
    (photoIndex) => !reserved.has(photoIndex),
  );
  const trackStyle: CSSProperties | undefined = pair
    ? { transform: pairSlideTransform(pair, pair.slideWidth ?? 0) }
    : undefined;

  function renderFrame(
    photoIndex: number,
    role: "outgoing" | "incoming" | "parked",
  ) {
    return (
      <div
        key={`photo-${photoIndex}`}
        data-photo-index={photoIndex}
        className={
          role === "parked"
            ? "photo-card-pager-frame is-parked"
            : role === "incoming"
              ? "photo-card-pager-frame is-incoming"
              : "photo-card-pager-frame is-outgoing"
        }
        aria-hidden={role === "parked" ? true : undefined}
      >
        {requested.has(photoIndex) ? images[photoIndex] : null}
      </div>
    );
  }

  const pairFrames = pair
    ? pair.direction === 1
      ? [renderFrame(pair.from, "outgoing"), renderFrame(pair.to, "incoming")]
      : [renderFrame(pair.to, "incoming"), renderFrame(pair.from, "outgoing")]
    : [renderFrame(index, "outgoing")];
  const trackFrames = [
    ...pairFrames,
    ...parkedIndexes.map((photoIndex) => renderFrame(photoIndex, "parked")),
  ];

  return (
    <div
      ref={rootRef}
      className={`photo-card-pager${photos.length > 1 ? " has-album" : ""}${
        axis === "x" ? " is-axis-x" : ""
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onDragStart={(event) => {
        // A mouse swipe otherwise becomes a native image drag and cancels the pointer.
        if (photos.length > 1) event.preventDefault();
      }}
      onPointerCancel={() => {
        const currentPair = pairRef.current;
        pointerRef.current = null;
        setAxis(null);
        pendingDragRef.current = null;
        if (currentPair?.mode === "drag") {
          pendingToRef.current = currentPair.from;
          startSettle({ ...currentPair, mode: "spring", dx: 0 });
          return;
        }
        if (!currentPair) pendingToRef.current = null;
        clearReadyWait();
      }}
    >
      {photos.length < 2 ? (
        (images[0] ?? null)
      ) : (
        <div
          ref={stageRef}
          className="photo-card-pager-stage"
          onLoad={(event) => {
            if (event.target instanceof HTMLImageElement) {
              rememberImage(event.target);
            }
          }}
        >
          <div
            className={`photo-card-pager-track${pair ? " is-paired" : ""}${
              pair?.mode === "drag" ? " is-dragging" : ""
            }${pair?.mode === "snap" ? " is-sliding" : ""}${
              pair?.mode === "spring" ? " is-springing" : ""
            }${
              pair?.mode === "snap" || pair?.mode === "spring"
                ? " is-settling"
                : ""
            }`}
            data-direction={
              pair ? (pair.direction === 1 ? "next" : "prev") : undefined
            }
            data-phase={pair?.mode ?? "idle"}
            data-dx={pair?.mode === "drag" ? String(pair.dx) : undefined}
            style={trackStyle}
            onTransitionEnd={onTrackTransitionEnd}
          >
            {trackFrames}
          </div>
        </div>
      )}
      {photos.length > 1 ? (
        <>
          <div className="photo-card-pager-dots" aria-hidden="true">
            {photos.map((photo, photoIndex) => (
              <span
                key={photo.id}
                className={
                  photoIndex === displayIndex ? "is-current" : undefined
                }
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Photo {displayIndex + 1} of {photos.length}
          </p>
        </>
      ) : null}
    </div>
  );
}
