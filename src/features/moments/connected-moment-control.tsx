"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildComposerEditDraft } from "@/features/composer/build-edit-draft";
import { useComposerSession } from "@/features/composer/composer-session";
import type {
  MomentInteractionViewModel,
  TimelineMomentViewModel,
} from "@/features/timeline/timeline-view-model";
import type { ConnectedMomentActions } from "./moment-action-types";

function announce(message: string) {
  const region = document.getElementById("journal-live-region");
  if (region) region.textContent = message;
}

function focusJournalContext() {
  document
    .getElementById("journal-focus-target")
    ?.focus({ preventScroll: true });
}

function restoreJournalFocusAfterRefresh() {
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(focusJournalContext),
  );
  window.setTimeout(focusJournalContext, 150);
}

function actionMomentLabel(moment: TimelineMomentViewModel) {
  const source =
    moment.kind === "milestone"
      ? moment.milestone
      : moment.kind === "location"
        ? moment.place
        : moment.text;
  const normalized = source.replace(/\s+/gu, " ").trim();
  const excerpt =
    normalized.length <= 72
      ? normalized
      : `${normalized.slice(0, 48)}…${normalized.slice(-20)}`;
  return `${moment.personName}’s “${excerpt}” moment from ${moment.displayDate}`;
}

type ConnectedMomentControlProps = Readonly<{
  moment: TimelineMomentViewModel;
  actions?: ConnectedMomentActions;
  position?: number;
  total?: number;
  taggablePeople?: NonNullable<MomentInteractionViewModel["taggablePeople"]>;
}>;

export function ConnectedMomentControl(props: ConnectedMomentControlProps) {
  if (!props.actions || !props.moment.canChange || !props.moment.revision) {
    return null;
  }

  return <ChangeableMomentControl {...props} actions={props.actions} />;
}

function ChangeableMomentControl({
  moment,
  actions,
  position = 1,
  total = 1,
}: ConnectedMomentControlProps & { actions: ConnectedMomentActions }) {
  const composerSession = useComposerSession();
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !menuWrapperRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setMenuOpen(false);
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [menuOpen]);

  const trash = async () => {
    if (
      !window.confirm(
        "Move this moment to trash? It will leave both family and personal timelines until restored.",
      )
    ) {
      return;
    }
    setMessage(null);
    setPending(true);
    try {
      const result = await actions.trash({
        momentId: moment.id,
        revision: moment.revision!,
      });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      announce("Moment moved to trash.");
      setMenuOpen(false);
      restoreJournalFocusAfterRefresh();
    } catch {
      setMessage("That moment could not be moved to trash. Try again.");
    } finally {
      setPending(false);
    }
  };

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(moment.text);
      announce("Moment text copied.");
      setMenuOpen(false);
    } catch {
      setMessage("That moment could not be copied. Try again.");
    }
  };

  const editMoment = () => {
    setMenuOpen(false);
    if (!composerSession) return;
    const draft = buildComposerEditDraft(moment, actions.update);
    if (!draft) return;
    composerSession.openEdit(draft, menuTriggerRef.current);
  };

  return (
    <>
      <div className="connected-moment-actions" ref={menuWrapperRef}>
        <button
          ref={menuTriggerRef}
          className="connected-moment-menu-trigger"
          type="button"
          aria-controls={menuOpen ? `moment-actions-${moment.id}` : undefined}
          aria-expanded={menuOpen}
          aria-label={`Moment options — ${actionMomentLabel(moment)} — entry ${position} of ${total}`}
          onClick={() => setMenuOpen((current) => !current)}
        >
          <span aria-hidden="true">•••</span>
        </button>
      </div>
      {menuOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="connected-moment-menu connected-moment-menu-portal"
              id={`moment-actions-${moment.id}`}
              role="group"
              aria-label="Moment options"
            >
              <button type="button" onClick={copyText}>
                Copy text
              </button>
              <button
                type="button"
                aria-label={`Edit — ${actionMomentLabel(moment)} — entry ${position} of ${total}`}
                onClick={editMoment}
              >
                Edit moment
              </button>
              <button
                type="button"
                aria-label={`${pending ? "Moving…" : "Move to trash"} — ${actionMomentLabel(moment)} — entry ${position} of ${total}`}
                disabled={pending}
                onClick={trash}
              >
                {pending ? "Moving…" : "Move to trash"}
              </button>
            </div>,
            document.body,
          )
        : null}
      {message ? (
        <p className="connected-moment-message" role="alert">
          {message}
        </p>
      ) : null}
    </>
  );
}
