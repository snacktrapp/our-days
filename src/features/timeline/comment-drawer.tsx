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
  formId,
  submitLabel,
  submitDisabled,
  onCancel,
  onDismiss,
  children,
}: {
  id: string;
  title: string;
  context: string;
  pending: boolean;
  formId?: string;
  submitLabel?: string;
  submitDisabled?: boolean;
  onCancel?: () => void;
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
    if (!pending) requestClose(onDismiss);
  }, [pending, requestClose, onDismiss]);
  const gesture = useSheetDismiss({
    onDismiss: dismiss,
    scrollerRef,
    sheetRef,
  });
  useModalDialog(true, dialogRef);
  useVisualViewportFill(dialogRef, true);
  useLayoutEffect(() => {
    lockOverlayChrome();
    return () => unlockOverlayChrome();
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
          <header
            className={`activity-sheet-bar${
              onCancel && formId && submitLabel ? " sheet-action-bar" : ""
            }`}
          >
            {onCancel && formId && submitLabel ? (
              <button
                className="sheet-header-action"
                type="button"
                disabled={pending}
                onClick={onCancel}
              >
                Cancel
              </button>
            ) : null}
            <h2 id={`${id}-title`}>{title}</h2>
            {onCancel && formId && submitLabel ? (
              <button
                className="sheet-header-action is-primary"
                type="submit"
                form={formId}
                disabled={pending || submitDisabled}
              >
                {submitLabel}
              </button>
            ) : null}
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
