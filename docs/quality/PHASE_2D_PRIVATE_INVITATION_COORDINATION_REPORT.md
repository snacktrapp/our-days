# Phase 2D private invitation coordination

Date: 2026-08-31

Status: **revised-MVP local invitation path passes — production delivery remains disabled by default**

This checkpoint connects the approved target-bound invitation model to a
private provisioning and delivery coordinator without putting Auth Admin
credentials, recipient addresses, bearer material, or delivery receipts in the
Next.js deployment. It advances the focused five-person revised MVP. It does
not narrow the ultimate app goal: broader relative onboarding, richer family
administration, multiple-circle UI, video, deeper archive/purge automation,
native options, and wider device hardening remain in the complete build.

## Implemented boundary

- An organizer creates one idempotent, circle-bound email request. Browser
  responses and the pending-request list expose an opaque request ID, invited
  display name, state, and dates—not the normalized address, salt, hash, Auth
  target, token, provider identifiers, or worker identity.
- Separate provisioner and delivery-worker Auth accounts must be explicitly
  allowlisted, have no family membership or photo-validator authority, present
  an ordinary authenticated JWT, and have a live matching `auth.sessions`
  record. Revocation invalidates outstanding work in place.
- Provisioning uses the Supabase Auth Admin invite path for a new unconfirmed
  target, a no-create passwordless code for an exact existing confirmed target,
  and a renewed admin invite for an exact existing unconfirmed target.
  Materialization and acceptance remain bound to that UUID; email agreement is
  defense in depth rather than identity.
- The delivery transaction records one immutable provider receipt and supports
  exact replay after a lost response, including after the family invitation has
  reached a terminal state. Receipt replay cannot authorize a resend.
- Expiry sweeping is bounded and worker-only. Expired request PII is scrubbed,
  linked work is invalidated, and organizer withdrawal or authority loss closes
  the same chain.
- The legacy browser raw-token creation, exact preflight, and Phase 2B job RPCs
  retain definitions only for historical fixtures. Their execution grants are
  revoked, and the public acceptance dispatcher accepts Phase 2D invitations
  only.
- Two independent gates default to disabled: Family Settings requires the
  explicit application invitation-delivery mode, while the database requires
  its owner-controlled `email_delivery` capability. Anonymous, authenticated,
  and `service_role` identities have no privilege on the private capability
  relation. A disabled database capability creates no request or side effect.

## Local end-to-end evidence

- The clean migration replay applies through
  `20260831124636_phase_2d_private_invitation_coordination.sql`.
- The complete database suite passes 942 pgTAP assertions. The focused Phase 2D
  suite contributes 94 assertions covering private-table/FORCE-RLS boundaries,
  organizer isolation, worker/session separation, target eligibility,
  revocation, expiry, immutable receipts, exact replay, default-off capability
  enforcement, zero browser/service grants, and retirement of legacy execution
  paths.
- Three real local invitation/Auth journeys pass end to end. An existing
  confirmed account receives a no-create email code, an orphaned unconfirmed
  account receives a renewed invitation code, and a new unconfirmed account
  receives its first admin-invite code. Each is materialized for the exact Auth
  UUID, receives the target-bound family email through Mailpit, verifies the
  appropriate Auth code, and accepts into one membership. The new-account
  journey additionally proves replay denial and terminal request scrubbing.
  The flows use separate provisioner and delivery-worker password sessions and
  synthetic `@example.test` identities only.
- CI now runs all three target-bound journeys after the existing Auth flow. It
  also runs the checked logical database recovery drill after all reset-owning
  database/media harnesses.

## Recovery parity

The local recovery contract now fails closed unless Phase 2D is the exact
migration head. Its canonical fixture requires five mutable private coordination
relations to be empty and the sixth capability relation to contain exactly
`email_delivery = false`. All six must use FORCE RLS; anonymous, authenticated,
and service roles must have zero capability-table privileges. The contract pins
the exact public organizer/worker routine grants, rejects the three retired
browser routines, rejects direct private-helper execution, and includes the new
tables, routines, triggers, constraints, indexes, ACLs, migration history,
normalized data, and archive entries in committed fingerprints.

The same-container synthetic dump/restore passed schema and effective
authorization fidelity, normalized data fidelity, database metadata, migration
history, exact nineteen-object owner-ACL representation handling, restored
invitation/photo authorization, and cleanup. During branch assembly, an
isolated temporary Git index represented the pending migration as its intended
commit so the harness could exercise its committed-source guard; CI and the
post-checkpoint local command must rerun from the actual commit.

This remains database regression evidence, not production disaster recovery.
It contains no Storage bytes, off-site encrypted backup, separate-project
restore, hosted control-plane configuration, external non-resurrection ledger,
session/credential rotation rehearsal, RPO, or RTO.

## Production activation blockers

- Before any delivery-disabled household pilot, implement and rehearse one
  reviewed one-time bootstrap for the two adult Auth identities and their exact
  organizer memberships. The three child journals remain managed profiles and
  need no Auth accounts. No ad hoc SQL, shared credential, or public signup may
  substitute for that bootstrap; without it, the disabled build cannot onboard
  the second adult.
- Add a durable single-flight claim around Auth-code issuance. The current
  local provisioner may retry after a crash between Auth accepting the send and
  database completion; concurrent invocation or a delayed retry can therefore
  issue a newer code. Hosted tests must prove crash recovery, provider/Auth rate
  limits, delayed or out-of-order messages, and that the code paired with the
  family link remains unambiguous. Application and database capabilities stay
  disabled until this is closed.
- Choose and deploy a production mail provider whose idempotency retention
  covers the full retry horizon; the local Mailpit adapter does not establish
  provider idempotency.
- Deploy the provisioner and delivery coordinator separately with narrowly
  scoped credentials, a reviewed operator process for the database capability,
  durable scheduling for bounded expiry sweeps, rate/abuse controls, no-content
  observability, and tested secret rotation. Local worker invocation does not
  prove that scheduled expiry processing exists.
- Complete a hosted Supabase/Vercel rehearsal and real iPhone Mail-to-installed-
  PWA journey, including delayed delivery, duplicate/lost responses, account
  switching, revocation, and stale-code denial.
- Define recipient-address/audit/provider-receipt retention and connect it to
  the later export, account-deletion, purge, and external restore-suppression
  policies.
- Rerun the complete security, database, browser, build, and recovery gates from
  the committed release candidate before changing invitation delivery from its
  disabled default.

## Milestone decision

Keep the invitation capability disabled outside the local rehearsal until the
production blockers above pass. For the revised MVP, this path is necessary for
the initial private household to onboard safely. Auth-code single-flight,
provider idempotency, a durable expiry-sweep schedule, and the hosted iPhone
rehearsal therefore remain revised-MVP production gates. Broader relative
invitation ergonomics, richer administration, and deeper recovery/retention
automation continue afterward as part of the retained complete-build goal.

A delivery-disabled pilot is a valid interim candidate only after the reviewed
two-adult bootstrap exists and passes account-switching and revocation checks.
Until then, this checkpoint is deployable groundwork rather than a usable
five-person release.
