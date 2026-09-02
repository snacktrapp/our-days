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
  firstPublishedMediaRefresh,
  optimisticMediaUploadSnapshot,
  removeOptimisticMediaUpload,
  removeOptimisticMediaUploadByIntake,
  subscribeToOptimisticMediaUploads,
  updateOptimisticMediaUpload,
  type OptimisticMediaUpload,
} from "./optimistic-media-upload";

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

function optimisticStageLabel(upload: OptimisticMediaUpload) {
  if (upload.stage.state === "uploading") {
    return `Uploading ${Math.round(upload.stage.progress * 100)}%`;
  }
  if (upload.stage.state === "processing") return "Preparing media";
  if (upload.stage.state === "published") return "Added to timeline";
  if (upload.stage.state === "failed") return upload.stage.message;
  if (upload.stage.state === "stopping") return "Stopping upload";
  if (upload.stage.state === "finishing") return "Finishing";
  return "Preparing upload";
}

function OptimisticMediaCard({
  upload,
  pendingPlacement = false,
}: Readonly<{
  upload: OptimisticMediaUpload;
  pendingPlacement?: boolean;
}>) {
  return (
    <article
      className={
        pendingPlacement
          ? "pending-media-item"
          : "moment moment-media optimistic-media-moment"
      }
    >
      <div className="connection">
        <span
          className={`avatar-node dot-${upload.journalPersonAccent}`}
          aria-hidden="true"
        >
          {upload.journalPersonInitial}
        </span>
        <span className="moment-meta">
          <strong>{upload.journalPersonName}</strong>
          <span>
            {dateLabel(upload.occurredOn)}
            {upload.occurredTime ? ` | ${upload.occurredTime}` : ""}
          </span>
        </span>
      </div>
      <div
        className="moment-card photo-card optimistic-media-card"
        aria-busy={
          upload.stage.state !== "failed" && upload.stage.state !== "published"
        }
      >
        <div className="photo-frame">
          {upload.kind === "video" ? (
            <video
              src={upload.previewUrl}
              muted
              playsInline
              preload="metadata"
            />
          ) : (
            // The preview is a private, device-local blob URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={upload.previewUrl} alt="" />
          )}
          <span className="optimistic-media-overlay">
            {optimisticStageLabel(upload)}
          </span>
        </div>
        <div className="card-copy">
          <div className="photo-card-heading">
            <p className="moment-kicker">{upload.kind}</p>
          </div>
          {upload.body ? <p>{upload.body}</p> : null}
          {pendingPlacement ? (
            <p className="pending-media-placement">
              Uploading privately · Will appear on{" "}
              {dateLabel(upload.occurredOn)}
            </p>
          ) : null}
          {upload.stage.state === "uploading" ? (
            <progress max={1} value={upload.stage.progress}>
              {Math.round(upload.stage.progress * 100)}%
            </progress>
          ) : null}
          {upload.stage.state === "failed" ? (
            <button
              className="pending-media-dismiss"
              type="button"
              onClick={() => removeOptimisticMediaUpload(upload.id)}
            >
              Dismiss
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function OptimisticMediaTimeline({
  uploads,
}: Readonly<{ uploads: readonly OptimisticMediaUpload[] }>) {
  if (uploads.length === 0) return null;

  return (
    <section
      className="timeline optimistic-media-timeline"
      aria-label="Media being added"
    >
      <div className="time-rail" aria-hidden="true" />
      {uploads.map((upload) => (
        <OptimisticMediaCard key={upload.id} upload={upload} />
      ))}
    </section>
  );
}

function BackdatedMediaShelf({
  uploads,
}: Readonly<{ uploads: readonly OptimisticMediaUpload[] }>) {
  if (uploads.length === 0) return null;
  return (
    <section className="pending-media-shelf" aria-label="Media being uploaded">
      {uploads.map((upload) => (
        <OptimisticMediaCard key={upload.id} upload={upload} pendingPlacement />
      ))}
    </section>
  );
}

export function PhotoStatusShelf({
  circleId,
  today = "",
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
    <>
      <OptimisticMediaTimeline
        uploads={optimisticUploads.filter(
          (upload) => upload.occurredOn === today,
        )}
      />
      <BackdatedMediaShelf
        uploads={optimisticUploads.filter(
          (upload) => upload.occurredOn !== today,
        )}
      />
      <PhotoStatusShelfView
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
      />
    </>
  );
}

export function PhotoStatusShelfView({
  cancellationResult,
  cancellingIds,
  confirmingCancelId,
  items,
  onConfirmCancel,
  onKeep,
  onRequestCancel,
}: PhotoStatusShelfViewProps) {
  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (cancellationResult) resultRef.current?.focus();
  }, [cancellationResult]);

  if (items.length === 0 && !cancellationResult) return null;

  const processingCount = items.filter(
    (item) => item.state === "processing",
  ).length;
  const unfinishedItems = items.filter((item) => item.state === "pending");

  return (
    <section className="photo-status-shelf" aria-label="Private photo status">
      {cancellationResult ? (
        <p
          className="photo-status-result"
          ref={resultRef}
          role="alert"
          tabIndex={-1}
        >
          {cancellationResult.message}
        </p>
      ) : null}
      {processingCount > 0 ? (
        <p className="photo-processing-status" role="status">
          {processingCount === 1
            ? "Adding your photo…"
            : `Adding ${processingCount} photos…`}
        </p>
      ) : null}
      {unfinishedItems.map((item) => {
        const cancelling = cancellingIds.has(item.id);
        const confirming = confirmingCancelId === item.id;
        return (
          <div
            key={item.id}
            className="photo-status-item"
            aria-busy={cancelling}
          >
            <span className="photo-status-mark" aria-hidden="true">
              {item.state === "pending" || item.state === "processing"
                ? "◌"
                : item.state === "published-cleanup"
                  ? "✓"
                  : "!"}
            </span>
            <div className="photo-status-copy">
              <strong>Photo upload paused</strong>
              <span>
                {item.journalPersonName} · {dateLabel(item.occurredOn)}
              </span>
              <span>It hasn’t been added to the timeline.</span>
              {confirming ? (
                <span className="photo-status-confirmation">
                  Cancel this unfinished photo? It won’t be added.
                </span>
              ) : null}
            </div>
            {item.canCancel ? (
              <div className="photo-status-actions">
                {confirming ? (
                  <>
                    <button type="button" onClick={onKeep}>
                      Keep upload
                    </button>
                    <button
                      type="button"
                      aria-label={`Confirm cancellation for ${item.journalPersonName}, ${dateLabel(item.occurredOn)}`}
                      disabled={cancelling}
                      onClick={() => onConfirmCancel(item.id)}
                    >
                      {cancelling ? "Cancelling…" : "Confirm cancel"}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    aria-label={`Cancel upload for ${item.journalPersonName}, ${dateLabel(item.occurredOn)}`}
                    disabled={cancelling}
                    onClick={() => onRequestCancel(item.id)}
                  >
                    Cancel upload
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
