"use client";

import { type ReactNode, useRef } from "react";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";

/** Uses the same native modal and scroll lock as the app's other sheets. */
export function CircleManagementSheet({
  children,
  labelledBy,
  onClose,
  busy = false,
}: {
  children: ReactNode;
  labelledBy: string;
  onClose: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalDialog(true, ref);
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
