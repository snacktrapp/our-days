# Phase 4D-A photo-moment publication checkpoint

Date: 2026-08-31

## Result

The local database and web app now have a default-off, end-to-end contract for
turning one verified private photo into one chronological family moment. The
complete caption, date, optional place, journal person, and tagged people are
staged before upload. Publication occurs atomically only after both the
immutable original and stripped WebP display derivative exist.

This is a safe development checkpoint, not production photo activation.

## Privacy and ownership boundary

- `photo_publication` and `family_derivative_delivery` are separate,
  database-owner capabilities seeded `false`.
- Web delivery has a separate default-off rollout switch:
  `OUR_DAYS_MEDIA_DELIVERY_MODE`. It is not an authorization boundary: once
  database delivery is enabled, an authorized family session can exercise the
  same ordinary-JWT Storage policy directly.
- Draft requests, staged tags, capabilities, original paths, derivative paths,
  checksums, and worker state are stored in private FORCE-RLS relations. When
  database delivery is enabled, the narrowly authorized descriptor RPC reveals
  the exact display-derivative bucket, path, size, type, and checksum needed for
  an authorized family member's ordinary-JWT download.
- The family-readable `moment_photos` relation contains only immutable IDs and
  safe display dimensions. It is read-only and visible only for a live,
  non-trashed photo moment in the caller's active circle and a live Auth
  session.
- The general moment-creation RPC still rejects `photo`; verified media cannot
  be bypassed with a fabricated moment row.
- The same-origin media route uses the ordinary viewer Supabase session for
  Storage download. It never uses a service role, public bucket, signed URL, or
  Next image optimizer, and returns `private, no-store`, `nosniff` responses.
- Descriptor and Storage checks independently re-evaluate capability, live
  session, account closure, circle membership, and trash state. Removal or
  trash therefore denies the later byte read even after descriptor lookup.
- The same-origin route hashes the complete bounded derivative and compares it
  with the immutable verified SHA-256 before returning any bytes; equal-size,
  equal-type path replacement or corruption fails closed.
- Original-quality media remains inaccessible through the timeline route and
  reserved for the later export/download ownership slice.

## Publication behavior

- Identical request-key retries return the same intake and pre-minted moment
  IDs; a changed payload with the same key fails.
- Either ordering is safe: staging rechecks for an already verified derivative,
  and derivative completion runs a deferred publisher after its job becomes
  verified.
- Browser reservation follows the same Auth user → circle → membership lock
  order as account closure and the underlying intake reservation.
- Moment, family tags, safe photo link, and creation audit commit together or
  not at all.
- Publication rechecks the uploader membership, managed-person authority,
  account-closure state, exact original/derivative identity, and exact Storage
  object metadata.
- Trash immediately hides the link and descriptor; restore makes the same
  immutable derivative readable again without republishing it.
- Combined and individual timelines reuse the existing moment chronology and
  render connected photo rows through `/api/media/moments/{momentId}` with
  truthful date/person alt text and an accessible retry state.

## Verification evidence

- Clean local migration reset: pass.
- Supabase database lint: no errors.
- Full pgTAP: 17 files, 978 assertions, pass after the final focused addition.
- Phase 4D publication pgTAP: 36 assertions covering capabilities, ACL/RLS,
  idempotency, the real intake→validation→derivative chain, atomic publication,
  forgery denial, delivery, trash/restore, wrong-circle, and revoked access.
- The forced photo concurrency harness passed an actual TUS patch + account
  closure request + staged photo-moment reservation race without deadlock and
  preserved terminal closure/quarantine invariants.
- Full Vitest: 53 files passed, 1 skipped; 649 tests passed, 3 skipped.
- TypeScript, ESLint, Prettier, database-type parity, and diff checks: pass.
- Webpack production build and private-artifact scan: pass.
- Final independent adversarial re-review: pass for merge with every media
  capability disabled; no unresolved checkpoint blocker.
- Mobile Playwright regression: 160 passed and 55 intentionally skipped. One
  short-screen no-mutation probe observed a late, unrelated lazy load of the
  reviewed public fixture image. The probe now eagerly settles existing
  timeline images before beginning its interaction audit and passed three
  consecutive isolated reruns. No product mutation or private request occurred.

## Deliberate blockers and next slice

- Both database capabilities and the web delivery rollout switch remain
  disabled.
- PD-006 remains pending. This checkpoint tests the strict immediate-revocation
  candidate; it does not authorize that delivery choice for production. Before
  activation, PD-006 must also decide whether direct ordinary-JWT Storage access
  is acceptable or whether delivery needs a distinct server-side trust boundary.
- Timeline metadata still uses the existing membership-scoped moment query,
  while derivative delivery additionally requires a live Auth session. Global
  live-session enforcement for caption/date/place/tag metadata is an activation
  blocker to resolve consistently for written and photo moments.
- The browser still needs the direct resumable upload coordinator, incremental
  hashing, retry/cancel/progress states, and status polling wired into Add
  Moment.
- Current validators do not accept genuine HEIC/HEIF even though the local
  preview can select them. Production photo posting remains blocked on a real
  iPhone picker/HEIC path and interrupted-upload rehearsal.
- Separately deployed validator/derivative workers, cleanup and purge,
  original-byte backup/recovery, export inclusion, hosted Supabase/Vercel, and
  real-device checks remain required.
- Photo edit controls, trash/restore UI, original export/checksums, and complete
  Memories photo rendering belong to the remaining revised-MVP Phase 4D-B/C
  work.

Complete-build items such as galleries, carousels, crop/edit tools, multiple
derivatives, background/native sharing, CDN delivery, and original-download UI
remain preserved in the post-MVP roadmap.
