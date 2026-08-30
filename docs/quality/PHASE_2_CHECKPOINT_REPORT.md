# Phase 2 local authorization checkpoint

Date: 2026-08-30

Status: **local authorization foundation passes — production provisioning remains pending**

This checkpoint begins the invitation-only Supabase/Auth phase after Brian accepted PD-001, PD-002, and PD-003. It remains local and unlinked. No GitHub repository, hosted Supabase project, Vercel project, SMTP provider, worker, domain, or production credential was created.

## Implemented

- Pinned `@supabase/supabase-js` 2.112.4, `@supabase/ssr` 0.12.5, and Supabase CLI 2.116.0 on the existing Node 22+ boundary.
- Local PostgreSQL 17 configuration with global signup disabled, email login enabled, exact loopback redirect, ten-minute OTPs, current-email confirmation, automatic Data API exposure disabled, and unused Realtime/S3/vector services disabled.
- A separate private schema, four exposed read-only family tables, composite circle foreign keys, retained/revocable memberships, revocable guardian grants, salted invitation-email hashes, token hashes, private audit events, immutable identity triggers, explicit grants, fixed-search-path definer helpers, and RLS based on current database membership.
- Circle-first organizer RPCs for member-only invitations, reinvitation, acceptance, invitation revocation/listing, role changes, membership revocation, managed-person creation, and guardian changes. Membership revocation also revokes active guardian grants.
- Two private Storage buckets protected by a restrictive deny policy until PD-006 and the media phase define their usable policy.
- Deterministic synthetic fixtures spanning two circles, dual-circle authority, two-organizer cases, managed children, a revoked member, and an authenticated no-circle actor.
- Request-scoped server/browser clients and a nonce/CSP proxy that refreshes with `getClaims()` while forwarding every Supabase cache header supplied alongside refreshed cookies.
- A mobile email-code form that always uses `shouldCreateUser: false`, returns non-enumerating request copy, verifies a single six-digit input, checks live RLS membership, and fails cross-origin Server Actions closed.
- A local OTP email template containing only the code, a ten-minute expiry explanation, and no family details.
- A fragment-based `/invite` flow that exchanges the secret for a ten-minute, `HttpOnly`, `SameSite=Strict`, route-scoped intent cookie with a hard fragment-free replacement navigation. A generic token-plus-email preflight precedes OTP, acceptance is atomic, and rejected acceptance clears the new Auth cookies even if the Auth API cleanup call fails. Connected routes never render the design fixture.
- Server-derived preparation/no-access states and a confirmed local sign-out flow that clears only Our Days browser state before a hard replacement navigation. Blocked IndexedDB deletion reports failure and gates the next sign-in until cleanup succeeds.
- CI scaffolding for two clean resets, pgTAP, real local Auth/Mailpit/PostgREST integration, two-session concurrency, generated-type drift, a connected Chromium journey, database lint, and project-scoped shutdown once the isolated repository is created.

## Evidence available now

- `npm run check`: 29 test files and 244 tests pass.
- `npm run build:webpack`: production compilation, TypeScript, route generation, and the private-artifact scan pass.
- Two consecutive `npm run db:reset` runs apply PostgreSQL 17 migration and synthetic seed cleanly; `npm run db:lint` reports no schema errors.
- `npm run test:db`: 68 executable pgTAP assertions cover exact full-catalog ACL/RPC allowlists, RLS, real dual-circle organizer isolation, mixed-circle composite rejection, immutable identity, invitation preflight/success/wrong recipient/expiry/revocation/replay/reinvite, immediate revocation, guardian revocation, audit history, and last-organizer protection.
- `npm run test:db:concurrency`: native row holds plus a service-only activity probe prove simultaneous lock waiters for reciprocal organizer revocation and invitation acceptance. The races yield one safe organizer outcome and exactly one invite success, membership, consumption, and acceptance audit.
- `npm run test:auth:integration`: real local Auth, Mailpit, PostgREST, and Storage HTTP services prove raw signup plus unknown-user OTP variants cannot persist an account, known-user OTP/invite works, stale authority cannot perform a sensitive mutation after revocation, a dual-circle identity loses A while retaining B, and anonymous/active/stale actors cannot list, read, upload, or publicly address either closed media bucket.
- `npm run test:browser:connected`: a connected production build in real Chromium completes fragment exchange → OTP → acceptance → membership gate; reloads after the Mail handoff boundary; replays the real Server Action wire format with a hostile Origin; performs A→B switching while a second isolated A context remains signed in; purges A-scoped browser canaries before B; proves a revoked invite leaves no session or intent and reaches bare-link recovery; checks short-screen focus, cache/storage/IndexedDB cleanup, Back/direct-route lockout, scoped cookies, response/server canaries, accessibility, console errors, and 320×350/390×844 overflow.
- `npm run types:db:check`: the committed typed Supabase client contract matches the running schema.
- Static Supabase contract tests cover the fail-closed config, RLS/grant shape, current-membership authorization, secret hashing, private definer boundary, circle-first locks, composite attribution, synthetic fixtures, and closed media buckets.
- Focused action tests prove `shouldCreateUser: false`, normalized input, non-enumerating provider failure, cross-origin denial, OTP verification, and no-circle denial.
- Local Chromium screenshots at 390×844 and 320×350 show the detached lock screen and connected form without overflow loss; the short screen scrolls rather than vertically clipping the form.
- Three independent reviews were used: privacy/schema, mobile Auth UX, and adversarial test-gap review. Their first- and final-pass blockers were implemented and rerun through the local gates above; all three returned GO for this local checkpoint.

## Evidence not yet available

- The trusted account-provisioning worker and email dispatch boundary depend on the pending production-infrastructure decision. No bypass credential is present in the Next.js process.
- Hosted SMTP delivery, abuse/rate-limit behavior, production redirect configuration, and iPhone Mail-to-installed-PWA handoff have not been tested.
- Connected moments do not exist yet, so the A→B test uses account-scoped browser canaries and live membership/session boundaries. It must gain real per-family content canaries when moments are connected.
- The organizer invitation-management interface is still the isolated design preview; it is not connected to the live RPCs.
- Moment persistence, comments, reactions, date browsing, export jobs, trash/purge behavior, and usable media policies belong to later phases. The two private media buckets intentionally remain closed.
- No GitHub-hosted CI run or hosted Supabase/Vercel evidence exists because those separate resources have not been approved or created.

## Next gate

Resolve the production provisioning/worker boundary and remaining product decisions before creating hosted resources. Then connect organizer invitation management to the tested RPCs and begin the moments phase without weakening the live membership gate. A Supabase secret/service-role credential must never enter the Next.js deployment.
