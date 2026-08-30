"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  MomentComposer,
  type SaveWrittenMomentAction,
} from "@/features/composer/moment-composer";
import type { MomentComposerViewModel } from "@/features/composer/composer-view-model";
import type { JournalSection } from "./shell-view-model";

export function PrimaryNavigation({
  composer,
  section,
  createMomentAction,
  memoriesHref,
}: {
  composer: MomentComposerViewModel;
  section: JournalSection;
  createMomentAction?: SaveWrittenMomentAction;
  memoriesHref?: string | null;
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const addMomentRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <nav className="bottom-nav" aria-label="Primary navigation">
        <Link
          className={`nav-item ${section === "timeline" ? "active" : ""}`}
          aria-current={section === "timeline" ? "page" : undefined}
          href="/family"
          prefetch={false}
        >
          <span className="nav-symbol" aria-hidden="true">
            │
          </span>
          <span>Family</span>
        </Link>
        <Link
          className={`nav-item ${section === "people" ? "active" : ""}`}
          aria-current={section === "people" ? "page" : undefined}
          href="/people"
          prefetch={false}
        >
          <span className="nav-symbol" aria-hidden="true">
            ◌
          </span>
          <span>People</span>
        </Link>
        <button
          ref={addMomentRef}
          className="add-moment"
          aria-label="Add moment"
          onClick={() => setComposerOpen(true)}
        >
          +
        </button>
        {memoriesHref === null ? (
          <span className="nav-item nav-item-unavailable" aria-hidden="true" />
        ) : (
          <Link
            className={`nav-item ${section === "memories" ? "active" : ""}`}
            aria-current={section === "memories" ? "page" : undefined}
            href={memoriesHref ?? "/memories"}
            prefetch={false}
          >
            <span className="nav-symbol" aria-hidden="true">
              ⌁
            </span>
            <span>Memories</span>
          </Link>
        )}
      </nav>
      <MomentComposer
        key={`${composer.recorderPersonId}:${composer.defaultJournalPersonId}`}
        model={composer}
        open={composerOpen}
        returnFocusRef={addMomentRef}
        onRequestClose={() => setComposerOpen(false)}
        saveWrittenMoment={createMomentAction}
      />
    </>
  );
}
