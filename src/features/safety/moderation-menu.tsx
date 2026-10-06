"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { reportReasons, reportThanks } from "./terms";

type ReportTarget = Readonly<{
  targetKind: "moment" | "note";
  targetId: string;
  onClose: () => void;
}>;

export function ReportDialog({ targetKind, targetId, onClose }: ReportTarget) {
  const router = useRouter();
  const [reason, setReason] = useState<string>(reportReasons[0][0]);
  const [details, setDetails] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thanks, setThanks] = useState<string | null>(null);

  useEffect(() => {
    if (!thanks) return;
    const timer = window.setTimeout(() => {
      router.refresh();
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [router, thanks]);

  return createPortal(
    <div onPointerDown={(event) => event.stopPropagation()}>
      <div className="safety-dialog-scrim" />
      <div
        className="safety-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-dialog-title"
      >
        <h2 id="report-dialog-title">Report</h2>
        {thanks ? (
          <p role="status">{thanks}</p>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPending(true);
              setError(null);
              void (async () => {
                const { reportContent } = await import("./safety-actions");
                const result = await reportContent({
                  targetKind,
                  targetId,
                  reason,
                  details,
                });
                setPending(false);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                setThanks(result.message || reportThanks);
              })();
            }}
          >
            <label>
              Reason
              <select
                value={reason}
                required
                onChange={(event) => setReason(event.target.value)}
              >
                {reportReasons.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Details
              <textarea
                value={details}
                maxLength={2000}
                onChange={(event) => setDetails(event.target.value)}
              />
            </label>
            {error ? <p role="alert">{error}</p> : null}
            <div className="safety-dialog-actions">
              <button type="button" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" disabled={pending}>
                {pending ? "Sending…" : "Submit report"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function ModerationMenuButtons({
  targetKind,
  targetId,
  authorMembershipId,
  authorName,
  onFinished,
}: Readonly<{
  targetKind: "moment" | "note";
  targetId: string;
  authorMembershipId?: string;
  authorName?: string;
  onFinished?: () => void;
}>) {
  const router = useRouter();
  const [reportOpen, setReportOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = authorName?.trim() || "this person";

  return (
    <>
      <button type="button" onClick={() => setReportOpen(true)}>
        Report
      </button>
      {authorMembershipId ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (pending) return;
            if (!window.confirm(`Block ${name}? They will not be told.`)) {
              return;
            }
            setPending(true);
            setError(null);
            void (async () => {
              try {
                const { blockAuthor } = await import("./safety-actions");
                const result = await blockAuthor(authorMembershipId);
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                onFinished?.();
                router.refresh();
              } finally {
                setPending(false);
              }
            })();
          }}
        >
          {`Block ${name}`}
        </button>
      ) : null}
      {error ? (
        <p className="connected-moment-message" role="alert">
          {error}
        </p>
      ) : null}
      {reportOpen ? (
        <ReportDialog
          targetKind={targetKind}
          targetId={targetId}
          onClose={() => setReportOpen(false)}
        />
      ) : null}
    </>
  );
}

export function CommentModeration({
  noteId,
  authorMembershipId,
  authorName,
}: Readonly<{
  noteId: string;
  authorMembershipId: string;
  authorName: string;
}>) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const [menuStyle, setMenuStyle] = useState<{
    top: number;
    right: number;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const place = () => {
      const trigger = wrapperRef.current?.querySelector("button");
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setMenuStyle({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    place();
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <span className="inline-note-more" ref={wrapperRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-label="Comment options"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <span className="inline-note-more-dots" aria-hidden="true" />
      </button>
      {open ? (
        <span
          className="connected-moment-menu comment-moderation-menu"
          role="group"
          aria-label="Comment options"
          style={
            menuStyle
              ? { top: menuStyle.top, right: menuStyle.right }
              : { visibility: "hidden" }
          }
        >
          <ModerationMenuButtons
            targetKind="note"
            targetId={noteId}
            authorMembershipId={authorMembershipId}
            authorName={authorName}
            onFinished={() => setOpen(false)}
          />
        </span>
      ) : null}
    </span>
  );
}
