"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createOurDaysBrowserClient } from "@/lib/supabase/browser";
import {
  photoUploadResumeStore,
  type PhotoUploadResumeRecord,
} from "./photo-upload-resume-store";

export type PhotoStatusItem = Readonly<{
  id: string;
  state: "attention" | "interrupted" | "pending" | "processing";
}>;

type PhotoStatusShelfViewProps = Readonly<{
  checkFailed: boolean;
  checking: boolean;
  dismissFailedId: string | null;
  items: readonly PhotoStatusItem[];
  onCheck: () => void;
  onDismiss: (id: string) => void;
}>;

function firstStatusRow(
  rows:
    readonly Readonly<{ status: string; moment_id: string | null }>[] | null,
) {
  return rows?.[0];
}

function localStatus(record: PhotoUploadResumeRecord) {
  if (record.acknowledged) {
    return record.intakeId ? null : ("attention" as const);
  }
  const expiresAt = record.expiresAt
    ? Date.parse(record.expiresAt)
    : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
    ? ("interrupted" as const)
    : ("pending" as const);
}

export function PhotoStatusShelf({ circleId }: Readonly<{ circleId: string }>) {
  const router = useRouter();
  const [items, setItems] = useState<readonly PhotoStatusItem[]>([]);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dismissFailedId, setDismissFailedId] = useState<string | null>(null);
  const runRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const dismissedRef = useRef(new Set<string>());

  const checkStatuses = useCallback(() => {
    if (inFlightRef.current) return inFlightRef.current;
    const run = ++runRef.current;
    setChecking(true);
    const task = (async () => {
      try {
        const supabase = createOurDaysBrowserClient();
        const { data, error } = await supabase.auth.getSession();
        const accountId = data.session?.user.id;
        if (error || !accountId) {
          if (run === runRef.current) {
            setItems([]);
            setCheckFailed(false);
            setDismissFailedId(null);
          }
          return;
        }

        const records = await photoUploadResumeStore.listForScope(
          accountId,
          circleId,
        );
        if (run !== runRef.current) return;
        const nextItems: PhotoStatusItem[] = [];
        let published = false;

        for (const record of records) {
          if (dismissedRef.current.has(record.id)) continue;
          const local = localStatus(record);
          if (local) {
            nextItems.push({ id: record.id, state: local });
            continue;
          }
          const { data: rows, error: statusError } = await supabase.rpc(
            "get_photo_moment_status",
            { intake_id: record.intakeId! },
          );
          if (run !== runRef.current) return;
          const status = firstStatusRow(rows);
          if (
            statusError ||
            !status ||
            ![
              "needs_attention",
              "processing",
              "published",
              "uploading",
            ].includes(status.status)
          ) {
            throw new Error("Photo status unavailable");
          }
          if (status.status === "published") {
            if (dismissedRef.current.has(record.id)) continue;
            await photoUploadResumeStore.remove(record.id);
            if (run !== runRef.current) return;
            published = true;
          } else if (status.status === "needs_attention") {
            nextItems.push({ id: record.id, state: "attention" });
          } else {
            nextItems.push({ id: record.id, state: "processing" });
          }
        }

        if (run !== runRef.current) return;
        setItems(nextItems);
        setCheckFailed(false);
        setDismissFailedId((current) =>
          current && nextItems.some((item) => item.id === current)
            ? current
            : null,
        );
        if (published) router.refresh();
      } catch {
        if (run === runRef.current) setCheckFailed(true);
      } finally {
        setChecking(false);
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
      dismissedRef.current.clear();
      setItems([]);
      setCheckFailed(false);
      setDismissFailedId(null);
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
    };
  }, [checkStatuses]);

  const dismiss = async (id: string) => {
    dismissedRef.current.add(id);
    runRef.current += 1;
    try {
      await photoUploadResumeStore.remove(id);
      setItems((current) => current.filter((item) => item.id !== id));
      setDismissFailedId(null);
    } catch {
      dismissedRef.current.delete(id);
      setDismissFailedId(id);
    }
  };

  return (
    <PhotoStatusShelfView
      checkFailed={checkFailed}
      checking={checking}
      dismissFailedId={dismissFailedId}
      items={items}
      onCheck={() => void checkStatuses()}
      onDismiss={(id) => void dismiss(id)}
    />
  );
}

export function PhotoStatusShelfView({
  checkFailed,
  checking,
  dismissFailedId,
  items,
  onCheck,
  onDismiss,
}: PhotoStatusShelfViewProps) {
  if (items.length === 0 && !checkFailed) return null;

  return (
    <section
      className="photo-status-shelf"
      aria-label="Private photo status"
      aria-live="polite"
    >
      {items.map((item) => (
        <div key={item.id} className="photo-status-item">
          <span className="photo-status-mark" aria-hidden="true">
            {item.state === "processing" || item.state === "pending"
              ? "◌"
              : "!"}
          </span>
          <div>
            <strong>
              {item.state === "pending"
                ? "Private upload not finished"
                : item.state === "processing"
                  ? "Preparing your photo"
                  : item.state === "attention"
                    ? "This photo needs attention"
                    : "Upload didn’t finish"}
            </strong>
            <span>
              {item.state === "pending"
                ? "It is private and has not been added to the timeline."
                : item.state === "processing"
                  ? "It will appear in the timeline when it is ready."
                  : item.state === "attention"
                    ? "It was kept private and was not added to the timeline."
                    : "Return to Add Moment with the same details and photo to continue."}
            </span>
            {dismissFailedId === item.id ? (
              <span role="alert">
                Couldn’t dismiss this notice. Try Dismiss again.
              </span>
            ) : null}
          </div>
          {item.state === "attention" || item.state === "interrupted" ? (
            <button type="button" onClick={() => onDismiss(item.id)}>
              Dismiss
            </button>
          ) : null}
        </div>
      ))}
      {checkFailed ? (
        <div className="photo-status-item photo-status-error" role="alert">
          <span className="photo-status-mark" aria-hidden="true">
            ◌
          </span>
          <div>
            <strong>Couldn’t check your photo yet</strong>
            <span>We couldn’t check its status yet.</span>
          </div>
          <button type="button" disabled={checking} onClick={onCheck}>
            {checking ? "Checking…" : "Check again"}
          </button>
        </div>
      ) : null}
    </section>
  );
}
