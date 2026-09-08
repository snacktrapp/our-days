"use client";

import { useRef, useState } from "react";
import { useComposerSession } from "@/features/composer/composer-session";
import { createConnectedEntryDraftActions } from "@/features/composer/entry-draft-client";
import {
  MomentComposer,
  type SaveFamilyMomentAction,
} from "@/features/composer/moment-composer";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import type { CreatePostToHomeContext } from "@/features/composer/post-to";
import { createPreviewEntryDraftActions } from "@/features/composer/preview-entry-drafts";

export function TimelineHeaderComposer({
  composer,
  createMomentAction,
  homeContext,
}: Readonly<{
  composer: MomentComposerViewModel;
  createMomentAction?: SaveFamilyMomentAction;
  homeContext?: CreatePostToHomeContext;
}>) {
  const session = useComposerSession();
  const [composerOpen, setComposerOpen] = useState(false);
  const addMomentRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<(() => void) | null>(null);

  if (composer.journalPeople.length === 0) {
    return <span className="topbar-leading-spacer" aria-hidden="true" />;
  }

  if (session) {
    return (
      <button
        ref={addMomentRef}
        className="header-add-moment"
        type="button"
        aria-label="Add moment"
        aria-expanded={session.isOpen}
        onClick={() => session.toggleCreate(addMomentRef.current)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    );
  }

  return (
    <>
      <button
        ref={addMomentRef}
        className="header-add-moment"
        type="button"
        aria-label="Add moment"
        aria-expanded={composerOpen}
        onClick={() => {
          if (composerOpen) {
            dismissRef.current?.();
            return;
          }
          setComposerOpen(true);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <MomentComposer
        key={`${composer.recorderPersonId}:${composer.defaultJournalPersonId}:${homeContext?.kind ?? "none"}:${homeContext?.circleId ?? composer.circleId ?? ""}`}
        model={composer}
        homeContext={homeContext}
        open={composerOpen}
        returnFocusRef={addMomentRef}
        registerDismiss={(dismiss) => {
          dismissRef.current = dismiss;
        }}
        onRequestClose={() => setComposerOpen(false)}
        saveFamilyMoment={createMomentAction}
        draftActions={
          composer.experience === "connected-family" ||
          composer.experience === "connected-written"
            ? createConnectedEntryDraftActions()
            : createPreviewEntryDraftActions()
        }
      />
    </>
  );
}
