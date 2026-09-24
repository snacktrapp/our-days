"use client";

import { type ReactNode, useRef } from "react";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useVisualViewportFill } from "@/features/shell/use-visual-viewport-fill";

/** Uses the same native modal, scroll lock, and keyboard viewport as other sheets. */
export function CircleManagementSheet({
  children,
  labelledBy,
  title,
  onClose,
  busy = false,
}: {
  children: ReactNode;
  labelledBy: string;
  /** When set, this is the only sheet title and lives in the bar. */
  title?: string;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(true, ref);
  useVisualViewportFill(ref, true);
  function dismiss() {
    if (!busy) onClose();
  }
  return (
    <dialog
      ref={ref}
      className="composer-dialog circle-management-dialog"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
      onKeyDown={containDialogFocus}
      onClick={(event) => {
        if (event.target === event.currentTarget) dismiss();
      }}
    >
      <section className="circle-management-sheet">
        <div className="circle-management-sheet-bar">
          <span className="sheet-handle" aria-hidden="true" />
          {title ? (
            <h2 id={labelledBy} tabIndex={-1}>
              {title}
            </h2>
          ) : null}
          <button
            type="button"
            aria-label="Close management"
            disabled={busy}
            onClick={dismiss}
          >
            ×
          </button>
        </div>
        <div className="circle-management-sheet-body">{children}</div>
      </section>
    </dialog>
  );
}
