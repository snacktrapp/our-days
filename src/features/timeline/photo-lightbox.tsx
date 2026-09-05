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
import {
  lockOverlayChrome,
  unlockOverlayChrome,
} from "@/features/shell/overlay-chrome";
import { overlayMotionReduced } from "@/features/shell/use-overlay-popover-close";
import {
  dispatchMomentHeart,
  usePairedTap,
} from "@/features/timeline/double-tap-heart";

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
  const closeTimerRef = useRef<number | null>(null);
  const swipeRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    let cancelled = false;
    void prefetchIndependentOverlayObjectUrl(current.src).then((next) => {
      if (!cancelled && next) setObjectUrlVersion((version) => version + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [current.src]);

  const goTo = useCallback(
    (next: number) => {
      if (album.length < 2) return;
      setZoomed(false);
      setIndex((next + album.length) % album.length);
    },
    [album.length],
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
    setMotion((current) => (current === "opening" ? "open" : current));
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
        goTo(index + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearCloseTimer();
    };
  }, [goTo, index, zoomed]);

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
      {album.length > 1 ? (
        <>
          <button
            type="button"
            className="photo-lightbox-nav is-prev"
            aria-label="Previous photo"
            onClick={() => goTo(index - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="photo-lightbox-nav is-next"
            aria-label="Next photo"
            onClick={() => goTo(index + 1)}
          >
            ›
          </button>
        </>
      ) : null}
      <div
        className="photo-lightbox-stage"
        onPointerDown={(event) => {
          if (zoomed || album.length < 2) return;
          swipeRef.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerUp={(event) => {
          const start = swipeRef.current;
          swipeRef.current = null;
          if (!start || start.id !== event.pointerId || zoomed) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
          goTo(index + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          swipeRef.current = null;
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={`photo-lightbox-photo ${zoomed ? "is-zoomed" : ""}`}
          src={objectUrl}
          alt={current.alt}
          onLoad={revealPhoto}
          onError={revealPhoto}
          onDoubleClick={() => setZoomed((currentZoom) => !currentZoom)}
        />
      </div>
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
