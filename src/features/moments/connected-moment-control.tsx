"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import type {
  MomentInteractionViewModel,
  TimelineMomentViewModel,
} from "@/features/timeline/timeline-view-model";
import type { ConnectedMomentActions } from "./moment-action-types";

function localTimeFor(moment: TimelineMomentViewModel) {
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

function actionMomentLabel(moment: TimelineMomentViewModel) {
  const source =
    moment.kind === "milestone"
      ? moment.milestone
      : moment.kind === "location"
        ? moment.place
        : moment.text;
  const normalized = source.replace(/\s+/gu, " ").trim();
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
  taggablePeople = [],
}: {
  moment: TimelineMomentViewModel;
  actions: ConnectedMomentActions;
  position?: number;
  total?: number;
  taggablePeople?: NonNullable<MomentInteractionViewModel["taggablePeople"]>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(moment.text);
  const [title, setTitle] = useState(
    moment.kind === "milestone" ? moment.milestone : "",
  );
  const [placeName, setPlaceName] = useState(
    moment.placeName ?? (moment.kind === "location" ? moment.place : ""),
  );
  const [taggedPersonIds, setTaggedPersonIds] = useState<readonly string[]>(
    moment.taggedPeople?.map((person) => person.id) ?? [],
  );
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
    title !== (moment.kind === "milestone" ? moment.milestone : "") ||
    placeName !==
      (moment.placeName ?? (moment.kind === "location" ? moment.place : "")) ||
    taggedPersonIds.join(",") !==
      (moment.taggedPeople?.map((person) => person.id) ?? []).join(",") ||
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
    setTitle(moment.kind === "milestone" ? moment.milestone : "");
    setPlaceName(
      moment.placeName ?? (moment.kind === "location" ? moment.place : ""),
    );
    setTaggedPersonIds(moment.taggedPeople?.map((person) => person.id) ?? []);
    setOccurredOn(moment.occurredOn);
    setOccurredTime(originalTime);
    setOpen(false);
    setMessage(null);
    window.requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const save = async () => {
    const trimmedBody = body.trim();
    if (moment.kind === "thought" && !trimmedBody) {
      setMessage("Write a thought before saving.");
      bodyRef.current?.focus();
      return;
    }
    if (moment.kind === "milestone" && !title.trim()) {
      setMessage("Name the milestone before saving.");
      return;
    }
    if (moment.kind === "location" && !placeName.trim()) {
      setMessage("Name the place before saving.");
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
    setPending(true);
    try {
      const result = await actions.update({
        momentId: moment.id,
        revision: moment.revision!,
        title: title.trim(),
        body: trimmedBody,
        placeName: placeName.trim(),
        taggedPersonIds,
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
    } catch {
      setMessage("That moment could not be changed. Try again.");
    } finally {
      setPending(false);
    }
  };

  const trash = async () => {
    if (
      !window.confirm(
        "Move this moment to trash? It will leave both family and personal timelines until restored.",
      )
    ) {
      return;
    }
    setMessage(null);
    setPending(true);
    try {
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
    } catch {
      setMessage("That moment could not be moved to trash. Try again.");
    } finally {
      setPending(false);
    }
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
            {moment.kind === "milestone" ? (
              <label className="composer-field">
                <span>Milestone</span>
                <input
                  type="text"
                  value={title}
                  maxLength={120}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
            ) : null}
            {moment.kind === "location" ? (
              <label className="composer-field">
                <span>Place name</span>
                <input
                  type="text"
                  value={placeName}
                  maxLength={160}
                  onChange={(event) => setPlaceName(event.target.value)}
                />
              </label>
            ) : null}
            {moment.kind !== "location" ? (
              <label className="composer-field">
                <span>
                  Place <small>Optional</small>
                </span>
                <input
                  type="text"
                  value={placeName}
                  maxLength={160}
                  placeholder="Add a place by hand"
                  onChange={(event) => setPlaceName(event.target.value)}
                />
              </label>
            ) : null}
            <label className="composer-field">
              <span>
                {moment.kind === "thought" ? "Your thought" : "Details"}
              </span>
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
            <fieldset className="people-tags">
              <legend>Who else was part of this?</legend>
              <div>
                {taggablePeople
                  .filter((person) => person.id !== moment.journalPersonId)
                  .map((person) => (
                    <label key={person.id}>
                      <input
                        type="checkbox"
                        checked={taggedPersonIds.includes(person.id)}
                        onChange={() =>
                          setTaggedPersonIds((current) =>
                            current.includes(person.id)
                              ? current.filter((id) => id !== person.id)
                              : [...current, person.id],
                          )
                        }
                      />
                      <span
                        className={`tag-person-dot dot-${person.accent}`}
                        aria-hidden="true"
                      >
                        {person.initial}
                      </span>
                      {person.name}
                    </label>
                  ))}
              </div>
            </fieldset>
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
