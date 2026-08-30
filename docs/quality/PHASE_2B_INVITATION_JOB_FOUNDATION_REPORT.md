# Phase 2B invitation-job foundation checkpoint

Date: 2026-08-30

Status: **local private request ledger and disabled worker contract pass — invitation sending remains unavailable**

This checkpoint advances accepted decision PD-003 without claiming that production invitation delivery exists. It creates no external account, email provider, queue, worker deployment, hosted secret, or user-facing Send action. Synthetic local Auth users are the only targets used in tests.

## Implemented

- A `private.invitation_jobs` ledger outside the Data API schema, with FORCE RLS and no browser table privileges.
- Same-circle composite requester and invalidator attribution. The target is a durable Auth user ID rather than a stored email address; it deliberately has no foreign key to `auth.users`, so a future account-closure workflow is not prevented by this job history.
- An organizer-only public request seam. The database derives the requester from `auth.uid()`, locks the circle, requires a confirmed target account that is not already active in that family, and returns only an opaque job ID.
- Request idempotency and bounded work. An exact retry returns the same job; compatible concurrent requests for one family and target coalesce; conflicting input fails generically.
- The organizer's membership `updated_at` is captured as an authorization generation. The membership integrity trigger rotates it on role or status changes. Demotion and revocation terminally invalidate queued work, and later restoration cannot resurrect it.
- Target activation also terminally invalidates queued work. Worker authorization freshly rejects an account that has already joined the family.
- Content-free audit events contain only circle-bound membership/job IDs, event type, and time. The ledger contains no recipient address, raw token, token hash, action link, encrypted payload, provider body, or Auth credential.
- A pure worker contract that accepts only an opaque job ID, derives a deterministic domain-separated HMAC-SHA256 bearer token with a worker-only versioned key, passes only its SHA-256 digest to materialization, and uses a stable job/delivery-version provider idempotency key.
- Disabled-by-default execution fails before coordinator, recipient, keyring, provider, or durable mutation work. Public results and errors contain no recipient or bearer material.
- In-memory fault doubles exercise lost provider responses, lost completion responses, revocation races, strict receipt comparison, and retry convergence. They are test-only and are not production adapters.

## Security properties established locally

- Anonymous, ordinary-member, revoked-member, no-circle, wrong-circle, and mixed dual-circle requests fail.
- Private tables and worker helpers are not executable or readable by browser roles; the browser-facing security-definer wrapper is fixed-path and delegates to a private mutator that browser roles cannot execute directly.
- Request keys cannot be reused with different target or display input, and a family cannot hold more than one queued job for one target account.
- Immutable job identity cannot be rewritten or deleted, and unfinished database paths cannot forge a delivered state.
- Authorization loss and target activation produce one terminal invalidation audit, including under the circle lock used by request and membership mutations.
- The disconnected worker keeps production credentials and Auth Admin libraries out of the web application and repository configuration.

## Deliberate boundaries and activation blockers

- The database job currently supports only `queued` and `invalidated`. It does not yet contain materialization identity, target-bound invitation state, leases, delivery versions, provider receipts, or delivered state.
- Production must bind the materialized invitation to `target_auth_user_id` and require exact `auth.uid()` equality at acceptance. Email matching remains defense in depth, not account identity.
- The real coordinator must atomically recheck requester generation, target eligibility, confirmed recipient binding, token digest, invitation liveness, and the complete provider receipt at every materialization, pre-send, completion, and existing-result boundary. Losing authority or recipient identity after materialization must invalidate both job and redeemable invitation.
- Provider idempotency is proven only by the pure double. Activation requires a chosen provider whose idempotency lifetime covers the full retry window, plus concurrent real-adapter tests.
- Supabase Auth Admin and worker token keys must exist only in a separately deployed, narrowly permissioned worker. The ordinary web deployment must not receive them.
- The existing legacy `public.create_invitation` still returns a raw token to authenticated organizers, and `public.preflight_invitation` still exposes an exact boolean to callers holding a token. They support the current local Auth acceptance harness but are production blockers. They must be replaced and their browser ACLs revoked before any external deployment or Send action.
- Auth-account provisioning, abuse/rate limits, email copy, custom SMTP/provider setup, durable scheduling, observability, and real iPhone Mail/PWA handoff remain unimplemented.

## Verification

- Clean migration replay and the full database suite pass: 365 pgTAP assertions across nine files. The focused invitation-job and exact identity/ACL files contribute 100 of those assertions.
- The overlapping database harness passes duplicate-key, distinct-key coalescing, request-versus-demotion, and request-versus-target-acceptance races in addition to the existing authorization and destructive-operation races. The target-acceptance race ends with exactly one active membership and no queued or worker-authorized job.
- The pure worker suite passes 68 focused tests. The full Vitest run passes 473 tests across 42 files.
- Prettier, ESLint, TypeScript, generated Supabase type comparison, Supabase schema lint, and `git diff --check` pass locally.
- `npm run build:webpack` passes production compilation and route generation, followed by a scan of tracked/untracked source and the complete `.next` output for privileged credentials and private design fixtures.
- Independent database and worker adversarial reviews found the stale-target race, recipient-binding race, Postgres timestamp round-trip mismatch, private-mutator privilege, production/test export ambiguity, and missing activation boundaries. The implemented fixes were re-tested; both reviewers give a conditional pass for disabled, unconnected groundwork and a no-go for production activation until the listed blockers are removed.

## Next gate

Keep invitation sending unavailable. The next activation slice must add the target-account-bound materialization/acceptance schema and real coordinator transactions first, then a separately deployed worker and provider adapter with concurrent crash/retry evidence. Only after the legacy raw-token and exact-preflight RPCs are removed, abuse controls pass, and the complete email-to-PWA flow passes on hosted iPhone Safari should Family Settings expose Send.
