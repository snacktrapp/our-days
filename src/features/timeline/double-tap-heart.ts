"use client";

import { useEffect, useRef } from "react";

export function dispatchMomentHeart(momentId: string) {
  document
    .getElementById(`moment-conversation-${momentId}`)
    ?.dispatchEvent(new Event("our-days:heart", { bubbles: false }));
}

export function usePairedTap({
  onDoubleTap,
  onSingleTap,
  delayMs = 240,
  enabled = true,
}: Readonly<{
  onDoubleTap: () => void;
  onSingleTap?: () => void;
  delayMs?: number;
  enabled?: boolean;
}>) {
  const timerRef = useRef<number | null>(null);
  const onDoubleTapRef = useRef(onDoubleTap);
  const onSingleTapRef = useRef(onSingleTap);
  onDoubleTapRef.current = onDoubleTap;
  onSingleTapRef.current = onSingleTap;

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

  return (detail: number) => {
    if (!enabled || detail === 0) {
      onSingleTapRef.current?.();
      return;
    }
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      onDoubleTapRef.current();
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      onSingleTapRef.current?.();
    }, delayMs);
  };
}
