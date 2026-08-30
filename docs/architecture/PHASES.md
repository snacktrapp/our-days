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

Deliver:

- Managed profiles/guardians, people tags, optional places, milestones, comments presented as notes, constrained reactions, member/invite management, and removal UI.

Gate: immutable tenant/author fields, parent visibility, descendant soft-delete visibility, non-author comment/reaction denial, organizer invariants, and accessibility pass.

## 6. Memories and video decision

Deliver:

- Years, dates, milestones, and On This Day based on `occurred_on`.
- Measured video spike for iPhone PWA upload, transcoding, playback, storage, and export. Ship the capped feature only if it meets the same retry/privacy bar.

Entry prerequisite for shipping video (not for the spike): PD-004 is accepted.

Gate: timezone/date-only fixtures pass; video has a recorded ship/defer decision with evidence.

## 7. Ownership, deletion, and export

Entry prerequisite: PD-005 is accepted.

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
