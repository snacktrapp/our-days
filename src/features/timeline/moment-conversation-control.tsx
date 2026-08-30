"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import type { MomentConversationActions } from "@/features/moments/moment-action-types";
import type {
  MomentConversationViewModel,
  MomentDetailViewModel,
  MomentInteractionViewModel,
  MomentReactionId,
} from "./timeline-view-model";

type ConversationSection = "reactions" | "notes";

type MomentConversationControlProps = Readonly<{
  interaction: MomentInteractionViewModel;
  model: MomentDetailViewModel;
  actions?: MomentConversationActions;
  position?: number;
  total?: number;
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
  actions,
  position = 1,
  total = 1,
}: MomentConversationControlProps) {
  const [open, setOpen] = useState(false);
  const [openingSection, setOpeningSection] =
    useState<ConversationSection>("notes");
  const [selectedReactionId, setSelectedReactionId] =
    useState<MomentReactionId | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [previewedNote, setPreviewedNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [conversation, setConversation] =
    useState<MomentConversationViewModel | null>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [conversationLoadError, setConversationLoadError] = useState<
    string | null
  >(null);
  const [mutationPending, setMutationPending] = useState(false);
  const [conversationMessage, setConversationMessage] = useState<string | null>(
    null,
  );
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteBody, setEditingNoteBody] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reactionHeadingRef = useRef<HTMLHeadingElement>(null);
  const notesHeadingRef = useRef<HTMLHeadingElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusRef = useRef<HTMLButtonElement | null>(null);
  const focusNoteAfterEditRef = useRef(false);
  const focusRetryAfterLoadRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const [savedReactionId, setSavedReactionId] =
    useState<MomentReactionId | null>(null);
  const editingNoteOriginalBody = editingNoteId
    ? (conversation ?? model.conversation).notes.find(
        (note) => note.id === editingNoteId,
      )?.body
    : undefined;
  const hasUnsavedEditedNote =
    editingNoteId !== null && editingNoteBody !== editingNoteOriginalBody;
  const hasUnsavedReaction = selectedReactionId !== savedReactionId;
  const isDirty = actions
    ? Boolean(noteDraft || hasUnsavedEditedNote || hasUnsavedReaction)
    : Boolean(selectedReactionId || noteDraft || previewedNote);
  const dialogId = `moment-detail-${model.id}`;
  const titleId = `${dialogId}-title`;
  const privacyId = `${dialogId}-privacy`;
  const noteErrorId = `${dialogId}-note-error`;
  const anchor = momentAnchor(model);
  const controlLabel = conciseLabel(anchor.label.replace(/^“|”$/gu, ""), 48);

  const resetDraft = useCallback(() => {
    focusRetryAfterLoadRef.current = false;
    setSelectedReactionId(null);
    setSavedReactionId(null);
    setNoteDraft("");
    setPreviewedNote(null);
    setNoteError(null);
    setConversationMessage(null);
    setConversationLoadError(null);
    setEditingNoteId(null);
    setEditingNoteBody("");
  }, []);

  const requestClose = useCallback(
    (discardDraft = false) => {
      if (mutationPending) return;
      const hasUnsavedNote = Boolean(
        noteDraft || previewedNote || hasUnsavedEditedNote,
      );
      const discardMessage =
        hasUnsavedNote && hasUnsavedReaction
          ? "Discard this unsaved note and response?"
          : hasUnsavedNote
            ? "Discard this unsaved note?"
            : "Discard this unsaved response?";
      if (!discardDraft && isDirty && !window.confirm(discardMessage)) {
        return;
      }
      resetDraft();
      loadGenerationRef.current += 1;
      setConversation(null);
      setLoadingConversation(false);
      setOpen(false);
      window.requestAnimationFrame(() =>
        returnFocusRef.current?.focus({ preventScroll: true }),
      );
    },
    [
      isDirty,
      hasUnsavedEditedNote,
      hasUnsavedReaction,
      mutationPending,
      noteDraft,
      previewedNote,
      resetDraft,
    ],
  );

  const loadConversation = useCallback(async () => {
    if (!actions) return false;
    const generation = loadGenerationRef.current + 1;
    loadGenerationRef.current = generation;
    setConversation(null);
    setConversationLoadError(null);
    setConversationMessage(null);
    setLoadingConversation(true);
    try {
      const result = await actions.load({ momentId: model.id });
      if (generation !== loadGenerationRef.current) return false;
      if (!result.ok) {
        setConversationLoadError(result.message);
        return false;
      }
      setConversation(result.conversation);
      const currentReactionId =
        result.conversation.reactions.find(
          (reaction) => reaction.isCurrentMember,
        )?.reactionId ?? null;
      setSavedReactionId(currentReactionId);
      setSelectedReactionId(currentReactionId);
      return true;
    } catch {
      if (generation === loadGenerationRef.current) {
        setConversationLoadError(
          "This private conversation could not be opened. Try again.",
        );
      }
      return false;
    } finally {
      if (generation === loadGenerationRef.current) {
        setLoadingConversation(false);
      }
    }
  }, [actions, model.id]);

  const openDetail = (
    section: ConversationSection,
    trigger: HTMLButtonElement,
  ) => {
    resetDraft();
    returnFocusRef.current = trigger;
    setOpeningSection(section);
    setOpen(true);
    if (actions) void loadConversation();
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

  useEffect(() => {
    if (!conversationLoadError || !focusRetryAfterLoadRef.current) return;
    focusRetryAfterLoadRef.current = false;
    const focusFrame = window.requestAnimationFrame(() =>
      retryButtonRef.current?.focus({ preventScroll: true }),
    );
    return () => window.cancelAnimationFrame(focusFrame);
  }, [conversationLoadError]);

  const focusNotesHeading = useCallback(() => {
    window.requestAnimationFrame(() =>
      notesHeadingRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  const focusReactionHeading = useCallback(() => {
    window.requestAnimationFrame(() =>
      reactionHeadingRef.current?.focus({ preventScroll: true }),
    );
  }, []);

  const retryConversation = async () => {
    focusRetryAfterLoadRef.current = true;
    const loaded = await loadConversation();
    if (loaded) {
      focusRetryAfterLoadRef.current = false;
      if (openingSection === "reactions") focusReactionHeading();
      else focusNotesHeading();
    }
  };

  const previewNote = async () => {
    const trimmedNote = noteDraft.trim();
    if (!trimmedNote) {
      setNoteError("Write a note before previewing it.");
      noteRef.current?.focus();
      return;
    }
    if (!actions) {
      setPreviewedNote(trimmedNote);
      setNoteDraft("");
      setNoteError(null);
      return;
    }
    setMutationPending(true);
    setNoteError(null);
    try {
      const result = await actions.createNote({
        momentId: model.id,
        body: trimmedNote,
      });
      if (!result.ok) {
        setNoteError(result.message);
        return;
      }
      setNoteDraft("");
      const refreshed = await loadConversation();
      if (!refreshed) {
        setConversationMessage(
          "Your note was saved, but this conversation needs to be reopened.",
        );
        return;
      }
      setNoteError(null);
      setConversationMessage("Note saved for this family.");
      focusNotesHeading();
    } catch {
      setMutationPending(false);
      setNoteError("The note could not be saved. Try again.");
    } finally {
      setMutationPending(false);
    }
  };

  const editPreviewedNote = () => {
    if (!previewedNote) return;
    focusNoteAfterEditRef.current = true;
    setNoteDraft(previewedNote);
    setPreviewedNote(null);
  };

  const visibleConversation = conversation ?? model.conversation;
  const visibleReactions = visibleConversation.reactions.flatMap((reaction) => {
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
          aria-label={`Respond to ${anchor.kindLabel.toLowerCase()} “${controlLabel}” by ${model.personName} on ${model.displayDate} — entry ${position} of ${total}`}
          onClick={(event) => openDetail("reactions", event.currentTarget)}
        >
          ♡ Respond
        </button>
        <button
          type="button"
          aria-label={`Open private notes for ${anchor.kindLabel.toLowerCase()} “${controlLabel}” by ${model.personName} on ${model.displayDate} — entry ${position} of ${total}`}
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
                    <span>
                      {actions
                        ? `Private to ${interaction.audienceName ?? "this family"}`
                        : "Local preview · Nothing is saved"}
                    </span>
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
                    {actions
                      ? `Visible only inside ${interaction.audienceName ?? "this family circle"}`
                      : "Local design preview · Notes and reactions are not saved"}
                  </span>

                  {conversationLoadError ? (
                    <div className="conversation-load-error" role="alert">
                      <p>{conversationLoadError}</p>
                      <button
                        ref={retryButtonRef}
                        type="button"
                        disabled={loadingConversation}
                        onClick={() => void retryConversation()}
                      >
                        Try again
                      </button>
                    </div>
                  ) : null}

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
                    {loadingConversation ? (
                      <p className="quiet-empty" role="status">
                        Opening family responses…
                      </p>
                    ) : conversationLoadError ? (
                      <p className="quiet-empty">
                        Family responses are unavailable right now.
                      </p>
                    ) : visibleReactions.length ? (
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
                            disabled={
                              loadingConversation ||
                              mutationPending ||
                              Boolean(actions && !conversation)
                            }
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
                    {actions ? (
                      <button
                        className="preview-note-action"
                        type="button"
                        disabled={
                          loadingConversation ||
                          mutationPending ||
                          !conversation ||
                          selectedReactionId === savedReactionId
                        }
                        onClick={async () => {
                          setMutationPending(true);
                          setConversationMessage(null);
                          try {
                            const savedReaction = selectedReactionId;
                            const result = await actions.setReaction({
                              momentId: model.id,
                              reactionId: savedReaction,
                            });
                            if (!result.ok) {
                              setConversationMessage(result.message);
                              return;
                            }
                            setSavedReactionId(savedReaction);
                            if (await loadConversation()) {
                              setConversationMessage(result.message);
                            } else {
                              setSelectedReactionId(savedReaction);
                              setSavedReactionId(savedReaction);
                              setConversationMessage(
                                "Your response was saved, but this conversation needs to be reopened.",
                              );
                            }
                            focusReactionHeading();
                          } catch {
                            setConversationMessage(
                              "The response could not be saved. Try again.",
                            );
                          } finally {
                            setMutationPending(false);
                          }
                        }}
                      >
                        {mutationPending ? "Saving…" : "Save response"}
                      </button>
                    ) : selectedReactionId ? (
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
                    {loadingConversation ? (
                      <p className="quiet-empty" role="status">
                        Opening family notes…
                      </p>
                    ) : conversationLoadError ? (
                      <p className="quiet-empty">
                        Family notes are unavailable right now.
                      </p>
                    ) : visibleConversation.notes.length ? (
                      <ol className="family-notes">
                        {visibleConversation.notes.map((note, noteIndex) => (
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
                              {editingNoteId === note.id ? (
                                <form
                                  className="note-preview-form"
                                  onSubmit={async (event) => {
                                    event.preventDefault();
                                    if (
                                      !actions ||
                                      !note.revision ||
                                      !editingNoteBody.trim()
                                    )
                                      return;
                                    setMutationPending(true);
                                    setConversationMessage(null);
                                    try {
                                      const result = await actions.updateNote({
                                        noteId: note.id,
                                        revision: note.revision,
                                        body: editingNoteBody.trim(),
                                      });
                                      if (!result.ok) {
                                        setConversationMessage(result.message);
                                        return;
                                      }
                                      setEditingNoteId(null);
                                      setEditingNoteBody("");
                                      if (await loadConversation()) {
                                        setConversationMessage("Note updated.");
                                      } else {
                                        setConversationMessage(
                                          "Your note was updated, but this conversation needs to be reopened.",
                                        );
                                      }
                                      focusNotesHeading();
                                    } catch {
                                      setConversationMessage(
                                        "The note could not be updated. Try again.",
                                      );
                                    } finally {
                                      setMutationPending(false);
                                    }
                                  }}
                                >
                                  <label
                                    htmlFor={`${dialogId}-edit-${note.id}`}
                                  >
                                    Edit your family note
                                  </label>
                                  <textarea
                                    id={`${dialogId}-edit-${note.id}`}
                                    value={editingNoteBody}
                                    maxLength={1000}
                                    onChange={(event) =>
                                      setEditingNoteBody(event.target.value)
                                    }
                                  />
                                  <div>
                                    <button
                                      type="button"
                                      disabled={mutationPending}
                                      onClick={() => {
                                        setEditingNoteId(null);
                                        setEditingNoteBody("");
                                        focusNotesHeading();
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="submit"
                                      disabled={
                                        mutationPending ||
                                        !editingNoteBody.trim()
                                      }
                                    >
                                      {mutationPending
                                        ? "Saving…"
                                        : "Save note"}
                                    </button>
                                  </div>
                                </form>
                              ) : (
                                <>
                                  <p>{note.body}</p>
                                  {actions &&
                                  note.canChange &&
                                  note.revision ? (
                                    <div className="note-owner-actions">
                                      <button
                                        type="button"
                                        aria-label={`Edit — your note “${conciseLabel(note.body, 48)}” from ${note.displayDate} — note ${noteIndex + 1} of ${visibleConversation.notes.length}`}
                                        disabled={mutationPending}
                                        onClick={() => {
                                          setEditingNoteId(note.id);
                                          setEditingNoteBody(note.body);
                                          setConversationMessage(null);
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        aria-label={`Remove — your note “${conciseLabel(note.body, 48)}” from ${note.displayDate} — note ${noteIndex + 1} of ${visibleConversation.notes.length}`}
                                        disabled={mutationPending}
                                        onClick={async () => {
                                          if (
                                            !window.confirm(
                                              "Remove your note from this family conversation? It cannot be restored here.",
                                            )
                                          )
                                            return;
                                          setMutationPending(true);
                                          setConversationMessage(null);
                                          try {
                                            const result =
                                              await actions.trashNote({
                                                noteId: note.id,
                                                revision: note.revision!,
                                              });
                                            if (!result.ok) {
                                              setConversationMessage(
                                                result.message,
                                              );
                                              return;
                                            }
                                            if (await loadConversation()) {
                                              setConversationMessage(
                                                "Note removed from this conversation.",
                                              );
                                            } else {
                                              setConversationMessage(
                                                "Your note was removed, but this conversation needs to be reopened.",
                                              );
                                            }
                                            focusNotesHeading();
                                          } catch {
                                            setConversationMessage(
                                              "The note could not be removed. Try again.",
                                            );
                                          } finally {
                                            setMutationPending(false);
                                          }
                                        }}
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ) : null}
                                </>
                              )}
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
                          {actions
                            ? `Visible only inside ${interaction.audienceName ?? "this family circle"}`
                            : "Private to this family · Local preview only"}
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
                        <button
                          className="preview-note-action"
                          type="submit"
                          disabled={
                            mutationPending ||
                            loadingConversation ||
                            Boolean(actions && !conversation)
                          }
                        >
                          {actions
                            ? mutationPending
                              ? "Saving…"
                              : "Save note"
                            : "Preview note"}
                        </button>
                      </form>
                    )}
                  </section>

                  {conversationMessage ? (
                    <p className="reaction-preview-status" role="status">
                      {conversationMessage}
                    </p>
                  ) : null}
                  <button
                    className="moment-detail-close-action"
                    type="button"
                    onClick={() => requestClose()}
                  >
                    {actions ? "Close" : "Close preview"}
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
