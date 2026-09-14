"use client";

import { useLayoutEffect, type RefObject } from "react";
import { subscribeVisualViewportFill } from "./visual-viewport-fill";

export function useVisualViewportFill(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useLayoutEffect(() => {
    if (!active) return;
    return subscribeVisualViewportFill(ref.current);
  }, [active, ref]);
}
