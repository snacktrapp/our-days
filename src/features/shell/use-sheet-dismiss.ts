"use client";

import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useRef,
} from "react";
import { overlayMotionReduced } from "./use-overlay-popover-close";

export const sheetDismissThresholdPx = 72;
export const sheetDismissAxisPx = 8;

export function canStartSheetDismiss(scrollTop: number, fromHandle: boolean) {
  return fromHandle || scrollTop <= 0;
}

export function sheetDismissShouldCommit(dy: number) {
  return dy >= sheetDismissThresholdPx;
}

export function useSheetDismiss({
  onDismiss,
  scrollerRef,
  sheetRef,
}: {
  onDismiss: () => void;
  scrollerRef: RefObject<HTMLElement | null>;
  sheetRef: RefObject<HTMLElement | null>;
}) {
  const pointerRef = useRef<{
    id: number;
    x: number;
    y: number;
    axis: "x" | "y" | null;
    fromHandle: boolean;
  } | null>(null);

  const clearDrag = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    sheet.style.removeProperty("--activity-sheet-drag");
    sheet.classList.remove("is-dragging");
  }, [sheetRef]);

  const writeDrag = useCallback(
    (dy: number) => {
      const sheet = sheetRef.current;
      if (!sheet) return;
      sheet.style.setProperty("--activity-sheet-drag", `${Math.max(0, dy)}px`);
      sheet.classList.add("is-dragging");
    },
    [sheetRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("button, input, textarea, select")) return;
      const fromHandle = Boolean(
        target.closest(".sheet-handle, .activity-sheet-bar"),
      );
      const scrollTop = scrollerRef.current?.scrollTop ?? 0;
      if (!canStartSheetDismiss(scrollTop, fromHandle)) return;
      pointerRef.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        axis: null,
        fromHandle,
      };
    },
    [scrollerRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = pointerRef.current;
      if (!start || start.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.axis == null) {
        if (
          Math.abs(dx) < sheetDismissAxisPx &&
          Math.abs(dy) < sheetDismissAxisPx
        ) {
          return;
        }
        start.axis = Math.abs(dy) >= Math.abs(dx) ? "y" : "x";
        if (start.axis !== "y" || dy <= 0) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* jsdom */
        }
      }
      if (start.axis !== "y" || dy <= 0) return;
      event.preventDefault();
      if (overlayMotionReduced()) return;
      writeDrag(dy);
    },
    [writeDrag],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const start = pointerRef.current;
      pointerRef.current = null;
      if (!start || start.id !== event.pointerId) return;
      const dy = event.clientY - start.y;
      const dragged = start.axis === "y" && dy > sheetDismissAxisPx;
      if (!dragged) {
        clearDrag();
        return;
      }
      event.preventDefault();
      if (!sheetDismissShouldCommit(dy)) {
        clearDrag();
        return;
      }
      // Keep the drag offset so close continues down from here. Clearing it
      // first snaps the sheet back up and retriggers sheet-up.
      if (overlayMotionReduced()) {
        clearDrag();
        onDismiss();
        return;
      }
      writeDrag(dy);
      onDismiss();
    },
    [clearDrag, onDismiss, writeDrag],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };
}
