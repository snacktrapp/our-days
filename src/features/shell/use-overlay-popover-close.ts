"use client";

import {
  type AnimationEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const overlayPopoverCloseMs = 140;

export function overlayMotionReduced() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useOverlayPopoverClose(
  options: Readonly<{
    animationName?: string;
    durationMs?: number;
  }> = {},
) {
  const animationName = options.animationName ?? "overlay-popover-out";
  const durationMs = options.durationMs ?? overlayPopoverCloseMs;
  const closingRef = useRef(false);
  const [closing, setClosing] = useState(false);
  const timerRef = useRef<number | null>(null);
  const commitRef = useRef<(() => void) | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const finish = useCallback(() => {
    clearTimer();
    const commit = commitRef.current;
    commitRef.current = null;
    closingRef.current = false;
    setClosing(false);
    commit?.();
  }, [clearTimer]);

  const cancel = useCallback(() => {
    if (!closingRef.current) return;
    clearTimer();
    commitRef.current = null;
    closingRef.current = false;
    setClosing(false);
  }, [clearTimer]);

  const requestClose = useCallback(
    (commit: () => void) => {
      if (overlayMotionReduced()) {
        cancel();
        commit();
        return;
      }
      if (closingRef.current) return;
      commitRef.current = commit;
      closingRef.current = true;
      setClosing(true);
      timerRef.current = window.setTimeout(finish, durationMs);
    },
    [cancel, durationMs, finish],
  );

  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.animationName !== animationName) return;
      finish();
    },
    [animationName, finish],
  );

  useEffect(() => () => clearTimer(), [clearTimer]);

  return {
    closing,
    closingRef,
    requestClose,
    cancel,
    onAnimationEnd,
  };
}
