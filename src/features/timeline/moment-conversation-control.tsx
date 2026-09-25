"use client";

import { flushSync } from "react-dom";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { notifyInlineNotePanelChanged } from "@/features/shell/hide-bottom-nav-while-composing";
import {
  overlayMotionReduced,
  overlayPopoverCloseMs,
} from "@/features/shell/use-overlay-popover-close";
import type { MomentConversationActions } from "@/features/moments/moment-action-types";
import {
  hiddenConversationNoteCount,
  visibleConversationNotes,
} from "./moment-conversation-notes";
import { displayConversationDate } from "./display-conversation-date";
import { MentionField } from "@/features/mentions/mention-field";
import {
  draftFromMentionDisplay,
  mentionsForSavedBody,
  type DraftMention,
  type MentionCandidate,
} from "@/features/mentions/mention-draft";
import { MentionText } from "@/features/mentions/mention-text";
import { CommentDrawer } from "./comment-drawer";
import { HeartGlyph } from "./heart-glyph";

function lovedByLine(names: readonly string[]) {
  if (names.length <= 1) return `Loved by ${names[0] ?? ""}`;
  if (names.length === 2) return `Loved by ${names[0]} and ${names[1]}`;
  const others = names.length - 2;
  return `Loved by ${names[0]}, ${names[1]} and ${others} ${others === 1 ? "other" : "others"}`;
}
import type {
  MomentConversationViewModel,
  MomentDetailViewModel,
  MomentInteractionViewModel,
  MomentReactionId,
} from "./timeline-view-model";

type InlinePanel = "note" | null;

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
  trailing?: ReactNode;
  mentionMembers?: readonly MentionCandidate[];
  mentionsEnabled?: boolean;
}>;

function momentKindLabel(model: MomentDetailViewModel) {
  if (model.kind === "photo") return "photo";
  if (model.kind === "location") return "place";
  if (model.kind === "insight") return "insight";
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

function withCurrentMemberReaction(
  conversation: MomentConversationViewModel,
  person: MomentInteractionViewModel["currentPerson"],
  reactionId: MomentReactionId | null,
): MomentConversationViewModel {
  const others = conversation.reactions.filter(
    (reaction) => !reaction.isCurrentMember,
  );
  if (!reactionId) {
    return { ...conversation, reactions: others };
  }
  const existing = conversation.reactions.find(
    (reaction) => reaction.isCurrentMember,
  );
  return {
    ...conversation,
    reactions: [
      ...others,
      {
        id: existing?.id ?? "optimistic-current-reaction",
        personName: person.name,
        personInitial: person.initial,
        personAccent: person.accent,
        reactionId,
        isCurrentMember: true,
      },
    ],
  };
}

function reactionPresenceKey(reaction: {
  id: string;
  reactionId: MomentReactionId;
  isCurrentMember?: boolean;
}) {
  return reaction.isCurrentMember
    ? `current:${reaction.reactionId}`
    : reaction.id;
}

function overlayCurrentMemberReaction(
  server: MomentConversationViewModel,
  local: MomentConversationViewModel,
): MomentConversationViewModel {
  const localCurrent = local.reactions.find(
    (reaction) => reaction.isCurrentMember,
  );
  const others = server.reactions.filter(
    (reaction) => !reaction.isCurrentMember,
  );
  return {
    ...server,
    reactions: localCurrent ? [...others, localCurrent] : others,
  };
}

export function MomentConversationControl({
  interaction,
  model,
  actions,
  position = 1,
  total = 1,
  trailing,
  mentionMembers = [],
  mentionsEnabled = false,
}: MomentConversationControlProps) {
  const panelId = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteTriggerRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<InlinePanel>(null);
  const [conversation, setConversation] = useState<MomentConversationViewModel>(
    model.conversation,
  );
  const [conversationLoaded, setConversationLoaded] = useState(true);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMentions, setNoteMentions] = useState<readonly DraftMention[]>([]);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [noteHeartPops, setNoteHeartPops] = useState<
    Readonly<Record<string, number>>
  >({});
  const [openHeartNamesId, setOpenHeartNamesId] = useState<string | null>(null);
  const [noteBurst, setNoteBurst] = useState<{
    noteId: string;
    generation: number;
    x: number;
    y: number;
  } | null>(null);
  const notePointer = useRef<{
    id: number;
    noteId: string;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const noteTap = useRef<{
    noteId: string;
    time: number;
    x: number;
    y: number;
  } | null>(null);
  useEffect(() => {
    const onTarget = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          momentId?: string;
          noteId?: string | null;
          openThread?: boolean;
        }>
      ).detail;
      if (detail?.momentId !== model.id) return;
      if (detail.openThread) setShowAllNotes(true);
    };
    window.addEventListener("our-days:notification-target", onTarget);
    return () =>
      window.removeEventListener("our-days:notification-target", onTarget);
  }, [model.id]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [selectedReactionId, setSelectedReactionId] =
    useState<MomentReactionId | null>(() =>
      currentReaction(model.conversation),
    );
  const reactionWriteGen = useRef(0);
  const reactionOptions = useMemo(
    () =>
      new Map(interaction.reactionOptions.map((option) => [option.id, option])),
    [interaction.reactionOptions],
  );
  const visibleReactions = useMemo(
    () =>
      conversation.reactions.flatMap((reaction) => {
        const option = reactionOptions.get(reaction.reactionId);
        return option
          ? [
              {
                ...reaction,
                option,
                presenceKey: reactionPresenceKey(reaction),
              },
            ]
          : [];
      }),
    [conversation.reactions, reactionOptions],
  );
  const [heartPopGeneration, setHeartPopGeneration] = useState(0);
  const [enteringKeys, setEnteringKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [leavingReactions, setLeavingReactions] = useState<
    typeof visibleReactions
  >([]);
  const [previousReactions, setPreviousReactions] = useState(visibleReactions);
  const kindLabel = momentKindLabel(model);
  const controlLabel = conciseLabel(model.text);

  if (previousReactions !== visibleReactions) {
    setPreviousReactions(visibleReactions);
    const nextKeys = new Set(
      visibleReactions.map((reaction) => reaction.presenceKey),
    );
    const previousKeys = new Set(
      previousReactions.map((reaction) => reaction.presenceKey),
    );
    const added = visibleReactions.filter(
      (reaction) => !previousKeys.has(reaction.presenceKey),
    );
    const removed = previousReactions.filter(
      (reaction) => !nextKeys.has(reaction.presenceKey),
    );
    if (overlayMotionReduced()) {
      if (enteringKeys.size > 0) setEnteringKeys(new Set());
      if (leavingReactions.length > 0) setLeavingReactions([]);
    } else {
      let nextEntering: Set<string> | null = null;
      if (added.length > 0) {
        nextEntering = new Set(enteringKeys);
        for (const reaction of added) nextEntering.add(reaction.presenceKey);
      }
      if (removed.length > 0) {
        const fadeOut = removed.filter(
          (reaction) => !enteringKeys.has(reaction.presenceKey),
        );
        const cancelEnter = removed.filter((reaction) =>
          enteringKeys.has(reaction.presenceKey),
        );
        if (cancelEnter.length > 0) {
          nextEntering ??= new Set(enteringKeys);
          for (const reaction of cancelEnter) {
            nextEntering.delete(reaction.presenceKey);
          }
        }
        if (fadeOut.length > 0) {
          setLeavingReactions((current) => [
            ...current.filter(
              (reaction) => !nextKeys.has(reaction.presenceKey),
            ),
            ...fadeOut,
          ]);
        }
      }
      if (nextEntering) setEnteringKeys(nextEntering);
    }
  }

  useEffect(() => {
    if (leavingReactions.length === 0) return;
    const timer = window.setTimeout(() => {
      setLeavingReactions([]);
    }, overlayPopoverCloseMs);
    return () => window.clearTimeout(timer);
  }, [leavingReactions]);

  const displayedReactions = useMemo(() => {
    const visibleKeys = new Set(
      visibleReactions.map((reaction) => reaction.presenceKey),
    );
    return [
      ...visibleReactions,
      ...leavingReactions.filter(
        (reaction) => !visibleKeys.has(reaction.presenceKey),
      ),
    ].sort(
      (a, b) =>
        Number(b.reactionId === "held-close") -
        Number(a.reactionId === "held-close"),
    );
  }, [leavingReactions, visibleReactions]);

  const popHeart = useCallback(() => {
    if (overlayMotionReduced()) return;
    setHeartPopGeneration((current) => current + 1);
  }, []);

  useLayoutEffect(() => {
    notifyInlineNotePanelChanged();
    return () => notifyInlineNotePanelChanged();
  }, [panel]);

  const applyLoadedConversation = useCallback(
    (next: MomentConversationViewModel, startedWriteGen: number) => {
      if (startedWriteGen !== reactionWriteGen.current) {
        setConversation((current) =>
          overlayCurrentMemberReaction(next, current),
        );
        setConversationLoaded(true);
        return;
      }
      setConversation(next);
      setSelectedReactionId(currentReaction(next));
      setConversationLoaded(true);
    },
    [],
  );

  const loadConversation = async (force = false) => {
    if (!actions || (conversationLoaded && !force)) return true;
    const startedWriteGen = reactionWriteGen.current;
    setLoading(true);
    setError(null);
    try {
      const result = await actions.load({ momentId: model.id });
      if (!result.ok) {
        setError(result.message);
        return false;
      }
      applyLoadedConversation(result.conversation, startedWriteGen);
      return true;
    } catch {
      setError("This family conversation could not be loaded. Try again.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  const togglePanel = async (nextPanel: "note") => {
    setError(null);
    if (panel === nextPanel) {
      setPanel(null);
      return;
    }
    // Focus during the original tap so iOS opens the keyboard immediately.
    flushSync(() => setPanel("note"));
    noteRef.current?.focus({ preventScroll: true });
    await loadConversation();
  };

  const chooseReaction = async (reactionId: MomentReactionId) => {
    const priorReactionId = selectedReactionId;
    const priorConversation = conversation;
    const next = priorReactionId === reactionId ? null : reactionId;
    reactionWriteGen.current += 1;
    const writeGen = reactionWriteGen.current;
    setSelectedReactionId(next);
    setConversation((current) =>
      withCurrentMemberReaction(current, interaction.currentPerson, next),
    );
    if (next) popHeart();
    setError(null);
    if (!actions) {
      return;
    }

    setPending(true);
    try {
      const result = await actions.setReaction({
        momentId: model.id,
        reactionId: next,
      });
      if (writeGen !== reactionWriteGen.current) return;
      if (!result.ok) {
        setSelectedReactionId(priorReactionId);
        setConversation(priorConversation);
        setError(result.message);
        return;
      }
    } catch {
      if (writeGen !== reactionWriteGen.current) return;
      setSelectedReactionId(priorReactionId);
      setConversation(priorConversation);
      setError("That response could not be saved. Try again.");
    } finally {
      if (writeGen === reactionWriteGen.current) setPending(false);
    }
  };

  const chooseNoteHeart = async (noteId: string, hearted: boolean) => {
    const priorConversation = conversation;
    const personName = interaction.currentPerson.name;
    setConversation((current) => ({
      ...current,
      notes: current.notes.map((note) => {
        if (note.id !== noteId) return note;
        const names = note.heartNames ?? [];
        const nextNames = hearted
          ? names.includes(personName)
            ? names
            : [...names, personName]
          : names.filter((name) => name !== personName);
        return {
          ...note,
          heartedByViewer: hearted,
          heartNames: nextNames,
          heartCount: nextNames.length,
        };
      }),
    }));
    if (hearted && !overlayMotionReduced()) {
      setNoteHeartPops((current) => ({
        ...current,
        [noteId]: (current[noteId] ?? 0) + 1,
      }));
    }
    setError(null);
    if (!actions) return;
    try {
      const result = await actions.setNoteHeart({
        noteId,
        momentId: model.id,
        hearted,
      });
      if (!result.ok) {
        setConversation(priorConversation);
        setError(result.message);
      }
    } catch {
      setConversation(priorConversation);
      setError("That heart could not be saved. Try again.");
    }
  };

  const conversationId = `moment-conversation-${model.id}`;

  useEffect(() => {
    const element = document.getElementById(conversationId);
    if (!element) return;
    const heart = (event: Event) => {
      if (selectedReactionId !== "held-close" && !pending) {
        event.preventDefault();
        void chooseReaction("held-close");
      }
    };
    element.addEventListener("our-days:heart", heart);
    return () => element.removeEventListener("our-days:heart", heart);
  });

  const rememberLocalNote = (nextBody: string, idPrefix: string) => {
    setConversation((current) => ({
      ...current,
      notes: [
        ...current.notes,
        {
          id: `${idPrefix}-${current.notes.length + 1}`,
          authorName: interaction.currentPerson.name,
          authorInitial: interaction.currentPerson.initial,
          authorAccent: interaction.currentPerson.accent,
          body: nextBody,
          displayDate: "Just now",
          canChange: true,
          revision: 1,
          heartCount: 0,
          heartedByViewer: false,
          heartNames: [],
        },
      ],
    }));
  };

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
          momentId: model.id,
          revision: editingNote.revision,
          body,
          mentions: mentionsForSavedBody(noteDraft, noteMentions),
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setConversation((current) => ({
          ...current,
          notes: current.notes.map((note) =>
            note.id === editingNote.id ? { ...note, body } : note,
          ),
        }));
        const reloaded = await loadConversation(true);
        if (!reloaded) setError(null);
      } else if (actions) {
        const result = await actions.createNote({
          momentId: model.id,
          body,
          mentions: mentionsForSavedBody(noteDraft, noteMentions),
        });
        if (!result.ok) {
          setError(result.message);
          return;
        }
        rememberLocalNote(body, "pending");
        const reloaded = await loadConversation(true);
        if (!reloaded) setError(null);
      } else {
        rememberLocalNote(body, "preview");
      }
      setNoteDraft("");
      setNoteMentions([]);
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

  const openNoteEditor = (note: (typeof conversation.notes)[number]) => {
    flushSync(() => {
      setEditingNoteId(note.id);
      const drafted = draftFromMentionDisplay(note.body, note.mentions ?? []);
      setNoteDraft(drafted.text);
      setNoteMentions(drafted.mentions);
      setPanel("note");
      setError(null);
    });
    noteRef.current?.focus({ preventScroll: true });
  };

  const removeNote = async (note: { id: string; revision?: number }) => {
    if (!window.confirm("Remove this comment?")) return;
    if (!actions || !note.revision) {
      setConversation((current) => ({
        ...current,
        notes: current.notes.filter((item) => item.id !== note.id),
      }));
      setNoteDraft("");
      setNoteMentions([]);
      setEditingNoteId(null);
      setError(null);
      setPanel(null);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await actions.trashNote({
        noteId: note.id,
        revision: note.revision,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setNoteDraft("");
      setNoteMentions([]);
      setEditingNoteId(null);
      setPanel(null);
      await loadConversation(true);
    } catch {
      setError("That note could not be removed. Try again.");
    } finally {
      setPending(false);
    }
  };

  const noteLabel = conversation.notes.length > 0 ? "Notes" : "Note";
  const visibleNotes = visibleConversationNotes(
    conversation.notes,
    showAllNotes,
  );
  const olderNoteCount = hiddenConversationNoteCount(conversation.notes.length);

  const reactionNames =
    displayedReactions.length > 0 ? (
      <ul className="inline-reaction-summary" aria-label="Family responses">
        {displayedReactions.map((reaction, index) => {
          const leaving = leavingReactions.some(
            (item) => item.presenceKey === reaction.presenceKey,
          );
          const entering = enteringKeys.has(reaction.presenceKey);
          return (
            <li
              key={reaction.presenceKey}
              className={
                leaving ? "is-closing" : entering ? "is-entering" : undefined
              }
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.animationName === "overlay-popover-in") {
                  setEnteringKeys((current) => {
                    if (!current.has(reaction.presenceKey)) return current;
                    const next = new Set(current);
                    next.delete(reaction.presenceKey);
                    return next;
                  });
                  return;
                }
                if (event.animationName !== "overlay-popover-out") return;
                setLeavingReactions((current) =>
                  current.filter(
                    (item) => item.presenceKey !== reaction.presenceKey,
                  ),
                );
              }}
            >
              {reaction.reactionId !== "held-close" ? (
                <span
                  aria-label={reactionPresentation[reaction.reactionId].label}
                >
                  {reactionPresentation[reaction.reactionId].emoji}
                </span>
              ) : null}
              <span>
                {reaction.personName}
                {index < displayedReactions.length - 1 ? "," : ""}
              </span>
            </li>
          );
        })}
      </ul>
    ) : null;
  return (
    <div id={conversationId} className="inline-conversation">
      <div className="soft-actions">
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
            <path d="M5.5 4.25h13a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7L7 20v-2.75H5.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" />
            <path d="M8 10h8M8 13h5" />
          </svg>
          <span className="sr-only">{noteLabel}</span>
        </button>
        <div className="quick-reaction-control">
          <button
            className="quick-reaction-trigger"
            type="button"
            aria-pressed={selectedReactionId === "held-close"}
            aria-label={`Love ${kindLabel} “${controlLabel}” by ${model.personName} on ${model.displayDate} — entry ${position} of ${total}`}
            title={selectedReactionId === "held-close" ? "Undo love" : "Love"}
            disabled={pending}
            onClick={() => void chooseReaction("held-close")}
          >
            <span
              key={heartPopGeneration}
              className={`quick-reaction-glyph${heartPopGeneration > 0 ? " is-popping" : ""}`}
              aria-hidden="true"
            >
              <HeartGlyph filled={selectedReactionId === "held-close"} />
            </span>
          </button>
        </div>
        <div className="reaction-names">{reactionNames}</div>
        {trailing}
      </div>

      {conversation.notes.length > 0 ? (
        <>
          <ol
            id={`${panelId}-comments`}
            className="inline-note-summary"
            aria-label="Notes from family"
          >
            {visibleNotes.map((note) => (
              <li
                key={note.id}
                id={`note-${note.id}`}
                className="inline-note-row"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  if (!event.isPrimary || event.button !== 0) {
                    notePointer.current = null;
                    noteTap.current = null;
                    return;
                  }
                  if (
                    event.target instanceof Element &&
                    event.target.closest(
                      "button, a, input, textarea, select, [role='button']",
                    )
                  ) {
                    notePointer.current = null;
                    return;
                  }
                  notePointer.current = {
                    id: event.pointerId,
                    noteId: note.id,
                    x: event.clientX,
                    y: event.clientY,
                    moved: false,
                  };
                }}
                onPointerMove={(event) => {
                  const current = notePointer.current;
                  if (
                    current?.noteId === note.id &&
                    Math.hypot(
                      event.clientX - current.x,
                      event.clientY - current.y,
                    ) > 10
                  ) {
                    current.moved = true;
                  }
                }}
                onPointerCancel={() => {
                  notePointer.current = null;
                  noteTap.current = null;
                }}
                onPointerUp={(event) => {
                  event.stopPropagation();
                  const current = notePointer.current;
                  notePointer.current = null;
                  if (
                    !current ||
                    current.noteId !== note.id ||
                    current.id !== event.pointerId ||
                    current.moved ||
                    Math.hypot(
                      event.clientX - current.x,
                      event.clientY - current.y,
                    ) > 10
                  ) {
                    noteTap.current = null;
                    return;
                  }
                  const previous = noteTap.current;
                  const now = performance.now();
                  if (
                    previous &&
                    previous.noteId === note.id &&
                    now - previous.time < 300 &&
                    Math.hypot(
                      previous.x - event.clientX,
                      previous.y - event.clientY,
                    ) < 32
                  ) {
                    noteTap.current = null;
                    event.preventDefault();
                    if (!note.heartedByViewer) {
                      const bounds =
                        event.currentTarget.getBoundingClientRect();
                      setNoteBurst({
                        noteId: note.id,
                        generation: now,
                        x: event.clientX - bounds.left,
                        y: event.clientY - bounds.top,
                      });
                      void chooseNoteHeart(note.id, true);
                    }
                    return;
                  }
                  noteTap.current = {
                    noteId: note.id,
                    time: now,
                    x: event.clientX,
                    y: event.clientY,
                  };
                }}
              >
                <div>
                  <span className="inline-note-author">
                    <strong>
                      <span
                        className={`comment-color-dot dot-${note.authorAccent}`}
                        aria-hidden="true"
                      />
                      {note.authorName}
                    </strong>
                    {note.createdAt ? (
                      <time
                        className="inline-note-when"
                        dateTime={note.createdAt}
                        suppressHydrationWarning
                      >
                        {displayConversationDate(note.createdAt)}
                      </time>
                    ) : (
                      <span className="inline-note-when">
                        {note.displayDate}
                      </span>
                    )}
                    {note.canChange && note.revision ? (
                      <span className="inline-note-more">
                        <button
                          type="button"
                          aria-label="Edit comment"
                          disabled={pending}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            openNoteEditor(note);
                          }}
                        >
                          …
                        </button>
                      </span>
                    ) : null}
                    <span className="inline-note-heart">
                      <button
                        className={`inline-note-heart-trigger${note.heartedByViewer ? " is-loved" : " is-caption"}`}
                        type="button"
                        aria-pressed={note.heartedByViewer === true}
                        aria-label={
                          note.heartedByViewer
                            ? "Undo love on this comment"
                            : "Love this comment"
                        }
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          void chooseNoteHeart(
                            note.id,
                            note.heartedByViewer !== true,
                          );
                        }}
                      >
                        <span
                          key={noteHeartPops[note.id] ?? 0}
                          className={`quick-reaction-glyph${(noteHeartPops[note.id] ?? 0) > 0 ? " is-popping" : ""}`}
                          aria-hidden="true"
                        >
                          <HeartGlyph filled={note.heartedByViewer === true} />
                        </span>
                      </button>
                      {(note.heartCount ?? 0) > 0 ? (
                        <button
                          className="inline-note-heart-count is-caption"
                          type="button"
                          aria-expanded={openHeartNamesId === note.id}
                          aria-label={`${note.heartCount} ${note.heartCount === 1 ? "person loves" : "people love"} this comment`}
                          onPointerDown={(event) => event.stopPropagation()}
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenHeartNamesId((current) =>
                              current === note.id ? null : note.id,
                            );
                          }}
                        >
                          {note.heartCount}
                        </button>
                      ) : null}
                    </span>
                  </span>
                  <p>
                    <MentionText text={note.body} mentions={note.mentions} />
                  </p>
                  {openHeartNamesId === note.id ? (
                    <p className="inline-note-loved">
                      {lovedByLine(note.heartNames ?? [])}
                    </p>
                  ) : null}
                </div>
                {noteBurst?.noteId === note.id ? (
                  <span
                    key={noteBurst.generation}
                    className="post-love-burst"
                    style={{ left: noteBurst.x, top: noteBurst.y }}
                    onAnimationEnd={() => setNoteBurst(null)}
                  >
                    <HeartGlyph filled />
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
          {olderNoteCount > 0 ? (
            <button
              className="inline-notes-more"
              type="button"
              aria-expanded={showAllNotes}
              aria-controls={`${panelId}-comments`}
              onClick={() => setShowAllNotes((current) => !current)}
            >
              {showAllNotes
                ? "Show fewer notes"
                : `Show ${olderNoteCount} more`}
            </button>
          ) : null}
        </>
      ) : null}

      {panel === "note" ? (
        <CommentDrawer
          id={`${panelId}-note`}
          title={editingNoteId ? "Edit comment" : "Add comment"}
          context={`${model.personName} · ${kindLabel}${controlLabel ? ` · ${controlLabel}` : ""}`}
          pending={pending}
          confirmDiscard={
            noteDraft.trim() ? "Discard this comment?" : undefined
          }
          onDismiss={() => {
            setNoteDraft("");
            setNoteMentions([]);
            setEditingNoteId(null);
            setError(null);
            setPanel(null);
            window.requestAnimationFrame(() =>
              noteTriggerRef.current?.focus({ preventScroll: true }),
            );
          }}
        >
          <form
            id={`${panelId}-note-form`}
            className="inline-note-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveNote();
            }}
          >
            <MentionField
              layout="pill"
              leading={
                editingNoteId ? (
                  <button
                    className="comment-delete is-caption"
                    type="button"
                    aria-label="Delete comment"
                    disabled={pending}
                    onClick={() => {
                      const note = conversation.notes.find(
                        (item) => item.id === editingNoteId,
                      );
                      if (note) void removeNote(note);
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                ) : null
              }
              submitLabel={
                pending ? "Saving…" : editingNoteId ? "Save" : "Post"
              }
              submitDisabled={loading || pending || !noteDraft.trim()}
              fieldRef={noteRef}
              id={`${panelId}-note-field`}
              aria-label={
                editingNoteId ? "Edit your note" : "Add a family note"
              }
              value={noteDraft}
              mentions={noteMentions}
              members={mentionMembers}
              enabled={mentionsEnabled}
              maxLength={1000}
              placeholder="A memory, detail, or reply…"
              disabled={loading || pending}
              onValueChange={(next, mentions) => {
                setNoteDraft(next);
                setNoteMentions(mentionsEnabled ? mentions : []);
                if (next.trim()) setError(null);
              }}
            />
            {error ? (
              <p className="inline-conversation-error" role="alert">
                {error}
              </p>
            ) : null}
          </form>
        </CommentDrawer>
      ) : null}

      {error && panel !== "note" ? (
        <p className="inline-conversation-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
