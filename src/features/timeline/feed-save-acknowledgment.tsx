"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  emptyOptimisticMomentSaveSnapshot,
  optimisticMomentSaveSnapshot,
  subscribeToOptimisticMomentSaves,
  removeOptimisticMomentSave,
} from "@/features/composer/optimistic-moment-save";
import {
  emptyOptimisticMediaUploadSnapshot,
  optimisticMediaUploadSnapshot,
  subscribeToOptimisticMediaUploads,
  removeOptimisticMediaUpload,
} from "@/features/composer/optimistic-media-upload";

/** Retire save indicators only after the refreshed feed contains their entry. */
export function FeedSaveAcknowledgment({
  momentIds,
  mediaCounts,
}: {
  momentIds: readonly string[];
  mediaCounts?: Readonly<Record<string, number>>;
}) {
  const saves = useSyncExternalStore(
    subscribeToOptimisticMomentSaves,
    optimisticMomentSaveSnapshot,
    emptyOptimisticMomentSaveSnapshot,
  );
  const uploads = useSyncExternalStore(
    subscribeToOptimisticMediaUploads,
    optimisticMediaUploadSnapshot,
    emptyOptimisticMediaUploadSnapshot,
  );
  useEffect(() => {
    const visible = new Set(momentIds);
    let destination: string | undefined;
    for (const save of saves) {
      if (
        save.stage.state === "published" &&
        save.stage.momentId &&
        visible.has(save.stage.momentId)
      ) {
        destination ??= save.stage.momentId;
        removeOptimisticMomentSave(save.id);
      }
    }
    for (const upload of uploads) {
      if (
        upload.stage.state === "published" &&
        upload.momentId &&
        visible.has(upload.momentId) &&
        (mediaCounts?.[upload.momentId] ?? 0) >= upload.totalFiles
      ) {
        destination ??= upload.momentId;
        removeOptimisticMediaUpload(upload.id);
      }
    }
    if (destination) {
      // Let the status shelf disappear before measuring the post. A single
      // jump also avoids replaying it on subsequent feed refreshes.
      window.dispatchEvent(new Event("our-days:reveal-new-entry"));
      window.requestAnimationFrame(() => {
        const entry = document.getElementById(`moment-${destination}`);
        if (!entry) return;
        const header = document
          .querySelector(".topbar")
          ?.getBoundingClientRect();
        const inset = header && header.bottom > 0 ? header.bottom + 16 : 16;
        window.scrollTo({
          top: Math.max(
            0,
            window.scrollY + entry.getBoundingClientRect().top - inset,
          ),
          behavior: "instant",
        });
      });
    }
  }, [momentIds, mediaCounts, saves, uploads]);
  return null;
}
