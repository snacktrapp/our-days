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

export const restTransform = "translate3d(0, 0, 0) scale(1)";
export const safariChromeBottomReserve = 56;

function parsePx(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function readCssPx(name: string): number {
  if (typeof document === "undefined") return 0;
  return parsePx(
    getComputedStyle(document.documentElement).getPropertyValue(name),
  );
}

function readSafeAreaInsets() {
  const fromVars = {
    top: readCssPx("--safe-area-inset-top"),
    right: readCssPx("--safe-area-inset-right"),
    bottom: readCssPx("--safe-area-inset-bottom"),
    left: readCssPx("--safe-area-inset-left"),
  };
  if (typeof document === "undefined") return fromVars;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);visibility:hidden;pointer-events:none";
  document.documentElement.append(probe);
  const style = getComputedStyle(probe);
  const fromEnv = {
    top: parsePx(style.paddingTop),
    right: parsePx(style.paddingRight),
    bottom: parsePx(style.paddingBottom),
    left: parsePx(style.paddingLeft),
  };
  probe.remove();
  return {
    top: Math.max(fromVars.top, fromEnv.top),
    right: Math.max(fromVars.right, fromEnv.right),
    bottom: Math.max(fromVars.bottom, fromEnv.bottom),
    left: Math.max(fromVars.left, fromEnv.left),
  };
}

function smallestPositive(values: readonly (number | null | undefined)[]) {
  const usable = values.filter(
    (value): value is number => typeof value === "number" && value > 1,
  );
  return usable.length > 0 ? Math.min(...usable) : 1;
}

export function visiblePhotoViewport(): Box {
  const insets = readSafeAreaInsets();
  const visual = typeof window !== "undefined" ? window.visualViewport : null;
  const width = smallestPositive([visual?.width, window.innerWidth]);
  const height = smallestPositive([visual?.height, window.innerHeight]);
  const reportedChromeBottom = Math.max(
    0,
    window.innerHeight - height - (visual?.offsetTop ?? 0),
  );
  // iOS Safari's floating URL pill overlays the visual viewport and is not
  // included in env(safe-area-inset-bottom). Reserve space only when that
  // chrome is not already reported as a visualViewport gap.
  const bottomInset =
    reportedChromeBottom > 1
      ? insets.bottom
      : insets.bottom + safariChromeBottomReserve;
  return {
    left: insets.left,
    top: insets.top,
    width: Math.max(1, width - insets.left - insets.right),
    height: Math.max(1, height - insets.top - bottomInset),
  };
}

export function destinationBox(
  width: number,
  height: number,
  viewport: Box = visiblePhotoViewport(),
): Box {
  const safeWidth = Math.max(width, 1);
  const safeHeight = Math.max(height, 1);
  const scale = Math.min(
    viewport.width / safeWidth,
    viewport.height / safeHeight,
  );
  const destWidth = safeWidth * scale;
  const destHeight = safeHeight * scale;
  return {
    left: viewport.left + (viewport.width - destWidth) / 2,
    top: viewport.top + (viewport.height - destHeight) / 2,
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
  const [stage, setStage] = useState(visiblePhotoViewport);
  const destRef = useRef<Box>(
    destinationBox(request.width ?? 1200, request.height ?? 801, stage),
  );

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
      invertTransform(origin, destRef.current),
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

  useEffect(() => {
    const updateStage = () => setStage(visiblePhotoViewport());
    window.addEventListener("resize", updateStage);
    const visual = window.visualViewport;
    visual?.addEventListener?.("resize", updateStage);
    return () => {
      window.removeEventListener("resize", updateStage);
      visual?.removeEventListener?.("resize", updateStage);
    };
  }, []);

  useLayoutEffect(() => {
    if (!objectUrl || openedRef.current) return;
    const photo = photoRef.current;
    const painted = photo?.getBoundingClientRect();
    destRef.current =
      painted && painted.width >= 2 && painted.height >= 2
        ? boxFromRect(painted)
        : destinationBox(request.width ?? 1200, request.height ?? 801, stage);
    openedRef.current = true;
    const origin = request.origin;
    if (overlayMotionReduced()) {
      setDimmer("1", "none");
      setPhotoLayer(restTransform, "none");
      window.requestAnimationFrame(() => setMotion("open"));
      return;
    }
    setPhotoLayer(invertTransform(origin, destRef.current), "none");
    setDimmer("0", "none");
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setPhotoLayer(restTransform, `transform ${motionMs}ms ease-out`);
        setDimmer("1", `opacity ${motionMs}ms ease-out`);
        window.setTimeout(() => setMotion("open"), motionMs);
      });
    });
  }, [objectUrl, request.origin, stage]);

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
        setPhotoLayer(restTransform, `transform ${motionMs}ms ease-out`);
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
      setPhotoLayer(restTransform, `transform ${motionMs}ms ease-out`);
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
        className="photo-lightbox-stage"
        style={{
          left: stage.left,
          top: stage.top,
          width: stage.width,
          height: stage.height,
        }}
      >
        <div
          ref={photoRef}
          className={`photo-lightbox-photo ${zoomed ? "is-zoomed" : ""} ${
            motion === "pulling" ? "is-pulling" : ""
          }`}
          onDoubleClick={() => setZoomed((current) => !current)}
          onPointerDown={startPull}
          onPointerMove={movePull}
          onPointerUp={finishPull}
          onPointerCancel={finishPull}
        >
          {objectUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={objectUrl}
              alt={request.alt}
              width={request.width}
              height={request.height}
              onLoad={() => {
                const painted = photoRef.current?.getBoundingClientRect();
                if (painted && painted.width >= 2 && painted.height >= 2) {
                  destRef.current = boxFromRect(painted);
                }
              }}
            />
          ) : null}
        </div>
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
