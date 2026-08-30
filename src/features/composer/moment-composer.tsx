"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MomentKind } from "@/features/timeline/timeline-view-model";

type MomentComposerProps = Readonly<{
  open: boolean;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
}>;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function containDialogFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;

  const dialog = event.currentTarget;
  const controls = [
    ...dialog.querySelectorAll<HTMLElement>(focusableSelector),
  ].filter((control) => {
    const style = window.getComputedStyle(control);
    return (
      control.tabIndex >= 0 &&
      !control.matches(":disabled") &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.visibility !== "collapse" &&
      control.getClientRects().length > 0
    );
  });
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;

  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export function MomentComposer({
  open,
  returnFocusRef,
  onRequestClose,
}: MomentComposerProps) {
  const [mode, setMode] = useState<MomentKind | null>(null);
  const [draft, setDraft] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(
    (discardDraft = false) => {
      if (
        !discardDraft &&
        draft.trim() &&
        !window.confirm("Discard this unfinished moment?")
      ) {
        return;
      }

      setMode(null);
      setDraft("");
      onRequestClose();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    },
    [draft, onRequestClose, returnFocusRef],
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const bodyWasLocked = document.body.classList.contains(
      "composer-scroll-locked",
    );
    document.body.classList.add("composer-scroll-locked");
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() =>
      firstChoiceRef.current?.focus(),
    );

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (!bodyWasLocked)
        document.body.classList.remove("composer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      className="composer-dialog"
      aria-labelledby="composer-title"
      aria-describedby="composer-privacy"
      onKeyDown={containDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="composer-sheet">
        <span className="sheet-handle" aria-hidden="true" />
        <button
          className="sheet-close"
          aria-label="Close moment composer"
          onClick={() => close()}
        >
          ×
        </button>
        {!mode ? (
          <>
            <span id="composer-privacy" className="private-label">
              Only your family can see this
            </span>
            <h2 id="composer-title">What would you like to remember?</h2>
            <div className="moment-choices">
              <button ref={firstChoiceRef} onClick={() => setMode("photo")}>
                <span className="choice-icon photo-choice" aria-hidden="true">
                  ▣
                </span>
                <strong>Photo or video</strong>
                <small>A glimpse of the day</small>
              </button>
              <button onClick={() => setMode("thought")}>
                <span className="choice-icon thought-choice" aria-hidden="true">
                  “
                </span>
                <strong>A thought</strong>
                <small>A few words to keep</small>
              </button>
              <button onClick={() => setMode("milestone")}>
                <span
                  className="choice-icon milestone-choice"
                  aria-hidden="true"
                >
                  ✦
                </span>
                <strong>Milestone</strong>
                <small>A meaningful first</small>
              </button>
              <button onClick={() => setMode("location")}>
                <span
                  className="choice-icon location-choice"
                  aria-hidden="true"
                >
                  ⌖
                </span>
                <strong>A place</strong>
                <small>Somewhere worth returning to</small>
              </button>
            </div>
          </>
        ) : (
          <form
            className="quick-compose"
            onSubmit={(event) => {
              event.preventDefault();
              close(true);
            }}
          >
            <span id="composer-privacy" className="private-label">
              New private {mode} moment
            </span>
            <h2 id="composer-title">Hold onto this moment</h2>
            <textarea
              aria-label="Moment text"
              placeholder="What happened?"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              autoFocus
            />
            <div className="compose-row">
              <span>Moment date</span>
              <button type="button">Today ›</button>
            </div>
            <div className="compose-row">
              <span>Journal</span>
              <button type="button">Mine ›</button>
            </div>
            <button className="save-moment" type="submit">
              Save moment
            </button>
          </form>
        )}
      </section>
    </dialog>
  );
}
