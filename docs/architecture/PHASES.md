# Delivery phases and gates

Each phase is deliberately vertical and testable. A phase is complete only when its automated checks pass, its negative authorization cases pass where applicable, and review findings are either fixed or explicitly accepted by Brian.

## 0. Approved baseline and production foundation

Deliver:

- Separate standard Next.js repository with the approved timeline preserved.
- Product brief, decision log, threat model, acceptance criteria, and test commands.
- Patched/audited dependency tree, PWA metadata, private-by-default crawler policy, and security-header baseline.
- 390×844, 320×568, and 430×932 visual baselines.

Gate: lint, typecheck, clean-install dependency audit, browser smoke, and production screenshot review pass. The phase remains a candidate—not complete—until the unrestricted default Next/Turbopack production build passes in CI or Vercel.

## 1. Application shell and test harness

Deliver:

- Server-first route groups for auth and journal areas.
- Extracted design tokens, timeline rail, connectors, cards, elapsed gaps, navigation, and accessible composer dialog.
- A serializable presentation-only timeline view model; prototype fixture strings never become database/domain contracts.
- Vitest/Testing Library, Playwright Chromium/WebKit/Firefox, axe smoke, and deterministic fixtures.
- Installed-PWA safe areas, focus handling, keyboard-aware sheet, 44px targets, AA contrast, reduced motion, and a minimal versioned-public-shell-only service worker with safe update behavior.

Gate: component, E2E, accessibility, visual, console, network-failure, and 320px/200%-zoom checks pass.

## 2. Supabase local foundation and invitation-only auth

Entry prerequisite: PD-003 is accepted.

Deliver:

- Local Supabase configuration, migrations, generated types, deterministic two-circle fixtures, explicit grants, RLS, Storage policies, and pgTAP catalog audits.
- Per-request server clients; caller-scoped unprivileged browser clients; service credentials absent from the web deployment and isolated in a separate worker.
- Next 16 `src/proxy.ts` handles nonce CSP plus session refresh/optimistic `getClaims` checks only. Protected routes are request-rendered, private/no-store, and authorized by RLS/current membership.
- Invite creation, one-time acceptance, verified-email binding, `shouldCreateUser: false` ordinary OTP, and membership revocation.
- Sign-out/account-switch purges account-scoped state and hard-transitions to the locked route; two-browser tests reject cached cookies, RSC payloads, names, or timelines.

The invitation-job foundation is recorded in `docs/quality/PHASE_2B_INVITATION_JOB_FOUNDATION_REPORT.md`. It adds a private, idempotent organizer request ledger and a disabled pure worker contract without exposing invitation sending. Production activation still requires a target-account-bound invitation schema, atomic materialization/delivery state, a separate trusted coordinator, a proven email-provider idempotency window, and removal of the legacy raw-token/preflight RPC exposure.

The local-only Phase 2C target-bound materialization checkpoint is recorded in `docs/quality/PHASE_2C_TARGET_BOUND_INVITATION_MATERIALIZATION_REPORT.md`. It links one immutable job to one invitation and makes the intended Auth UUID authoritative at acceptance, while keeping every new coordinator function private and ungranted. It does not provision an account, read a recipient address for delivery, send email, select a provider, enable the worker, expose Send, or remove the still-required legacy local acceptance harness.

Gate: member success plus anonymous, no-circle, wrong-circle, dual-circle, stale-token revoked-member, invite replay, wrong-email, and concurrent-acceptance denials pass.

## 3. Written moments end to end

Entry prerequisite: PD-001 and PD-002 are accepted.

The decision-independent personal-journals preview is recorded in `docs/quality/PERSONAL_JOURNALS_PREVIEW_REPORT.md`. It establishes stable journal ownership, all five individual routes, truthful managed-profile attribution, chronological gaps, and honest empty states without implying that production authorization or persistence exists.

The connected local written-moments checkpoint is recorded in `docs/quality/PHASE_3_CHECKPOINT_REPORT.md`. The Supabase/RLS slice and connected Chromium/Firefox journeys pass locally; hosted WebKit and unrestricted default-build evidence remain required before this phase is called complete.

Deliver:

- Combined and personal feeds, thought creation, backdating, managed-person selection, edit, trash, restore, loading/error/empty/end states, and stable cursor pagination.
- `occurred_on` plus optional precise time/timezone semantics and correct On This Day behavior.
- Server-side row-to-view-model mapping keeps storage/domain records out of presentation components.

Gate: equal-timestamp pagination, historical insertion, scroll stability, browser restoration, parent/child policy, other-adult denial, wrong-circle denial, and revoked-member denial pass.

## 4. Photo ownership pipeline

Entry prerequisite: PD-006 is accepted for the media-delivery branch.

The bounded Phase 4A quarantine-only foundation is recorded in `docs/quality/PHASE_4A_PHOTO_INTAKE_FOUNDATION_REPORT.md`. It introduces a private intake ledger, a third private quarantine bucket, exact-path reservation, a fingerprint-bound claim, direct authenticated TUS create/part, and an `uploaded_unverified` acknowledgement using only local synthetic data. It is not the Phase 4 media-delivery branch: there is no browser read, standard or signed upload, upsert, worker, content verification, immutable canonical original, derivative, photo moment, download, export, byte recovery, cleanup process, deployment, or production-data approval. Pinned Storage evidence shows concurrent TUS uploads to one path can both complete, so nothing may publish from the quarantine path.

Deliver:

- Reserved asset row, fingerprint-bound claim, direct private resumable upload, upload closure, isolated full-byte verification, immutable browser-unwritable canonical original/checksum, orientation-correct stripped derivative, idempotent promotion, controlled display, and original download.
- HEIC/large-photo spike and interrupted/resumed upload behavior.

Gate: byte-for-byte original verification, immutable-promotion and late-quarantine-write races, EXIF/GPS absence from derivatives, expiry/retry/duplicate/path-spoof/wrong-circle/revoked denial, cache inspection, and iPhone photo-picker checks pass.

## 5. Family context

The decision-independent Family settings preview is recorded in `docs/quality/FAMILY_SETTINGS_PREVIEW_REPORT.md`. It establishes the account-versus-managed-profile language, invitation review, access-removal consequence, and mobile interaction only; it performs no security-sensitive mutation and does not accept a pending policy.

The connected local family-context checkpoint is recorded in `docs/quality/PHASE_5_CHECKPOINT_REPORT.md`. Thoughts, milestones, manual places, people tags, lazy family notes, constrained reactions, trash identity, authorization denials, and destructive races pass locally in Chromium and Firefox; hosted WebKit and unrestricted default-build evidence remain required before this phase is called complete.

The connected access-management checkpoint is recorded in `docs/quality/PHASE_5_ACCESS_MANAGEMENT_CHECKPOINT_REPORT.md`. Active account and managed-profile visibility, organizer-only membership removal and pending-invitation withdrawal, mobile recovery, and wrong-circle/revoked denial pass locally. New invitation creation remains deliberately unavailable until a separately trusted provisioning and delivery worker exists.

Deliver:

- Managed profiles/guardians, people tags, optional places, milestones, comments presented as notes, constrained reactions, member/invite management, and removal UI.

Gate: immutable tenant/author fields, parent visibility, descendant soft-delete visibility, non-author comment/reaction denial, organizer invariants, and accessibility pass.

## 6. Memories and video decision

The decision-independent functional preview for years and On This Day is recorded in `docs/quality/MEMORIES_PREVIEW_REPORT.md`. It validates the emotional and mobile interaction direction only; this phase remains incomplete until production date queries, authorization, scale, timezone, and external-device gates pass.

The connected Milestones archive checkpoint is recorded in `docs/quality/PHASE_6_MILESTONES_CHECKPOINT_REPORT.md`. It adds a count-free landing doorway and dedicated circle-authorized journey while preserving the central timeline, stable traversal, and existing moment actions.

The isolated local short-video preview is recorded in `docs/quality/VIDEO_FEASIBILITY_REPORT.md`. It establishes a quiet timeline treatment, bounded on-device inspection, and a no-upload/no-persistence lifecycle only. Video remains absent from Add Moment, PD-004 remains pending, and upload/transcode/playback/export/deletion work remains deferred.

Deliver:

- Years, dates, milestones, and On This Day based on `occurred_on`.
- After PD-004 is accepted, a measured production video spike for iPhone PWA upload, transcoding, playback, storage, export, and purge. Ship the capped feature only if it meets the same retry/privacy bar.

Entry prerequisite for production media work or shipping video (not for the completed local-only preview): PD-004 is accepted.

Gate: timezone/date-only fixtures pass; video has a recorded ship/defer decision with evidence.

## 7. Ownership, deletion, and export

Entry prerequisite: PD-005 is accepted.

The decision-independent export-request and archive-contract groundwork is recorded in `docs/quality/PHASE_7A_EXPORT_FOUNDATION_REPORT.md`. It is not a Phase 7 entry or completion claim: the request ledger is bounded and private, the structured-data harness is pure and unconnected, and no worker, media, artifact delivery, retention duration, purge behavior, or user-facing export action exists.

The membership-attribution prerequisite is recorded in `docs/quality/PHASE_7B_MEMBERSHIP_ATTRIBUTION_REPORT.md`. Moment recorder and trash history now use durable same-circle membership IDs instead of Auth user IDs, with unchanged public feed responses. It does not yet make membership Auth attachments nullable, request account closure, reconcile Storage, delete an Auth user, or expose account-deletion UI.

The database-only account-closure preparation checkpoint is recorded in `docs/quality/PHASE_7C_ACCOUNT_CLOSURE_PREPARATION_REPORT.md`. It adds an immutable private request ledger and an atomic all-circle preparation seam that preserves shared history while revoking access and detaching Auth. Account deletion is still unavailable: there is no web action or deployed worker, and Auth deletion, session handling, media reconciliation, external restore suppression, content purge, and retention policy remain later gates.

Deliver:

- Trash/restore, idempotent purge ledger, immutable deletion requests, audit events, export jobs, safe archive names, structured manifest, originals, and checksums.

Gate: export isolation/count/checksum tests, revoked-requester denial, partial-storage-failure retry, direct hard-delete denial, and restore/purge policy tests pass.

## 8. Recovery and release candidate

The local logical recovery foundation is recorded in `docs/quality/PHASE_8A_LOCAL_RECOVERY_FOUNDATION_REPORT.md`. It proves checked synthetic database fidelity only by restoring into a temporary database in the same local Postgres container. It does not recover Storage object bytes, restore a hosted project, invalidate sessions or credentials, apply an external suppression ledger, create off-site encrypted backups, or establish RPO/RTO evidence.

Deliver:

- A production recovery rehearsal into a quarantined new Supabase project at the current migration head, including session/credential invalidation, external append-only suppression replay, and separate authenticated/encrypted media recovery with full-byte SHA-256 reconciliation.
- Off-site backup retention and key custody, measured RPO/RTO, secret scan, observability without family content, privacy/ownership copy, runbooks, and real-device PWA QA.
- Independent adversarial privacy, accessibility/mobile, test-gap, and final release reviews.

Gate: no unresolved release blocker, CI green, clean fresh-environment deployment, current and short-screen iPhone Safari/standalone flows pass.

## 9. Separate production release

Entry prerequisite: Brian explicitly approves external creation/billing, Supabase region, backup/PITR level, and any paid worker/media service.

- Dedicated GitHub repository and protected checks.
- Dedicated Supabase production resources and backups.
- Dedicated Vercel project, environment variables, hostname, and deployment.
- Final family acceptance handoff and export/deletion verification.

Gate: production smoke and authorization denial suite pass against non-personal seed data; Brian approves the acceptance build before personal family data is added.
