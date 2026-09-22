"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteCircleAction } from "./delete-circle-action";

export function DeleteCircleControl({
  circleId,
  name,
}: {
  circleId: string;
  name: string;
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
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
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
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Delete unused circle
        </button>
      )}
      {message ? <p role="status">{message}</p> : null}
    </div>
  );
}
