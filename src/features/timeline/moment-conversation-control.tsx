"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MomentConversationActions } from "@/features/moments/moment-action-types";
import type {
  MomentConversationViewModel,
  MomentDetailViewModel,
  MomentInteractionViewModel,
  MomentReactionId,
} from "./timeline-view-model";

type InlinePanel = "note" | "reactions" | null;

const reactionPresentation: Readonly<
  Record<MomentReactionId, { emoji: string; label: string }>
> = {
  "held-close": { emoji: "❤️", label: "Heart" },
  "made-me-smile": { emoji: "😂", label: "Laugh" },
  "remember-this": { emoji: "✨", label: "Meaningful" },
};

type MomentConversationControlProps = Readonly<{
  interaction: MomentInteractionViewModel;
  model: MomentDetailViewModel;
  actions?: MomentConversationActions;
  position?: number;
  total?: number;
}>;

function momentKindLabel(model: MomentDetailViewModel) {
  if (model.kind === "photo") return "photo";
  if (model.kind === "location") return "place";
  return model.kind;
}

function conciseLabel(value: string, maxLength = 48) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function currentReaction(
  conversation: MomentConversationViewModel,
): MomentReactionId | null {
  return (
    conversation.reactions.find((reaction) => reaction.isCurrentMember)
      ?.reactionId ?? null
  );
}

export function MomentConversationControl({
  interaction,
  model,
  actions,
  position = 1,
  total = 1,
}: MomentConversationControlProps) {
  const panelId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteTriggerRef = useRef<HTMLButtonElement>(null);
  const reactionControlRef = useRef<HTMLDivElement>(null);
  const reactionTriggerRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<InlinePanel>(null);
  const [conversation, setConversation] = useState<MomentConversationViewModel>(
    model.conversation,
  );
  const [conversationLoaded, setConversationLoaded] = useState(!actions);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [selectedReactionId, setSelectedReactionId] =
    useState<MomentReactionId | null>(() =>
      currentReaction(model.conversation),
    );

  const reactionOptions = useMemo(
    () =>
      new Map(interaction.reactionOptions.map((option) => [option.id, option])),
    [interaction.reactionOptions],
  );
  const visibleReactions = conversation.reactions.flatMap((reaction) => {
    const option = reactionOptions.get(reaction.reactionId);
    return option ? [{ ...reaction, option }] : [];
  });
  const kindLabel = momentKindLabel(model);
  const controlLabel = conciseLabel(model.text);

  useEffect(() => {
    if (panel !== "note") return;
    const frame = window.requestAnimationFrame(() =>
      noteRef.current?.focus({ preventScroll: !editingNoteId }),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [editingNoteId, panel]);

  useEffect(() => {
    if (panel !== "reactions") return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !reactionControlRef.current?.contains(event.target)
      ) {
        setPanel(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPanel(null);
      window.requestAnimationFrame(() =>
        reactionTriggerRef.current?.focus({ preventScroll: true }),
      );
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [panel]);

  useEffect(() => {
    if (!actions) return;
    let active = true;
    void actions.load({ momentId: model.id }).then((result) => {
      if (!active || !result.ok) return;
      setConversation(result.conversation);
      setSelectedReactionId(currentReaction(result.conversation));
      setConversationLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [actions, model.id]);

  const loadConversation = async (force = false) => {
    if (!actions || (conversationLoaded && !force)) return true;
    setLoading(true);
    setError(null);
    try {
      const result = await actions.load({ momentId: model.id });
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      setConversation(result.conversation);
      setSelectedReactionId(currentReaction(result.conversation));
      setConversationLoaded(true);
      return true;
    } catch {
      setError("This family conversation could not be loaded. Try again.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const togglePanel = async (nextPanel: Exclude<InlinePanel, null>) => {
    setError(null);
    if (panel === nextPanel) {
      setPanel(null);
      return;
    }
    setPanel(nextPanel);
    await loadConversation();
  };

  const openReactionPicker = () => {
    setError(null);
    setPanel("reactions");
    void loadConversation();
  };

  const chooseReaction = async (reactionId: MomentReactionId) => {
    if (pending || loading) return;
    const prior = selectedReactionId;
    const next = prior === reactionId ? null : reactionId;
    setSelectedReactionId(next);
    setPanel(null);
    setError(null);
    window.requestAnimationFrame(() =>
      reactionTriggerRef.current?.focus({ preventScroll: true }),
    );
    if (!actions) {
      return;
    }

    setPending(true);
    try {
      const result = await actions.setReaction({
        momentId: model.id,
        reactionId: next,
      });
      if (!result.ok) {
        setSelectedReactionId(prior);
        setError(result.message);
        return;
      }
      const loaded = await loadConversation(true);
      if (!loaded) setSelectedReactionId(next);
    } catch {
      setSelectedReactionId(prior);
      setError("That response could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  };

  const conversationId = `moment-conversation-${model.id}`;

  useEffect(() => {
    const element = document.getElementById(conversationId);
    if (!element) return;
    const heart = () => void chooseReaction("held-close");
    element.addEventListener("our-days:heart", heart);
    return () => element.removeEventListener("our-days:heart", heart);
  });

  const saveNote = async () => {
    const body = noteDraft.trim();
    if (!body) {
      setError("Write a note before saving it.");
      noteRef.current?.focus();
      return;
    }
    setPending(true);
    setError(null);
    try {
      const editingNote = editingNoteId
        ? conversation.notes.find((note) => note.id === editingNoteId)
        : undefined;
      if (actions && editingNote?.revision) {
        const result = await actions.updateNote({
          noteId: editingNote.id,
          revision: editingNote.revision,
          body,
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        await loadConversation(true);
      } else if (actions) {
        const result = await actions.createNote({ momentId: model.id, body });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        await loadConversation(true);
      } else {
        setConversation((current) => ({
          ...current,
          notes: [
            ...current.notes,
            {
              id: `preview-${current.notes.length + 1}`,
              authorName: interaction.currentPerson.name,
              authorInitial: interaction.currentPerson.initial,
              authorAccent: interaction.currentPerson.accent,
              body,
              displayDate: "Just now",
              canChange: true,
            },
          ],
        }));
      }
      setNoteDraft("");
      setEditingNoteId(null);
      setPanel(null);
      window.requestAnimationFrame(() =>
        noteTriggerRef.current?.focus({ preventScroll: true }),
      );
    } catch {
      setError("That note could not be saved. Try again.");
    } finally {
      setPending(false);
    }
  };

  const noteLabel = conversation.notes.length > 0 ? "Notes" : "Note";
  const visibleNotes = showAllNotes
    ? conversation.notes
    : conversation.notes.slice(0, 2);

  return (
    <div id={conversationId} className="inline-conversation">
      {visibleReactions.length > 0 || conversation.notes.length > 0 ? (
        <div className="conversation-summary" aria-label="Family activity">
          {visibleReactions.length > 0 ? (
            <ul
              className="inline-reaction-summary"
              aria-label="Family responses"
            >
              {visibleReactions.map((reaction) => (
                <li key={reaction.id}>
                  <span aria-hidden="true">
                    {reactionPresentation[reaction.reactionId].emoji}
                  </span>
                  <span>{reaction.personName}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {conversation.notes.length > 0 ? (
            <>
              <ol
                className="inline-note-summary"
                aria-label="Notes from family"
              >
                {visibleNotes.map((note) => (
                  <li key={note.id}>
                    <span
                      className={`note-avatar dot-${note.authorAccent}`}
                      aria-hidden="true"
                    >
                      {note.authorInitial}
                    </span>
                    <div>
                      <span className="inline-note-author">
                        <strong>{note.authorName}</strong>
                        {actions && note.canChange && note.revision ? (
                          <span>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => {
                                setEditingNoteId(note.id);
                                setNoteDraft(note.body);
                                setPanel("note");
                                setError(null);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={async () => {
                                if (
                                  !window.confirm(
                                    "Remove this note from the family conversation?",
                                  )
                                )
                                  return;
                                setPending(true);
                                setError(null);
                                try {
                                  const result = await actions.trashNote({
                                    noteId: note.id,
                                    revision: note.revision!,
                                  });
                                  if (!result.ok) {
                                    setError(result.message);
                                    return;
                                  }
                                  await loadConversation(true);
                                } catch {
                                  setError(
                                    "That note could not be removed. Try again.",
                                  );
                                } finally {
                                  setPending(false);
                                }
                              }}
                            >
                              Remove
                            </button>
                          </span>
                        ) : null}
                      </span>
                      <p>{note.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              {conversation.notes.length > 2 ? (
                <button
                  className="inline-notes-more"
                  type="button"
                  onClick={() => setShowAllNotes((current) => !current)}
                >
                  {showAllNotes
                    ? "Show fewer notes"
                    : `Show ${conversation.notes.length - 2} more`}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="soft-actions">
        <div ref={reactionControlRef} className="quick-reaction-control">
          <button
            ref={reactionTriggerRef}
            className="quick-reaction-trigger"
            type="button"
            aria-expanded={panel === "reactions"}
            aria-haspopup="menu"
            aria-controls={`${panelId}-reactions`}
            aria-label={`Choose a reaction for ${kindLabel} “${controlLabel}” by ${model.personName} on ${model.displayDate} — entry ${position} of ${total}`}
            title="Choose a reaction"
            onContextMenu={(event) => {
              event.preventDefault();
              openReactionPicker();
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp") return;
              event.preventDefault();
              openReactionPicker();
            }}
            onClick={() => void togglePanel("reactions")}
          >
            <span aria-hidden="true">
              {selectedReactionId
                ? reactionPresentation[selectedReactionId].emoji
                : "♡"}
            </span>
          </button>
          {panel === "reactions" ? (
            <div
              id={`${panelId}-reactions`}
              className="inline-reaction-picker"
              role="menu"
              aria-label="Choose a reaction"
            >
              {interaction.reactionOptions.map((option) => {
                const presentation = reactionPresentation[option.id];
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="menuitemradio"
                    aria-label={presentation.label}
                    aria-checked={selectedReactionId === option.id}
                    disabled={loading || pending}
                    onClick={() => void chooseReaction(option.id)}
                  >
                    <span aria-hidden="true">{presentation.emoji}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <button
          ref={noteTriggerRef}
          className="note-action-trigger"
          type="button"
          aria-expanded={panel === "note"}
          aria-controls={`${panelId}-note`}
          aria-label={`Add a note to ${kindLabel} “${controlLabel}” by ${model.personName} on ${model.displayDate} — entry ${position} of ${total}`}
          onClick={() => void togglePanel("note")}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5.5 5.5h13a2 2 0 0 1 2 2v7.75a2 2 0 0 1-2 2h-7L7 20v-2.75H5.5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z" />
            <path d="M8 10h8M8 13h5" />
          </svg>
          <span className="sr-only">{noteLabel}</span>
        </button>
        {model.taggedPeopleLabel ? (
          <span className="tagged">with {model.taggedPeopleLabel}</span>
        ) : null}
      </div>

      {panel === "note" ? (
        <form
          id={`${panelId}-note`}
          className="inline-note-form"
          onSubmit={(event) => {
            event.preventDefault();
            void saveNote();
          }}
        >
          <textarea
            ref={noteRef}
            id={`${panelId}-note-field`}
            aria-label={editingNoteId ? "Edit your note" : "Add a family note"}
            value={noteDraft}
            maxLength={1000}
            placeholder="A memory, detail, or reply…"
            disabled={loading || pending}
            onChange={(event) => {
              setNoteDraft(event.target.value);
              if (event.target.value.trim()) setError(null);
            }}
          />
          <div>
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setNoteDraft("");
                setEditingNoteId(null);
                setError(null);
                setPanel(null);
                window.requestAnimationFrame(() =>
                  noteTriggerRef.current?.focus({ preventScroll: true }),
                );
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || pending || !noteDraft.trim()}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      ) : null}

      {error ? (
        <p className="inline-conversation-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
