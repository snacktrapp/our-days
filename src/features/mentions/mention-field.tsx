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

function scrollPickerAboveField(picker: HTMLElement, field: HTMLElement) {
  const scroller = picker.closest(
    ".composer-editor-scroll, .comment-sheet-body, .composer-sheet-body",
  );
  if (!(scroller instanceof HTMLElement)) return;
  const padding = 8;
  const viewportBottom = window.visualViewport
    ? window.visualViewport.offsetTop + window.visualViewport.height
    : window.innerHeight;
  const scrollerRect = scroller.getBoundingClientRect();
  const visibleBottom = Math.min(scrollerRect.bottom, viewportBottom) - padding;
  const pickerTop = picker.getBoundingClientRect().top;
  if (pickerTop < scrollerRect.top + padding) {
    scroller.scrollTop -= scrollerRect.top + padding - pickerTop;
  }
  const fieldBottom = field.getBoundingClientRect().bottom;
  if (fieldBottom > visibleBottom) {
    scroller.scrollTop += fieldBottom - visibleBottom;
  }
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
  const pickerRef = useRef<HTMLUListElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const caretRef = useRef<number | null>(null);
  const query = enabled ? mentionQueryAt(value, cursor, mentions) : null;
  const choices = query ? filterMentionCandidates(members, query.query) : [];
  const open = Boolean(query && choices.length > 0);

  useLayoutEffect(() => {
    const caret = caretRef.current;
    const field = textareaRef.current;
    if (caret === null || !field) return;
    caretRef.current = null;
    field.setSelectionRange(caret, caret);
  }, [value]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const picker = pickerRef.current;
    const field = textareaRef.current;
    if (!root) return;
    if (!open || !picker || !field) {
      root.style.marginTop = "";
      return;
    }
    root.style.marginTop = `${picker.offsetHeight + 6}px`;
    scrollPickerAboveField(picker, field);
  }, [open, choices.length, value]);

  return (
    <div className="mention-field" ref={rootRef}>
      {open && query ? (
        <ul
          ref={pickerRef}
          className="mention-picker"
          role="listbox"
          aria-label="Mention a circle member"
        >
          {choices.map((member) => (
            <li key={member.userId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
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
                }}
              >
                <span
                  className={`comment-color-dot dot-${member.accent}`}
                  aria-hidden="true"
                />
                <span>{member.name}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
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
    </div>
  );
}
