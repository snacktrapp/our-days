"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";
import {
  applyMentionTextChange,
  filterMentionCandidates,
  insertMention,
  mentionQueryAt,
  type DraftMention,
  type MentionCandidate,
} from "./mention-draft";

type MentionFieldProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "value" | "onChange"
> &
  Readonly<{
    value: string;
    mentions: readonly DraftMention[];
    members: readonly MentionCandidate[];
    enabled: boolean;
    onValueChange: (value: string, mentions: readonly DraftMention[]) => void;
    fieldRef?: Ref<HTMLTextAreaElement>;
  }>;

function assignTextareaRef(
  node: HTMLTextAreaElement | null,
  fieldRef: Ref<HTMLTextAreaElement> | undefined,
  local: { current: HTMLTextAreaElement | null },
) {
  local.current = node;
  if (!fieldRef) return;
  if (typeof fieldRef === "function") fieldRef(node);
  else fieldRef.current = node;
}

export function MentionField({
  value,
  mentions,
  members,
  enabled,
  onValueChange,
  fieldRef,
  onSelect,
  onKeyDown,
  ...props
}: MentionFieldProps) {
  const [cursor, setCursor] = useState(value.length);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const chipRowRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const query = enabled ? mentionQueryAt(value, cursor, mentions) : null;
  const choices = query ? filterMentionCandidates(members, query.query) : [];
  const open = Boolean(query && choices.length > 0);

  useLayoutEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    const caret = caretRef.current;
    field.style.height = "0px";
    const max = 136;
    const next = Math.min(Math.max(field.scrollHeight, 0), max);
    field.style.height = `${next}px`;
    if (caret !== null) {
      caretRef.current = null;
      field.setSelectionRange(caret, caret);
    }
    const row = chipRowRef.current;
    const scroller = row?.closest(
      ".composer-editor-scroll, .comment-sheet-body",
    );
    if (!row || !(scroller instanceof HTMLElement)) return;
    const rowBox = row.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (rowBox.bottom > view.bottom - 4) {
      scroller.scrollTop += rowBox.bottom - view.bottom + 8;
    }
  }, [value, open]);

  return (
    <div className="mention-field">
      <textarea
        {...props}
        ref={(node) => assignTextareaRef(node, fieldRef, textareaRef)}
        value={value}
        onSelect={(event) => {
          setCursor(event.currentTarget.selectionStart ?? value.length);
          onSelect?.(event);
        }}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          const next = event.target.value;
          const selection = event.target.selectionStart ?? next.length;
          if (!enabled) {
            onValueChange(next, []);
            setCursor(selection);
            return;
          }
          const applied = applyMentionTextChange(value, next, mentions);
          if (applied.text !== next) caretRef.current = applied.cursor;
          onValueChange(applied.text, applied.mentions);
          setCursor(applied.text === next ? selection : applied.cursor);
        }}
      />
      {open && query ? (
        <div
          ref={chipRowRef}
          className="mention-chip-row"
          role="listbox"
          aria-label="Mention a circle member"
        >
          {choices.map((member) => (
            <button
              key={member.userId}
              type="button"
              role="option"
              aria-label={member.name}
              aria-selected={false}
              onPointerDown={(event) => event.preventDefault()}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const inserted = insertMention(
                  value,
                  cursor,
                  query.start,
                  member,
                  mentions,
                );
                caretRef.current = inserted.cursor;
                onValueChange(inserted.text, inserted.mentions);
                setCursor(inserted.cursor);
                textareaRef.current?.focus({ preventScroll: true });
              }}
            >
              <span
                className={`mention-chip-mark dot-${member.accent}`}
                aria-hidden="true"
              >
                {member.initial}
              </span>
              <span>{member.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
