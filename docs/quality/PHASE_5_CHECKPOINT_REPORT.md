# Phase 5 local family-context checkpoint

Date: 2026-08-30

Status: **local family-context slice passes in Chromium and Firefox — hosted WebKit evidence and production provisioning remain pending**

This checkpoint extends the approved private timeline with family context while keeping conversation bodies lazy and circle-authorized. It implements the decision-independent parts of Phase 5 after Brian accepted PD-001, PD-002, and PD-003. It creates or links no external resource and uses synthetic family data only.

## Implemented

- One circle-scoped moment contract for thoughts, milestones, and manually entered places, with optional manual place labels on other kinds and immutable kind/tenant/journal/recorder identity.
- Atomic, revision-checked moment and people-tag updates. Removed tags stay as attributed soft records; re-adding a tag cannot silently rewrite who originally attached it.
- Distinct, readable timeline treatments for thoughts, milestones, and places in combined and personal journals. Family tags wrap at 320px without crowding the center rail.
- Lazy-loaded family notes and constrained, count-free reactions. Feed responses contain no note body; opening a detail sheet performs a freshly authorized conversation read.
- One replaceable response per member and author-only note edit/removal. First-time response removal is a true no-op rather than a tombstone or audit event.
- Parent trash and membership revocation serialize against descendant creation. Trash hides the moment and descendants together; revoked members lose note/reaction access on the next database request.
- Truthful failure, retry, dirty-draft, durable-success, and focus behavior across composer, editor, note, response, and conversation-refresh paths.
- Trash and restore preserve useful identity for title-only milestones and place-only location moments.
- The legacy thought-update RPC rejects milestone and location rows, closing a compatibility path that could otherwise bypass kind-specific validation.

## Evidence available now

- `npm run check`: formatting, ESLint, TypeScript, 35 test files, and 301 unit/contract/component tests pass.
- `npm run build:webpack`: production compilation, route generation, TypeScript, and the private-artifact scan pass.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run db:lint`: no schema errors.
- `npm run test:db`: 160 pgTAP assertions pass across four files, including cross-circle, revoked-member, non-author, legacy-RPC, descendant-visibility, and reaction no-op cases.
- `npm run types:db:check`: committed Supabase types match a database rebuilt from all migrations.
- `npm run test:auth:integration`: local Auth, invitation, stale-token, circle-isolation, and closed-Storage paths pass.
- `npm run test:db:concurrency`: overlapping organizer revocation, invitation acceptance, moment/tag edits, note edits, replaceable responses, parent trash, and member revocation serialize into valid durable state.
- Connected production Chromium and Firefox journeys pass invitation/OTP/acceptance; lazy notes; note edit/removal; reaction set/removal; thought, milestone, and place creation; milestone-place editing; trash/restore; 320×350 accessibility/reflow; cross-origin denial; two-circle isolation; revoked-invite recovery; browser cleanup; membership revocation; and sign-out.
- The detached mobile Playwright matrix passes 149 checks with 55 intentional project/engine skips across Chromium mobile, Firefox mobile, 320px Chromium, and wide visual coverage. It exercises keyboard-height states, accessibility, privacy headers, CSP, service-worker boundaries, and visual baselines. Two intentional visual changes—the clearer family-tag prompt and taller tagged 320px timeline—were inspected against expected/actual/diff images before their baselines were updated.
- Independent privacy/security, mobile UX/accessibility, and adversarial test-gap reviewers returned GO after their findings were fixed and rerun.

## Local environment exceptions

- The installed macOS Playwright WebKit binary crashes before opening an application page with `Bus error: 10`. No local WebKit result is claimed. The prepared Linux CI WebKit project remains a merge/release prerequisite.
- The default local Turbopack build cannot bind its internal CSS worker port in this restricted host. The webpack production build and artifact scan pass repeatedly; the unrestricted default build remains a hosted CI/Vercel prerequisite.

## Deliberate boundaries

- Places are explicit family-entered labels. This checkpoint requests no browser geolocation and performs no third-party geocoding or map lookup.
- Notes use reversible database lifecycle metadata for privacy integrity and race handling, but the current author UI says **Remove** and offers no restore. Permanent purge timing remains governed by pending PD-005.
- Reactions are a fixed understated vocabulary with no totals, rankings, notifications, or engagement prompts.
- Short video remains a local feasibility preview only; PD-004 is still required for production video.
- Media buckets stay closed and photo upload remains deferred until PD-006 is accepted.
- The schema remains multi-circle capable while the interface deliberately exposes one circle.
- No GitHub, hosted Supabase, Vercel, SMTP, domain, worker, billing, analytics, or production credential was created.

## Next gate

Obtain the hosted default-build and three-engine browser result. PD-006 is the next product decision required to start the private original-photo and derivative pipeline. PD-004 and PD-005 can remain pending until video and irreversible purge work respectively.
