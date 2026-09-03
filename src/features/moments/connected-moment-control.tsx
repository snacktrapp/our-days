"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOverlayPopoverClose } from "@/features/shell/use-overlay-popover-close";
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

const compactMenuHeight = 3 * 44 + 8;

function compactMenuPlacement(trigger: HTMLElement): "above" | "below" {
  const rect = trigger.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return "below";
  const nav = document.querySelector(".bottom-nav");
  const topbar = document.querySelector(".topbar");
  const ceiling = topbar?.getBoundingClientRect().bottom ?? 0;
  const floor = nav?.getBoundingClientRect().top ?? window.innerHeight;
  const spaceBelow = floor - rect.bottom - 4;
  const spaceAbove = rect.top - ceiling - 4;
  if (spaceBelow >= compactMenuHeight) return "below";
  return spaceAbove > spaceBelow ? "above" : "below";
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
  const [menuPlacement, setMenuPlacement] = useState<"above" | "below">(
    "below",
  );
  const [message, setMessage] = useState<string | null>(null);
  const menuWrapperRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const { closing, closingRef, requestClose, cancel, onAnimationEnd } =
    useOverlayPopoverClose();

  const closeMenu = useCallback(
    (immediate = false) => {
      if (immediate) {
        cancel();
        setMenuOpen(false);
        return;
      }
      requestClose(() => setMenuOpen(false));
    },
    [cancel, requestClose],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menuWrapperRef.current?.contains(target)) {
        closeMenu();
      }
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
      menuTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeWithEscape);
    };
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const updatePlacement = () => {
      const trigger = menuTriggerRef.current;
      if (trigger) setMenuPlacement(compactMenuPlacement(trigger));
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
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
      closeMenu(true);
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
      closeMenu(true);
    } catch {
      setMessage("That moment could not be copied. Try again.");
    }
  };

  const editMoment = () => {
    closeMenu(true);
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
          aria-expanded={menuOpen && !closing}
          aria-label={`Moment options — ${actionMomentLabel(moment)} — entry ${position} of ${total}`}
          onClick={() => {
            if (menuOpen) {
              if (closingRef.current) {
                cancel();
                return;
              }
              closeMenu();
              return;
            }
            const trigger = menuTriggerRef.current;
            setMenuPlacement(trigger ? compactMenuPlacement(trigger) : "below");
            setMenuOpen(true);
          }}
        >
          <span aria-hidden="true">•••</span>
        </button>
        {menuOpen ? (
          <div
            className={
              closing
                ? "connected-moment-menu is-closing"
                : "connected-moment-menu"
            }
            id={`moment-actions-${moment.id}`}
            role="group"
            aria-label="Moment options"
            aria-hidden={closing ? true : undefined}
            data-placement={menuPlacement}
            onAnimationEnd={onAnimationEnd}
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
          </div>
        ) : null}
      </div>
      {message ? (
        <p className="connected-moment-message" role="alert">
          {message}
        </p>
      ) : null}
    </>
  );
}
