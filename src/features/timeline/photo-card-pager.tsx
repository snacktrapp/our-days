"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type TransitionEvent,
} from "react";
import { photoAlbum } from "@/features/moments/moment-photos";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import {
  albumIndexes,
  axisLockPx,
  clampDragDx,
  frameImage,
  pairTransform,
  slideMs,
  swipeThreshold,
  waitForImageReady,
  wrapIndex,
  type AlbumPair,
} from "./photo-album-gesture";
import type { PhotoMomentViewModel } from "./timeline-view-model";
import { PhotoLightboxTrigger } from "./photo-lightbox";

export function PhotoCardPager({
  moment,
  images,
}: Readonly<{
  moment: PhotoMomentViewModel;
  images: readonly ReactNode[];
}>) {
  const photos = photoAlbum(moment);
  const [index, setIndex] = useState(0);
  const [pair, setPair] = useState<AlbumPair | null>(null);
  const [axis, setAxis] = useState<"x" | "y" | null>(null);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
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
  const suppressClickRef = useRef(false);

  function writePair(next: AlbumPair | null) {
    pairRef.current = next;
    setPair(next);
  }

  const current = photos[index] ??
    photos[0] ?? {
      id: moment.id,
      src: moment.image.src,
      alt: moment.image.alt,
      width: moment.image.width,
      height: moment.image.height,
    };
  const displayIndex = pair?.mode === "snap" ? pair.to : index;

  function frameEl(photoIndex: number): HTMLElement | null {
    return (
      stageRef.current?.querySelector(`[data-photo-index="${photoIndex}"]`) ??
      null
    );
  }

  function estimateHeight(incomingIndex: number): number {
    const stage = stageRef.current;
    if (!stage) return 0;
    const width = stage.clientWidth;
    const incoming = photos[incomingIndex];
    if (incoming?.width && incoming.height && width > 0) {
      return width * (incoming.height / incoming.width);
    }
    return 0;
  }

  function paintedFrameHeight(photoIndex: number): number {
    const height = frameEl(photoIndex)?.offsetHeight ?? 0;
    return height > 1 ? height : 0;
  }

  function lockStageHeight(incomingIndex: number, incomingPainted = 0) {
    const currentHeight = stageRef.current?.offsetHeight ?? 0;
    const incomingHeight = Math.max(
      incomingPainted,
      estimateHeight(incomingIndex),
    );
    const nextHeight = Math.max(currentHeight, incomingHeight);
    if (nextHeight > 0) setStageHeight(nextHeight);
  }

  function settleStageHeight(incomingIndex: number) {
    const nextHeight =
      paintedFrameHeight(incomingIndex) || estimateHeight(incomingIndex);
    if (nextHeight > 0) setStageHeight(nextHeight);
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
    const incomingHeight = paintedFrameHeight(nextIndex);
    pendingToRef.current = null;
    pendingDragRef.current = null;
    clearFinishTimer();
    setIndex(nextIndex);
    writePair(null);
    setAxis(null);
    if (incomingHeight > 0) {
      setStageHeight(incomingHeight);
      return;
    }
    const estimated = estimateHeight(nextIndex);
    if (estimated > 0) setStageHeight(estimated);
  }

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
    lockStageHeight(to, paintedFrameHeight(to));
    if (overlayMotionReduced()) {
      pendingToRef.current = null;
      pendingDragRef.current = null;
      setIndex(to);
      writePair(null);
      requestAnimationFrame(() => settleStageHeight(to));
      return;
    }
    pendingToRef.current = to;
    writePair({ from, to, direction, mode: "pending", dx: 0 });
    requestAnimationFrame(() => {
      lockStageHeight(to, paintedFrameHeight(to));
      startSettle({ from, to, direction, mode: "snap", dx: 0 });
    });
  }

  function applyDrag(to: number, direction: 1 | -1, dx: number) {
    lockStageHeight(to, paintedFrameHeight(to));
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
    const dx = clampDragDx(
      rawDx,
      direction,
      stageRef.current?.clientWidth ?? 0,
    );
    pendingToRef.current = to;
    pendingDragRef.current = { to, direction, dx, commit: false };
    if (overlayMotionReduced()) return;
    clearReadyWait();
    cancelReadyRef.current = waitForImageReady(
      frameImage(frameEl(to)),
      onIncomingReadyForDrag,
    );
  }

  function moveHorizontalDrag(rawDx: number) {
    const direction: 1 | -1 =
      rawDx === 0 ? (pairRef.current?.direction ?? 1) : rawDx < 0 ? 1 : -1;
    const to = wrapIndex(index + direction, photos.length);
    const dx = clampDragDx(
      rawDx,
      direction,
      stageRef.current?.clientWidth ?? 0,
    );
    if (pointerRef.current) pointerRef.current.dx = dx;
    const pending = pendingDragRef.current;
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
      cancelReadyRef.current = waitForImageReady(
        frameImage(frameEl(to)),
        onIncomingReadyForDrag,
      );
      return;
    }
    if (!pending) {
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
      if (Math.abs(rawDx) < axisLockPx && Math.abs(rawDy) < axisLockPx) {
        return;
      }
      if (Math.abs(rawDy) >= Math.abs(rawDx)) {
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
    if (commit || Math.abs(dx) > axisLockPx) {
      event.preventDefault();
      suppressClickRef.current = true;
    }
    if (overlayMotionReduced()) {
      pendingDragRef.current = null;
      if (!commit) {
        pendingToRef.current = null;
        return;
      }
      const direction: 1 | -1 = dx < 0 ? 1 : -1;
      const to = wrapIndex(index + direction, photos.length);
      clearReadyWait();
      cancelReadyRef.current = waitForImageReady(frameImage(frameEl(to)), () =>
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

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const reserved = new Set(pair ? [pair.from, pair.to] : [index]);
  const parkedIndexes = albumIndexes(photos.length).filter(
    (photoIndex) => !reserved.has(photoIndex),
  );
  const stageStyle: CSSProperties | undefined =
    stageHeight == null ? undefined : { height: stageHeight };
  const trackStyle: CSSProperties | undefined = pair
    ? { transform: pairTransform(pair) }
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
        {images[photoIndex]}
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
      className={`photo-card-pager${photos.length > 1 ? " has-album" : ""}${
        axis === "x" ? " is-axis-x" : ""
      }`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
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
      onClickCapture={onClickCapture}
    >
      <PhotoLightboxTrigger
        src={current.src}
        alt={current.alt}
        width={current.width}
        height={current.height}
        photos={photos}
        index={index}
        reactionTargetId={moment.id}
      >
        {photos.length < 2 ? (
          (images[0] ?? null)
        ) : (
          <div
            ref={stageRef}
            className="photo-card-pager-stage"
            style={stageStyle}
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
      </PhotoLightboxTrigger>
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
