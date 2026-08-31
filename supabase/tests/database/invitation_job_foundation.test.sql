begin;

select plan(58);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'invitation_jobs'
  ),
  'private',
  'invitation jobs stay outside the exposed public schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'invitation_jobs'
  ),
  'the private invitation ledger enables and forces RLS'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%FOREIGN KEY (circle_id, requested_by_membership_id)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitation_jobs_requester_fkey'
  ),
  'requester attribution is structurally bound to the same circle'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%FOREIGN KEY (circle_id, invalidated_by_membership_id)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitation_jobs_invalidator_fkey'
  ),
  'invalidation attribution is structurally bound to the same circle'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%UNIQUE (circle_id, requested_by_membership_id, request_key)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitation_jobs_request_key_unique'
  ),
  'idempotency keys are scoped to one requester and circle'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_row.indexrelid)
      like '%(circle_id, target_auth_user_id) WHERE (state = ''queued''%'
      from pg_catalog.pg_index as index_row
      join pg_catalog.pg_class as class
        on class.oid = index_row.indexrelid
     where class.relname = 'invitation_jobs_one_queued_per_target_idx'
  ),
  'one family can have at most one queued delivery per target account'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'private'
       and table_name = 'invitation_jobs'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  0::bigint,
  'browser roles receive no direct invitation-ledger privileges'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.request_invitation_job(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the superseded public request seam is retired for authenticated callers'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.request_invitation_job(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot request invitation work'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.request_invitation_job(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'the private invitation mutator is not browser executable'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.invitation_job_requester_is_authorized(uuid)',
    'EXECUTE'
  ),
  'the future worker authorization helper is not browser executable'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.proname = 'request_invitation_job'
  ),
  'the mutating request implementation is private, definer, and fixed-path'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.proname = 'request_invitation_job'
  ),
  'the only browser-facing request wrapper is definer and fixed-path'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'invitation_jobs'
       and column_name in (
         'email', 'recipient_email', 'raw_token', 'token_hash',
         'encrypted_payload'
       )
  ),
  0::bigint,
  'the ledger stores neither recipient addresses nor bearer material'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '10000000-0000-4000-8000-000000000021',
    'job-target-one@example.test',
    statement_timestamp(),
    '{}'
  ),
  (
    '10000000-0000-4000-8000-000000000022',
    'job-target-unconfirmed@example.test',
    null,
    '{}'
  ),
  (
    '10000000-0000-4000-8000-000000000023',
    'job-target-two@example.test',
    statement_timestamp(),
    '{}'
  ),
  (
    '10000000-0000-4000-8000-000000000024',
    'job-target-deleted@example.test',
    statement_timestamp(),
    '{}'
  );

-- Historical foundation journeys run through a transaction-local grant. The
-- production ACL above remains the asserted contract and this grant rolls back.
grant execute on function public.request_invitation_job(uuid, uuid, text, uuid)
  to authenticated;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000021',
  '  Aunt Rowan  ',
  '91000000-0000-4000-8000-000000000001'
) as job_id \gset organizer_one_

set local role postgres;
select is(
  (select circle_id from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'a valid job is bound to the requested family'
);
select is(
  (select requested_by_membership_id from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the database derives the organizer membership'
);
select is(
  (select target_auth_user_id from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  '10000000-0000-4000-8000-000000000021'::uuid,
  'the durable job records only the provisioned target account ID'
);
select is(
  (select invited_display_name from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  'Aunt Rowan',
  'the private display label is normalized'
);
select is(
  (select requester_authorization_version from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  (select updated_at from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000001'),
  'the job captures the exact organizer authorization version'
);
select is(
  (select state from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  'queued',
  'the foundation records only a queued delivery intent'
);
select is(
  (
    select count(*)::bigint from private.audit_events
     where event_type = 'invitation_job_requested'
       and subject_id = :'organizer_one_job_id'::uuid
  ),
  1::bigint,
  'a new job creates one content-free audit event'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select is(
  public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000021',
    'Aunt Rowan',
    '91000000-0000-4000-8000-000000000001'
  ),
  :'organizer_one_job_id'::uuid,
  'a lost-response retry returns the original job ID'
);

set local role postgres;
select is(
  (select count(*)::bigint from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  1::bigint,
  'an idempotent retry leaves exactly one durable row'
);
select is(
  (
    select count(*)::bigint from private.audit_events
     where event_type = 'invitation_job_requested'
       and subject_id = :'organizer_one_job_id'::uuid
  ),
  1::bigint,
  'an idempotent retry creates no false audit history'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select is(
  public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000021',
    'Aunt Rowan',
    '91000000-0000-4000-8000-000000000002'
  ),
  :'organizer_one_job_id'::uuid,
  'a distinct key coalesces into existing queued work for the same target'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select is(
  public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000021',
    'Aunt Rowan',
    '91000000-0000-4000-8000-000000000003'
  ),
  :'organizer_one_job_id'::uuid,
  'co-organizer retries converge on the same target delivery'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000021',
    'Conflicting label',
    '91000000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'Invitation delivery could not be requested',
  'the same idempotency key cannot be reused with conflicting input'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000021',
    'Another label',
    '91000000-0000-4000-8000-000000000004'
  )$$,
  '22023',
  'Invitation delivery could not be requested',
  'queued work for one target cannot silently change its display identity'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000023',
    'Denied member target',
    '91000000-0000-4000-8000-000000000005'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'an ordinary member cannot request invitation delivery'
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000023',
    'Denied revoked target',
    '91000000-0000-4000-8000-000000000006'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'a revoked member cannot request invitation delivery'
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000007',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000023',
    'Denied no-circle target',
    '91000000-0000-4000-8000-000000000007'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'an account without a circle cannot request invitation delivery'
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000006',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000023',
    'Denied wrong-circle target',
    '91000000-0000-4000-8000-000000000008'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'an organizer from another circle cannot request this family job'
);
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000023',
    'Denied dual-circle target',
    '91000000-0000-4000-8000-000000000009'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'a dual-circle user cannot borrow their organizer role from circle B'
);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000023',
  'Harbor invite',
  '91000000-0000-4000-8000-000000000010'
) as job_id \gset dual_b_
select isnt(
  :'dual_b_job_id'::uuid,
  null::uuid,
  'the dual-circle organizer can request work in the circle they organize'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000022',
    'Unconfirmed target',
    '91000000-0000-4000-8000-000000000011'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'an unconfirmed target account cannot enter the durable queue'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'Already active',
    '91000000-0000-4000-8000-000000000012'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'an active family member cannot be queued for another invitation'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000099',
    'Unknown target',
    '91000000-0000-4000-8000-000000000013'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'an unknown target account cannot enter the durable queue'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000023',
    'Missing key',
    null
  )$$,
  '22023',
  'Invitation delivery could not be requested',
  'null request keys follow the generic invalid-input contract'
);
select throws_ok(
  $$select * from private.invitation_jobs$$,
  '42501',
  'permission denied for table invitation_jobs',
  'authenticated callers cannot enumerate private invitation work'
);

set local role postgres;
select throws_ok(
  format(
    'update private.invitation_jobs set state = %L where id = %L',
    'delivered',
    :'organizer_one_job_id'
  ),
  '42501',
  'Invitation job identity is immutable',
  'unfinished paths cannot forge delivery state'
);
select throws_ok(
  format(
    'delete from private.invitation_jobs where id = %L',
    :'organizer_one_job_id'
  ),
  '42501',
  'Invitation jobs cannot be deleted',
  'the private request ledger cannot be deleted'
);
select ok(
  private.invitation_job_requester_is_authorized(
    :'organizer_one_job_id'::uuid
  ),
  'the future worker gate recognizes the active organizer generation'
);

insert into public.people (
  id,
  circle_id,
  display_name,
  profile_kind,
  created_by_membership_id
)
values (
  '30000000-0000-4000-8000-000000000021',
  '20000000-0000-4000-8000-000000000001',
  'Joined target',
  'account',
  '40000000-0000-4000-8000-000000000001'
);
insert into public.circle_memberships (
  id,
  circle_id,
  user_id,
  person_id,
  role,
  status
)
values (
  '40000000-0000-4000-8000-000000000021',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000021',
  '30000000-0000-4000-8000-000000000021',
  'member',
  'active'
);
select is(
  (select state from private.invitation_jobs
    where id = :'organizer_one_job_id'::uuid),
  'invalidated',
  'a target joining the family terminally invalidates queued delivery'
);
select ok(
  not private.invitation_job_requester_is_authorized(
    :'organizer_one_job_id'::uuid
  ),
  'an active target is never worker-authorized'
);
select is(
  (
    select count(*)::bigint from private.audit_events
     where event_type = 'invitation_job_invalidated'
       and subject_id = :'organizer_one_job_id'::uuid
  ),
  1::bigint,
  'target activation records one content-free invalidation event'
);
select is(
  (
    select actor_membership_id from private.audit_events
     where event_type = 'invitation_job_invalidated'
       and subject_id = :'organizer_one_job_id'::uuid
  ),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'target activation attributes invalidation to the authenticated organizer'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000024',
  'Deleted target',
  '91000000-0000-4000-8000-000000000016'
) as job_id \gset deleted_target_

set local role postgres;
delete from auth.users
 where id = '10000000-0000-4000-8000-000000000024';
select is(
  (select state from private.invitation_jobs
    where id = :'deleted_target_job_id'::uuid),
  'queued',
  'account deletion does not erase the content-free historical job record'
);
select ok(
  not private.invitation_job_requester_is_authorized(
    :'deleted_target_job_id'::uuid
  ),
  'a deleted target account makes retained work ineligible'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000023',
  'Uncle Finch',
  '91000000-0000-4000-8000-000000000014'
) as job_id \gset organizer_two_
select isnt(
  :'organizer_two_job_id'::uuid,
  null::uuid,
  'the second organizer can create their own bounded job'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.set_membership_role(
  '40000000-0000-4000-8000-000000000002',
  'member'
);

set local role postgres;
select ok(
  not private.invitation_job_requester_is_authorized(
    :'organizer_two_job_id'::uuid
  ),
  'organizer demotion closes worker authority immediately'
);
select is(
  (select state from private.invitation_jobs
    where id = :'organizer_two_job_id'::uuid),
  'invalidated',
  'demotion makes queued work terminal'
);
select is(
  (
    select count(*)::bigint from private.audit_events
     where event_type = 'invitation_job_invalidated'
       and subject_id = :'organizer_two_job_id'::uuid
  ),
  1::bigint,
  'demotion records one content-free invalidation event'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.set_membership_role(
  '40000000-0000-4000-8000-000000000002',
  'organizer'
);

set local role postgres;
select ok(
  not private.invitation_job_requester_is_authorized(
    :'organizer_two_job_id'::uuid
  ),
  'restoring organizer role never resurrects invalidated work'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000023',
  'Uncle Finch',
  '91000000-0000-4000-8000-000000000015'
) as job_id \gset organizer_two_new_
select isnt(
  :'organizer_two_new_job_id'::uuid,
  :'organizer_two_job_id'::uuid,
  'a newly authorized organizer receives a fresh job generation'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.revoke_membership(
  '40000000-0000-4000-8000-000000000002'
);

set local role postgres;
select is(
  (select state from private.invitation_jobs
    where id = :'organizer_two_new_job_id'::uuid),
  'invalidated',
  'membership revocation terminally invalidates queued work'
);
select ok(
  not private.invitation_job_requester_is_authorized(
    :'organizer_two_new_job_id'::uuid
  ),
  'revocation closes worker authority for the new generation'
);
select is(
  (
    select count(*)::bigint from private.audit_events
     where event_type = 'invitation_job_invalidated'
       and subject_id = :'organizer_two_new_job_id'::uuid
  ),
  1::bigint,
  'revocation records one job invalidation event'
);

update public.circle_memberships
   set status = 'active',
       role = 'organizer',
       revoked_at = null,
       revoked_by_membership_id = null
 where id = '40000000-0000-4000-8000-000000000002';
select ok(
  not private.invitation_job_requester_is_authorized(
    :'organizer_two_new_job_id'::uuid
  ),
  'restoring a revoked organizer never resurrects terminal work'
);

select * from finish();
rollback;
