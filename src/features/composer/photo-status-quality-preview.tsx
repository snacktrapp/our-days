"use client";

import {
  PhotoStatusChipView,
  PhotoStatusShelfView,
} from "./photo-status-shelf";

export function PhotoStatusQualityPreview() {
  return (
    <main className="photo-status-quality-preview">
      <h1>Private photo status</h1>
      <p>Mobile layout and accessibility fixture</p>
      <PhotoStatusChipView busy label="Uploading 1 of 2…" progress={0.45} />
      <PhotoStatusChipView busy label="Uploading… 10%" progress={0.1} />
      <PhotoStatusChipView busy label="Retrying upload…" progress={0.1} />
      <PhotoStatusShelfView
        cancellationResult={null}
        cancellingIds={new Set()}
        confirmingCancelId="pending"
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
      />
    </main>
  );
}
