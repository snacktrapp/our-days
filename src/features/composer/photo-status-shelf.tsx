"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import { photoUploadResumeStore } from "./photo-upload-resume-store";
import {
  clearOptimisticMediaUploads,
  emptyOptimisticMediaUploadSnapshot,
  firstAcceptedMomentRefresh,
  firstPublishedMediaRefresh,
  optimisticMediaUploadSnapshot,
  removeOptimisticMediaUpload,
  removeOptimisticMediaUploadByIntake,
  retryOptimisticMediaUpload,
  subscribeToOptimisticMediaUploads,
  updateOptimisticMediaUpload,
  type OptimisticMediaUpload,
} from "./optimistic-media-upload";
import {
  emptyOptimisticMomentSaveSnapshot,
  optimisticMomentSaveSnapshot,
  removeOptimisticMomentSave,
  retryOptimisticMomentSave,
  subscribeToOptimisticMomentSaves,
  type OptimisticMomentSave,
} from "./optimistic-moment-save";

type PhotoCleanupState =
  | "awaiting_cleanup_job"
  | "completed"
  | "leased"
  | "not_requested"
  | "not_required"
  | "operator_review"
  | "queued";

export type PhotoStatusItem = Readonly<{
  id: string;
  journalPersonName: string;
  occurredOn: string;
  state:
    "attention" | "cancelled" | "pending" | "processing" | "published-cleanup";
  canCancel: boolean;
  cleanupState: PhotoCleanupState;
}>;

type CancellationResult = Readonly<{
  id: string;
  message: string;
}>;

type ChipAction = Readonly<{
  ariaLabel?: string;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}>;

export type PhotoStatusChipViewProps = Readonly<{
  alert?: string | null;
  busy?: boolean;
  confirmation?: string | null;
  detail?: string | null;
  label: string;
  primaryAction?: ChipAction | null;
  progress?: number | null;
  secondaryAction?: ChipAction | null;
}>;

type PhotoStatusShelfViewProps = Readonly<{
  cancellationResult: CancellationResult | null;
  cancellingIds: ReadonlySet<string>;
  confirmingCancelId: string | null;
  items: readonly PhotoStatusItem[];
  onConfirmCancel: (id: string) => void;
  onKeep: () => void;
  onRequestCancel: (id: string) => void;
}>;

const allowedServerStatuses = new Set([
  "cancelled_cleanup_pending",
  "needs_attention",
  "processing",
  "published_cleanup_pending",
  "reserved",
  "uploading",
]);
const allowedCleanupStates = new Set<PhotoCleanupState>([
  "awaiting_cleanup_job",
  "completed",
  "leased",
  "not_requested",
  "not_required",
  "operator_review",
  "queued",
]);
const allowedMomentStatuses = new Set([
  "cancelled",
  "needs_attention",
  "processing",
  "published",
  "uploading",
]);
const terminalUploadMessage =
  "This photo could not be added. Dismiss it and try again.";

type PhotoMomentStatus =
  "cancelled" | "needs_attention" | "processing" | "published" | "uploading";

const activeUploadStates = new Set([
  "finishing",
  "preparing",
  "stopping",
  "uploading",
]);

function momentStatusFromShelfItem(
  item: PhotoStatusItem,
): PhotoMomentStatus | null {
  if (item.state === "published-cleanup") return "published";
  if (item.state === "attention") return "needs_attention";
  if (item.state === "cancelled") return "cancelled";
  if (item.state === "processing") return "processing";
  if (item.state === "pending") return "uploading";
  return null;
}

function visibleState(status: string): PhotoStatusItem["state"] {
  if (status === "cancelled_cleanup_pending") return "cancelled";
  if (status === "needs_attention") return "attention";
  if (status === "processing") return "processing";
  if (status === "published_cleanup_pending") return "published-cleanup";
  return "pending";
}

function dateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return date;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function optimisticUploadFractionLabel(upload: OptimisticMediaUpload) {
  if (upload.totalFiles > 1) {
    return `Uploading ${Math.min(upload.totalFiles, Math.max(1, upload.completedFiles + 1))} of ${upload.totalFiles}…`;
  }
  return "Uploading…";
}

function optimisticUploadChipLabel(upload: OptimisticMediaUpload) {
  if (upload.stage.state === "published") return "Added to timeline";
  if (upload.stage.state === "failed") return "Upload failed";
  if (upload.stage.state === "stopping") return "Stopping upload";
  return optimisticUploadFractionLabel(upload);
}

function optimisticUploadChipProgress(
  upload: OptimisticMediaUpload,
): number | null {
  if (
    upload.stage.state === "failed" ||
    upload.stage.state === "published" ||
    upload.stage.state === "stopping"
  ) {
    return null;
  }
  if (upload.stage.state === "uploading") return upload.stage.progress;
  if (upload.totalFiles > 1) {
    return Math.min(1, upload.completedFiles / upload.totalFiles);
  }
  if (
    upload.stage.state === "processing" ||
    upload.stage.state === "finishing"
  ) {
    return 1;
  }
  return 0;
}

function optimisticMomentChipLabel(save: OptimisticMomentSave) {
  if (save.stage.state === "failed") return "Couldn’t add";
  if (save.mode === "bible-verse") return "Adding verse…";
  if (save.mode === "thought") return "Adding note…";
  if (save.mode === "location") return "Adding place…";
  return "Adding milestone…";
}

function ChipActionButton({ action }: Readonly<{ action: ChipAction }>) {
  return (
    <button
      type="button"
      aria-label={action.ariaLabel}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
}

export function PhotoStatusChipView({
  alert,
  busy = false,
  confirmation,
  detail,
  label,
  primaryAction,
  progress,
  secondaryAction,
}: PhotoStatusChipViewProps) {
  return (
    <section className="photo-status-shelf" aria-label="Private photo status">
      {alert ? (
        <p className="photo-status-result" role="alert">
          {alert}
        </p>
      ) : null}
      <div className="photo-status-chip" aria-busy={busy}>
        <p className="photo-status-chip-copy" role="status">
          {label}
        </p>
        {detail ? <p className="photo-status-chip-detail">{detail}</p> : null}
        {typeof progress === "number" ? (
          <progress max={1} value={progress}>
            {Math.round(progress * 100)}%
          </progress>
        ) : busy ? (
          <progress max={1} className="photo-status-chip-indeterminate">
            Working
          </progress>
        ) : null}
        {confirmation ? (
          <p className="photo-status-confirmation">{confirmation}</p>
        ) : null}
        {primaryAction || secondaryAction ? (
          <div className="photo-status-actions">
            {secondaryAction ? (
              <ChipActionButton action={secondaryAction} />
            ) : null}
            {primaryAction ? <ChipActionButton action={primaryAction} /> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function serverShelfChip({
  cancellationResult,
  cancellingIds,
  confirmingCancelId,
  items,
  onConfirmCancel,
  onKeep,
  onRequestCancel,
}: PhotoStatusShelfViewProps): PhotoStatusChipViewProps | null {
  const processingCount = items.filter(
    (item) => item.state === "processing",
  ).length;
  const unfinishedItems = items.filter((item) => item.state === "pending");
  const pending = unfinishedItems[0];
  const confirming =
    pending && confirmingCancelId === pending.id ? pending : null;
  const cancelling = pending ? cancellingIds.has(pending.id) : false;

  if (!pending && processingCount === 0 && !cancellationResult) return null;

  if (confirming) {
    return {
      alert: cancellationResult?.message ?? null,
      busy: cancelling,
      confirmation: "Cancel this unfinished photo? It won’t be added.",
      detail: `${confirming.journalPersonName} · ${dateLabel(confirming.occurredOn)}`,
      label: "Photo upload paused",
      primaryAction: {
        ariaLabel: `Confirm cancellation for ${confirming.journalPersonName}, ${dateLabel(confirming.occurredOn)}`,
        disabled: cancelling,
        label: cancelling ? "Cancelling…" : "Confirm cancel",
        onClick: () => onConfirmCancel(confirming.id),
      },
      secondaryAction: {
        label: "Keep upload",
        onClick: onKeep,
      },
    };
  }

  if (pending?.canCancel) {
    return {
      alert: cancellationResult?.message ?? null,
      busy: cancelling,
      detail: `${pending.journalPersonName} · ${dateLabel(pending.occurredOn)}`,
      label: "Photo upload paused",
      primaryAction: {
        ariaLabel: `Cancel upload for ${pending.journalPersonName}, ${dateLabel(pending.occurredOn)}`,
        disabled: cancelling,
        label: "Cancel upload",
        onClick: () => onRequestCancel(pending.id),
      },
    };
  }

  if (processingCount > 0) {
    return {
      alert: cancellationResult?.message ?? null,
      busy: true,
      label: "Uploading…",
    };
  }

  if (cancellationResult) {
    return {
      alert: cancellationResult.message,
      label: "Photo upload paused",
    };
  }

  return null;
}

export function PhotoStatusShelfView(props: PhotoStatusShelfViewProps) {
  const chip = serverShelfChip(props);
  if (!chip) return null;
  return <PhotoStatusChipView {...chip} />;
}

function uploadChip(upload: OptimisticMediaUpload): PhotoStatusChipViewProps {
  const failed = upload.stage.state === "failed";
  return {
    busy: !failed && upload.stage.state !== "published",
    label: optimisticUploadChipLabel(upload),
    progress: optimisticUploadChipProgress(upload),
    primaryAction: failed
      ? upload.retryable
        ? {
            label: "Retry",
            onClick: () => {
              retryOptimisticMediaUpload(upload.id);
            },
          }
        : {
            label: "Dismiss",
            onClick: () => removeOptimisticMediaUpload(upload.id),
          }
      : null,
  };
}

function momentChip(save: OptimisticMomentSave): PhotoStatusChipViewProps {
  const failed = save.stage.state === "failed";
  return {
    busy: !failed,
    label: optimisticMomentChipLabel(save),
    primaryAction: failed
      ? {
          label: "Retry",
          onClick: () => retryOptimisticMomentSave(save.id),
        }
      : null,
    secondaryAction: failed
      ? {
          label: "Dismiss",
          onClick: () => removeOptimisticMomentSave(save.id),
        }
      : null,
  };
}

function selectVisibleChip({
  cancellationResult,
  cancellingIds,
  confirmingCancelId,
  items,
  onConfirmCancel,
  onKeep,
  onRequestCancel,
  saves,
  uploads,
}: PhotoStatusShelfViewProps & {
  saves: readonly OptimisticMomentSave[];
  uploads: readonly OptimisticMediaUpload[];
}): PhotoStatusChipViewProps | null {
  const failedUpload = uploads.find(
    (upload) => upload.stage.state === "failed",
  );
  if (failedUpload) return uploadChip(failedUpload);

  const failedSave = saves.find((save) => save.stage.state === "failed");
  if (failedSave) return momentChip(failedSave);

  const activeUpload = uploads.find((upload) =>
    activeUploadStates.has(upload.stage.state),
  );
  if (activeUpload) return uploadChip(activeUpload);

  const processingUpload = uploads.find(
    (upload) => upload.stage.state === "processing",
  );
  if (processingUpload) return uploadChip(processingUpload);

  const saving = saves.find((save) => save.stage.state === "saving");
  if (saving) return momentChip(saving);

  const published = uploads.find(
    (upload) => upload.stage.state === "published",
  );
  if (published) return uploadChip(published);

  return serverShelfChip({
    cancellationResult,
    cancellingIds,
    confirmingCancelId,
    items,
    onConfirmCancel,
    onKeep,
    onRequestCancel,
  });
}

export function PhotoStatusShelf({
  circleId,
}: Readonly<{ circleId: string; today?: string }>) {
  const router = useRouter();
  const [items, setItems] = useState<readonly PhotoStatusItem[]>([]);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(
    null,
  );
  const [cancellationResult, setCancellationResult] =
    useState<CancellationResult | null>(null);
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const runRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const publishedRef = useRef(new Set<string>());
  const optimisticUploads = useSyncExternalStore(
    subscribeToOptimisticMediaUploads,
    optimisticMediaUploadSnapshot,
    emptyOptimisticMediaUploadSnapshot,
  ).filter((upload) => upload.circleId === circleId);
  const optimisticMomentSaves = useSyncExternalStore(
    subscribeToOptimisticMomentSaves,
    optimisticMomentSaveSnapshot,
    emptyOptimisticMomentSaveSnapshot,
  ).filter((save) => save.circleId === circleId);

  const checkStatuses = useCallback(
    (finishProcessing = false) => {
      if (inFlightRef.current) return inFlightRef.current;
      const run = ++runRef.current;
      const task = (async () => {
        try {
          const supabase = createOurDaysBrowserClient();
          const initial = await supabase.rpc("list_my_photo_intakes", {
            circle_id: circleId,
          });
          let rows = initial.data;
          let statusError = initial.error;
          if (run !== runRef.current) return;
          if (
            statusError ||
            !rows ||
            rows.some(
              (row) =>
                !allowedServerStatuses.has(row.status) ||
                !allowedCleanupStates.has(
                  row.cleanup_state as PhotoCleanupState,
                ),
            )
          ) {
            throw new Error("Photo status unavailable");
          }

          if (finishProcessing) {
            const pendingIds = rows
              .filter((row) => row.status === "processing")
              .map((row) => row.intake_id);
            if (pendingIds.length > 0) {
              await Promise.allSettled(
                pendingIds.map((intakeId) =>
                  globalThis.fetch("/api/photos/process", {
                    body: JSON.stringify({ intakeId }),
                    credentials: "same-origin",
                    headers: { "content-type": "application/json" },
                    method: "POST",
                  }),
                ),
              );
              const refreshed = await supabase.rpc("list_my_photo_intakes", {
                circle_id: circleId,
              });
              rows = refreshed.data;
              statusError = refreshed.error;
              if (
                run !== runRef.current ||
                statusError ||
                !rows ||
                rows.some(
                  (row) =>
                    !allowedServerStatuses.has(row.status) ||
                    !allowedCleanupStates.has(
                      row.cleanup_state as PhotoCleanupState,
                    ),
                )
              ) {
                throw new Error("Photo status unavailable");
              }
            }
          }

          const allItems = rows.map((row) => ({
            id: row.intake_id,
            journalPersonName: row.journal_person_name,
            occurredOn: row.occurred_on,
            state: visibleState(row.status),
            canCancel: row.can_cancel,
            cleanupState: row.cleanup_state as PhotoCleanupState,
          }));
          const nextItems = allItems.filter(
            (item) => item.state === "pending" || item.state === "processing",
          );
          setItems(nextItems);
          setCancellationResult((current) =>
            current && nextItems.some((item) => item.id === current.id)
              ? current
              : null,
          );

          let shouldRefresh = false;
          const serverIntakeIds = new Set(rows.map((row) => row.intake_id));
          const resolvedStatuses = new Map<string, PhotoMomentStatus>();
          for (const item of allItems) {
            const status = momentStatusFromShelfItem(item);
            if (status) resolvedStatuses.set(item.id, status);
            if (status === "published") {
              if (
                !publishedRef.current.has(item.id) &&
                firstPublishedMediaRefresh(item.id)
              ) {
                publishedRef.current.add(item.id);
                removeOptimisticMediaUploadByIntake(item.id);
                shouldRefresh = true;
              }
            } else if (status === "needs_attention" || status === "cancelled") {
              const matchingUpload = optimisticMediaUploadSnapshot().find(
                (upload) => upload.intakeId === item.id,
              );
              if (matchingUpload) {
                updateOptimisticMediaUpload(matchingUpload.id, {
                  stage: { state: "failed", message: terminalUploadMessage },
                });
              }
            }
          }

          const absentUploads = optimisticMediaUploadSnapshot().filter(
            (upload) =>
              upload.circleId === circleId &&
              upload.kind === "photo" &&
              upload.intakeId &&
              (upload.stage.state === "processing" ||
                upload.stage.state === "published") &&
              !serverIntakeIds.has(upload.intakeId),
          );
          const absenceResults = await Promise.all(
            absentUploads.map(async (upload) => {
              const result = await supabase.rpc("get_photo_moment_status", {
                intake_id: upload.intakeId!,
              });
              const status = result.data?.[0]?.status;
              return {
                upload,
                status:
                  !result.error && status && allowedMomentStatuses.has(status)
                    ? (status as PhotoMomentStatus)
                    : null,
              };
            }),
          );
          if (run !== runRef.current) return;
          for (const { upload, status } of absenceResults) {
            if (!status || !upload.intakeId) continue;
            resolvedStatuses.set(upload.intakeId, status);
            if (status === "published") {
              removeOptimisticMediaUpload(upload.id);
              if (firstPublishedMediaRefresh(upload.intakeId)) {
                publishedRef.current.add(upload.intakeId);
                shouldRefresh = true;
              }
            } else if (status === "needs_attention" || status === "cancelled") {
              updateOptimisticMediaUpload(upload.id, {
                stage: { state: "failed", message: terminalUploadMessage },
              });
            }
          }
          if (shouldRefresh) router.refresh();

          try {
            const { data: sessionData, error: sessionError } =
              await supabase.auth.getSession();
            const accountId = sessionData.session?.user.id;
            if (sessionError || !accountId)
              throw new Error("Session unavailable");
            const localRecords = await photoUploadResumeStore.listForScope(
              accountId,
              circleId,
            );
            const unresolvedLocalRecords = localRecords.filter(
              (record) =>
                record.intakeId &&
                !serverIntakeIds.has(record.intakeId) &&
                !resolvedStatuses.has(record.intakeId),
            );
            const localStatusResults = await Promise.all(
              unresolvedLocalRecords.map(async (record) => {
                const result = await supabase.rpc("get_photo_moment_status", {
                  intake_id: record.intakeId!,
                });
                const status = result.data?.[0]?.status;
                return {
                  intakeId: record.intakeId!,
                  status:
                    !result.error && status && allowedMomentStatuses.has(status)
                      ? (status as PhotoMomentStatus)
                      : null,
                };
              }),
            );
            if (run !== runRef.current) return;
            for (const result of localStatusResults) {
              if (result.status) {
                resolvedStatuses.set(result.intakeId, result.status);
              }
            }
            await Promise.all(
              localRecords
                .filter(
                  (record) =>
                    record.intakeId &&
                    ["cancelled", "needs_attention", "published"].includes(
                      resolvedStatuses.get(record.intakeId) ?? "",
                    ),
                )
                .map((record) => photoUploadResumeStore.remove(record.id)),
            );
          } catch {
            // Browser resume shortcuts are best-effort and never need a family-facing notice.
          }
        } catch {
          // A status poll can retry quietly when the page is visible again.
        }
      })();
      inFlightRef.current = task;
      void task.finally(() => {
        if (inFlightRef.current === task) inFlightRef.current = null;
      });
      return task;
    },
    [circleId, router],
  );

  useEffect(() => {
    void checkStatuses(true);
    const checkWhenVisible = () => {
      if (!document.hidden) void checkStatuses(true);
    };
    const interval = window.setInterval(checkWhenVisible, 10_000);
    const clear = () => {
      runRef.current += 1;
      inFlightRef.current = null;
      publishedRef.current.clear();
      clearOptimisticMediaUploads();
      setItems([]);
      setCancellationResult(null);
      setConfirmingCancelId(null);
      setCancellingIds(new Set());
    };
    window.addEventListener("our-days:clear-private-state", clear);
    window.addEventListener("online", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("our-days:clear-private-state", clear);
      window.removeEventListener("online", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      runRef.current += 1;
      inFlightRef.current = null;
    };
  }, [checkStatuses]);

  useEffect(() => {
    for (const upload of optimisticUploads) {
      if (!upload.momentId) continue;
      if (firstAcceptedMomentRefresh(upload.momentId)) router.refresh();
    }
  }, [optimisticUploads, router]);

  useEffect(() => {
    const timers: number[] = [];
    for (const upload of optimisticUploads) {
      if (upload.stage.state !== "published") continue;
      const refreshKey = upload.intakeId ?? upload.momentId ?? upload.id;
      if (firstPublishedMediaRefresh(refreshKey)) router.refresh();
      timers.push(
        window.setTimeout(() => removeOptimisticMediaUpload(upload.id), 1_200),
      );
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [optimisticUploads, router]);

  const cancel = async (id: string) => {
    runRef.current += 1;
    inFlightRef.current = null;
    setConfirmingCancelId(null);
    setCancellingIds((current) => new Set(current).add(id));
    setCancellationResult(null);

    const supabase = createOurDaysBrowserClient();
    try {
      const { data, error } = await supabase.rpc("cancel_photo_intake", {
        intake_id: id,
      });
      const result = data?.[0];
      if (
        error ||
        result?.state !== "invalidated" ||
        !allowedCleanupStates.has(result.cleanup_state as PhotoCleanupState)
      ) {
        throw new Error("Cancellation unavailable");
      }
      setItems((current) => current.filter((item) => item.id !== id));
    } catch {
      setCancellationResult({
        id,
        message:
          "Cancellation couldn’t be confirmed. Check your connection and try again.",
      });
      setCancellingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      return;
    }

    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      const accountId = sessionData.session?.user.id;
      if (sessionError || !accountId) throw new Error("Session unavailable");
      const records = await photoUploadResumeStore.listForScope(
        accountId,
        circleId,
      );
      await Promise.all(
        records
          .filter((record) => record.intakeId === id)
          .map((record) => photoUploadResumeStore.remove(record.id)),
      );
    } catch {
      // Local resume cleanup is best-effort after server-confirmed cancellation.
    } finally {
      setCancellingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <VisiblePhotoStatusChip
      cancellationResult={cancellationResult}
      cancellingIds={cancellingIds}
      confirmingCancelId={confirmingCancelId}
      items={items.filter(
        (item) =>
          !optimisticUploads.some((upload) => upload.intakeId === item.id),
      )}
      onConfirmCancel={(id) => void cancel(id)}
      onKeep={() => setConfirmingCancelId(null)}
      onRequestCancel={setConfirmingCancelId}
      saves={optimisticMomentSaves}
      uploads={optimisticUploads}
    />
  );
}

function VisiblePhotoStatusChip(
  props: PhotoStatusShelfViewProps & {
    saves: readonly OptimisticMomentSave[];
    uploads: readonly OptimisticMediaUpload[];
  },
) {
  const chip = selectVisibleChip(props);
  if (!chip) return null;
  return <PhotoStatusChipView {...chip} />;
}
