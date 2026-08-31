# Phase 4D-C photo status recovery checkpoint

Date: 2026-08-31

Status: accepted local, default-off development checkpoint; not production
photo activation.

## Delivered

- A small photo-status shelf appears only when the existing photo-posting gate
  is enabled and only for the signed-in account's current family circle.
- Opaque acknowledged records remain available after upload-URL expiry, so a
  photo that is still being processed survives reload.
- Published work removes its local coordination record and refreshes the
  timeline. Processing, needs-attention, possibly active, and genuinely expired
  uploads use distinct, non-public language.
- Unknown server states and failed IndexedDB/status operations fail closed.
  Status checks are single-flight; dismissal, sign-out, visibility changes, and
  delayed responses cannot restore stale UI.
- The shelf renders no caption, filename, content hash, object path, upload URL,
  or family identity.

## Verification

- Focused component, upload, and real IndexedDB reload tests: 30 passed.
- Complete Vitest suite: 58 files passed, 1 skipped; 690 tests passed, 3
  skipped.
- TypeScript, ESLint, Prettier, production Webpack build, and private-artifact
  scan passed.
- A dedicated Chromium 320×568 layout/axe check passed with no serious or
  critical violations, no horizontal overflow, and no target smaller than
  44×44.
- The shared 320px reflow check and the preview-disabled private-route check
  passed for the new quality fixture.
- The reload journey uses the real IndexedDB implementation: processing is
  visible after remount; later publication removes the record and shelf and
  invokes the timeline refresh. Phase 4D-B separately proved the connected
  publication-to-timeline path.
- An independent no-edit review passed after adversarial checks of expiry,
  polling races, dismissal races/failures, reload truthfulness, account/circle
  scoping, unknown statuses, privacy, accessibility, and mobile behavior.

## Deliberately still open

- Both photo rollout gates remain off.
- Production activation still requires central live-session enforcement,
  removal of the legacy raw reservation grant, fixed quotas, explicit
  cancellation and cleanup processing, hosted workers, HEIC and real-iPhone
  proof, export/original-download inclusion, and PD-006.
- Cross-tab coordination, cross-device status, background sync, push
  notifications, and richer operator-resolution UI remain after the revised
  MVP unless release evidence promotes one to a blocker.
