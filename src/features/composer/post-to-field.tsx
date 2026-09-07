"use client";

import { useEffect, useRef, useState } from "react";
import { ComposerPickerPanel } from "./composer-picker-panel";
import {
  defaultPostToCircleIds,
  formatPostToTriggerLabel,
  type PostableCircle,
} from "./post-to";

type PostToFieldProps = Readonly<{
  circles: readonly PostableCircle[];
  selectedIds: readonly string[];
  justMe: boolean;
  justMeAllowed?: boolean;
  currentCircleId?: string;
  onChange: (next: { selectedIds: readonly string[]; justMe: boolean }) => void;
}>;

export function PostToField({
  circles,
  selectedIds,
  justMe,
  justMeAllowed = true,
  currentCircleId,
  onChange,
}: PostToFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const label = formatPostToTriggerLabel(circles, selectedIds, justMe);

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

  if (circles.length === 0) return null;

  const chooseCircle = (circleId: string, checked: boolean) => {
    if (checked) {
      onChange({
        justMe: false,
        selectedIds: selectedIds.includes(circleId)
          ? selectedIds
          : [...selectedIds, circleId],
      });
      return;
    }
    const remaining = selectedIds.filter((id) => id !== circleId);
    if (remaining.length === 0) return;
    onChange({ justMe: false, selectedIds: remaining });
  };

  const chooseJustMe = () => {
    if (!justMeAllowed) return;
    onChange({ justMe: true, selectedIds: [] });
  };

  return (
    <div ref={rootRef} className="composer-field composer-post-to-picker">
      <span>Post to</span>
      <button
        ref={triggerRef}
        type="button"
        className="composer-picker-trigger composer-post-to-trigger"
        aria-label={`Post to, ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open ? (
        <ComposerPickerPanel
          className="composer-picker-panel composer-post-to-menu"
          role="dialog"
          aria-label="Post to"
        >
          <fieldset className="people-tags post-to-circles">
            <legend className="sr-only">Circles</legend>
            <div>
              {circles.map((circle) => (
                <label key={circle.id}>
                  <input
                    type="checkbox"
                    checked={!justMe && selectedIds.includes(circle.id)}
                    onChange={(event) =>
                      chooseCircle(circle.id, event.target.checked)
                    }
                  />
                  {circle.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="post-to-just-me">
            <input
              type="checkbox"
              checked={justMe}
              disabled={!justMeAllowed}
              onChange={(event) => {
                if (event.target.checked) {
                  chooseJustMe();
                  return;
                }
                onChange({
                  justMe: false,
                  selectedIds: defaultPostToCircleIds(circles, currentCircleId),
                });
              }}
            />
            Just me
          </label>
        </ComposerPickerPanel>
      ) : null}
    </div>
  );
}
