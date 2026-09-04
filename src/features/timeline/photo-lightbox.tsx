"use client";

import {
  useCallback,
  useEffect,
  useId,
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

export type PhotoLightboxRequest = Readonly<{
  src: string;
  alt: string;
  origin: Box;
  trigger: HTMLElement;
  width?: number;
  height?: number;
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
  const closeTimerRef = useRef<number | null>(null);
  const titleId = useId();

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

  useEffect(() => {
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
  }, []);

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
      <div className="photo-lightbox-stage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className={`photo-lightbox-photo ${zoomed ? "is-zoomed" : ""}`}
          src={objectUrl}
          alt={request.alt}
          onLoad={revealPhoto}
          onError={revealPhoto}
          onDoubleClick={() => setZoomed((current) => !current)}
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
