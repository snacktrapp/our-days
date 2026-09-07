"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import {
  defaultPostToCircleIds,
  type PostableCircle,
} from "@/features/composer/post-to";
import type { SetMomentAudienceAction } from "@/features/moments/moment-action-types";
import type { MomentAudience } from "@/features/moments/moment-audience";

type AudienceChipProps = Readonly<{
  label: string;
  momentId: string;
  revision?: number;
  audience?: MomentAudience;
  circleId?: string;
  linkedCircleIds?: readonly string[];
  circles: readonly PostableCircle[];
  setAudience?: SetMomentAudienceAction;
}>;

export function AudienceChip({
  label,
  momentId,
  revision,
  audience = "family",
  circleId,
  linkedCircleIds,
  circles,
  setAudience,
}: AudienceChipProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [justMe, setJustMe] = useState(audience === "just_me");
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(() =>
    initialSelectedIds(circles, circleId, linkedCircleIds, audience),
  );
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const dialogMounted = useModalDialog(open, dialogRef);
  const lockedCircleId = circleId;

  const close = () => {
    setOpen(false);
    setMessage(null);
    window.requestAnimationFrame(() =>
      triggerRef.current?.focus({ preventScroll: true }),
    );
  };

  const openSheet = () => {
    setJustMe(audience === "just_me");
    setSelectedIds(
      initialSelectedIds(circles, circleId, linkedCircleIds, audience),
    );
    setMessage(null);
    setOpen(true);
  };

  const chooseCircle = (nextCircleId: string, checked: boolean) => {
    if (checked) {
      setJustMe(false);
      setSelectedIds((current) =>
        current.includes(nextCircleId) ? current : [...current, nextCircleId],
      );
      return;
    }
    if (nextCircleId === lockedCircleId) return;
    const remaining = selectedIds.filter((id) => id !== nextCircleId);
    if (remaining.length === 0) return;
    setJustMe(false);
    setSelectedIds(remaining);
  };

  const save = () => {
    if (!setAudience || !revision) {
      setMessage("Preview moments are not saved.");
      return;
    }
    if (!justMe && selectedIds.length === 0) {
      setMessage("Choose at least one circle or Just me.");
      return;
    }
    startTransition(async () => {
      const result = await setAudience({
        momentId,
        revision,
        audience: justMe ? "just_me" : "family",
        circleIds: justMe ? [] : selectedIds,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      close();
      router.refresh();
    });
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="audience-chip"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Audience, ${label}`}
        onClick={openSheet}
      >
        <span
          className={
            audience === "just_me"
              ? "audience-chip-face just-me-pill"
              : "audience-chip-face"
          }
        >
          {label}
        </span>
      </button>
      {dialogMounted ? (
        <dialog
          ref={dialogRef}
          className="audience-edit-dialog"
          aria-labelledby={`audience-edit-title-${momentId}`}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onKeyDown={containDialogFocus}
        >
          <section className="audience-edit-sheet">
            <header className="audience-edit-bar">
              <h2 id={`audience-edit-title-${momentId}`}>Posted to</h2>
              <button type="button" onClick={close}>
                Close
              </button>
            </header>
            <fieldset className="people-tags post-to-circles">
              <legend className="sr-only">Circles</legend>
              <div>
                {circles.map((circle) => {
                  const locked = !justMe && circle.id === lockedCircleId;
                  return (
                    <label key={circle.id}>
                      <input
                        type="checkbox"
                        checked={!justMe && selectedIds.includes(circle.id)}
                        disabled={locked}
                        onChange={(event) =>
                          chooseCircle(circle.id, event.target.checked)
                        }
                      />
                      {circle.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <label className="post-to-just-me">
              <input
                type="checkbox"
                checked={justMe}
                onChange={(event) => {
                  if (event.target.checked) {
                    setJustMe(true);
                    setSelectedIds([]);
                    return;
                  }
                  setJustMe(false);
                  setSelectedIds(
                    defaultPostToCircleIds(circles, lockedCircleId),
                  );
                }}
              />
              Just me
            </label>
            {message ? (
              <p className="audience-edit-message" role="alert">
                {message}
              </p>
            ) : null}
            <div className="audience-edit-actions">
              <button type="button" onClick={close}>
                Cancel
              </button>
              <button type="button" disabled={isPending} onClick={save}>
                Save
              </button>
            </div>
          </section>
        </dialog>
      ) : null}
    </>
  );
}

function initialSelectedIds(
  circles: readonly PostableCircle[],
  circleId: string | undefined,
  linkedCircleIds: readonly string[] | undefined,
  audience: MomentAudience,
) {
  if (audience === "just_me") return [];
  if (linkedCircleIds?.length) {
    const known = new Set(circles.map((circle) => circle.id));
    const selected = linkedCircleIds.filter((id) => known.has(id));
    if (circleId && known.has(circleId) && !selected.includes(circleId)) {
      return [circleId, ...selected];
    }
    return selected.length > 0
      ? selected
      : defaultPostToCircleIds(circles, circleId);
  }
  return defaultPostToCircleIds(circles, circleId);
}
