"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import type {
  MomentDetailViewModel,
  MomentInteractionViewModel,
  MomentReactionId,
} from "./timeline-view-model";

type ConversationSection = "reactions" | "notes";

type MomentConversationControlProps = Readonly<{
  interaction: MomentInteractionViewModel;
  model: MomentDetailViewModel;
}>;

function momentAnchor(model: MomentDetailViewModel) {
  if (model.kind === "photo") {
    return { label: model.kicker, kindLabel: "Photo", symbol: "" };
  }
  if (model.kind === "thought") {
    return { label: `“${model.text}”`, kindLabel: "Thought", symbol: "“" };
  }
  if (model.kind === "location") {
    return { label: model.place, kindLabel: "Place", symbol: "⌖" };
  }
  return { label: model.milestone, kindLabel: "Milestone", symbol: "✦" };
}

function conciseLabel(value: string, maxLength = 72) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function MomentConversationControl({
  interaction,
  model,
}: MomentConversationControlProps) {
  const [open, setOpen] = useState(false);
  const [openingSection, setOpeningSection] =
    useState<ConversationSection>("notes");
  const [selectedReactionId, setSelectedReactionId] =
    useState<MomentReactionId | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [previewedNote, setPreviewedNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reactionHeadingRef = useRef<HTMLHeadingElement>(null);
  const notesHeadingRef = useRef<HTMLHeadingElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const focusNoteAfterEditRef = useRef(false);

  const isDirty = Boolean(selectedReactionId || noteDraft || previewedNote);
  const dialogId = `moment-detail-${model.id}`;
  const titleId = `${dialogId}-title`;
  const privacyId = `${dialogId}-privacy`;
  const noteErrorId = `${dialogId}-note-error`;
  const anchor = momentAnchor(model);

  const resetDraft = useCallback(() => {
    setSelectedReactionId(null);
    setNoteDraft("");
    setPreviewedNote(null);
    setNoteError(null);
  }, []);

  const requestClose = useCallback(
    (discardDraft = false) => {
      const hasUnsavedNote = Boolean(noteDraft || previewedNote);
      const discardMessage =
        hasUnsavedNote && selectedReactionId
          ? "Discard this unsaved note and response?"
          : hasUnsavedNote
            ? "Discard this unsaved note?"
            : "Discard this unsaved response?";
      if (!discardDraft && isDirty && !window.confirm(discardMessage)) {
        return;
      }
      resetDraft();
      setOpen(false);
      window.requestAnimationFrame(() =>
        returnFocusRef.current?.focus({ preventScroll: true }),
      );
    },
    [isDirty, noteDraft, previewedNote, resetDraft, selectedReactionId],
  );

  const openDetail = (
    section: ConversationSection,
    trigger: HTMLButtonElement,
  ) => {
    resetDraft();
    returnFocusRef.current = trigger;
    setOpeningSection(section);
    setOpen(true);
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;

    const bodyWasLocked = document.body.classList.contains(
      "composer-scroll-locked",
    );
    document.body.classList.add("composer-scroll-locked");
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      const target =
        openingSection === "reactions"
          ? reactionHeadingRef.current
          : notesHeadingRef.current;
      const focusTarget = target ?? headingRef.current;
      focusTarget?.focus({ preventScroll: true });
      const scroll = focusTarget?.closest<HTMLElement>(".moment-detail-scroll");
      if (focusTarget && scroll) {
        const targetBounds = focusTarget.getBoundingClientRect();
        const scrollBounds = scroll.getBoundingClientRect();
        scroll.scrollTop += targetBounds.top - scrollBounds.top - 12;
      }
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (!bodyWasLocked)
        document.body.classList.remove("composer-scroll-locked");
      if (dialog.open) dialog.close();
    };
  }, [open, openingSection]);

  useEffect(() => {
    if (previewedNote !== null || !focusNoteAfterEditRef.current) return;
    focusNoteAfterEditRef.current = false;
    noteRef.current?.focus();
  }, [previewedNote]);

  const previewNote = () => {
    const trimmedNote = noteDraft.trim();
    if (!trimmedNote) {
      setNoteError("Write a note before previewing it.");
      noteRef.current?.focus();
      return;
    }
    setPreviewedNote(trimmedNote);
    setNoteDraft("");
    setNoteError(null);
  };

  const editPreviewedNote = () => {
    if (!previewedNote) return;
    focusNoteAfterEditRef.current = true;
    setNoteDraft(previewedNote);
    setPreviewedNote(null);
  };

  const visibleReactions = model.conversation.reactions.flatMap((reaction) => {
    const option = interaction.reactionOptions.find(
      ({ id }) => id === reaction.reactionId,
    );
    return option ? [{ ...reaction, label: option.label }] : [];
  });

  return (
    <>
      <div className="soft-actions">
        <button
          type="button"
          aria-label={`Respond to ${model.kicker} by ${model.personName}`}
          onClick={(event) => openDetail("reactions", event.currentTarget)}
        >
          ♡ Respond
        </button>
        <button
          type="button"
          aria-label={`Open private notes for ${model.kicker} by ${model.personName}`}
          onClick={(event) => openDetail("notes", event.currentTarget)}
        >
          Notes
        </button>
        {model.taggedPeopleLabel ? (
          <span className="tagged">with {model.taggedPeopleLabel}</span>
        ) : null}
      </div>

      {open
        ? createPortal(
            <dialog
              ref={dialogRef}
              id={dialogId}
              className="moment-detail-dialog"
              aria-labelledby={titleId}
              aria-describedby={privacyId}
              onKeyDown={containDialogFocus}
              onCancel={(event) => {
                event.preventDefault();
                requestClose();
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) requestClose();
              }}
            >
              <section className="moment-detail-sheet">
                <div className="moment-detail-sticky-bar">
                  <span className="sheet-handle" aria-hidden="true" />
                  <div className="moment-detail-privacy-bar">
                    <span>Local preview · Nothing is saved</span>
                    <button
                      className="sheet-close"
                      type="button"
                      aria-label="Close moment details"
                      onClick={() => requestClose()}
                    >
                      ×
                    </button>
                  </div>
                  <div
                    className={`moment-detail-anchor accent-${model.personAccent}`}
                    data-moment-kind={model.kind}
                  >
                    {model.kind === "photo" ? (
                      <span
                        className="moment-detail-photo-cue"
                        aria-hidden="true"
                      >
                        <i />
                        <b />
                      </span>
                    ) : (
                      <span aria-hidden="true">{anchor.symbol}</span>
                    )}
                    <div>
                      <h2
                        ref={headingRef}
                        id={titleId}
                        tabIndex={-1}
                        aria-label={`${anchor.kindLabel}: ${conciseLabel(anchor.label)} — ${model.personName}, ${model.displayDate}`}
                      >
                        {anchor.label}
                      </h2>
                      <span>
                        {anchor.kindLabel} · {model.personName} ·{" "}
                        {model.displayDate}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="moment-detail-scroll">
                  <span id={privacyId} className="moment-detail-description">
                    Local design preview · Notes and reactions are not saved
                  </span>

                  <article
                    className={`moment-detail-summary accent-${model.personAccent}`}
                  >
                    <span>
                      {model.personName} · {model.displayDate}
                    </span>
                    <strong>{model.kicker}</strong>
                    <p>{model.text}</p>
                  </article>

                  <section
                    className="moment-detail-section"
                    aria-labelledby={`${dialogId}-reactions-heading`}
                  >
                    <div className="moment-detail-section-heading">
                      <h3
                        ref={reactionHeadingRef}
                        id={`${dialogId}-reactions-heading`}
                        tabIndex={-1}
                      >
                        A quiet response
                      </h3>
                    </div>
                    {visibleReactions.length ? (
                      <ul
                        className="family-reactions"
                        aria-label="Family responses"
                      >
                        {visibleReactions.map((reaction) => (
                          <li key={reaction.id}>
                            <span
                              className={`note-avatar dot-${reaction.personAccent}`}
                              aria-hidden="true"
                            >
                              {reaction.personInitial}
                            </span>
                            <span>
                              <strong>{reaction.personName}</strong>
                              <small>{reaction.label}</small>
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="quiet-empty">
                        No family responses are attached to this moment.
                      </p>
                    )}
                    <div
                      className="reaction-choices"
                      role="group"
                      aria-labelledby={`${dialogId}-your-response`}
                    >
                      <span id={`${dialogId}-your-response`}>
                        Your response
                      </span>
                      <div>
                        {interaction.reactionOptions.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={selectedReactionId === option.id}
                            onClick={() =>
                              setSelectedReactionId((current) =>
                                current === option.id ? null : option.id,
                              )
                            }
                          >
                            <span aria-hidden="true">{option.symbol}</span>
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {selectedReactionId ? (
                      <div className="reaction-preview-status" role="status">
                        <span>
                          Selected for this preview. Nothing was saved.
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedReactionId(null)}
                        >
                          Clear response
                        </button>
                      </div>
                    ) : null}
                  </section>

                  <section
                    className="moment-detail-section"
                    aria-labelledby={`${dialogId}-notes-heading`}
                  >
                    <div className="moment-detail-section-heading">
                      <h3
                        ref={notesHeadingRef}
                        id={`${dialogId}-notes-heading`}
                        tabIndex={-1}
                      >
                        Notes from family
                      </h3>
                      <span>The details someone else remembers</span>
                    </div>
                    {model.conversation.notes.length ? (
                      <ol className="family-notes">
                        {model.conversation.notes.map((note) => (
                          <li key={note.id}>
                            <span
                              className={`note-avatar dot-${note.authorAccent}`}
                              aria-hidden="true"
                            >
                              {note.authorInitial}
                            </span>
                            <div>
                              <span>
                                <strong>{note.authorName}</strong>
                                <time>{note.displayDate}</time>
                              </span>
                              <p>{note.body}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="quiet-empty">
                        No notes here yet. The moment can stay quiet.
                      </p>
                    )}

                    {previewedNote ? (
                      <article
                        className="previewed-note"
                        aria-label="Your local note preview"
                      >
                        <span
                          className={`note-avatar dot-${interaction.currentPerson.accent}`}
                          aria-hidden="true"
                        >
                          {interaction.currentPerson.initial}
                        </span>
                        <div>
                          <span>
                            <strong>{interaction.currentPerson.name}</strong>
                            <small>Your local preview · Not saved</small>
                          </span>
                          <p>{previewedNote}</p>
                          <div>
                            <button type="button" onClick={editPreviewedNote}>
                              Back to edit
                            </button>
                            <button
                              type="button"
                              onClick={() => setPreviewedNote(null)}
                            >
                              Clear preview
                            </button>
                          </div>
                        </div>
                      </article>
                    ) : (
                      <form
                        className="note-preview-form"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          previewNote();
                        }}
                      >
                        <label htmlFor={`${dialogId}-note`}>
                          Your note to the family
                        </label>
                        <span className="note-audience">
                          Private to this family · Local preview only
                        </span>
                        <textarea
                          ref={noteRef}
                          id={`${dialogId}-note`}
                          value={noteDraft}
                          maxLength={1000}
                          placeholder="A memory, detail, or reply…"
                          aria-invalid={noteError ? true : undefined}
                          aria-describedby={noteError ? noteErrorId : undefined}
                          onChange={(event) => {
                            setNoteDraft(event.target.value);
                            if (event.target.value.trim()) setNoteError(null);
                          }}
                        />
                        {noteError ? (
                          <p
                            id={noteErrorId}
                            className="composer-error"
                            role="alert"
                          >
                            {noteError}
                          </p>
                        ) : null}
                        <button className="preview-note-action" type="submit">
                          Preview note
                        </button>
                      </form>
                    )}
                  </section>

                  <button
                    className="moment-detail-close-action"
                    type="button"
                    onClick={() => requestClose()}
                  >
                    Close preview
                  </button>
                </div>
              </section>
            </dialog>,
            document.body,
            dialogId,
          )
        : null}
    </>
  );
}
