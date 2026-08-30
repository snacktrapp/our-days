# Phase 3 local written-moments checkpoint

Date: 2026-08-30

Status: **local written-moment slice passes in Chromium and Firefox — hosted WebKit evidence and production provisioning remain pending**

This checkpoint connects the approved timeline to real local Supabase data without creating or linking any external resource. It implements the Phase 3 written-thought slice after Brian accepted PD-001, PD-002, and PD-003. Photos, production media delivery, comments, reactions, permanent purge, exports, hosted infrastructure, and personal family data are not part of this checkpoint.

## Implemented

- A circle-owned `moments` table with immutable tenant/journal/recorder identity, trimmed 1–4,000 character thoughts, authoritative `occurred_on`, optional minute/timezone precision, revisions, reversible trash, composite circle integrity, explicit grants, RLS, and audit events.
- Mutation RPCs for create, optimistic edit, and trash/restore. Adults may change only their own journals; an approved active guardian may record and manage a child's moments; organizers do not gain silent editing power over another adult.
- Read RPCs for combined/personal timelines and manageable trash. Keyset ordering includes occurrence fields and `id`; cumulative navigation holds a fixed feed snapshot and excludes rows created or updated after traversal begins.
- Real combined and personal journals, easy thought creation, managed-person selection, backdating, edit, trash, restore, historical gaps, empty/end/error states, and private `/trash` recovery.
- A connected-only scroll-memory boundary that preserves the timeline position across pagination and browser Back without changing the detached design preview.
- Short-screen modal behavior, stable focus recovery, live announcements, distinct accessible action names with moment excerpts, and a rail-preserving permission-lost state.
- Account acceptance now ends with a full replacement navigation after server-side membership confirmation. This gives the newly accepted account a clean document and avoids retaining the prior account's React router tree.
- CI configuration for connected Chromium, Firefox, and WebKit runs on Linux, plus the existing detached multi-project browser suite.

## Evidence available now

- `npm run check`: formatting, ESLint, TypeScript, 34 test files, and 273 unit/contract/component tests pass.
- `npm run build:webpack`: production compile, route generation, TypeScript, and private-artifact scan pass.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run test:db`: 112 pgTAP assertions pass across identity/authorization, adversarial catalog boundaries, and written moments.
- `npm run db:lint`: no schema errors. `npm run types:db:check`: committed types match the running database.
- `npm run test:auth:integration`: real local Auth, invitation, stale-token, circle-isolation, and closed-Storage paths pass.
- `npm run test:db:concurrency`: organizer revocation, invitation acceptance, and same-revision edit races serialize with one durable winner.
- Connected production Chromium and Firefox runs pass the full fragment/OTP/acceptance flow; create/edit/trash/restore in combined and personal journals; 42 equal-date records without omission/duplication; fixed-snapshot late-insert exclusion; a two-pixel scroll-anchor budget; deep Back restoration; two real circles with immediate DOM/history/storage canary scans after Back/Forward; live membership revocation; private-cache headers; browser-state cleanup; and sign-out.
- Detached mobile Playwright: 135 passed and 21 intentional project/engine skips across 156 cases in Chromium mobile, Firefox mobile, and 320px Chromium. The suite covers reflow, keyboard heights, 200%-equivalent zoom where supported, Axe, focus, reduced motion, private RSC/header boundaries, CSP, service-worker allowlisting, error boundaries, and console/network checks.
- Manual local iPhone-sized inspection of the connected combined family timeline and Molly's personal journal showed the central rail, person identity, date gaps, and readable cards without horizontal overflow.
- Independent final privacy/security, mobile UX/accessibility, and adversarial test-gap reviews each returned GO after their blockers were fixed and rerun.

## Local environment exceptions

- The installed macOS Playwright WebKit binary crashes before opening an application page with `Bus error: 10`, including after a forced browser reinstall. No local WebKit application result is claimed. The hosted Linux CI job installs and runs WebKit; that hosted result remains a merge/release prerequisite.
- The default local Turbopack build was denied permission when its CSS helper attempted to bind an internal port. The webpack production build passes repeatedly. Phase 0's existing unrestricted default-build CI/Vercel prerequisite remains unchanged and unresolved locally.

## Deliberate boundaries

- The UI still exposes one circle at a time, while every database contract remains circle-scoped for eventual multi-circle membership.
- Pagination is cumulative for the mobile interaction checkpoint. The 10,000-page defensive ceiling prevents an unbounded input; a true incremental cursor client should replace cumulative sequential reads before family volume makes that meaningful.
- Trash is reversible but has no permanent purge policy. PD-005 remains pending, so no retention duration or worker deletion behavior is implied.
- Media buckets remain closed. PD-006 is required before the photo-delivery branch, and PD-004 remains pending for production video.
- No GitHub, hosted Supabase, Vercel, SMTP, domain, worker, billing, or production credential was created.

## Next gate

Obtain the hosted three-engine CI result, including WebKit and the unrestricted default production build. Then either accept PD-006 and begin the private photo pipeline or continue decision-independent family-context work without weakening this written-moment authorization boundary.
