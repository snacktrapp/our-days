"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCircleAction } from "./delete-circle-action";

export function DeleteCircleControl({
  circleId,
  name,
  disabled = false,
}: {
  circleId: string;
  name: string;
  disabled?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <div className="circle-delete-control">
      {confirming ? (
        <>
          <p>
            Delete “{name}”? This only works for an unused circle with no other
            people, posts, or history. It cannot be undone.
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
              className="settings-danger-button"
              disabled={pending || disabled}
              onClick={() =>
                startTransition(async () => {
                  try {
                    const result = await deleteCircleAction(circleId, name);
                    setMessage(result.message);
                    if (result.ok) {
                      router.replace("/circles");
                      router.refresh();
                    }
                  } catch {
                    setMessage(
                      "The deletion couldn’t be confirmed. Refresh before trying again.",
                    );
                  }
                })
              }
            >
              {pending ? "Deleting…" : "Delete circle"}
            </button>
          </div>
        </>
      ) : (
        <button
          type="button"
          className="circle-delete-trigger"
          disabled={disabled}
          onClick={() => {
            setConfirming(true);
            setMessage("");
          }}
        >
          Delete circle
        </button>
      )}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
