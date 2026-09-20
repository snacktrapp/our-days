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
    for (const save of saves) {
      if (
        save.stage.state === "published" &&
        save.stage.momentId &&
        visible.has(save.stage.momentId)
      )
        removeOptimisticMomentSave(save.id);
    }
    for (const upload of uploads) {
      if (
        upload.stage.state === "published" &&
        upload.momentId &&
        visible.has(upload.momentId) &&
        (mediaCounts?.[upload.momentId] ?? 0) >= upload.totalFiles
      )
        removeOptimisticMediaUpload(upload.id);
    }
  }, [momentIds, mediaCounts, saves, uploads]);
  return null;
}
