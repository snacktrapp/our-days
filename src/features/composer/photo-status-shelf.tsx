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
import { requestPhotoProcessingResponse } from "./photo-processing-request";
import {
  clearOptimisticMediaUploads,
  emptyOptimisticMediaUploadSnapshot,
  firstAcceptedMomentRefresh,
  firstPublishedMediaRefresh,
  optimisticMediaUploadSnapshot,
  queuedOptimisticMediaUploadCount,
  removeOptimisticMediaUpload,
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

function photoDeliveryHasPhotos(data: unknown) {
  return (
    Array.isArray(data) &&
    data.some(
      (row) =>
        !!row &&
        typeof row === "object" &&
        "photo_id" in row &&
        typeof row.photo_id === "string" &&
        row.photo_id.length > 0,
    )
  );
}

function timelineHasPublishedPhoto(
  data: unknown,
  match: Readonly<{
    journalPersonId: string;
    momentId: string;
    occurredOn: string;
  }>,
) {
  if (!Array.isArray(data)) return false;
  return data.some((row) => {
    if (!row || typeof row !== "object") return false;
    const kind = "moment_kind" in row ? row.moment_kind : null;
    if (kind !== "photo") return false;
    const momentId = "moment_id" in row ? row.moment_id : null;
    const personId =
      "moment_journal_person_id" in row ? row.moment_journal_person_id : null;
    const occurredOn = "occurred_on" in row ? row.occurred_on : null;
    return (
      momentId === match.momentId ||
      (personId === match.journalPersonId &&
        String(occurredOn) === String(match.occurredOn))
    );
  });
}

async function retirePhotoIntake({
  circleId,
  intakeId,
  supabase,
}: Readonly<{
  circleId: string;
  intakeId: string;
  supabase: ReturnType<typeof createOurDaysBrowserClient>;
}>) {
  const { data, error } = await supabase.rpc("cancel_photo_intake", {
    intake_id: intakeId,
  });
  const result = data?.[0];
  if (
    error ||
    result?.state !== "invalidated" ||
    !allowedCleanupStates.has(result.cleanup_state as PhotoCleanupState)
  ) {
    return false;
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
        .filter((record) => record.intakeId === intakeId)
        .map((record) => photoUploadResumeStore.remove(record.id)),
    );
  } catch {
    // Local resume cleanup is best-effort after server-confirmed cancellation.
  }
  return true;
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
  if (upload.stage.state === "uploading") {
    if (upload.stage.retrying) return "Retrying upload…";
    const percent = Math.max(
      0,
      Math.min(99, Math.round(upload.stage.progress * 100)),
    );
    if (percent > 0) return `Uploading… ${percent}%`;
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
  if (save.stage.state === "published") return "Saved";
  if (save.stage.state === "failed") return "Couldn’t add";
  if (save.mode === "bible-verse") return "Adding verse…";
  if (save.mode === "thought") return "Adding note…";
  if (save.mode === "location") return "Adding place…";
  return "Adding milestone…";
}

function ChipProgressBar({ value }: Readonly<{ value?: number }>) {
  const determinate = typeof value === "number";
  const percent = determinate
    ? Math.min(100, Math.max(0, Math.round(value * 100)))
    : 0;
  return (
    <div
      className={
        determinate
          ? "photo-status-chip-bar"
          : "photo-status-chip-bar photo-status-chip-indeterminate"
      }
      role="progressbar"
      aria-label="Upload progress"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={determinate ? value : undefined}
    >
      {determinate ? (
        <svg
          className="photo-status-chip-bar-fill"
          viewBox="0 0 100 6"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect x="0" y="0" width={percent} height="6" rx="3" />
        </svg>
      ) : (
        <span />
      )}
    </div>
  );
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
          <ChipProgressBar value={progress} />
        ) : busy ? (
          <ChipProgressBar />
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

function uploadChip(
  upload: OptimisticMediaUpload,
  onDismissFailed: (upload: OptimisticMediaUpload) => void,
  queuedCount: number,
): PhotoStatusChipViewProps {
  const failed = upload.stage.state === "failed";
  const waitingDetail =
    !failed && queuedCount > 0
      ? `${queuedCount} more ${queuedCount === 1 ? "post is" : "posts are"} waiting to upload.`
      : null;
  return {
    busy: !failed && upload.stage.state !== "published",
    label: optimisticUploadChipLabel(upload),
    detail: waitingDetail,
    progress: optimisticUploadChipProgress(upload),
    primaryAction:
      upload.stage.state === "published"
        ? {
            label: "Dismiss",
            onClick: () => removeOptimisticMediaUpload(upload.id),
          }
        : failed
          ? upload.retryable
            ? {
                label: "Retry",
                onClick: () => {
                  retryOptimisticMediaUpload(upload.id);
                },
              }
            : {
                label: "Dismiss",
                onClick: () => onDismissFailed(upload),
              }
          : null,
    secondaryAction:
      failed && upload.retryable
        ? {
            label: "Dismiss",
            onClick: () => onDismissFailed(upload),
          }
        : null,
  };
}

function momentChip(save: OptimisticMomentSave): PhotoStatusChipViewProps {
  const failed = save.stage.state === "failed";
  return {
    busy: save.stage.state === "saving",
    label: optimisticMomentChipLabel(save),
    primaryAction: failed
      ? {
          label: "Retry",
          onClick: () => retryOptimisticMomentSave(save.id),
        }
      : null,
    secondaryAction:
      failed || save.stage.state === "published"
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
  onDismissFailed,
  onKeep,
  onRequestCancel,
  queuedCount,
  saves,
  uploads,
}: PhotoStatusShelfViewProps & {
  onDismissFailed: (upload: OptimisticMediaUpload) => void;
  queuedCount: number;
  saves: readonly OptimisticMomentSave[];
  uploads: readonly OptimisticMediaUpload[];
}): PhotoStatusChipViewProps | null {
  const failedUpload = uploads.find(
    (upload) => upload.stage.state === "failed",
  );
  if (failedUpload)
    return uploadChip(failedUpload, onDismissFailed, queuedCount);

  const failedSave = saves.find((save) => save.stage.state === "failed");
  if (failedSave) return momentChip(failedSave);

  const activeUpload = uploads.find((upload) =>
    activeUploadStates.has(upload.stage.state),
  );
  if (activeUpload)
    return uploadChip(activeUpload, onDismissFailed, queuedCount);

  const processingUpload = uploads.find(
    (upload) => upload.stage.state === "processing",
  );
  if (processingUpload) {
    return uploadChip(processingUpload, onDismissFailed, queuedCount);
  }

  const saving = saves.find((save) => save.stage.state === "saving");
  if (saving) return momentChip(saving);

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
  const [hiddenIntakeIds, setHiddenIntakeIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const runRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const publishedRef = useRef(new Set<string>());
  const optimisticUploads = useSyncExternalStore(
    subscribeToOptimisticMediaUploads,
    optimisticMediaUploadSnapshot,
    emptyOptimisticMediaUploadSnapshot,
  ).filter((upload) => upload.circleId === circleId);
  const queuedUploads = useSyncExternalStore(
    subscribeToOptimisticMediaUploads,
    () => queuedOptimisticMediaUploadCount(circleId),
    () => 0,
  );
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
                  requestPhotoProcessingResponse(intakeId),
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
            (item) =>
              (item.state === "pending" || item.state === "processing") &&
              !publishedRef.current.has(item.id),
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
                const upload = optimisticMediaUploadSnapshot().find(
                  (upload) => upload.intakeId === item.id,
                );
                if (upload && upload.completedFiles >= upload.totalFiles)
                  updateOptimisticMediaUpload(upload.id, {
                    stage: { state: "published" },
                  });
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
              if (upload.completedFiles >= upload.totalFiles)
                updateOptimisticMediaUpload(upload.id, {
                  stage: { state: "published" },
                });
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

          const optimisticSnapshot = optimisticMediaUploadSnapshot();
          const leftoverReserved = rows.filter((row) => {
            if (visibleState(row.status) !== "pending" || !row.can_cancel) {
              return false;
            }
            if (publishedRef.current.has(row.intake_id)) return false;
            return !optimisticSnapshot.some(
              (upload) =>
                upload.intakeId === row.intake_id &&
                upload.stage.state !== "failed" &&
                upload.stage.state !== "published",
            );
          });
          if (leftoverReserved.length > 0) {
            const timeline = await supabase.rpc("list_timeline_moments", {
              circle_id: circleId,
              page_size: 40,
            });
            if (run !== runRef.current) return;
            const leftoverResults = await Promise.all(
              leftoverReserved.map(async (row) => {
                const [statusResult, deliveryResult] = await Promise.all([
                  supabase.rpc("get_photo_moment_status", {
                    intake_id: row.intake_id,
                  }),
                  row.moment_id
                    ? supabase.rpc("get_photo_moment_delivery", {
                        moment_id: row.moment_id,
                      })
                    : Promise.resolve({ data: [], error: null }),
                ]);
                const status = statusResult.data?.[0]?.status;
                const published =
                  status === "published" ||
                  photoDeliveryHasPhotos(deliveryResult.data) ||
                  timelineHasPublishedPhoto(timeline.data, {
                    journalPersonId: row.journal_person_id,
                    momentId: row.moment_id,
                    occurredOn: row.occurred_on,
                  });
                return { published, row, status };
              }),
            );
            if (run !== runRef.current) return;
            const retiredIntakeIds = new Set<string>();
            for (const { published, row, status } of leftoverResults) {
              if (status && allowedMomentStatuses.has(status)) {
                resolvedStatuses.set(
                  row.intake_id,
                  status as PhotoMomentStatus,
                );
              }
              if (!published) continue;
              publishedRef.current.add(row.intake_id);
              retiredIntakeIds.add(row.intake_id);
              setHiddenIntakeIds((current) => {
                if (current.has(row.intake_id)) return current;
                const next = new Set(current);
                next.add(row.intake_id);
                return next;
              });
              const upload = optimisticMediaUploadSnapshot().find(
                (upload) => upload.intakeId === row.intake_id,
              );
              if (upload && upload.completedFiles >= upload.totalFiles)
                updateOptimisticMediaUpload(upload.id, {
                  stage: { state: "published" },
                });
              shouldRefresh = true;
              if (
                await retirePhotoIntake({
                  circleId,
                  intakeId: row.intake_id,
                  supabase,
                })
              ) {
                resolvedStatuses.set(row.intake_id, "cancelled");
              }
            }
            if (retiredIntakeIds.size > 0) {
              setItems((current) =>
                current.filter((item) => !retiredIntakeIds.has(item.id)),
              );
            }
            if (shouldRefresh) router.refresh();
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
    const clear = () => {
      runRef.current += 1;
      inFlightRef.current = null;
      publishedRef.current.clear();
      clearOptimisticMediaUploads();
      setItems([]);
      setCancellationResult(null);
      setConfirmingCancelId(null);
      setCancellingIds(new Set());
      setHiddenIntakeIds(new Set());
    };
    window.addEventListener("our-days:clear-private-state", clear);
    window.addEventListener("online", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () => {
      window.removeEventListener("our-days:clear-private-state", clear);
      window.removeEventListener("online", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
      runRef.current += 1;
      inFlightRef.current = null;
    };
  }, [checkStatuses]);

  const hasActiveWork =
    items.some(
      (item) => item.state === "pending" || item.state === "processing",
    ) ||
    optimisticUploads.some(
      (upload) =>
        activeUploadStates.has(upload.stage.state) ||
        upload.stage.state === "processing",
    );
  useEffect(() => {
    if (!hasActiveWork) return;
    const interval = window.setInterval(() => {
      if (!document.hidden) void checkStatuses(true);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [checkStatuses, hasActiveWork]);

  useEffect(() => {
    for (const upload of optimisticUploads) {
      if (!upload.momentId) continue;
      if (firstAcceptedMomentRefresh(upload.momentId)) router.refresh();
    }
  }, [optimisticUploads, router]);

  const incomingPublishedIntakeIds = optimisticUploads.flatMap((upload) =>
    upload.stage.state === "published" && upload.intakeId
      ? [upload.intakeId]
      : [],
  );
  if (incomingPublishedIntakeIds.some((id) => !hiddenIntakeIds.has(id))) {
    const nextHidden = new Set(hiddenIntakeIds);
    for (const intakeId of incomingPublishedIntakeIds) {
      nextHidden.add(intakeId);
    }
    setHiddenIntakeIds(nextHidden);
  }

  const publishedUploadKey = incomingPublishedIntakeIds.join();
  useEffect(() => {
    if (!publishedUploadKey) return;
    for (const intakeId of publishedUploadKey.split(",")) {
      if (intakeId) publishedRef.current.add(intakeId);
    }
    void checkStatuses();
  }, [checkStatuses, publishedUploadKey]);

  useEffect(() => {
    for (const upload of optimisticUploads) {
      if (upload.stage.state !== "published") continue;
      const refreshKey = upload.intakeId ?? upload.momentId ?? upload.id;
      if (firstPublishedMediaRefresh(refreshKey)) router.refresh();
    }
  }, [optimisticUploads, router]);

  const hideIntake = (intakeId: string) => {
    publishedRef.current.add(intakeId);
    setHiddenIntakeIds((current) => {
      if (current.has(intakeId)) return current;
      const next = new Set(current);
      next.add(intakeId);
      return next;
    });
    setItems((current) => current.filter((item) => item.id !== intakeId));
  };

  const dismissFailedUpload = (upload: OptimisticMediaUpload) => {
    if (upload.intakeId) {
      hideIntake(upload.intakeId);
    }
    removeOptimisticMediaUpload(upload.id);
    if (upload.intakeId) {
      void retirePhotoIntake({
        circleId,
        intakeId: upload.intakeId,
        supabase: createOurDaysBrowserClient(),
      });
    }
  };

  const cancel = async (id: string) => {
    runRef.current += 1;
    inFlightRef.current = null;
    setConfirmingCancelId(null);
    setCancellingIds((current) => new Set(current).add(id));
    setCancellationResult(null);

    const retired = await retirePhotoIntake({
      circleId,
      intakeId: id,
      supabase: createOurDaysBrowserClient(),
    });
    if (!retired) {
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
    hideIntake(id);
    setCancellingIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  return (
    <VisiblePhotoStatusChip
      cancellationResult={cancellationResult}
      cancellingIds={cancellingIds}
      confirmingCancelId={confirmingCancelId}
      items={items.filter(
        (item) =>
          !hiddenIntakeIds.has(item.id) &&
          !optimisticUploads.some((upload) => upload.intakeId === item.id),
      )}
      onConfirmCancel={(id) => void cancel(id)}
      onDismissFailed={dismissFailedUpload}
      onKeep={() => setConfirmingCancelId(null)}
      onRequestCancel={setConfirmingCancelId}
      queuedCount={queuedUploads}
      saves={optimisticMomentSaves}
      uploads={optimisticUploads}
    />
  );
}

function VisiblePhotoStatusChip(
  props: PhotoStatusShelfViewProps & {
    onDismissFailed: (upload: OptimisticMediaUpload) => void;
    queuedCount: number;
    saves: readonly OptimisticMomentSave[];
    uploads: readonly OptimisticMediaUpload[];
  },
) {
  const chip = selectVisibleChip(props);
  if (!chip) return null;
  return <PhotoStatusChipView {...chip} />;
}
