"use client";

import {
  formatEntryDraftRowLabel,
  type EntryDraftListItem,
} from "./entry-drafts";

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4.1L19.2 8.9a1.2 1.2 0 0 0 0-1.7l-2.4-2.4a1.2 1.2 0 0 0-1.7 0L4 15.9V20z" />
      <path d="m13.6 6.4 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 7h14" />
      <path d="M9.5 7V5.5h5V7" />
      <path d="M8 7l.8 12h6.4L16 7" />
    </svg>
  );
}

export function DraftsList({
  drafts,
  onOpen,
  onDelete,
}: Readonly<{
  drafts: readonly EntryDraftListItem[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}>) {
  if (drafts.length === 0) {
    return <p className="composer-drafts-empty">No drafts yet.</p>;
  }

  return (
    <ul className="composer-drafts-list">
      {drafts.map((draft) => {
        const label = formatEntryDraftRowLabel(draft.kind, draft.updatedAt);
        return (
          <li key={draft.id} className="composer-drafts-row">
            <button
              type="button"
              className="composer-drafts-open"
              aria-label={`Open ${label}`}
              onClick={() => onOpen(draft.id)}
            >
              <strong>{label}</strong>
              <small>{draft.previewText || "No text yet"}</small>
            </button>
            <div className="composer-drafts-actions">
              <button
                type="button"
                className="composer-drafts-icon"
                aria-label={`Edit ${label}`}
                onClick={() => onOpen(draft.id)}
              >
                <EditIcon />
              </button>
              <button
                type="button"
                className="composer-drafts-icon composer-drafts-trash"
                aria-label={`Delete ${label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(draft.id);
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
