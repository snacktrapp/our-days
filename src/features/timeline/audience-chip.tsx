"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { containDialogFocus } from "@/features/dialog/contain-dialog-focus";
import { useModalDialog } from "@/features/dialog/lock-background-scroll";
import { PostToChoices } from "@/features/composer/post-to-field";
import {
  initialPostToCircleIds,
  type PostableCircle,
} from "@/features/composer/post-to";
import { useComposerSession } from "@/features/composer/composer-session";
import { buildComposerEditDraft } from "@/features/composer/build-edit-draft";
import type {
  RemoveMomentPhotoAction,
  ReorderMomentPhotosAction,
  SetMomentAudienceAction,
  UpdateFamilyMomentAction,
} from "@/features/moments/moment-action-types";
import type { MomentAudience } from "@/features/moments/moment-audience";
import type { TimelineMomentViewModel } from "./timeline-view-model";

type AudienceChipProps = Readonly<{
  label: string;
  names?: readonly string[];
  momentId: string;
  revision?: number;
  audience?: MomentAudience;
  circleId?: string;
  linkedCircleIds?: readonly string[];
  circles: readonly PostableCircle[];
  setAudience?: SetMomentAudienceAction;
  edit?: Readonly<{
    moment: TimelineMomentViewModel;
    update: UpdateFamilyMomentAction;
    removePhoto?: RemoveMomentPhotoAction;
    reorderPhotos?: ReorderMomentPhotosAction;
  }>;
}>;

export function AudienceChip({
  label,
  names,
  momentId,
  revision,
  audience = "family",
  circleId,
  linkedCircleIds,
  circles,
  setAudience,
  edit,
}: AudienceChipProps) {
  const router = useRouter();
  const composerSession = useComposerSession();
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
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
  const detailNames =
    names && names.length > 0
      ? names
      : audience === "just_me"
        ? ["Just me"]
        : [];
  const canEdit = Boolean(setAudience || (composerSession && edit));

  const openComposerEdit = () => {
    if (!composerSession || !edit) return false;
    const draft = buildComposerEditDraft(edit.moment, edit.update, {
      removePhoto: edit.removePhoto,
      reorderPhotos: edit.reorderPhotos,
    });
    if (!draft) return false;
    composerSession.openEdit(draft, triggerRef.current);
    return true;
  };

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

  const openEdit = () => {
    setExpanded(false);
    if (openComposerEdit()) return;
    openSheet();
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

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [expanded]);

  return (
    <div ref={rootRef} className="card-audience">
      <button
        ref={triggerRef}
        type="button"
        className="audience-chip"
        aria-expanded={expanded}
        aria-label={`Audience, ${label}`}
        onClick={() => setExpanded((value) => !value)}
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
      {expanded ? (
        <div className="audience-chip-detail">
          {detailNames.length > 0 ? (
            <ul>
              {detailNames.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="audience-chip-edit"
              onClick={openEdit}
            >
              Edit
            </button>
          ) : null}
        </div>
      ) : null}
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
              legend="Who can see this?"
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
    </div>
  );
}
