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

Deliver:

- Reserved asset row, direct private upload, immutable original/checksum, orientation-correct stripped derivative, idempotent completion, controlled display, and original download.
- HEIC/large-photo spike and interrupted/resumed upload behavior.

Gate: byte-for-byte original verification, EXIF/GPS absence from derivatives, expiry/retry/duplicate/path-spoof/wrong-circle/revoked denial, cache inspection, and iPhone photo-picker checks pass.

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

Deliver:

- Trash/restore, idempotent purge ledger, immutable deletion requests, audit events, export jobs, safe archive names, structured manifest, originals, and checksums.

Gate: export isolation/count/checksum tests, revoked-requester denial, partial-storage-failure retry, direct hard-delete denial, and restore/purge policy tests pass.

## 8. Recovery and release candidate

Deliver:

- Backup/restore drill, secret scan, observability without family content, privacy/ownership copy, runbooks, and real-device PWA QA.
- Independent adversarial privacy, accessibility/mobile, test-gap, and final release reviews.

Gate: no unresolved release blocker, CI green, clean fresh-environment deployment, current and short-screen iPhone Safari/standalone flows pass.

## 9. Separate production release

Entry prerequisite: Brian explicitly approves external creation/billing, Supabase region, backup/PITR level, and any paid worker/media service.

- Dedicated GitHub repository and protected checks.
- Dedicated Supabase production resources and backups.
- Dedicated Vercel project, environment variables, hostname, and deployment.
- Final family acceptance handoff and export/deletion verification.

Gate: production smoke and authorization denial suite pass against non-personal seed data; Brian approves the acceptance build before personal family data is added.
