"use client";

import {
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { CspPublicImage } from "@/components/csp-image";
import { PrivatePhotoImage } from "@/components/private-photo-image";
import { photoAlbum } from "@/features/moments/moment-photos";
import type { PhotoMomentViewModel } from "./timeline-view-model";
import { PhotoLightboxTrigger } from "./photo-lightbox";

const swipeThreshold = 36;

export function PhotoCardPager({
  moment,
  preload = false,
}: Readonly<{
  moment: PhotoMomentViewModel;
  preload?: boolean;
}>) {
  const photos = photoAlbum(moment);
  const [index, setIndex] = useState(0);
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    swiped: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const current = photos[index] ?? photos[0] ?? {
    id: moment.id,
    src: moment.image.src,
    alt: moment.image.alt,
    width: moment.image.width,
    height: moment.image.height,
  };

  function goTo(next: number) {
    if (photos.length < 2) return;
    setIndex((next + photos.length) % photos.length);
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (photos.length < 2 || event.pointerType === "mouse" && event.button !== 0) {
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
        {moment.image.delivery === "private" ? (
          <PrivatePhotoImage
            src={current.src}
            alt={current.alt}
            width={current.width}
            height={current.height}
            highPriority={preload}
          />
        ) : (
          <CspPublicImage
            src={current.src}
            alt={current.alt}
            width={current.width ?? 1200}
            height={current.height ?? 801}
            highPriority={preload}
            sizes="(max-width: 520px) 92vw, 410px"
          />
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
                className={photoIndex === index ? "is-current" : undefined}
              />
            ))}
          </div>
          <p className="sr-only" aria-live="polite">
            Photo {index + 1} of {photos.length}
          </p>
        </>
      ) : null}
    </div>
  );
}
