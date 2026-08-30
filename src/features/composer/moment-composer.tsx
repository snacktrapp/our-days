"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import type { MomentKind } from "@/features/timeline/timeline-view-model";
import type { MomentComposerViewModel } from "./composer-view-model";

type MomentComposerProps = Readonly<{
  model: MomentComposerViewModel;
  open: boolean;
  returnFocusRef: React.RefObject<HTMLButtonElement | null>;
  onRequestClose: () => void;
}>;

type ModeCopy = Readonly<{
  kindLabel: string;
  title: string;
  bodyLabel: string;
  bodyPlaceholder: string;
  bodyRequired: boolean;
}>;

type PhotoDecodeState = "empty" | "decoding" | "ready" | "error";

const modeCopy: Readonly<Record<MomentKind, ModeCopy>> = {
  photo: {
    kindLabel: "Photo",
    title: "Choose a glimpse to keep",
    bodyLabel: "A few words",
    bodyPlaceholder: "What do you want to remember?",
    bodyRequired: false,
  },
  thought: {
    kindLabel: "Thought",
    title: "Hold onto this moment",
    bodyLabel: "Your thought",
    bodyPlaceholder: "What happened?",
    bodyRequired: true,
  },
  milestone: {
    kindLabel: "Milestone",
    title: "Mark this milestone",
    bodyLabel: "What made it meaningful?",
    bodyPlaceholder: "The part you want to remember…",
    bodyRequired: false,
  },
  location: {
    kindLabel: "Place",
    title: "Remember somewhere together",
    bodyLabel: "What happened here?",
    bodyPlaceholder: "A small detail from this place…",
    bodyRequired: false,
  },
};

const previewImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function plainDateLabel(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ] as const;
  const monthName = monthNames[Number(month) - 1];
  if (!monthName) return value;
  return `${monthName} ${Number(day)}, ${year}`;
}

function resolvePreviewTitle(
  title: string,
  body: string,
  hasPhoto: boolean,
  fallback: string,
) {
  if (title.trim()) return title.trim();
  if (body.trim()) return body.trim();
  if (hasPhoto) return "A photo to remember";
  return fallback;
}

export function MomentComposer({
  model,
  open,
  returnFocusRef,
  onRequestClose,
}: MomentComposerProps) {
  const [mode, setMode] = useState<MomentKind | null>(null);
  const [choosingMode, setChoosingMode] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [optionalDetailsOpen, setOptionalDetailsOpen] = useState(false);
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [occurredOn, setOccurredOn] = useState(model.previewToday);
  const [journalPersonId, setJournalPersonId] = useState(
    model.defaultJournalPersonId,
  );
  const [taggedPersonIds, setTaggedPersonIds] = useState<readonly string[]>([]);
  const [placeName, setPlaceName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoDecodeState, setPhotoDecodeState] =
    useState<PhotoDecodeState>("empty");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [contentError, setContentError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);

  const journalPerson =
    model.journalPeople.find((person) => person.id === journalPersonId) ??
    model.journalPeople[0];
  const taggedPeople = model.taggablePeople.filter((person) =>
    taggedPersonIds.includes(person.id),
  );
  const copy = mode ? modeCopy[mode] : null;
  const resolvedPlaceName = mode === "location" ? title : placeName;
  const isDirty = Boolean(
    body.length ||
    title.length ||
    placeName.length ||
    photoFile ||
    taggedPersonIds.length ||
    occurredOn !== model.previewToday ||
    journalPersonId !== model.defaultJournalPersonId,
  );

  const revokeCurrentPhotoUrl = useCallback(() => {
    if (photoPreviewUrlRef.current) {
      const url = photoPreviewUrlRef.current;
      photoPreviewUrlRef.current = null;
      URL.revokeObjectURL(url);
    }
  }, []);

  const clearPhotoPreview = useCallback(() => {
    revokeCurrentPhotoUrl();
    setPhotoPreviewUrl(null);
  }, [revokeCurrentPhotoUrl]);

  const rejectUndecodablePhoto = useCallback(
    (expectedUrl: string) => {
      if (photoPreviewUrlRef.current !== expectedUrl) return;
      clearPhotoPreview();
      setPhotoFile(null);
      setPhotoDecodeState("error");
      if (photoInputRef.current) photoInputRef.current.value = "";
      setPhotoError("This image could not be shown. Choose another one.");
    },
    [clearPhotoPreview],
  );

  const resetDraft = useCallback(
    (nextMode: MomentKind | null = null) => {
      clearPhotoPreview();
      if (photoInputRef.current) photoInputRef.current.value = "";
      setMode(nextMode);
      setChoosingMode(false);
      setReviewing(false);
      setOptionalDetailsOpen(false);
      setBody("");
      setTitle("");
      setOccurredOn(model.previewToday);
      setJournalPersonId(model.defaultJournalPersonId);
      setTaggedPersonIds([]);
      setPlaceName("");
      setPhotoFile(null);
      setPhotoDecodeState("empty");
      setPhotoError(null);
      setContentError(null);
    },
    [clearPhotoPreview, model.defaultJournalPersonId, model.previewToday],
  );

  const close = useCallback(
    (discardDraft = false) => {
      if (
        !discardDraft &&
        isDirty &&
        !window.confirm("Discard this unfinished moment?")
      ) {
        return;
      }

      resetDraft();
      onRequestClose();
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    },
    [isDirty, onRequestClose, resetDraft, returnFocusRef],
  );

  useEffect(() => () => revokeCurrentPhotoUrl(), [revokeCurrentPhotoUrl]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const bodyWasLocked = document.body.classList.contains(
      "composer-scroll-locked",
    );
    document.body.classList.add("composer-scroll-locked");
    if (!dialog.open) dialog.showModal();

    return () => {
      if (!bodyWasLocked)
        document.body.classList.remove("composer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusFrame = window.requestAnimationFrame(() => {
      if (reviewing) reviewHeadingRef.current?.focus();
      else if (mode && !choosingMode) {
        if (mode === "photo") photoInputRef.current?.focus();
        else if (mode === "thought") bodyTextareaRef.current?.focus();
        else titleInputRef.current?.focus();
      } else firstChoiceRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [choosingMode, mode, open, reviewing]);

  const replacePhoto = (file: File | null) => {
    clearPhotoPreview();
    setPhotoFile(null);
    setPhotoDecodeState("empty");
    setPhotoError(null);
    if (!file) {
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    if (!previewImageTypes.has(file.type.toLowerCase())) {
      setPhotoDecodeState("error");
      setPhotoError("Choose an image file for this preview.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    if (file.size === 0) {
      setPhotoDecodeState("error");
      setPhotoError("That image is empty. Choose another one.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setPhotoDecodeState("error");
      setPhotoError("Choose an image smaller than 25 MB for this preview.");
      if (photoInputRef.current) photoInputRef.current.value = "";
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    photoPreviewUrlRef.current = nextUrl;
    setPhotoFile(file);
    setPhotoPreviewUrl(nextUrl);
    setPhotoDecodeState("decoding");
  };

  const acceptDecodedPhoto = (expectedUrl: string) => {
    if (photoPreviewUrlRef.current !== expectedUrl) return;
    setPhotoDecodeState("ready");
    setPhotoError(null);
  };

  const chooseMode = (nextMode: MomentKind) => {
    if (mode === nextMode) {
      setChoosingMode(false);
      return;
    }
    if (
      mode &&
      isDirty &&
      !window.confirm("Discard this draft and choose another type?")
    ) {
      return;
    }
    resetDraft(nextMode);
  };

  const toggleTaggedPerson = (personId: string) => {
    setTaggedPersonIds((current) =>
      current.includes(personId)
        ? current.filter((id) => id !== personId)
        : [...current, personId],
    );
  };

  const chooseJournalPerson = (personId: string) => {
    if (!model.journalPeople.some((person) => person.id === personId)) return;
    setJournalPersonId(personId);
    setTaggedPersonIds((current) =>
      current.filter((taggedPersonId) => taggedPersonId !== personId),
    );
  };

  const previewDraft = () => {
    if (mode === "photo" && photoDecodeState !== "ready") {
      setPhotoError(
        photoDecodeState === "decoding"
          ? "Wait for this photo to finish loading."
          : "Choose a photo for this preview.",
      );
      photoInputRef.current?.focus();
      return;
    }
    if (mode === "thought" && !body.trim()) {
      setContentError("Write a thought before previewing this moment.");
      bodyTextareaRef.current?.focus();
      return;
    }
    if ((mode === "milestone" || mode === "location") && !title.trim()) {
      setContentError(
        mode === "milestone"
          ? "Name the milestone before previewing this moment."
          : "Name the place before previewing this moment.",
      );
      titleInputRef.current?.focus();
      return;
    }
    setContentError(null);
    setReviewing(true);
  };

  const previewTitle = resolvePreviewTitle(
    title,
    body,
    Boolean(photoFile),
    copy?.kindLabel ?? "Moment",
  );

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

        {!mode || choosingMode ? (
          <>
            <span id="composer-privacy" className="private-label">
              Local design preview · Nothing is saved
            </span>
            <h2 id="composer-title">
              {mode
                ? "Choose a kind of moment"
                : "What would you like to remember?"}
            </h2>
            {mode && isDirty ? (
              <p className="composer-draft-held">
                Your current draft is still here.
              </p>
            ) : null}
            <div className="moment-choices">
              <button ref={firstChoiceRef} onClick={() => chooseMode("photo")}>
                <span className="choice-icon photo-choice" aria-hidden="true">
                  ▣
                </span>
                <strong>Photo</strong>
                <small>A glimpse of the day</small>
              </button>
              <button onClick={() => chooseMode("thought")}>
                <span className="choice-icon thought-choice" aria-hidden="true">
                  “
                </span>
                <strong>A thought</strong>
                <small>A few words to keep</small>
              </button>
              <button onClick={() => chooseMode("milestone")}>
                <span
                  className="choice-icon milestone-choice"
                  aria-hidden="true"
                >
                  ✦
                </span>
                <strong>Milestone</strong>
                <small>A meaningful first</small>
              </button>
              <button onClick={() => chooseMode("location")}>
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
        ) : reviewing && copy ? (
          <div className="composer-review">
            <span id="composer-privacy" className="private-label">
              Design preview · Nothing was saved
            </span>
            <h2 ref={reviewHeadingRef} id="composer-title" tabIndex={-1}>
              A preview of this moment
            </h2>
            <article className={`composer-preview-card preview-${mode}`}>
              {photoPreviewUrl ? (
                <div className="composer-photo-preview">
                  {/* The selected blob must bypass both Next's public optimizer
                      and its CSP-incompatible inline image style. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={photoPreviewUrl}
                    src={photoPreviewUrl}
                    alt=""
                    width={720}
                    height={540}
                    decoding="async"
                    onError={() => {
                      if (photoPreviewUrlRef.current !== photoPreviewUrl)
                        return;
                      setReviewing(false);
                      rejectUndecodablePhoto(photoPreviewUrl);
                    }}
                  />
                </div>
              ) : null}
              <div className="composer-preview-copy">
                <span>{copy.kindLabel}</span>
                <strong>{previewTitle}</strong>
                {title.trim() && body.trim() ? <p>{body.trim()}</p> : null}
              </div>
            </article>
            <dl className="composer-review-details">
              <div>
                <dt>Journal</dt>
                <dd>{journalPerson.name}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{plainDateLabel(occurredOn)}</dd>
              </div>
              {taggedPeople.length ? (
                <div>
                  <dt>With</dt>
                  <dd>
                    {taggedPeople.map((person) => person.name).join(", ")}
                  </dd>
                </div>
              ) : null}
              {resolvedPlaceName.trim() && mode !== "location" ? (
                <div>
                  <dt>Place</dt>
                  <dd>{resolvedPlaceName.trim()}</dd>
                </div>
              ) : null}
            </dl>
            {journalPersonId !== model.recorderPersonId ? (
              <p className="recorded-by">Recorded by {model.recordedByName}</p>
            ) : null}
            <div className="composer-review-actions">
              <button
                className="secondary-composer-action"
                type="button"
                onClick={() => setReviewing(false)}
              >
                Back to edit
              </button>
              <button
                className="save-moment"
                type="button"
                onClick={() => close(true)}
              >
                Close preview
              </button>
            </div>
          </div>
        ) : copy ? (
          <form
            className="quick-compose"
            onSubmit={(event) => {
              event.preventDefault();
              previewDraft();
            }}
          >
            <button
              className="composer-back"
              type="button"
              onClick={() => setChoosingMode(true)}
            >
              ← Choose another
            </button>
            <span id="composer-privacy" className="private-label">
              Local {copy.kindLabel.toLowerCase()} preview
            </span>
            <h2 id="composer-title">{copy.title}</h2>

            {mode === "photo" ? (
              <label className="photo-input">
                <span>
                  {photoFile ? "Choose a different photo" : "Choose photo"}
                </span>
                <small>It stays on this device in the preview.</small>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  required={!photoFile}
                  aria-invalid={photoError ? true : undefined}
                  aria-describedby={
                    photoError ? "photo-preview-error" : undefined
                  }
                  onChange={(event) =>
                    replacePhoto(event.currentTarget.files?.[0] ?? null)
                  }
                />
              </label>
            ) : null}
            {photoError ? (
              <p
                id="photo-preview-error"
                className="composer-error"
                role="alert"
              >
                {photoError}
              </p>
            ) : null}
            <p
              className="composer-selection-status"
              role="status"
              aria-live="polite"
            >
              {photoFile
                ? photoDecodeState === "ready"
                  ? "Photo ready for this local preview."
                  : "Preparing this photo on your device."
                : ""}
            </p>
            {photoPreviewUrl ? (
              <div className="composer-photo-preview">
                {/* The selected blob is local-only and must never enter the
                    generic Next image optimizer or receive inline styles. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={photoPreviewUrl}
                  src={photoPreviewUrl}
                  alt="Selected photo preview"
                  width={720}
                  height={540}
                  decoding="async"
                  onLoad={() => acceptDecodedPhoto(photoPreviewUrl)}
                  onError={() => rejectUndecodablePhoto(photoPreviewUrl)}
                />
                <button type="button" onClick={() => replacePhoto(null)}>
                  Remove photo
                </button>
              </div>
            ) : null}

            {mode === "milestone" || mode === "location" ? (
              <label className="composer-field">
                <span>{mode === "milestone" ? "Milestone" : "Place name"}</span>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={title}
                  required
                  aria-invalid={contentError ? true : undefined}
                  aria-describedby={
                    contentError ? "composer-content-error" : undefined
                  }
                  maxLength={120}
                  placeholder={
                    mode === "milestone"
                      ? "A meaningful first"
                      : "Somewhere worth remembering"
                  }
                  onChange={(event) => {
                    setTitle(event.target.value);
                    if (event.target.value.trim()) setContentError(null);
                  }}
                />
              </label>
            ) : null}

            <label className="composer-field">
              <span>{copy.bodyLabel}</span>
              <textarea
                ref={bodyTextareaRef}
                placeholder={copy.bodyPlaceholder}
                value={body}
                required={copy.bodyRequired}
                aria-invalid={
                  mode === "thought" && contentError ? true : undefined
                }
                aria-describedby={
                  mode === "thought" && contentError
                    ? "composer-content-error"
                    : undefined
                }
                maxLength={4000}
                onChange={(event) => {
                  setBody(event.target.value);
                  if (mode === "thought" && event.target.value.trim()) {
                    setContentError(null);
                  }
                }}
              />
            </label>
            {contentError ? (
              <p
                id="composer-content-error"
                className="composer-error"
                role="alert"
              >
                {contentError}
              </p>
            ) : null}

            <div className="composer-core-fields">
              <label className="composer-field">
                <span>Moment date</span>
                <input
                  type="date"
                  value={occurredOn}
                  max={model.previewToday}
                  required
                  onChange={(event) => setOccurredOn(event.target.value)}
                />
              </label>
              <div className="composer-field composer-select-field">
                <label htmlFor="composer-journal-person">Journal</label>
                <select
                  id="composer-journal-person"
                  value={journalPersonId}
                  onChange={(event) => chooseJournalPerson(event.target.value)}
                >
                  {model.journalPeople.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.contextLabel}
                    </option>
                  ))}
                </select>
                <span className="composer-select-arrow" aria-hidden="true">
                  ⌄
                </span>
              </div>
            </div>

            <div className="composer-optional">
              <button
                className="composer-optional-toggle"
                type="button"
                aria-expanded={optionalDetailsOpen}
                aria-controls="composer-optional-fields"
                onClick={() => setOptionalDetailsOpen((current) => !current)}
              >
                People and place <span>Optional</span>
              </button>
              {optionalDetailsOpen ? (
                <div id="composer-optional-fields">
                  <fieldset className="people-tags">
                    <legend>Who was there?</legend>
                    <div>
                      {model.taggablePeople.map((person) => {
                        const isJournalPerson = person.id === journalPersonId;
                        return (
                          <label key={person.id}>
                            <input
                              type="checkbox"
                              checked={taggedPersonIds.includes(person.id)}
                              disabled={isJournalPerson}
                              onChange={() => toggleTaggedPerson(person.id)}
                            />
                            <span
                              className={`tag-person-dot dot-${person.accent}`}
                              aria-hidden="true"
                            >
                              {person.initial}
                            </span>
                            {person.name}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                  {mode !== "location" ? (
                    <label className="composer-field">
                      <span>Place</span>
                      <input
                        type="text"
                        value={placeName}
                        maxLength={160}
                        placeholder="Add a place by hand"
                        onChange={(event) => setPlaceName(event.target.value)}
                      />
                      <small>No location is read from your photo.</small>
                    </label>
                  ) : null}
                </div>
              ) : null}
            </div>

            {journalPersonId !== model.recorderPersonId ? (
              <p className="recorded-by">Recorded by {model.recordedByName}</p>
            ) : null}
            <p className="composer-preview-note">
              Preview only. Nothing will be uploaded or saved.
            </p>
            <button className="save-moment" type="submit">
              Preview moment
            </button>
          </form>
        ) : null}
      </section>
    </dialog>
  );
}
