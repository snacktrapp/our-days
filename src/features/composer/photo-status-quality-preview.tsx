"use client";

import { PhotoStatusShelfView } from "./photo-status-shelf";

export function PhotoStatusQualityPreview() {
  return (
    <main className="photo-status-quality-preview">
      <h1>Private photo status</h1>
      <p>Mobile layout and accessibility fixture</p>
      <PhotoStatusShelfView
        cancellationResult={null}
        cancellingIds={new Set()}
        cleanupWarningId={null}
        confirmingCancelId="pending"
        checkFailed
        checking={false}
        localStoreWarning={false}
        items={[
          {
            id: "processing",
            journalPersonName: "Person One",
            occurredOn: "2026-08-21",
            state: "processing",
            canCancel: false,
            cleanupState: "not_requested",
          },
          {
            id: "pending",
            journalPersonName: "Person Two",
            occurredOn: "2026-08-20",
            state: "pending",
            canCancel: true,
            cleanupState: "not_requested",
          },
          {
            id: "attention",
            journalPersonName: "Person One",
            occurredOn: "2026-08-19",
            state: "attention",
            canCancel: false,
            cleanupState: "not_required",
          },
          {
            id: "cancelled",
            journalPersonName: "Person Two",
            occurredOn: "2026-08-18",
            state: "cancelled",
            canCancel: false,
            cleanupState: "operator_review",
          },
        ]}
        onConfirmCancel={() => undefined}
        onKeep={() => undefined}
        onRequestCancel={() => undefined}
        onCheck={() => undefined}
      />
    </main>
  );
}
