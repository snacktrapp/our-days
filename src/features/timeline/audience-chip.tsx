"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import { PostToChoices } from "@/features/composer/post-to-field";
import {
  initialPostToCircleIds,
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
    initialPostToCircleIds(circles, {
      audience,
      circleId,
      linkedCircleIds,
    }),
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
      initialPostToCircleIds(circles, {
        audience,
        circleId,
        linkedCircleIds,
      }),
    );
    setMessage(null);
    setOpen(true);
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
            <PostToChoices
              circles={circles}
              selectedIds={selectedIds}
              justMe={justMe}
              currentCircleId={lockedCircleId}
              lockedCircleId={lockedCircleId}
              legend="Post to"
              onChange={(next) => {
                setJustMe(next.justMe);
                setSelectedIds(next.selectedIds);
              }}
            />
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
