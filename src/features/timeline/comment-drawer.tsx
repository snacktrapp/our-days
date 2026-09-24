"use client";

import { useCallback, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import {
  lockOverlayChrome,
  unlockOverlayChrome,
} from "@/features/shell/overlay-chrome";
import {
  sheetCloseMs,
  useOverlayPopoverClose,
} from "@/features/shell/use-overlay-popover-close";
import { useSheetDismiss } from "@/features/shell/use-sheet-dismiss";
import { useVisualViewportFill } from "@/features/shell/use-visual-viewport-fill";

export function CommentDrawer({
  id,
  title,
  context,
  pending,
  confirmDiscard,
  onDismiss,
  children,
}: {
  id: string;
  title: string;
  context: string;
  pending: boolean;
  confirmDiscard?: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { closing, requestClose, onAnimationEnd } = useOverlayPopoverClose(
    "sheet-down",
    sheetCloseMs,
  );
  const dismiss = useCallback(() => {
    if (pending) return;
    if (confirmDiscard && !window.confirm(confirmDiscard)) {
      const sheet = sheetRef.current;
      sheet?.style.removeProperty("--activity-sheet-drag");
      sheet?.classList.remove("is-dragging");
      return;
    }
    requestClose(onDismiss);
  }, [confirmDiscard, pending, requestClose, onDismiss]);
  const gesture = useSheetDismiss({
    onDismiss: dismiss,
    scrollerRef,
    sheetRef,
  });
  useModalDialog(true, dialogRef);
  useVisualViewportFill(dialogRef, true);
  useLayoutEffect(() => {
    lockOverlayChrome();
    const dialog = dialogRef.current;
    const syncKeyboard = () => {
      const viewport = window.visualViewport;
      const inset = viewport
        ? window.innerHeight - viewport.height - viewport.offsetTop
        : 0;
      dialog?.classList.toggle("is-keyboard-open", inset > 80);
    };
    syncKeyboard();
    window.visualViewport?.addEventListener("resize", syncKeyboard);
    window.visualViewport?.addEventListener("scroll", syncKeyboard);
    return () => {
      window.visualViewport?.removeEventListener("resize", syncKeyboard);
      window.visualViewport?.removeEventListener("scroll", syncKeyboard);
      unlockOverlayChrome();
    };
  }, []);

  return createPortal(
    <dialog
      ref={dialogRef}
      id={id}
      className="composer-dialog activity-dialog comment-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-context`}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          dismiss();
        } else containDialogFocus(event);
      }}
    >
      <section
        ref={sheetRef}
        className={`composer-sheet activity-sheet comment-sheet${closing ? " is-closing" : ""}`}
        onAnimationEnd={onAnimationEnd}
        {...(pending ? {} : gesture)}
      >
        <div className="activity-sheet-chrome">
          <span className="sheet-handle" aria-hidden="true" />
          <header className="activity-sheet-bar">
            <h2 id={`${id}-title`}>{title}</h2>
          </header>
        </div>
        <div ref={scrollerRef} className="comment-sheet-body">
          <p id={`${id}-context`} className="comment-sheet-context">
            {context}
          </p>
          {children}
        </div>
      </section>
    </dialog>,
    document.body,
  );
}
