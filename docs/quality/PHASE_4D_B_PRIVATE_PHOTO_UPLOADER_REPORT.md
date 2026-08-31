# Phase 4D-B private photo uploader checkpoint

Date: 2026-08-31

## Result

Our Days now has a default-off mobile browser path that can prepare one JPEG,
PNG, or WebP photo, hash it incrementally outside the main thread, reserve its
complete moment draft, upload the original through Supabase's resumable Storage
endpoint, acknowledge quarantine intake, and report either verified publication
or honest private processing.

This is a safe development checkpoint, not production photo activation. The
database `photo_publication` capability and the application
`OUR_DAYS_PHOTO_POSTING_MODE` switch both remain disabled by default.

## Browser and privacy behavior

- The browser reads only bounded file slices for SHA-256 hashing; it does not
  load the complete original into JavaScript memory for hashing.
- Byte signatures, declared MIME, and the 25 MiB browser limit are checked
  before coordination. Genuine HEIC/HEIF is rejected truthfully until that
  production path exists.
- TUS uses the exact derived Storage origin, 6 MiB chunks, ordinary-user tokens
  refreshed immediately before each request, `x-upsert: false`, and metadata
  that contains no filename, caption, place, tags, media bytes, or token.
- Persisted recovery data is limited to opaque account/circle/draft/file
  fingerprints, stable request keys, coordinator IDs, expiry, acknowledgement,
  and the exact upload URL. It contains no family content or bearer credential.
- Resumed URLs require the exact Storage origin and resumable path, with no
  credentials, query, or fragment. Cross-origin and same-origin off-path URLs
  fail before a token-bearing request.
- Ambiguous PATCH failures reconcile against the same upload URL with bounded
  exponential backoff and jitter. Five failed attempts at one offset terminate
  safely rather than spinning forever.
- Expired or conflicted TUS URLs discard the exact persisted record, clear the
  in-memory URL, and allow the same photo and draft to create one fresh upload.
- Stop is available only before the acknowledgement boundary. Abort checks
  separate inspection, hashing, session lookup, recovery lookup, reservation,
  claim, upload creation, and chunk upload. After all bytes arrive, the UI enters
  an explicit non-cancellable `Finishing` state before acknowledgement.
- Stopped and failed attempts clear progress while retaining the selected photo
  and draft. Processing says `Photo received`; only verified publication says
  `Moment saved`. Non-retryable failures return to photo editing without a
  misleading retry action.
- Signing out purges both the draft and photo-upload IndexedDB databases. The
  production store is tested through a real IndexedDB implementation for exact
  account/circle/draft/file matching, expiry removal, explicit removal, and
  sign-out deletion.

## Database boundary

- Public photo reservation, upload claim, acknowledgement, and Storage TUS
  authorization require both the default-off capability and a live Auth session.
- Deleting the Auth session after reservation denies claim; deleting it after
  claim denies Storage create/part and acknowledgement.
- The ordinary browser still cannot publish directly. Quarantine validation,
  immutable original promotion, stripped derivative creation, and atomic moment
  publication remain the Phase 4A–D-A worker/database chain.
- The web switch is a product rollout control, not an independent authorization
  boundary. Database and Storage authorization remain authoritative.

## Verification evidence

- Full Vitest: 56 files passed, 1 skipped; 674 tests passed, 3 intentionally
  skipped.
- Full pgTAP: 18 files, 983 assertions, pass.
- Supabase database lint and committed generated-type parity: pass.
- Local synthetic photo intake/validation/promotion/derivative integration:
  pass.
- Forced duplicate, conflicting upload, membership/guardian revocation, account
  closure, and stale-patch concurrency suite: pass.
- TypeScript, ESLint, Prettier, and production Webpack build: pass.
- Private-artifact scan: pass after adding whole-word handling for short family
  fixture canaries; the regression still detects every standalone canary.
- Connected Chromium and Firefox production flows: pass, including invitations,
  circle isolation, revocation, sign-out cleanup, timeline mutations, Memories,
  notes, reactions, trash, and restore.
- WebKit did not reach an application page. Playwright 1.62.1's frozen macOS 14
  binary bus-errors at process launch on macOS 14.1.1 x86_64, including after a
  forced clean reinstall and in a launch-only probe. This is recorded as missing
  WebKit/Safari evidence, not an application pass or failure.
- Independent security review: PASS for a default-off checkpoint.
- Independent mobile uploader/UX review: PASS after cancellation, finishing,
  retry, mobile-action, IndexedDB, and expired-resume fixes.

## Production activation blockers

- Keep both photo-posting gates disabled.
- Add per-account/circle open-intake and byte quotas, explicit server-side
  cancellation/invalidation, and scheduled cleanup for expired reservations,
  TUS uploads, quarantine objects, and abandoned request rows.
- Coordinate sign-out and in-flight upload abort/purge across tabs.
- Add a durable pending/failed/needs-attention surface so a processing photo
  remains understandable after the composer closes or the app reloads.
- Prove separately deployed validator/derivative workers, cleanup, recovery,
  export inclusion, and hosted Supabase/Vercel behavior.
- Support genuine iPhone HEIC/HEIF input or document an explicitly accepted
  conversion boundary. Complete installed-iPhone testing must cover Photos and
  Camera selection, foreground/background interruption, memory pressure,
  keyboard/short-screen layout, standalone PWA behavior, and VoiceOver.
- Resolve PD-006 and the direct ordinary-JWT Storage boundary before family media
  is activated.

## Retained complete-build roadmap

The revised five-person MVP remains the release target, with video deferred.
Nothing from the complete product vision is cancelled: broader relative
onboarding, multiple-circle UI, richer place and memory discovery, complete
archive/purge automation, original download/export UX, galleries and editing,
native sharing or a native client, video after PD-004, and wider device hardening
remain in the post-MVP phases in `docs/architecture/PHASES.md`.
