"use client";

import { useState } from "react";
import {
  formatEntryDraftRowLabel,
  type EntryDraftListItem,
} from "./entry-drafts";

const swipeDeletePx = 72;

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
      {drafts.map((draft) => (
        <DraftsListRow
          key={draft.id}
          draft={draft}
          onOpen={onOpen}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

function DraftsListRow({
  draft,
  onOpen,
  onDelete,
}: Readonly<{
  draft: EntryDraftListItem;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}>) {
  const [offset, setOffset] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pointer, setPointer] = useState<{
    id: number;
    startX: number;
  } | null>(null);

  return (
    <li className="composer-drafts-row">
      <div
        className="composer-drafts-row-swipe"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" && event.button !== 0) return;
          setMenuOpen(false);
          setPointer({ id: event.pointerId, startX: event.clientX });
        }}
        onPointerMove={(event) => {
          if (!pointer || pointer.id !== event.pointerId) return;
          const next = Math.min(
            0,
            Math.max(-swipeDeletePx, event.clientX - pointer.startX),
          );
          setOffset(next);
        }}
        onPointerUp={(event) => {
          if (!pointer || pointer.id !== event.pointerId) return;
          const committed = offset <= -swipeDeletePx / 2;
          setOffset(committed ? -swipeDeletePx : 0);
          setPointer(null);
        }}
        onPointerCancel={() => {
          setOffset(0);
          setPointer(null);
        }}
      >
        <button
          type="button"
          className="composer-drafts-open"
          aria-label={`Open ${formatEntryDraftRowLabel(draft.kind, draft.updatedAt)}`}
          onClick={() => {
            if (offset < -8) return;
            onOpen(draft.id);
          }}
        >
          <strong>
            {formatEntryDraftRowLabel(draft.kind, draft.updatedAt)}
          </strong>
          <small>{draft.previewText || "No text yet"}</small>
        </button>
        <button
          type="button"
          className="composer-drafts-more"
          aria-label={`Draft options for ${formatEntryDraftRowLabel(draft.kind, draft.updatedAt)}`}
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
        {menuOpen ? (
          <div className="composer-drafts-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onDelete(draft.id);
              }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="composer-drafts-delete"
        onClick={() => onDelete(draft.id)}
      >
        Delete
      </button>
    </li>
  );
}
