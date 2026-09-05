"use client";

import {
  useCallback,
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
import { createPortal } from "react-dom";
import {
  peekIndependentOverlayObjectUrl,
  prefetchIndependentOverlayObjectUrl,
} from "@/components/independent-overlay-photo";
import {
  lockOverlayChrome,
  unlockOverlayChrome,
} from "@/features/shell/overlay-chrome";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";
import {
  axisLockPx,
  clampDragDx,
  mountedAlbumIndexes,
  pairTransform,
  slideMs,
  swipeThreshold,
  waitForFrameReady,
  wrapIndex,
  type AlbumPair,
} from "./photo-album-gesture";

const motionMs = 180;

type Box = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type PhotoLightboxPhoto = Readonly<{
  src: string;
  alt: string;
  width?: number;
  height?: number;
}>;

export type PhotoLightboxRequest = Readonly<{
  src: string;
  alt: string;
  origin: Box;
  trigger: HTMLElement;
  width?: number;
  height?: number;
  photos?: readonly PhotoLightboxPhoto[];
  index?: number;
}>;

type PhotoMotion = "opening" | "open" | "closing";

let session: PhotoLightboxRequest | null = null;
const listeners = new Set<(next: PhotoLightboxRequest | null) => void>();

function publish(next: PhotoLightboxRequest | null) {
  session = next;
  listeners.forEach((listen) => listen(next));
}

export function requestPhotoLightbox(next: PhotoLightboxRequest) {
  publish(next);
}

export function readPhotoLightboxSession() {
  return session;
}

export function resetPhotoLightboxSession() {
  publish(null);
}

function usePhotoLightboxSession() {
  const [current, setCurrent] = useState<PhotoLightboxRequest | null>(
    () => session,
  );
  useEffect(() => {
    listeners.add(setCurrent);
    return () => {
      listeners.delete(setCurrent);
    };
  }, []);
  return current;
}

export function PhotoLightboxTrigger({
  src,
  alt,
  width,
  height,
  photos,
  index = 0,
  reactionTargetId,
  children,
}: Readonly<{
  src: string;
  alt: string;
  width?: number;
  height?: number;
  photos?: readonly PhotoLightboxPhoto[];
  index?: number;
  reactionTargetId?: string;
  children: ReactNode;
}>) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const handleTap = usePairedTap({
    enabled: Boolean(reactionTargetId),
    onDoubleTap: () => {
      if (reactionTargetId) dispatchMomentHeart(reactionTargetId);
    },
    onSingleTap: () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      requestPhotoLightbox({
        src,
        alt,
        origin: {
          left: rect.left,
          top: rect.top,
          width: Math.max(rect.width, 1),
          height: Math.max(rect.height, 1),
        },
        trigger,
        width,
        height,
        photos,
        index,
      });
    },
  });

  useEffect(() => {
    void prefetchIndependentOverlayObjectUrl(src);
    for (const photo of photos ?? []) {
      if (photo.src !== src)
        void prefetchIndependentOverlayObjectUrl(photo.src);
    }
  }, [photos, src]);

  return (
    <button
      ref={triggerRef}
      type="button"
      className="media-viewer-trigger photo-viewer-trigger"
      aria-label={`Open photo full screen: ${alt}`}
      onClick={(event) => handleTap(event.detail)}
    >
      {children}
    </button>
  );
}

function PhotoLightboxFrame({
  photo,
  photoIndex,
  role,
  zoomed,
  onReady,
  onToggleZoom,
}: Readonly<{
  photo: PhotoLightboxPhoto;
  photoIndex: number;
  role: "outgoing" | "incoming" | "parked";
  zoomed: boolean;
  onReady?: () => void;
  onToggleZoom?: () => void;
}>) {
  const objectUrl = peekIndependentOverlayObjectUrl(photo.src);
  return (
    <div
      data-photo-index={photoIndex}
      className={
        role === "parked"
          ? "photo-lightbox-frame is-parked"
          : role === "incoming"
            ? "photo-lightbox-frame is-incoming"
            : "photo-lightbox-frame is-outgoing"
      }
      aria-hidden={role === "parked" ? true : undefined}
    >
      {objectUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className={`photo-lightbox-photo${zoomed ? " is-zoomed" : ""}`}
          src={objectUrl}
          alt={photo.alt}
          onLoad={onReady}
          onError={onReady}
          onDoubleClick={role === "parked" ? undefined : onToggleZoom}
        />
      ) : null}
    </div>
  );
}

function PhotoLightboxLayer({
  request,
  onClosed,
}: Readonly<{
  request: PhotoLightboxRequest;
  onClosed: () => void;
}>) {
  const album = request.photos?.length
    ? request.photos
    : [
        {
          src: request.src,
          alt: request.alt,
          width: request.width,
          height: request.height,
        },
      ];
  const [index, setIndex] = useState(() => {
    const start = request.index ?? 0;
    return start >= 0 && start < album.length ? start : 0;
  });
  const current = album[index] ?? album[0]!;
  const [, setObjectUrlVersion] = useState(0);
  const objectUrl = peekIndependentOverlayObjectUrl(current.src);
  const [zoomed, setZoomed] = useState(false);
  const [motion, setMotion] = useState<PhotoMotion>("opening");
  const [pair, setPair] = useState<AlbumPair | null>(null);
  const [axis, setAxis] = useState<"x" | "y" | null>(null);
  const closeTimerRef = useRef<number | null>(null);
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
  const titleId = useId();
  const displayIndex = pair?.mode === "snap" ? pair.to : index;

  function writePair(next: AlbumPair | null) {
    pairRef.current = next;
    setPair(next);
  }

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
    setIndex(nextIndex);
    writePair(null);
    setAxis(null);
  }

  function startSettle(next: AlbumPair) {
    pendingToRef.current = next.mode === "snap" ? next.to : next.from;
    writePair(next);
    clearFinishTimer();
    finishTimerRef.current = window.setTimeout(finishPair, slideMs + 40);
  }

  function startSnap(from: number, to: number, direction: 1 | -1) {
    setZoomed(false);
    if (overlayMotionReduced()) {
      pendingToRef.current = null;
      pendingDragRef.current = null;
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
    const to = wrapIndex(index + direction, album.length);
    const dx = clampDragDx(
      rawDx,
      direction,
      stageRef.current?.clientWidth ?? 0,
    );
    pendingToRef.current = to;
    pendingDragRef.current = { to, direction, dx, commit: false };
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
    const to = wrapIndex(index + direction, album.length);
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
      cancelReadyRef.current = waitForFrameReady(
        frameEl(to),
        onIncomingReadyForDrag,
      );
      return;
    }
    if (!pending) {
      beginHorizontalDrag(rawDx);
    }
  }

  function cancelHorizontalDrag() {
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
  }

  function onTrackTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName && event.propertyName !== "transform") return;
    finishPair();
  }

  function pagingAllowed() {
    return (
      album.length >= 2 &&
      motion === "open" &&
      !zoomed &&
      !pair &&
      !pointerRef.current
    );
  }

  function goTo(next: number) {
    if (!pagingAllowed()) return;
    const to = wrapIndex(next, album.length);
    if (to === index) return;
    const direction: 1 | -1 = next < index || next < 0 ? -1 : 1;
    clearReadyWait();
    cancelReadyRef.current = waitForFrameReady(frameEl(to), () => {
      startSnap(index, to, direction);
    });
  }

  const goToRef = useRef(goTo);
  useEffect(() => {
    goToRef.current = goTo;
  });

  useEffect(() => {
    let cancelled = false;
    const photos = request.photos?.length
      ? request.photos
      : [{ src: request.src }];
    for (const photo of photos) {
      void prefetchIndependentOverlayObjectUrl(photo.src).then((next) => {
        if (!cancelled && next) setObjectUrlVersion((version) => version + 1);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(
    () => () => {
      clearFinishTimer();
      clearReadyWait();
    },
    [],
  );

  function clearCloseTimer() {
    if (closeTimerRef.current == null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function teardown() {
    clearCloseTimer();
    onClosed();
    document.getElementById("journal-focus-target")?.blur();
    if (document.activeElement instanceof HTMLElement) {
      const active = document.activeElement;
      if (
        active.closest(".topbar") ||
        active.classList.contains("photo-lightbox-close")
      ) {
        active.blur();
      }
    }
  }

  function close() {
    if (motion === "closing") return;
    if (overlayMotionReduced()) {
      teardown();
      return;
    }
    setMotion("closing");
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(teardown, motionMs);
  }

  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  function revealPhoto() {
    setMotion((currentMotion) =>
      currentMotion === "opening" ? "open" : currentMotion,
    );
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (zoomed) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goToRef.current(index + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToRef.current(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearCloseTimer();
    };
  }, [index, zoomed]);

  function onLayerKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const root = event.currentTarget;
    const controls = [
      ...root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((control) => control.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (pointerRef.current && pointerRef.current.id !== event.pointerId) {
      cancelHorizontalDrag();
      return;
    }
    if (
      album.length < 2 ||
      zoomed ||
      motion !== "open" ||
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
    if (!start || start.id !== event.pointerId || zoomed) return;
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
    if (
      !start ||
      start.id !== event.pointerId ||
      start.axis !== "x" ||
      zoomed
    ) {
      pendingDragRef.current = null;
      if (!pair) pendingToRef.current = null;
      return;
    }
    const rawDx = event.clientX - start.x;
    const currentPair = pairRef.current;
    const pending = pendingDragRef.current;
    const dx = currentPair?.dx ?? pending?.dx ?? rawDx;
    const commit = Math.abs(dx) >= swipeThreshold;
    if (overlayMotionReduced()) {
      pendingDragRef.current = null;
      if (!commit) {
        pendingToRef.current = null;
        return;
      }
      const direction: 1 | -1 = dx < 0 ? 1 : -1;
      const to = wrapIndex(index + direction, album.length);
      clearReadyWait();
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
  const mounted = mountedAlbumIndexes(index, album.length);
  const parkedIndexes = mounted.filter(
    (photoIndex) => !reserved.has(photoIndex),
  );
  const trackStyle: CSSProperties | undefined = pair
    ? { transform: pairTransform(pair) }
    : undefined;

  function renderFrame(
    photoIndex: number,
    role: "outgoing" | "incoming" | "parked",
  ) {
    const photo = album[photoIndex];
    if (!photo) return null;
    return (
      <PhotoLightboxFrame
        key={`photo-${photoIndex}`}
        photo={photo}
        photoIndex={photoIndex}
        role={role}
        zoomed={role === "outgoing" && zoomed && !pair}
        onReady={role === "outgoing" && !pair ? revealPhoto : undefined}
        onToggleZoom={
          role === "parked"
            ? undefined
            : () => setZoomed((currentZoom) => !currentZoom)
        }
      />
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

  if (!objectUrl) return null;

  return (
    <div
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-motion={motion}
      onKeyDown={onLayerKeyDown}
    >
      <div className="photo-lightbox-dimmer" />
      <h2 id={titleId} className="sr-only">
        Full-screen photo: {current.alt}
      </h2>
      <button
        type="button"
        className="photo-lightbox-close media-viewer-close"
        aria-label="Close full-screen media"
        onClick={close}
      >
        ×
      </button>
      <div
        ref={stageRef}
        className={`photo-lightbox-stage${album.length > 1 ? " has-album" : ""}${
          axis === "x" ? " is-axis-x" : ""
        }${zoomed ? " is-zoomed" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={cancelHorizontalDrag}
      >
        {album.length < 2 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={`photo-lightbox-photo ${zoomed ? "is-zoomed" : ""}`}
            src={objectUrl}
            alt={current.alt}
            onLoad={revealPhoto}
            onError={revealPhoto}
            onDoubleClick={() => setZoomed((currentZoom) => !currentZoom)}
          />
        ) : (
          <div
            className={`photo-lightbox-track${pair ? " is-paired" : ""}${
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
        )}
      </div>
      {album.length > 1 ? (
        <p className="sr-only" aria-live="polite">
          Photo {displayIndex + 1} of {album.length}
        </p>
      ) : null}
    </div>
  );
}

export function PhotoLightboxHost() {
  const request = usePhotoLightboxSession();
  const close = useCallback(() => {
    publish(null);
  }, []);

  const overlayOpen = request != null;
  useLayoutEffect(() => {
    if (!overlayOpen) {
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.classList.add("overlay-open");
    document.body.classList.add("overlay-open");
    lockOverlayChrome();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.documentElement.classList.remove("overlay-open");
      document.body.classList.remove("overlay-open");
      unlockOverlayChrome();
    };
  }, [overlayOpen]);

  if (!request || typeof document === "undefined") return null;

  return createPortal(
    <PhotoLightboxLayer request={request} onClosed={close} />,
    document.body,
  );
}

export function PhotoLightboxRoot({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <PhotoLightboxHost />
    </>
  );
}
