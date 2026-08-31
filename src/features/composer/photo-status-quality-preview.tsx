"use client";

import { PhotoStatusShelfView } from "./photo-status-shelf";

export function PhotoStatusQualityPreview() {
  return (
    <main className="photo-status-quality-preview">
      <h1>Private photo status</h1>
      <p>Mobile layout and accessibility fixture</p>
      <PhotoStatusShelfView
        checkFailed
        checking={false}
        dismissFailedId={null}
        items={[
          { id: "processing", state: "processing" },
          { id: "pending", state: "pending" },
          { id: "attention", state: "attention" },
          { id: "interrupted", state: "interrupted" },
        ]}
        onCheck={() => undefined}
        onDismiss={() => undefined}
      />
    </main>
  );
}
