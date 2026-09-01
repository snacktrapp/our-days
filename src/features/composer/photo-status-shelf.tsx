"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import { photoUploadResumeStore } from "./photo-upload-resume-store";

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
    | "attention"
    | "cancelled"
    | "pending"
    | "processing"
    | "published-cleanup";
  canCancel: boolean;
  cleanupState: PhotoCleanupState;
}>;

type CancellationResult = Readonly<{
  id: string;
  kind: "error" | "success";
  message: string;
}>;

type PhotoStatusShelfViewProps = Readonly<{
  cancellationResult: CancellationResult | null;
  cancellingIds: ReadonlySet<string>;
  cleanupWarningId: string | null;
  confirmingCancelId: string | null;
  checkFailed: boolean;
  checking: boolean;
  items: readonly PhotoStatusItem[];
  localStoreWarning: boolean;
  onConfirmCancel: (id: string) => void;
  onKeep: () => void;
  onRequestCancel: (id: string) => void;
  onCheck: () => void;
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

function cleanupCopy(item: PhotoStatusItem) {
  const prefix =
    item.state === "published-cleanup"
      ? "The photo was added privately."
      : "It won’t be added.";
  if (item.cleanupState === "not_required") {
    return `${prefix} No uploaded photo bytes were retained.`;
  }
  if (item.cleanupState === "leased") {
    return `${prefix} Its temporary private upload copy is being removed.`;
  }
  if (item.cleanupState === "operator_review") {
    return `${prefix} Its temporary private upload copy needs private maintenance.`;
  }
  return `${prefix} Its temporary private upload copy is waiting for secure removal.`;
}

export function PhotoStatusShelf({ circleId }: Readonly<{ circleId: string }>) {
  const router = useRouter();
  const [items, setItems] = useState<readonly PhotoStatusItem[]>([]);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmingCancelId, setConfirmingCancelId] = useState<string | null>(
    null,
  );
  const [cancellationResult, setCancellationResult] =
    useState<CancellationResult | null>(null);
  const [cleanupWarningId, setCleanupWarningId] = useState<string | null>(null);
  const [localStoreWarning, setLocalStoreWarning] = useState(false);
  const [cancellingIds, setCancellingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const runRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const publishedRef = useRef(new Set<string>());

  const checkStatuses = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = ++runRef.current;
    setChecking(true);
    const task = (async () => {
      try {
        const supabase = createOurDaysBrowserClient();
        const { data: rows, error } = await supabase.rpc(
          "list_my_photo_intakes",
          { circle_id: circleId },
        );
        if (run !== runRef.current) return;
        if (
          error ||
          !rows ||
          rows.some(
            (row) =>
              !allowedServerStatuses.has(row.status) ||
              !allowedCleanupStates.has(row.cleanup_state as PhotoCleanupState),
          )
        ) {
          throw new Error("Photo status unavailable");
        }

        const nextItems = rows.map((row) => ({
          id: row.intake_id,
          journalPersonName: row.journal_person_name,
          occurredOn: row.occurred_on,
          state: visibleState(row.status),
          canCancel: row.can_cancel,
          cleanupState: row.cleanup_state as PhotoCleanupState,
        }));
        setItems(nextItems);
        setCheckFailed(false);
        setCancellationResult((current) =>
          current && nextItems.some((item) => item.id === current.id)
            ? current
            : null,
        );

        let shouldRefresh = false;
        for (const item of nextItems) {
          if (
            item.state === "published-cleanup" &&
            !publishedRef.current.has(item.id)
          ) {
            publishedRef.current.add(item.id);
            shouldRefresh = true;
          }
        }
        if (shouldRefresh) router.refresh();

        try {
          const { data: sessionData, error: sessionError } =
            await supabase.auth.getSession();
          const accountId = sessionData.session?.user.id;
          if (sessionError || !accountId) throw new Error("Session unavailable");
          const localRecords = await photoUploadResumeStore.listForScope(
            accountId,
            circleId,
          );
          const serverIntakeIds = new Set(rows.map((row) => row.intake_id));
          await Promise.all(
            localRecords
              .filter(
                (record) =>
                  record.intakeId && !serverIntakeIds.has(record.intakeId),
              )
              .map((record) => photoUploadResumeStore.remove(record.id)),
          );
          if (run === runRef.current) setLocalStoreWarning(false);
        } catch {
          if (run === runRef.current) setLocalStoreWarning(true);
        }
      } catch {
        if (run === runRef.current) setCheckFailed(true);
      } finally {
        if (run === runRef.current) setChecking(false);
      }
    })();
    inFlightRef.current = task;
    void task.finally(() => {
      if (inFlightRef.current === task) inFlightRef.current = null;
    });
    return task;
  }, [circleId, router]);

  useEffect(() => {
    void checkStatuses();
    const checkWhenVisible = () => {
      if (!document.hidden) void checkStatuses();
    };
    const interval = window.setInterval(checkWhenVisible, 10_000);
    const clear = () => {
      runRef.current += 1;
      inFlightRef.current = null;
      publishedRef.current.clear();
      setItems([]);
      setCheckFailed(false);
      setCancellationResult(null);
      setCleanupWarningId(null);
      setConfirmingCancelId(null);
      setLocalStoreWarning(false);
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

  const cancel = async (id: string) => {
    runRef.current += 1;
    inFlightRef.current = null;
    setConfirmingCancelId(null);
    setCancellingIds((current) => new Set(current).add(id));
    setCancellationResult(null);
    setCleanupWarningId(null);

    const supabase = createOurDaysBrowserClient();
    let cleanupState: PhotoCleanupState;
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
      cleanupState = result.cleanup_state as PhotoCleanupState;
      setItems((current) =>
        current.map((item) =>
          item.id === id
            ? {
                ...item,
                canCancel: false,
                cleanupState,
                state: "cancelled",
              }
            : item,
        ),
      );
      setCancellationResult({
        id,
        kind: "success",
        message: "Cancellation confirmed. The photo won’t be added.",
      });
    } catch {
      setCancellationResult({
        id,
        kind: "error",
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
      setCleanupWarningId(id);
    } finally {
      setCancellingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <PhotoStatusShelfView
      cancellationResult={cancellationResult}
      cancellingIds={cancellingIds}
      cleanupWarningId={cleanupWarningId}
      confirmingCancelId={confirmingCancelId}
      checkFailed={checkFailed}
      checking={checking}
      items={items}
      localStoreWarning={localStoreWarning}
      onConfirmCancel={(id) => void cancel(id)}
      onKeep={() => setConfirmingCancelId(null)}
      onRequestCancel={setConfirmingCancelId}
      onCheck={() => void checkStatuses()}
    />
  );
}

export function PhotoStatusShelfView({
  cancellationResult,
  cancellingIds,
  cleanupWarningId,
  confirmingCancelId,
  checkFailed,
  checking,
  items,
  localStoreWarning,
  onConfirmCancel,
  onKeep,
  onRequestCancel,
  onCheck,
}: PhotoStatusShelfViewProps) {
  const resultRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (cancellationResult) resultRef.current?.focus();
  }, [cancellationResult]);

  if (items.length === 0 && !checkFailed) return null;

  return (
    <section className="photo-status-shelf" aria-label="Private photo status">
      {cancellationResult ? (
        <p
          className="photo-status-result"
          ref={resultRef}
          role={cancellationResult.kind === "error" ? "alert" : "status"}
          tabIndex={-1}
        >
          {cancellationResult.message}
        </p>
      ) : null}
      {localStoreWarning ? (
        <p className="photo-status-browser-note" role="status">
          Photo status is current, but this browser couldn’t tidy its saved
          upload shortcut.
        </p>
      ) : null}
      {items.map((item) => {
        const cancelling = cancellingIds.has(item.id);
        const confirming = confirmingCancelId === item.id;
        const cleanupAttention = item.cleanupState === "operator_review";
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
            <div>
              <strong>
                {cleanupAttention
                  ? item.state === "published-cleanup"
                    ? "Photo added; cleanup needs attention"
                    : "Private cleanup needs attention"
                  : item.state === "pending"
                    ? "Private upload not finished"
                    : item.state === "processing"
                      ? "Preparing your photo"
                      : item.state === "cancelled"
                        ? "Photo cancelled"
                        : item.state === "published-cleanup"
                          ? "Photo added privately"
                          : "Photo wasn’t added"}
              </strong>
              <span>
                {item.journalPersonName} · {dateLabel(item.occurredOn)}
              </span>
              <span>
                {item.state === "pending"
                  ? "It is private and has not been added to the timeline."
                  : item.state === "processing"
                    ? "It is being prepared privately and can’t be cancelled safely now."
                    : item.state === "cancelled" ||
                        item.state === "published-cleanup"
                      ? cleanupCopy(item)
                      : "It remains private and was not added. Family organizers can review it later."}
              </span>
              {cleanupWarningId === item.id ? (
                <span role="status">
                  Cancellation was confirmed, but this browser couldn’t remove
                  its saved upload shortcut.
                </span>
              ) : null}
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
      {checkFailed ? (
        <div className="photo-status-item photo-status-error" role="alert">
          <span className="photo-status-mark" aria-hidden="true">
            ◌
          </span>
          <div>
            <strong>Couldn’t check your photo yet</strong>
            <span>We couldn’t check its private status yet.</span>
          </div>
          <button type="button" disabled={checking} onClick={onCheck}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
