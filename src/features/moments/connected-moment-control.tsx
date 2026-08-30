"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import type { ThoughtMomentViewModel } from "@/features/timeline/timeline-view-model";
import type { ConnectedMomentActions } from "./moment-action-types";

function localTimeFor(moment: ThoughtMomentViewModel) {
  const instant = moment.editOccurrence?.occurredAt;
  const timeZone = moment.editOccurrence?.timeZone;
  if (!instant || !timeZone) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  return hour && minute ? `${hour}:${minute}` : "";
}

function announce(message: string) {
  const region = document.getElementById("journal-live-region");
  if (region) region.textContent = message;
}

function focusJournalContext() {
  document
    .getElementById("journal-focus-target")
    ?.focus({ preventScroll: true });
}

function restoreJournalFocusAfterRefresh() {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(focusJournalContext),
  );
  window.setTimeout(focusJournalContext, 150);
}

function actionMomentLabel(moment: ThoughtMomentViewModel) {
  const normalized = moment.text.replace(/\s+/gu, " ").trim();
  const excerpt =
    normalized.length <= 72
      ? normalized
      : `${normalized.slice(0, 48)}…${normalized.slice(-20)}`;
  return `${moment.personName}’s “${excerpt}” moment from ${moment.displayDate}`;
}

export function ConnectedMomentControl({
  moment,
  actions,
  position = 1,
  total = 1,
}: {
  moment: ThoughtMomentViewModel;
  actions: ConnectedMomentActions;
  position?: number;
  total?: number;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(moment.text);
  const [occurredOn, setOccurredOn] = useState(moment.occurredOn);
  const originalTime = localTimeFor(moment);
  const [occurredTime, setOccurredTime] = useState(originalTime);
  const [message, setMessage] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const bodyWasLocked = document.body.classList.contains(
      "composer-scroll-locked",
    );
    document.body.classList.add("composer-scroll-locked");
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => bodyRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (!bodyWasLocked)
        document.body.classList.remove("composer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!moment.canChange || !moment.revision) return null;

  const draftIsDirty =
    body !== moment.text ||
    occurredOn !== moment.occurredOn ||
    occurredTime !== originalTime;

  const close = () => {
    if (pending) return;
    if (
      draftIsDirty &&
      !window.confirm("Discard your unsaved changes to this moment?")
    ) {
      return;
    }
    setBody(moment.text);
    setOccurredOn(moment.occurredOn);
    setOccurredTime(originalTime);
    setOpen(false);
    setMessage(null);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const save = () => {
    const trimmedBody = body.trim();
    if (!trimmedBody) {
      setMessage("Write a thought before saving.");
      bodyRef.current?.focus();
      return;
    }
    let occurredAt = moment.editOccurrence?.occurredAt ?? null;
    let occurredTimezone = moment.editOccurrence?.timeZone ?? null;
    if (!occurredTime) {
      occurredAt = null;
      occurredTimezone = null;
    } else if (
      occurredOn !== moment.occurredOn ||
      occurredTime !== originalTime
    ) {
      const localMoment = new Date(`${occurredOn}T${occurredTime}:00`);
      if (Number.isNaN(localMoment.getTime())) {
        setMessage("Check the time and try again.");
        return;
      }
      occurredAt = localMoment.toISOString();
      occurredTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await actions.update({
        momentId: moment.id,
        revision: moment.revision!,
        body: trimmedBody,
        occurredOn,
        occurredAt,
        occurredTimezone,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      announce("Changes to this moment were saved.");
      setOpen(false);
      router.replace(pathname);
      router.refresh();
      restoreJournalFocusAfterRefresh();
    });
  };

  const trash = () => {
    if (
      !window.confirm(
        "Move this moment to trash? It will leave both family and personal timelines until restored.",
      )
    ) {
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await actions.trash({
        momentId: moment.id,
        revision: moment.revision!,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      announce("Moment moved to trash.");
      restoreJournalFocusAfterRefresh();
    });
  };

  return (
    <>
      <div className="connected-moment-actions">
        <button
          ref={editButtonRef}
          type="button"
          aria-label={`Edit — ${actionMomentLabel(moment)} — entry ${position} of ${total}`}
          onClick={() => setOpen(true)}
        >
          Edit
        </button>
        <button
          type="button"
          aria-label={`${pending ? "Moving…" : "Move to trash"} — ${actionMomentLabel(moment)} — entry ${position} of ${total}`}
          disabled={pending}
          onClick={trash}
        >
          {pending ? "Moving…" : "Move to trash"}
        </button>
      </div>
      {message && !open ? (
        <p className="connected-moment-message" role="alert">
          {message}
        </p>
      ) : null}
      {open ? (
        <dialog
          ref={dialogRef}
          className="composer-dialog"
          aria-labelledby={`edit-moment-${moment.id}`}
          onKeyDown={containDialogFocus}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <section className="composer-sheet connected-edit-sheet">
            <span className="sheet-handle" aria-hidden="true" />
            <button
              className="sheet-close"
              type="button"
              aria-label="Close moment editor"
              disabled={pending}
              onClick={close}
            >
              ×
            </button>
            <span className="private-label">Private to this family</span>
            <h2 id={`edit-moment-${moment.id}`}>Edit this moment</h2>
            <label className="composer-field">
              <span>Your thought</span>
              <textarea
                ref={bodyRef}
                value={body}
                maxLength={4000}
                onChange={(event) => setBody(event.target.value)}
              />
            </label>
            <div className="composer-core-fields">
              <label className="composer-field">
                <span>Moment date</span>
                <input
                  type="date"
                  value={occurredOn}
                  max={moment.maxOccurredOn}
                  onChange={(event) => setOccurredOn(event.target.value)}
                />
              </label>
              <label className="composer-field">
                <span>
                  Time <small>Optional</small>
                </span>
                <input
                  type="time"
                  value={occurredTime}
                  onChange={(event) => setOccurredTime(event.target.value)}
                />
              </label>
            </div>
            {message ? (
              <p className="composer-error" role="alert">
                {message}
              </p>
            ) : null}
            <button
              className="save-moment"
              type="button"
              disabled={pending}
              onClick={save}
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          </section>
        </dialog>
      ) : null}
    </>
  );
}
