"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { SettingsRowCopy } from "@/features/family-settings/settings-directory";
import type { AccountSafetySnapshot } from "./safety-actions";
import { deletionConfirmation } from "./terms";

function organizerExplanation(circles: readonly string[]) {
  if (circles.length === 1) {
    return `${circles[0]} needs another organizer or archiving before this account can be deleted.`;
  }
  return `${circles.join(", ")} need another organizer or archiving before this account can be deleted.`;
}

export function AccountSafetyControls({
  safety,
}: {
  safety?: AccountSafetySnapshot | null;
}) {
  const blocks = safety?.blocks ?? [];
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [circles, setCircles] = useState<readonly string[]>(
    safety?.lastOrganizerCircles ?? [],
  );
  const blocked = circles.length > 0;

  return (
    <>
      <div className="settings-row is-plain">
        <SettingsRowCopy
          title="Blocked people"
          subtitle={blocks.length === 0 ? "No one is blocked." : undefined}
        />
      </div>
      {blocks.map((block) => (
        <div className="settings-row is-plain" key={block.membershipId}>
          <SettingsRowCopy title={block.personDisplayName} />
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void (async () => {
                try {
                  const { unblockAuthor } = await import("./safety-actions");
                  const result = await unblockAuthor(block.membershipId);
                  if (!result.ok) setError(result.message);
                  else window.location.reload();
                } finally {
                  setPending(false);
                }
              })();
            }}
          >
            {`Unblock ${block.personDisplayName}`}
          </button>
        </div>
      ))}
      <div className="settings-row is-plain">
        <button
          type="button"
          className="safety-delete-trigger"
          onClick={() => {
            setCircles(safety?.lastOrganizerCircles ?? []);
            setError(null);
            setOpen(true);
          }}
        >
          Delete account
        </button>
      </div>
      {error && !open ? <p role="alert">{error}</p> : null}
      {open
        ? createPortal(
            <>
              <div className="safety-dialog-scrim" />
              <div
                className="safety-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="delete-account-title"
              >
                <h2 id="delete-account-title">Delete account</h2>
                {blocked ? (
                  <p>{organizerExplanation(circles)}</p>
                ) : (
                  <p>{deletionConfirmation}</p>
                )}
                {error ? <p role="alert">{error}</p> : null}
                <div className="safety-dialog-actions">
                  <button type="button" onClick={() => setOpen(false)}>
                    Close
                  </button>
                  {blocked ? null : (
                    <button
                      type="button"
                      className="is-destructive"
                      disabled={pending}
                      onClick={() => {
                        setPending(true);
                        setError(null);
                        void (async () => {
                          try {
                            const { requestAccountDeletion } =
                              await import("./safety-actions");
                            const result = await requestAccountDeletion();
                            if (!result.ok) {
                              if (result.lastOrganizerCircles?.length) {
                                setCircles(result.lastOrganizerCircles);
                              }
                              setError(result.message);
                              return;
                            }
                            const { signOutCurrentDevice } =
                              await import("@/features/auth/sign-out-action");
                            const signedOut = await signOutCurrentDevice();
                            if (!signedOut.ok) {
                              setError(
                                signedOut.message ??
                                  "Deletion requested. Sign out and use another email.",
                              );
                              return;
                            }
                            const { purgeOurDaysBrowserState } =
                              await import("@/lib/auth/browser-private-state");
                            await purgeOurDaysBrowserState();
                            window.location.replace(
                              "/sign-in?notice=deletion-requested",
                            );
                          } finally {
                            setPending(false);
                          }
                        })();
                      }}
                    >
                      {pending ? "Requesting…" : "Delete my account"}
                    </button>
                  )}
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
