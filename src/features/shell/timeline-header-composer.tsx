"use client";

import { useRef, useState } from "react";
import { useComposerSession } from "@/features/composer/composer-session";
import {
  MomentComposer,
  type SaveFamilyMomentAction,
} from "@/features/composer/moment-composer";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";

export function TimelineHeaderComposer({
  composer,
  createMomentAction,
}: Readonly<{
  composer: MomentComposerViewModel;
  createMomentAction?: SaveFamilyMomentAction;
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
        key={`${composer.recorderPersonId}:${composer.defaultJournalPersonId}`}
        model={composer}
        open={composerOpen}
        returnFocusRef={addMomentRef}
        registerDismiss={(dismiss) => {
          dismissRef.current = dismiss;
        }}
        onRequestClose={() => setComposerOpen(false)}
        saveFamilyMoment={createMomentAction}
      />
    </>
  );
}
