begin;

select plan(43);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'export_jobs'
  ),
  'private',
  'export jobs stay outside the exposed public schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'export_jobs'
  ),
  'the private job ledger enables and forces RLS as defense in depth'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%FOREIGN KEY (circle_id, requested_by_membership_id)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'export_jobs_requester_fkey'
  ),
  'requester attribution is structurally bound to the same circle'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%UNIQUE (circle_id, requested_by_membership_id, request_key)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'export_jobs_request_key_unique'
  ),
  'request idempotency is scoped to one circle and requester membership'
);

select ok(
  (
    select pg_catalog.pg_get_indexdef(index_row.indexrelid)
      like '%(circle_id, requested_by_membership_id) WHERE (state = ''queued''%'
      from pg_catalog.pg_index as index_row
      join pg_catalog.pg_class as class
        on class.oid = index_row.indexrelid
     where class.relname = 'export_jobs_one_queued_per_requester_idx'
  ),
  'each requester can have at most one queued export per circle'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'private'
       and table_name = 'export_jobs'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  0::bigint,
  'browser roles receive no direct job-ledger privileges'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.request_family_export(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated callers can reach the guarded public request RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.request_family_export(uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot reach the export request RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.export_job_requester_is_authorized(uuid)',
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
       and procedure.proname = 'request_family_export'
  ),
  'the mutating implementation is private, security-definer, and fixed-path'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.request_family_export(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001'
) as job_id \gset organizer_one_

set local role postgres;
select is(
  (
    select job.circle_id
      from private.export_jobs as job
     where job.id = :'organizer_one_job_id'::uuid
  ),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'a valid export request is bound to the exact requested circle'
);

select is(
  (
    select job.requested_by_membership_id
      from private.export_jobs as job
     where job.id = :'organizer_one_job_id'::uuid
  ),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the database derives requester membership from the authenticated organizer'
);

select is(
  (
    select job.requester_authorization_version
      from private.export_jobs as job
     where job.id = :'organizer_one_job_id'::uuid
  ),
  (
    select membership.updated_at
      from public.circle_memberships as membership
     where membership.id = '40000000-0000-4000-8000-000000000001'
  ),
  'the job captures the exact membership authorization generation'
);

select is(
  (
    select job.state
      from private.export_jobs as job
     where job.id = :'organizer_one_job_id'::uuid
  ),
  'queued',
  'the foundation records only an honest queued intent'
);

select is(
  (
    select count(*)::bigint
      from private.audit_events as audit
     where audit.event_type = 'export_requested'
       and audit.subject_type = 'export_job'
       and audit.subject_id = :'organizer_one_job_id'::uuid
  ),
  1::bigint,
  'a new request creates one content-free audit event'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select is(
  public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000001'
  ),
  :'organizer_one_job_id'::uuid,
  'a lost-response retry returns the original job ID'
);

set local role postgres;
select is(
  (
    select count(*)::bigint
      from private.export_jobs as job
     where job.circle_id = '20000000-0000-4000-8000-000000000001'
       and job.requested_by_membership_id =
         '40000000-0000-4000-8000-000000000001'
       and job.request_key = '90000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'an idempotent retry leaves exactly one durable request'
);

select is(
  (
    select count(*)::bigint
      from private.audit_events as audit
     where audit.event_type = 'export_requested'
       and audit.subject_id = :'organizer_one_job_id'::uuid
  ),
  1::bigint,
  'an idempotent retry does not create false audit history'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.request_family_export(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000002'
) as job_id \gset organizer_one_second_
select is(
  :'organizer_one_second_job_id'::uuid,
  :'organizer_one_job_id'::uuid,
  'a second request key coalesces into the already queued family export'
);

set local role postgres;
select is(
  (
    select count(*)::bigint
      from private.audit_events as audit
     where audit.event_type = 'export_requested'
       and audit.actor_membership_id =
         '40000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'coalescing multiple request keys creates no duplicate audit event'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'Family export could not be requested',
  'an ordinary family member cannot request the whole-family archive'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000004'
  )$$,
  '42501',
  'Family export could not be requested',
  'a revoked member cannot request an export with a captured JWT'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000007',
  true
);
select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000005'
  )$$,
  '42501',
  'Family export could not be requested',
  'an authenticated account without a circle cannot request an export'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000006',
  true
);
select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000006'
  )$$,
  '42501',
  'Family export could not be requested',
  'an organizer from another circle cannot request this family archive'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    '90000000-0000-4000-8000-000000000007'
  )$$,
  '42501',
  'Family export could not be requested',
  'a dual-circle user cannot borrow their organizer role from circle B'
);

select public.request_family_export(
  '20000000-0000-4000-8000-000000000002',
  '90000000-0000-4000-8000-000000000008'
) as job_id \gset dual_circle_
select isnt(
  :'dual_circle_job_id'::uuid,
  null::uuid,
  'the same dual-circle user can request the circle where they organize'
);

select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000002', null
  )$$,
  '22023',
  'Family export could not be requested',
  'null request keys follow the generic invalid-input contract'
);

select throws_ok(
  $$select * from private.export_jobs$$,
  '42501',
  'permission denied for table export_jobs',
  'authenticated callers cannot enumerate private export requests'
);

set local role postgres;
select throws_ok(
  $$insert into private.export_jobs (
      circle_id,
      requested_by_membership_id,
      requester_authorization_version,
      request_key
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000006',
      statement_timestamp(),
      '90000000-0000-4000-8000-000000000009'
    )$$,
  '23503',
  'insert or update on table "export_jobs" violates foreign key constraint "export_jobs_requester_fkey"',
  'composite integrity rejects a requester membership from another circle'
);

select throws_ok(
  format(
    'update private.export_jobs set state = %L where id = %L',
    'ready',
    :'organizer_one_job_id'
  ),
  '42501',
  'Family export request identity is immutable',
  'the unfinished web path cannot forge job readiness'
);

select throws_ok(
  format(
    'delete from private.export_jobs where id = %L',
    :'organizer_one_job_id'
  ),
  '42501',
  'Family export requests cannot be deleted',
  'the immutable request ledger cannot be directly deleted'
);

select ok(
  private.export_job_requester_is_authorized(
    :'organizer_one_job_id'::uuid
  ),
  'the future worker gate recognizes the active organizer requester'
);

update public.circle_memberships
   set role = 'member'
 where id = '40000000-0000-4000-8000-000000000001';
select ok(
  not private.export_job_requester_is_authorized(
    :'organizer_one_job_id'::uuid
  ),
  'organizer demotion immediately closes future export processing authority'
);

update public.circle_memberships
   set role = 'organizer'
 where id = '40000000-0000-4000-8000-000000000001';
select ok(
  not private.export_job_requester_is_authorized(
    :'organizer_one_job_id'::uuid
  ),
  'restoring organizer role never resurrects an older authorization generation'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.request_family_export(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000011'
) as job_id \gset organizer_one_reauthorized_

set local role postgres;
select isnt(
  :'organizer_one_reauthorized_job_id'::uuid,
  :'organizer_one_job_id'::uuid,
  'a newly authorized organizer receives a new export generation'
);
select is(
  (
    select state
      from private.export_jobs
     where id = :'organizer_one_job_id'::uuid
  ),
  'invalidated',
  'the stale queued generation becomes terminally invalidated'
);
select is(
  (
    select count(*)::bigint
      from private.audit_events
     where event_type = 'export_invalidated'
       and subject_id = :'organizer_one_job_id'::uuid
  ),
  1::bigint,
  'stale-generation invalidation creates one content-free audit event'
);
select ok(
  private.export_job_requester_is_authorized(
    :'organizer_one_reauthorized_job_id'::uuid
  ),
  'only the newly captured organizer generation is worker eligible'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.request_family_export(
  '20000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000010'
) as job_id \gset organizer_two_

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.revoke_membership(
  '40000000-0000-4000-8000-000000000002'
);

set local role postgres;
select ok(
  not private.export_job_requester_is_authorized(
    :'organizer_two_job_id'::uuid
  ),
  'membership revocation immediately closes future export processing authority'
);

select is(
  (
    select count(*)::bigint
      from private.export_jobs as job
     where job.id = :'organizer_two_job_id'::uuid
  ),
  1::bigint,
  'revocation preserves the immutable request for audit and reconciliation'
);

select is(
  (
    select state
      from private.export_jobs
     where id = :'organizer_two_job_id'::uuid
  ),
  'invalidated',
  'membership revocation terminally invalidates its queued export'
);

select is(
  (
    select count(*)::bigint
      from private.audit_events
     where event_type = 'export_invalidated'
       and subject_id = :'organizer_two_job_id'::uuid
  ),
  1::bigint,
  'revocation invalidates the export exactly once in audit history'
);

update public.circle_memberships
   set status = 'active',
       role = 'organizer',
       revoked_at = null,
       revoked_by_membership_id = null
 where id = '40000000-0000-4000-8000-000000000002';
select ok(
  not private.export_job_requester_is_authorized(
    :'organizer_two_job_id'::uuid
  ),
  'restoring a revoked organizer never resurrects terminally invalidated work'
);

select * from finish();
rollback;
