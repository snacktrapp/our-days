"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  peekIndependentOverlayObjectUrl,
  prefetchIndependentOverlayObjectUrl,
} from "@/components/independent-overlay-photo";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";

const motionMs = 180;
const dismissDistanceRatio = 0.2;
const flickVelocity = 0.65;

type Box = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type PhotoLightboxRequest = Readonly<{
  src: string;
  alt: string;
  origin: Box;
  trigger: HTMLElement;
  width?: number;
  height?: number;
}>;

type PhotoMotion = "opening" | "open" | "pulling" | "snap-back" | "swipe-out";

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

function boxFromRect(rect: DOMRect | Box): Box {
  return {
    left: rect.left,
    top: rect.top,
    width: Math.max(rect.width, 1),
    height: Math.max(rect.height, 1),
  };
}

export function destinationBox(
  width: number,
  height: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
): Box {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const scale = Math.min(
    viewportWidth / safeWidth,
    viewportHeight / safeHeight,
  );
  const destWidth = safeWidth * scale;
  const destHeight = safeHeight * scale;
  return {
    left: (viewportWidth - destWidth) / 2,
    top: (viewportHeight - destHeight) / 2,
    width: destWidth,
    height: destHeight,
  };
}

export function invertTransform(origin: Box, dest: Box) {
  const originX = origin.left + origin.width / 2;
  const originY = origin.top + origin.height / 2;
  const destX = dest.left + dest.width / 2;
  const destY = dest.top + dest.height / 2;
  return `translate3d(${originX - destX}px, ${originY - destY}px, 0) scale(${
    origin.width / dest.width
  }, ${origin.height / dest.height})`;
}

function pullTranslate(distance: number) {
  return `translate3d(0, ${distance}px, 0)`;
}

function measureTrigger(trigger: HTMLElement): Box {
  return boxFromRect(trigger.getBoundingClientRect());
}

export function PhotoLightboxTrigger({
  src,
  alt,
  width,
  height,
  reactionTargetId,
  children,
}: Readonly<{
  src: string;
  alt: string;
  width?: number;
  height?: number;
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
      requestPhotoLightbox({
        src,
        alt,
        origin: measureTrigger(trigger),
        trigger,
        width,
        height,
      });
    },
  });

  useEffect(() => {
    void prefetchIndependentOverlayObjectUrl(src);
  }, [src]);

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

function PhotoLightboxLayer({
  request,
  onClosed,
}: Readonly<{
  request: PhotoLightboxRequest;
  onClosed: () => void;
}>) {
  const [objectUrl, setObjectUrl] = useState(() =>
    peekIndependentOverlayObjectUrl(request.src),
  );
  const [zoomed, setZoomed] = useState(false);
  const [motion, setMotion] = useState<PhotoMotion>("opening");
  const photoRef = useRef<HTMLDivElement>(null);
  const dimmerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const openedRef = useRef(false);
  const pullRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    distance: number;
  } | null>(null);
  const titleId = useId();
  const dest = destinationBox(request.width ?? 1200, request.height ?? 801);

  useEffect(() => {
    let cancelled = false;
    void prefetchIndependentOverlayObjectUrl(request.src).then((next) => {
      if (!cancelled && next) setObjectUrl(next);
    });
    return () => {
      cancelled = true;
    };
  }, [request.src]);

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

  function setPhotoLayer(transform: string, transition: string) {
    const photo = photoRef.current;
    if (!photo) return;
    photo.style.transition = transition;
    photo.style.transform = transform;
  }

  function teardown() {
    clearCloseTimer();
    openedRef.current = false;
    pullRef.current = null;
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

  function reverseToCard() {
    if (overlayMotionReduced()) {
      teardown();
      return;
    }
    const origin = measureTrigger(request.trigger);
    setMotion("swipe-out");
    setPhotoLayer(
      invertTransform(origin, dest),
      `transform ${motionMs}ms ease-in`,
    );
    setDimmer("0", `opacity ${motionMs}ms ease-in`);
    clearCloseTimer();
    closeTimerRef.current = window.setTimeout(teardown, motionMs);
  }

  function close() {
    if (motion === "swipe-out") return;
    reverseToCard();
  }

  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useLayoutEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    const origin = request.origin;
    if (overlayMotionReduced()) {
      setDimmer("1", "none");
      setPhotoLayer("", "none");
      window.requestAnimationFrame(() => setMotion("open"));
      return;
    }
    setPhotoLayer(invertTransform(origin, dest), "none");
    setDimmer("0", "none");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setPhotoLayer("", `transform ${motionMs}ms ease-out`);
        setDimmer("1", `opacity ${motionMs}ms ease-out`);
        window.setTimeout(() => setMotion("open"), motionMs);
      });
    });
  }, [dest, request.origin]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearCloseTimer();
    };
  }, []);

  function startPull(event: React.PointerEvent<HTMLDivElement>) {
    if (zoomed || event.pointerType === "mouse") return;
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
    setPhotoLayer(pullTranslate(deltaY), "none");
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
        setPhotoLayer("", `transform ${motionMs}ms ease-out`);
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
      setPhotoLayer("", `transform ${motionMs}ms ease-out`);
      setDimmer("1", `opacity ${motionMs}ms ease-out`);
      clearCloseTimer();
      closeTimerRef.current = window.setTimeout(
        () => setMotion("open"),
        motionMs,
      );
      return;
    }

    reverseToCard();
  }

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

  return (
    <div
      className="photo-lightbox"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-motion={motion}
      onKeyDown={onLayerKeyDown}
    >
      <div ref={dimmerRef} className="photo-lightbox-dimmer" />
      <h2 id={titleId} className="sr-only">
        Full-screen photo: {request.alt}
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
        ref={photoRef}
        className={`photo-lightbox-photo ${zoomed ? "is-zoomed" : ""} ${
          motion === "pulling" ? "is-pulling" : ""
        }`}
        style={{
          left: dest.left,
          top: dest.top,
          width: dest.width,
          height: dest.height,
        }}
        onDoubleClick={() => setZoomed((current) => !current)}
        onPointerDown={startPull}
        onPointerMove={movePull}
        onPointerUp={finishPull}
        onPointerCancel={finishPull}
      >
        {objectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={objectUrl} alt={request.alt} />
        ) : null}
      </div>
    </div>
  );
}

export function PhotoLightboxHost() {
  const request = usePhotoLightboxSession();
  const close = useCallback(() => {
    publish(null);
  }, []);

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
