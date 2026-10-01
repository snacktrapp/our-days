"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
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
  clearAlbumFrameHeight,
  setAlbumFrameHeight,
} from "./album-frame-style";
import {
  albumFrameFit,
  albumGestureFrameHeight,
  albumIndexes,
  albumPhotoHeightRatio,
  albumSlideWidth,
  axisLockPx,
  clampDragDx,
  pairSlideTransform,
  slideMs,
  swipeThreshold,
  waitForFrameReady,
  wrapIndex,
  type AlbumPair,
} from "./photo-album-gesture";
import type { PhotoMomentViewModel } from "./timeline-view-model";

export function PhotoCardPager({
  moment,
  images,
}: Readonly<{
  moment: PhotoMomentViewModel;
  images: readonly ReactNode[];
}>) {
  const photos = photoAlbum(moment);
  const [index, setIndex] = useState(0);
  // Keep mounted images for the life of this card: revisiting a slide must not
  // revoke its blob URL and download it again. Empty frames cost no requests.
  const [requested, setRequested] = useState(() => new Set([0]));
  const [pair, setPair] = useState<AlbumPair | null>(null);
  const [axis, setAxis] = useState<"x" | "y" | null>(null);
  const [measured, setMeasured] = useState(
    () => new Map<number, { width: number; height: number }>(),
  );
  const frameKey = useId();
  const stageRef = useRef<HTMLDivElement>(null);
  const pagerRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(0);
  const frameReadyRef = useRef(false);
  const rememberRef = useRef<(img: HTMLImageElement) => void>(() => {});
  const publishFrameRef = useRef<
    (
      active: AlbumPair | null,
      settledIndex: number,
      instant: boolean,
    ) => boolean
  >(() => false);
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
    if (next?.mode === "drag") publishFrame(next, indexRef.current, true);
  }

  function readSlideWidth() {
    const next = albumSlideWidth(stageRef.current);
    if (next > 0) slideWidthRef.current = next;
    return slideWidthRef.current;
  }

  indexRef.current = index;

  function ratioAt(photoIndex: number) {
    const photo = photos[photoIndex];
    const stored = albumPhotoHeightRatio(photo?.width, photo?.height);
    if (stored != null) return stored;
    const seen = measured.get(photoIndex);
    const fromImage = albumPhotoHeightRatio(seen?.width, seen?.height);
    if (fromImage != null) return fromImage;
    const first = photos[0];
    const firstStored = albumPhotoHeightRatio(first?.width, first?.height);
    if (firstStored != null) return firstStored;
    const firstSeen = measured.get(0);
    const firstImage = albumPhotoHeightRatio(
      firstSeen?.width,
      firstSeen?.height,
    );
    if (firstImage != null) return firstImage;
    return 0.75;
  }

  function fitClass(photoIndex: number) {
    const photo = photos[photoIndex];
    const seen = measured.get(photoIndex);
    const width = photo?.width && photo.width > 0 ? photo.width : seen?.width;
    const height =
      photo?.height && photo.height > 0 ? photo.height : seen?.height;
    return albumFrameFit(width, height) === "cover" ? "is-cover" : "is-contain";
  }

  function publishFrame(
    active: AlbumPair | null,
    settledIndex: number,
    instant: boolean,
  ) {
    const width = readSlideWidth();
    const fromIndex = active?.from ?? settledIndex;
    const toIndex = active?.to ?? settledIndex;
    const height = albumGestureFrameHeight(
      width,
      ratioAt(fromIndex),
      ratioAt(toIndex),
      active?.mode ?? "idle",
      active?.dx ?? 0,
    );
    if (height <= 0) return false;
    setAlbumFrameHeight(document, frameKey, height);
    if (stageRef.current) {
      stageRef.current.dataset.frameHeight = height.toFixed(2);
    }
    const pager = pagerRef.current;
    if (pager) {
      if (instant || overlayMotionReduced())
        pager.dataset.heightInstant = "true";
      else delete pager.dataset.heightInstant;
    }
    return true;
  }

  publishFrameRef.current = publishFrame;

  function animateSettledFrame(next: AlbumPair) {
    if (overlayMotionReduced()) {
      publishFrame(next, indexRef.current, true);
      return;
    }
    if (pagerRef.current) delete pagerRef.current.dataset.heightInstant;
    requestAnimationFrame(() => {
      publishFrame(next, indexRef.current, false);
    });
  }

  function rememberImage(img: HTMLImageElement) {
    const host = img.closest("[data-photo-index]");
    const photoIndex = Number(host?.getAttribute("data-photo-index"));
    if (!Number.isInteger(photoIndex) || photoIndex < 0) return;
    const photo = photos[photoIndex];
    if (photo?.width && photo.height && photo.width > 0 && photo.height > 0) {
      return;
    }
    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    setMeasured((current) => {
      const previous = current.get(photoIndex);
      if (
        previous?.width === img.naturalWidth &&
        previous.height === img.naturalHeight
      ) {
        return current;
      }
      const next = new Map(current);
      next.set(photoIndex, {
        width: img.naturalWidth,
        height: img.naturalHeight,
      });
      return next;
    });
  }

  rememberRef.current = rememberImage;

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
    publishFrame(null, nextIndex, false);
  }

  useLayoutEffect(() => {
    if (photos.length < 2) return;
    const stage = stageRef.current;
    if (!stage) return;
    const update = () => {
      const width = albumSlideWidth(stage);
      if (width <= 0 || width === slideWidthRef.current) return;
      slideWidthRef.current = width;
      const active = pairRef.current;
      const dragging = active?.mode === "drag";
      const published = publishFrameRef.current(
        dragging ? active : null,
        indexRef.current,
        true,
      );
      if (published) {
        frameReadyRef.current = true;
        pagerRef.current?.setAttribute("data-frame-ready", "true");
      }
      if (dragging) return;
      requestAnimationFrame(() => {
        if (pairRef.current?.mode === "drag") return;
        if (overlayMotionReduced()) return;
        delete pagerRef.current?.dataset.heightInstant;
      });
    };
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [photos.length]);

  useLayoutEffect(() => {
    if (photos.length < 2) return;
    const stage = stageRef.current;
    stage?.querySelectorAll("img").forEach((node) => {
      if (node instanceof HTMLImageElement) rememberRef.current(node);
    });
    const active = pairRef.current;
    if (active?.mode === "drag") {
      publishFrameRef.current(active, indexRef.current, true);
      return;
    }
    if (active?.mode === "snap" || active?.mode === "spring") return;
    const firstPublish = !frameReadyRef.current;
    const published = publishFrameRef.current(
      null,
      indexRef.current,
      firstPublish,
    );
    if (!published) return;
    frameReadyRef.current = true;
    pagerRef.current?.setAttribute("data-frame-ready", "true");
    if (!firstPublish) return;
    requestAnimationFrame(() => {
      if (pairRef.current?.mode === "drag") return;
      if (overlayMotionReduced()) return;
      delete pagerRef.current?.dataset.heightInstant;
    });
  }, [measured, photos]);

  useEffect(
    () => () => {
      clearAlbumFrameHeight(document, frameKey);
    },
    [frameKey],
  );

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
    animateSettledFrame(next);
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
      publishFrame(null, to, true);
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
            ? `photo-card-pager-frame is-parked ${fitClass(photoIndex)}`
            : role === "incoming"
              ? `photo-card-pager-frame is-incoming ${fitClass(photoIndex)}`
              : `photo-card-pager-frame is-outgoing ${fitClass(photoIndex)}`
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
      ref={pagerRef}
      data-album={photos.length > 1 ? frameKey : undefined}
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
