"use client";

import { useEffect, useRef, useState } from "react";

type JournalOption = Readonly<{
  id: string;
  name: string;
  contextLabel: string;
}>;

type JournalPickerFieldProps = Readonly<{
  options: readonly JournalOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}>;

export function JournalPickerField({
  options,
  value,
  onChange,
  disabled = false,
}: JournalPickerFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      window.requestAnimationFrame(() =>
        triggerRef.current?.focus({ preventScroll: true }),
      );
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  if (!selected) return null;

  return (
    <div ref={rootRef} className="composer-field composer-journal-picker">
      <span>Journal</span>
      <button
        ref={triggerRef}
        type="button"
        className="composer-picker-trigger composer-journal-trigger"
        aria-label={`Journal, ${selected.name} · ${selected.contextLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-disabled={disabled || undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
      >
        <span>
          {selected.name} · {selected.contextLabel}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <div
          className="composer-picker-panel composer-journal-menu"
          role="menu"
        >
          {options.map((option) => {
            const isSelected = option.id === selected.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                  window.requestAnimationFrame(() =>
                    triggerRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.contextLabel}</small>
                </span>
                <span aria-hidden="true">{isSelected ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
