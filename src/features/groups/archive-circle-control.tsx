"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { archiveCircleAction } from "./archive-circle-action";

export function ArchiveCircleControl({
  circleId,
  name,
  archived = false,
  disabled = false,
}: {
  circleId: string;
  name: string;
  archived?: boolean;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  function submit() {
    startTransition(async () => {
      try {
        const result = await archiveCircleAction(circleId, !archived);
        setMessage(result.message);
        if (result.ok) {
          setConfirming(false);
          router.refresh();
        }
      } catch {
        setMessage(
          "The change couldn’t be confirmed. Refresh before trying again.",
        );
      }
    });
  }
  return (
    <div className="circle-delete-control">
      {confirming ? (
        <>
          <p>
            Archive “{name}”? It will be hidden from circle lists and posting
            choices for everyone. Posts and people are kept. You can restore it
            anytime.
          </p>
          <div className="settings-review-actions">
            <button
              type="button"
              disabled={pending || disabled}
              onClick={() => {
                setConfirming(false);
                setMessage("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || disabled}
              onClick={submit}
            >
              {pending ? "Archiving…" : "Archive circle"}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="circle-delete-trigger"
          disabled={pending || disabled}
          onClick={() => (archived ? submit() : setConfirming(true))}
        >
          {pending
            ? "Restoring…"
            : archived
              ? "Restore circle"
              : "Archive circle"}
        </button>
      )}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
