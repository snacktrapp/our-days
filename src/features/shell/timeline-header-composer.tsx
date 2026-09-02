"use client";

import { useRef, useState } from "react";
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
  const [composerOpen, setComposerOpen] = useState(false);
  const addMomentRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={addMomentRef}
        className="header-add-moment"
        type="button"
        aria-label="Add moment"
        onClick={() => setComposerOpen(true)}
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
        onRequestClose={() => setComposerOpen(false)}
        saveFamilyMoment={createMomentAction}
      />
    </>
  );
}
