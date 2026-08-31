# Phase 2C target-bound invitation materialization

Date: 2026-08-31

Status: **verified local-only database boundary — invitation sending remains unavailable**

This checkpoint advances accepted PD-003 without claiming that production invitation delivery exists. It uses only existing confirmed synthetic Auth users to test a durable job-to-invitation link and exact-account acceptance. It creates no external account, provider, queue, worker deployment, email, hosted secret, or Send action.

## Implemented boundary

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

All tests use synthetic local data. No hosted project, production credential, personal address, or external delivery provider was used.

- The focused Phase 2C pgTAP suite passes 69 assertions. The complete database suite passes 690 assertions across 13 files, including exact schema/ACL catalogs, reciprocal links, exact-target acceptance, same-email/different-UUID denial, replay, conflict, expiry replacement, withdrawal, activation, closure, detached-profile denial, audit attribution, and no resurrection. Schema lint reports no errors, and generated public database types match.
- The complete unit/component/contract suite passes 495 assertions across 44 files. Formatting, ESLint, TypeScript, the recovery safety self-test, the disabled-worker contract, the no-Send interface, and the static absence of provider credentials or public coordinator seams all pass.
- The held-lock database harness passes all six Phase 2C races: exact materialization convergence; conflicting-digest single winner; materialization versus requester demotion; acceptance versus target activation; acceptance versus organizer withdrawal; and acceptance versus target closure. Per-operation waiter counts are exact, unsafe 5xx/deadlock/serialization outcomes are rejected, durable job/invitation/audit state is correlated to the winner, bearer replay is denied, and the preserved global concurrency suite also passes.
- Auth integration, the real quarantined TUS upload integration, and the existing photo concurrency suite remain green. These are regressions only; this invitation phase adds no media or Auth Admin capability.
- A production webpack build and private-artifact scan pass. The complete connected family journey passes in Chromium and Firefox. Local WebKit cannot launch on this macOS 14 host because Playwright's frozen binary exits before page creation; the macOS 15 Intel CI WebKit gate remains authoritative and this is not represented as local WebKit app evidence.
- The isolated logical restore passes with independently renewed schema, catalog, normalized-data, archive-inventory, and restored-schema fingerprints. The drill proves database/authorization fidelity for the committed synthetic fixture; it does not recover Auth sessions, Storage object bytes, hosted configuration, or separate-cluster roles.
- Independent adversarial review initially returned NO-GO for split job/invitation terminalization, lost-response replay, stale-job liveness, false audit attribution, and incomplete reciprocal linking. Those findings were fixed. A second review found and closed request-error and real-expiry attribution regressions. The final implementation review returned GO, and the final test-gap review's false-positive findings were closed before the 690-assertion and full concurrency reruns.

The remaining production gates below are intentionally outside this checkpoint. Passing Phase 2C does not make invitation sending available.

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
