# Phase 7C account-closure preparation checkpoint

Date: 2026-08-30

Status: **database preparation passes locally — account deletion remains unavailable**

This checkpoint closes database authorization without deleting shared family history. It does not deploy a worker, expose account-deletion UI, call the Supabase Auth Admin API, touch Storage objects, purge moments, select a retention policy, or claim that restored backups cannot resurrect an account.

## Implemented

- A private, immutable `account_closure_requests` ledger records an opaque idempotency key and replaceable Auth subject without storing an email, media policy, or false deletion timestamp. It deliberately has no foreign key to `auth.users`.
- A private closure-to-membership ledger records every affected circle and retained membership. Both ledgers use forced RLS and expose no browser table privileges.
- The authenticated request RPC derives `auth.uid()` and accepts only a request key. It locks the Auth row and all affected circles in stable order and rejects a last organizer before recording intent.
- Requested closure blocks new export and invitation jobs, and makes queued work ineligible for a worker. Ordinary family reads remain available until preparation commits, so an unprepared request does not partially remove access.
- The only preparation seam is a fixed-path security-definer RPC executable by `service_role`, not by browser roles. The web application still has no service-role credential.
- Preparation locks the Auth subject, request, affected circles, and memberships; rechecks the last-organizer invariant; and then performs one transaction across every circle.
- The transaction terminally invalidates queued exports and invitation work, revokes pending invitations and guardian grants, records truthful membership- or closure-based attribution, revokes each membership, and changes its Auth attachment from the original UUID to `NULL`.
- The Auth foreign key remains `ON DELETE RESTRICT`. Only revoked memberships with a matching closure ledger may detach; active-null membership, direct detachment, Auth reassignment, and automatic reattachment are denied.
- People, moments, notes, reactions, recorder/trash attribution, and family-facing timeline responses remain attached to durable memberships and people. A recreated Auth account—even with the same email—cannot claim the detached journal through an old invitation.
- Generated public-schema TypeScript types include the request RPC and nullable membership Auth attachment.

## Local evidence

- The migration applied from a clean local reset.
- The focused pgTAP suite passed 96 assertions covering catalog placement, forced RLS, runtime service-role boundaries, fixed search paths, idempotent request/replay, requested-state access, successful and denied all-circle outcomes, stale-JWT RLS denial after preparation, work invalidation, immutable terminal state, historical-content preservation, Auth deletion restriction before preparation, and same-UUID/same-email non-resurrection.
- The complete database suite passed 503 assertions across 11 files, and Supabase schema lint reported no errors.
- The real local Auth/REST/Storage integration passed with one captured bearer token: requested-state family reads remained available, preparation ran through the service-role-only seam, and the same token then received zero family rows, generic mutation denial, and denied list/read/upload access on both private media buckets.
- The expanded overlapping race harness passed competing two-organizer closure requests, same-key and conflicting-key retries, request-versus-prepare, prepared replay, last-organizer topology-versus-prepare, same-subject invitation acceptance versus closure, invitation target/requester work, cross-circle all-or-none detachment, terminal attribution, non-resurrection, and explicit deadlock rejection.
- The fail-closed logical recovery drill passed at migration head `20260831010000`, including the exact new private-table inventory and migration history. Its cleanup audit found no restore databases, snapshot backends, dump files, locks, or temporary worktrees.
- Generated database types match the live local schema. The full static/unit gate passed 477 Vitest tests across 42 files, and the webpack production build plus private-artifact scan passed.
- Independent adversarial reviews found and closed two blockers. First, two co-organizers could otherwise both request closure and strand the second immutable request; the invariant now counts only active, Auth-attached, non-closing organizers in request, preparation, demotion, and revocation paths. Second, invitation acceptance had not been raced directly against closure for the same Auth subject; the harness now proves both serial outcomes end with complete detachment and valid terminal attribution. Both reviewers returned GO after re-review.

## Deliberate boundaries

- The public request seam has no UI. It must not be exposed as a finished deletion feature before confirmation language, recovery expectations, and the complete worker path are reviewed.
- Preparation is not Auth deletion. No Auth Admin credential, deployed coordinator, session operation, email-provider action, or completion receipt exists here.
- Current media buckets remain closed and the fixture used for Auth-deletion proof has no media. Production closure must reconcile all original and derivative objects before deleting Auth.
- Shared family content is preserved. Adult content deletion, trash duration, and hard purge remain governed by PD-002 and pending PD-005.
- Backup recovery still needs an external append-only suppression source so a restored database cannot silently re-enable a closed account. The local logical drill is not that source.
- Ready export/download artifacts, legacy media ownership, worker retries, quarantined failures, and end-to-end receipt semantics remain unresolved.
- Reattaching a detached journal is permanently denied by this slice. Any future recovery or child-account claim ceremony requires a separately reviewed policy.

## Next gate

Keep account deletion unavailable. Before a production action exists, add private media ownership/reconciliation, ready-artifact invalidation, an external suppression/receipt boundary, a separately deployed narrow worker, Auth/session deletion integration, retry and partial-failure recovery, and real-device confirmation/recovery UX. Then rehearse the full operation against isolated hosted resources and prove that a restored project does not restore access.
