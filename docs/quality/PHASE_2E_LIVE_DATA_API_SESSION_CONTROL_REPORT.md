# Phase 2E live Data API session control

Date: 2026-08-31

Status: accepted local security checkpoint; production resources remain
unprovisioned.

## Delivered

- PostgREST now invokes a private pre-request guard after selecting the request
  database role. Authenticated requests proceed only when `session_id` belongs
  to the JWT subject, the Supabase Auth session has not expired, and account
  closure is not in progress.
- The guard is security-invoker with a fixed empty search path. It relies on
  PostgREST's authoritative database role, so a forged or mismatched JWT `role`
  claim cannot bypass or opt into the check.
- Anonymous invitation preparation and the isolated service control plane stay
  outside the user-session check. Their existing narrow ACLs and invitation
  controls remain authoritative.
- The browser route guard treats only the exact generic stale-session denial as
  signed-out state and redirects to the locked sign-in route. Unexpected
  database failures still surface instead of being hidden as logout.
- The obsolete raw `reserve_photo_intake` API grant is removed. Photo drafts
  continue through the atomic `reserve_photo_moment` boundary.
- Auth, browser, concurrency, and photo integration fixtures now create real
  matching local `auth.sessions`, so the release harness exercises the same
  invariant as the app.

## Invitation-race correction found during verification

The strengthened acceptance-versus-organizer-withdrawal test found a real audit
defect in a safe terminal state: when withdrawal won through the job-first
trigger path, the invitation was revoked and no membership was created, but the
ordinary `invitation_revoked` event was missing. The trigger that actually
materializes that revocation now records exactly one event with the organizer
actor. An affected-row guard makes replay and recursive invalidation
idempotent. Focused repetitions exercised both acceptance and withdrawal
winners and verified the durable job, invitation, membership, email-request,
and audit state independently from the HTTP responses.

## Verification

- Complete pgTAP database suite: 19 files and 1,002 assertions passed.
- Focused adversarial authorization catalog: 42 assertions passed.
- Database lint passed with no schema errors; generated TypeScript database
  types match the local schema.
- The complete serialized database concurrency gate passed, including staged
  same-key initial closure, acceptance-versus-withdrawal, invitation-versus-
  closure, organizer topology, export, moment, note, trash, and revocation
  races. Closing-session replays are now asserted at the pre-request boundary;
  lower-layer function idempotency remains covered by pgTAP.
- Auth/PostgREST integration passed deleted-session, wrong-session,
  account-closing, service-boundary, valid-session, and raw-reservation-denial
  cases.
- Photo intake, promotion, derivative, and connected Chromium journeys passed
  with session-aware fixtures. The connected journey also proved that local
  sign-out invalidates a copied same-session context, while a separately
  reauthenticated session remains valid until membership revocation.
- Full static, lint, TypeScript, unit, and recovery self-test gate passed: 58
  test files passed, one skipped; 691 tests passed, three skipped.
- The production Webpack build and private-artifact scan passed.

## Boundary and remaining release work

`pgrst.db_pre_request` governs PostgREST/Data API requests. Supabase Storage is
a separate boundary and already has explicit live-session predicates for this
app's upload and delivery paths. The current app does not use Realtime, Edge
Functions, or a direct database connection for family data; any future path of
that kind must add an equivalent explicit check before release.

This checkpoint does not activate photo posting, provision production services,
or settle PD-006. Photo quotas, cancellation and cleanup processing, hosted
workers, HEIC/installed-iPhone proof, and export/original-download inclusion
remain open. Invitation delivery still requires its documented production
provider, expiry, retention, and hosted-device gates.
