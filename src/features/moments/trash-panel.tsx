"use client";

import { useState, useTransition } from "react";
import type { TrashedMomentViewModel } from "@/data/trash.server";
import type { ChangeTrashAction } from "./moment-action-types";

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00Z`));
}

function restoreMomentLabel(moment: TrashedMomentViewModel) {
  const normalized = moment.body.replace(/\s+/gu, " ").trim();
  const excerpt =
    normalized.length <= 72
      ? normalized
      : `${normalized.slice(0, 48)}…${normalized.slice(-20)}`;
  return `${moment.journalPersonName}’s “${excerpt}” moment from ${dateLabel(moment.occurredOn)}`;
}

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

function RestoreButton({
  moment,
  restore,
  position,
  total,
}: {
  moment: TrashedMomentViewModel;
  restore: ChangeTrashAction;
  position: number;
  total: number;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label={`${pending ? "Restoring…" : "Restore"} — ${restoreMomentLabel(moment)} — entry ${position} of ${total}`}
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await restore({
              momentId: moment.id,
              revision: moment.revision,
            });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            announce("Moment restored to its chronological place.");
            restoreJournalFocusAfterRefresh();
          });
        }}
      >
        {pending ? "Restoring…" : "Restore"}
      </button>
      {error ? (
        <span className="trash-error" role="alert">
          {error}
        </span>
      ) : null}
    </>
  );
}

export function TrashPanel({
  moments,
  restore,
}: {
  moments: readonly TrashedMomentViewModel[];
  restore: ChangeTrashAction;
}) {
  return (
    <section
      className="section-panel trash-panel"
      aria-labelledby="trash-title"
      tabIndex={-1}
    >
      <p className="section-intro">
        A private, reversible place for moments you may want back. No permanent
        deletion policy is active yet.
      </p>
      <h2 id="trash-title" className="sr-only">
        Trashed moments
      </h2>
      {moments.length === 0 ? (
        <div className="trash-empty">
          <strong>Nothing is waiting to be restored</strong>
          <span>Moments moved here will stay out of every timeline.</span>
        </div>
      ) : (
        <ul className="trash-list">
          {moments.map((moment, index) => (
            <li key={moment.id}>
              <span
                className={`person-avatar dot-${moment.journalPersonAccent}`}
                aria-hidden="true"
              >
                {Array.from(moment.journalPersonName)[0]}
              </span>
              <div>
                <span>
                  {moment.journalPersonName} · {dateLabel(moment.occurredOn)}
                </span>
                <p>{moment.body}</p>
                <RestoreButton
                  moment={moment}
                  restore={restore}
                  position={index + 1}
                  total={moments.length}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
