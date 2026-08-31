# Phase 2C target-bound invitation materialization

Date: 2026-08-31

Status: **candidate local-only database boundary — verification is in progress; invitation sending remains unavailable**

This checkpoint advances accepted PD-003 without claiming that production invitation delivery exists. It uses only existing confirmed synthetic Auth users to test a durable job-to-invitation link and exact-account acceptance. It creates no external account, provider, queue, worker deployment, email, hosted secret, or Send action.

## Candidate boundary

- One private invitation job may move monotonically from `queued` to `materialized` or `invalidated`. It records a bounded expiry and delivery generation; a materialized job retains one immutable linked invitation.
- A target-bound invitation carries the job's exact Auth UUID. The current confirmed email and salted email digest remain defense in depth, but email equality alone cannot grant membership.
- Materialization accepts the immutable job identity and a lowercase SHA-256 token digest. The database derives the target, recipient binding, person identity, creator, email digest, and expiry; it never accepts or returns a plaintext recipient address, raw token, action URL, or provider payload.
- Exact lost-response retries converge on the same job and invitation. A changed identity, generation, delivery version, or token digest is denied without overwriting the winner.
- New coordinator seams remain in `private`, use fixed search paths, and are ungranted from `public`, `anon`, `authenticated`, and `service_role`. Tests exercise them only as local `postgres`; there is no deployed caller.
- Acceptance of a target-bound invitation requires `auth.uid()` to equal the immutable target UUID. Same-email substitution by another Auth account is denied.
- Requester authority loss, target activation, target identity drift, expiry, closure, and organizer withdrawal terminalize materialized authority and revoke an unaccepted linked invitation without resurrecting it on retry.

## Deliberate compatibility boundary

The existing browser-facing raw-token creation and exact preflight RPCs remain only because the current local invitation/OTP journey still depends on them. They are not used by the new target-bound coordinator, remain production blockers, and must be removed—not grandfathered—when the trusted provisioner and hosted email flow replace the legacy harness.

The Phase 2B public job request also still requires an already-existing confirmed target Auth UUID. No browser UI can perform a trusted lookup, and no Send action is exposed. A future separately deployed provisioner must accept organizer intent, create or recover the exact Auth account idempotently, and pass only its durable UUID into this boundary.

## Verification status

Final evidence must cover:

- exact schema, constraint, routine, and ACL catalogs;
- materialization success, exact replay, conflict, expiry, and monotonic state;
- missing, unconfirmed, closing, detached, already-active, and wrong-circle targets;
- exact-target acceptance plus same-email/different-UUID denial;
- requester demotion/revocation, target activation, closure, recipient-binding drift, withdrawal, and no resurrection;
- overlapping exact/conflicting materialization and materialization-versus-authority-loss outcomes;
- absence of plaintext email, raw bearer, action URL, provider receipt, delivery credential, or a new public/service execution seam;
- unchanged disabled-worker and no-Send UI contracts; and
- complete database, Auth, concurrency, generated-type, schema-lint, recovery, build, and connected-browser regressions.

Until these checks and independent reviews pass, this document records a candidate architecture rather than a passing checkpoint.

## Explicit non-capabilities

- no Auth Admin account provisioning or target lookup;
- no recipient-email delivery read;
- no provider adapter, provider idempotency receipt, or completion state;
- no enabled or deployed worker;
- no external email, domain, SMTP, queue, scheduler, or credential;
- no browser Send or resend action;
- no removal yet of legacy raw-token creation or exact preflight;
- no production or hosted activation; and
- no personal family address or data.

## Next activation gate

Keep invitation sending unavailable. The next slice must define and test the separately deployed Auth provisioner and provider adapter, durable provider receipts, abuse/rate controls, and the complete crash/retry window. Production cutover must revoke the legacy raw-token/preflight ACLs, exercise a target-bound email-to-PWA journey on hosted iPhone Safari, and prove that organizer or recipient authority loss makes every previously sent link useless.
