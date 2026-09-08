"use client";

import { useState } from "react";
import { PostToChoices } from "@/features/composer/post-to-field";
import {
  defaultPostToCircleIds,
  type PostableCircle,
} from "@/features/composer/post-to";
import type { ShareInsightAction } from "./insight-share";

export function InsightShareControl({
  momentId,
  circles,
  currentCircleId,
  shareInsight,
}: Readonly<{
  momentId: string;
  circles: readonly PostableCircle[];
  currentCircleId?: string;
  shareInsight: ShareInsightAction;
}>) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() =>
    defaultPostToCircleIds(circles, currentCircleId),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (circles.length === 0) return null;

  const share = async () => {
    if (selectedIds.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    const result = await shareInsight({ momentId, circleIds: selectedIds });
    setBusy(false);
    setMessage(result.message);
    if (result.ok) setOpen(false);
  };

  return (
    <div className="insight-share">
      <button
        className="insight-share-toggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Share to…
      </button>
      {open ? (
        <div className="insight-share-panel">
          <PostToChoices
            circles={circles}
            selectedIds={selectedIds}
            justMe={false}
            justMeAllowed={false}
            currentCircleId={currentCircleId}
            legend="Share to"
            onChange={(next) => setSelectedIds([...next.selectedIds])}
          />
          <button
            className="insight-share-submit"
            type="button"
            disabled={busy || selectedIds.length === 0}
            onClick={() => {
              void share();
            }}
          >
            Share
          </button>
        </div>
      ) : null}
      {message ? (
        <p className="insight-share-message" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
