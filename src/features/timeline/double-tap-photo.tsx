"use client";

import { useRef, useState, type ReactNode } from "react";
import { dispatchMomentHeart } from "./double-tap-heart";
import { HeartGlyph } from "./heart-glyph";

// Pointer distance and cancellation keep carousel swipes and scrolling from
// counting as taps. No single-tap action, fullscreen, or delayed media controls.
export function DoubleTapPhoto({
  momentId,
  children,
}: Readonly<{ momentId: string; children: ReactNode }>) {
  const start = useRef<{
    id: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const [burst, setBurst] = useState<{
    generation: number;
    x: number;
    y: number;
  } | null>(null);
  return (
    <div
      className="double-tap-photo"
      onPointerDownCapture={(event) => {
        if (!event.isPrimary || event.button !== 0) {
          start.current = null;
          lastTap.current = null;
          return;
        }
        start.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          moved: false,
        };
      }}
      onPointerMoveCapture={(event) => {
        const current = start.current;
        if (
          current &&
          Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10
        )
          current.moved = true;
      }}
      onPointerCancelCapture={() => {
        start.current = null;
        lastTap.current = null;
      }}
      onPointerUpCapture={(event) => {
        const current = start.current;
        start.current = null;
        if (
          !current ||
          current.id !== event.pointerId ||
          current.moved ||
          Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10
        ) {
          lastTap.current = null;
          return;
        }
        const previous = lastTap.current;
        const now = performance.now();
        if (
          previous &&
          now - previous.time < 300 &&
          Math.hypot(previous.x - event.clientX, previous.y - event.clientY) <
            32
        ) {
          lastTap.current = null;
          if (!dispatchMomentHeart(momentId)) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          setBurst({
            generation: now,
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          });
        } else
          lastTap.current = { time: now, x: event.clientX, y: event.clientY };
      }}
    >
      {children}
      {burst ? (
        <span
          key={burst.generation}
          className="post-love-burst"
          style={{ left: burst.x, top: burst.y }}
          onAnimationEnd={() => setBurst(null)}
        >
          <HeartGlyph filled />
        </span>
      ) : null}
    </div>
  );
}
