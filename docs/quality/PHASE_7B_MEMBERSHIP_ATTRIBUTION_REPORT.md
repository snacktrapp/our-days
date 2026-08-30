# Phase 7B membership-attribution checkpoint

Date: 2026-08-30

Status: **membership-based moment history passes locally — account closure remains unavailable**

This checkpoint removes a replaceable sign-in identity from durable moment history without claiming that account deletion exists. It creates no closure job, Auth Admin client, Storage cleanup, external worker, user-facing action, retention policy, or content-deletion behavior.

## Implemented

- `moments.recorded_by_membership_id` is required and `moments.trashed_by_membership_id` is optional. Both are composite same-circle foreign keys to `circle_memberships(circle_id, id)` with restrictive deletion.
- The migration atomically renames and backfills the legacy Auth-user actor columns through the existing unique `(circle_id, user_id)` membership mapping before validating the new foreign keys.
- Recorder and trash indexes keep their query coverage under truthful names.
- Written and family-moment writers derive the recorder membership from the authenticated caller and requested circle. The reversible trash workflow records the same derived membership.
- Recorder membership is immutable. A valid membership from another family fails at the foreign-key boundary.
- Timeline, year/On This Day, and milestone readers now join the recorder through membership identity. Their public signatures and response fields remain unchanged: clients receive the recorder's family-facing person ID and display name, never an Auth or membership ID.
- Seed and direct database fixtures use membership attribution. Generated public-schema TypeScript types match the physical schema.

## Upgrade evidence

- A clean reset applies the complete migration chain and loads the updated seed.
- The in-place rehearsal reset the local database to migration `20260830234500`, loaded the committed pre-cutover seed, and added two legacy moments recorded by the same dual-circle Auth user in circles A and B. The populated upgrade contained nine moments, five distinct Auth recorders, and two trash actors before `supabase migration up` applied the cutover.
- The dual-circle legacy rows mapped to memberships `...005` and `...007` in their respective circles, including the circle-B trash actor. All nine legacy rows retained revision `1` and unchanged creation/update timestamps. The focused catalog, attribution, writer, cross-circle, immutability, reader-definition, response-compatibility, and retained-Auth-restriction suite then passed against the upgraded data.
- The final focused suite passed 42 assertions, including validated foreign keys and unchanged timeline function metadata. The full database suite passed 407 assertions across ten files on the clean final schema.
- The written-moment static contract passed 12 tests, and the full Vitest run passed 477 tests across 42 files. Prettier, ESLint, TypeScript, generated database types, and Supabase schema lint passed.
- The full overlapping database race harness passed, including moment/tag edits and reversible parent trash through the membership-based writers, then restored the canonical fixtures.
- `npm run build:webpack` passed production compilation and route generation, followed by the complete private credential/design-fixture artifact scan.
- Independent privacy and SQL migration reviews found no merge blocker. Their upgrade-evidence gap was closed with the populated legacy rehearsal; dual-circle legacy mapping, validated constraints, exact reader rewrite counts, unchanged timestamps/revisions, and timeline metadata were added or verified before final approval.

## Deliberate boundaries

- `circle_memberships.user_id` remains non-null and `ON DELETE RESTRICT`; deleting even a revoked Auth user still fails. This is intentional until the closure preparation transaction exists.
- A production closure request must atomically handle every circle, deny the entire request if the member is the last organizer anywhere, revoke access before Auth deletion so captured JWTs lose RLS access immediately, and prevent invitation reactivation.
- The later worker must reconcile Auth-owned Storage objects before hard deletion. Supabase Auth deletion removes sessions and refresh capability but cannot retroactively invalidate an already issued access JWT.
- Login/contact identity removal is separate from deleting or anonymizing shared family history. Adult content deletion and trash retention remain governed by PD-002 and pending PD-005.
- A recreated account—even with the same email—must receive no old access automatically. Future deliberate reattachment needs its own reviewed policy and ceremony.
- Legacy invitation verifier retention, ready export/download invalidation, backup restore suppression, and final account-closure audit semantics remain unresolved production gates.

## Next gate

Keep account closure unavailable. The next schema slice must choose and prove a private closing-state/Auth-binding model, an idempotent all-circles preparation transaction, last-organizer and stale-JWT denial, and invitation/job invalidation. Auth Admin deletion remains disabled until private media ownership, Storage reconciliation, backup/restore suppression, and the separately deployed worker are tested end to end.
