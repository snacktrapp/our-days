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
    layout?: "inline" | "pill";
    submitLabel?: string;
    submitDisabled?: boolean;
  }>;

function SendArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 19V6M6.5 11.5 12 6l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
  layout = "inline",
  submitLabel,
  submitDisabled = false,
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
    const line = Number.parseFloat(getComputedStyle(field).lineHeight) || 20;
    const max = layout === "pill" ? line * 5 : 136;
    if (layout === "pill") field.style.height = `${line}px`;
    else field.style.height = "0px";
    const content =
      layout === "pill" && field.value.length === 0 ? line : field.scrollHeight;
    const next = Math.min(Math.max(content, line), max);
    field.style.height = `${next}px`;
    field.parentElement?.classList.toggle(
      "is-multiline",
      layout === "pill" && next > line + 1,
    );
    if (caret !== null) {
      caretRef.current = null;
      field.setSelectionRange(caret, caret);
    }
    const row = chipRowRef.current;
    const target = row ?? field;
    const scroller = target.closest(
      ".composer-editor-scroll, .comment-sheet-body",
    );
    if (!(scroller instanceof HTMLElement)) return;
    const box = target.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    if (box.bottom > view.bottom - 8) {
      scroller.scrollTop += box.bottom - view.bottom + 12;
    } else if (box.top < view.top + 4) {
      scroller.scrollTop -= view.top - box.top + 12;
    }
  }, [value, open, layout]);

  useLayoutEffect(() => {
    if (layout !== "pill") return;
    const field = textareaRef.current;
    if (!field) return;
    const resize = () => {
      const line = Number.parseFloat(getComputedStyle(field).lineHeight) || 20;
      const content = field.value.length === 0 ? line : field.scrollHeight;
      const next = Math.min(Math.max(content, line), line * 5);
      field.style.height = `${next}px`;
      field.parentElement?.classList.toggle("is-multiline", next > line + 1);
    };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [layout, value]);

  const chips =
    open && query ? (
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
    ) : null;

  const field = (
    <textarea
      {...props}
      ref={(node) => assignTextareaRef(node, fieldRef, textareaRef)}
      rows={layout === "pill" ? undefined : props.rows}
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
  );

  return (
    <div className={`mention-field${layout === "pill" ? " is-pill" : ""}`}>
      {layout === "pill" ? chips : null}
      {layout === "pill" ? (
        <div className="mention-pill">
          {field}
          {submitLabel ? (
            <button
              className="mention-send"
              type="submit"
              aria-label={submitLabel}
              disabled={submitDisabled}
            >
              <SendArrow />
            </button>
          ) : null}
        </div>
      ) : (
        field
      )}
      {layout === "pill" ? null : chips}
    </div>
  );
}
