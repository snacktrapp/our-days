"use client";

import {
  cloneElement,
  isValidElement,
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
import type { PhotoMomentViewModel } from "./timeline-view-model";
import { PhotoLightboxTrigger } from "./photo-lightbox";

const swipeThreshold = 36;
const slideMs = 200;

type Slide = Readonly<{
  from: number;
  to: number;
  direction: 1 | -1;
  phase: "pending" | "sliding";
}>;

function wrapIndex(next: number, length: number) {
  return (next + length) % length;
}

function neighborIndexes(index: number, length: number) {
  if (length < 2) return [];
  const prev = wrapIndex(index - 1, length);
  const next = wrapIndex(index + 1, length);
  return prev === next ? [next] : [prev, next];
}

function clonePrefetch(node: ReactNode, key: string) {
  if (!isValidElement(node)) return null;
  return cloneElement(node, { key });
}

export function PhotoCardPager({
  moment,
  images,
}: Readonly<{
  moment: PhotoMomentViewModel;
  images: readonly ReactNode[];
}>) {
  const photos = photoAlbum(moment);
  const [index, setIndex] = useState(0);
  const [slide, setSlide] = useState<Slide | null>(null);
  const [stageHeight, setStageHeight] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingToRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    swiped: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const current = photos[index] ??
    photos[0] ?? {
      id: moment.id,
      src: moment.image.src,
      alt: moment.image.alt,
      width: moment.image.width,
      height: moment.image.height,
    };
  const displayIndex = slide?.to ?? index;

  function clearFinishTimer() {
    if (finishTimerRef.current == null) return;
    window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = null;
  }

  function finishSlide() {
    const nextIndex = pendingToRef.current;
    if (nextIndex == null) return;
    pendingToRef.current = null;
    clearFinishTimer();
    setIndex(nextIndex);
    setSlide(null);
    setStageHeight(null);
  }

  useEffect(() => () => clearFinishTimer(), []);

  function lockStageHeight(incomingIndex: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const currentHeight = stage.offsetHeight;
    const width = stage.clientWidth;
    const incoming = photos[incomingIndex];
    const estimated =
      incoming?.width && incoming.height && width > 0
        ? width * (incoming.height / incoming.width)
        : 0;
    const nextHeight = Math.max(currentHeight, estimated);
    if (nextHeight > 0) setStageHeight(nextHeight);
  }

  function startSlideMotion(to: number) {
    setSlide((currentSlide) =>
      currentSlide && currentSlide.to === to && currentSlide.phase === "pending"
        ? { ...currentSlide, phase: "sliding" }
        : currentSlide,
    );
    clearFinishTimer();
    finishTimerRef.current = window.setTimeout(finishSlide, slideMs + 40);
  }

  function goTo(next: number) {
    if (photos.length < 2 || slide) return;
    const to = wrapIndex(next, photos.length);
    if (to === index) return;
    const direction: 1 | -1 = next < index || next < 0 ? -1 : 1;
    lockStageHeight(to);
    if (overlayMotionReduced()) {
      setIndex(to);
      requestAnimationFrame(() => setStageHeight(null));
      return;
    }
    pendingToRef.current = to;
    setSlide({ from: index, to, direction, phase: "pending" });
    requestAnimationFrame(() => startSlideMotion(to));
  }

  function onTrackTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName && event.propertyName !== "transform") return;
    finishSlide();
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      photos.length < 2 ||
      slide ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    pointerRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      swiped: false,
    };
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) > swipeThreshold && Math.abs(dx) > Math.abs(dy)) {
      start.swiped = true;
    }
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const start = pointerRef.current;
    pointerRef.current = null;
    if (!start || start.id !== event.pointerId || !start.swiped) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) < swipeThreshold) return;
    event.preventDefault();
    suppressClickRef.current = true;
    goTo(index + (dx < 0 ? 1 : -1));
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  const reserved = new Set(slide ? [slide.from, slide.to] : [index]);
  const prefetchIndexes = neighborIndexes(displayIndex, photos.length).filter(
    (photoIndex) => !reserved.has(photoIndex),
  );
  const stageStyle: CSSProperties | undefined =
    stageHeight == null ? undefined : { height: stageHeight };
  const outgoingImage = images[slide?.from ?? index] ?? images[0];
  const incomingImage = slide ? (images[slide.to] ?? images[0]) : null;
  const outgoingFrame = (
    <div
      key={`photo-${slide?.from ?? index}`}
      className="photo-card-pager-frame is-outgoing"
    >
      {outgoingImage}
    </div>
  );
  const incomingFrame = slide ? (
    <div
      key={`photo-${slide.to}`}
      className="photo-card-pager-frame is-incoming"
    >
      {incomingImage}
    </div>
  ) : null;
  const trackFrames =
    slide && incomingFrame
      ? slide.direction === 1
        ? [outgoingFrame, incomingFrame]
        : [incomingFrame, outgoingFrame]
      : [outgoingFrame];

  return (
    <div
      className={`photo-card-pager${photos.length > 1 ? " has-album" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        pointerRef.current = null;
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
              className={`photo-card-pager-track${slide ? " is-paired" : ""}${
                slide?.phase === "sliding" ? " is-sliding" : ""
              }`}
              data-direction={
                slide ? (slide.direction === 1 ? "next" : "prev") : undefined
              }
              data-phase={slide?.phase ?? "idle"}
              onTransitionEnd={onTrackTransitionEnd}
            >
              {trackFrames}
            </div>
            {prefetchIndexes.length > 0 ? (
              <div className="photo-card-pager-prefetch" aria-hidden="true">
                {prefetchIndexes.map((photoIndex) =>
                  clonePrefetch(
                    images[photoIndex],
                    `${moment.id}-prefetch-${photoIndex}`,
                  ),
                )}
              </div>
            ) : null}
          </div>
        )}
      </PhotoLightboxTrigger>
      {photos.length > 1 ? (
        <>
          <button
            type="button"
            className="photo-card-pager-arrow is-prev"
            aria-label="Previous photo"
            onClick={(event) => {
              event.stopPropagation();
              goTo(index - 1);
            }}
          >
            ‹
          </button>
          <button
            type="button"
            className="photo-card-pager-arrow is-next"
            aria-label="Next photo"
            onClick={(event) => {
              event.stopPropagation();
              goTo(index + 1);
            }}
          >
            ›
          </button>
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
