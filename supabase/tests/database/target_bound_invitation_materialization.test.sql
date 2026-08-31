begin;

select no_plan();

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'invitation_jobs'
       and column_name in (
         'expires_at', 'delivery_version', 'materialized_at',
         'invitation_id', 'invalidation_reason'
       )
  ),
  array[
    'expires_at', 'delivery_version', 'materialized_at',
    'invitation_id', 'invalidation_reason'
  ]::text[],
  'the job ledger has the bounded materialization state fields'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'invitations'
       and column_name in (
         'invitation_job_id', 'target_auth_user_id',
         'target_email_confirmed_at', 'recipient_binding'
       )
  ),
  array[
    'invitation_job_id', 'target_auth_user_id',
    'target_email_confirmed_at', 'recipient_binding'
  ]::text[],
  'materialized invitations carry an exact Auth target and recipient binding'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%queued%materialized%invalidated%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitation_jobs_state_valid'
  ),
  'the job state machine is queued, materialized, or invalidated'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_class as class
     where class.relname = 'invitation_jobs_one_live_per_target_idx'
       and class.relkind = 'i'
  ),
  'one circle and target can have only one live job'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like 'FOREIGN KEY (circle_id, invitation_job_id, target_auth_user_id) REFERENCES private.invitation_jobs(circle_id, id, target_auth_user_id)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitations_invitation_job_fkey'
       and constraint_row.conrelid = 'private.invitations'::regclass
  ),
  'the invitation foreign key structurally pins the circle, job, and target Auth UUID'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like 'FOREIGN KEY (circle_id, id, invitation_id) REFERENCES private.invitations(circle_id, invitation_job_id, id)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitation_jobs_reciprocal_invitation_fkey'
       and constraint_row.conrelid = 'private.invitation_jobs'::regclass
  ),
  'the job foreign key reciprocally pins the circle, job, and invitation'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%actor_membership_id IS NOT NULL%invitation_job_invalidated%invitation_job%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'audit_events_nullable_actor_scope_valid'
       and constraint_row.conrelid = 'private.audit_events'::regclass
  ),
  'only invitation-job invalidation audits may have a system NULL actor'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.materialize_target_bound_invitation_job(uuid,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.materialize_target_bound_invitation_job(uuid,integer,text)',
    'EXECUTE'
  ),
  'the local materialization seam is ungranted to browser and service roles'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.load_target_bound_invitation_job(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.load_target_bound_invitation_job(uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.invalidate_target_bound_invitation_job(uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'load and invalidation seams remain private and ungranted'
);

select is(
  (
    select
      (
        select count(*)
          from unnest(array[
            'private.load_target_bound_invitation_job(uuid)'::regprocedure,
            'private.materialize_target_bound_invitation_job(uuid,integer,text)'::regprocedure,
            'private.invalidate_target_bound_invitation_job(uuid,text,uuid,uuid)'::regprocedure
          ]) as routine(oid)
          join pg_catalog.pg_proc as procedure on procedure.oid = routine.oid
          cross join lateral pg_catalog.aclexplode(coalesce(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )) as privilege
         where privilege.grantee = 0
           and privilege.privilege_type = 'EXECUTE'
      )
      +
      (
        select count(*)
          from (values ('anon'), ('authenticated'), ('service_role'))
            as role_name(name)
          cross join (values
            ('private.load_target_bound_invitation_job(uuid)'),
            ('private.materialize_target_bound_invitation_job(uuid,integer,text)'),
            ('private.invalidate_target_bound_invitation_job(uuid,text,uuid,uuid)')
          ) as routine(signature)
         where has_function_privilege(role_name.name, routine.signature, 'EXECUTE')
      )
  ),
  0::bigint,
  'the exact private worker seam matrix denies PUBLIC, anon, authenticated, and service_role'
);

select is(
  (
    select count(*)::bigint
      from (values
        ('private.load_target_bound_invitation_job(uuid)'),
        ('private.materialize_target_bound_invitation_job(uuid,integer,text)'),
        ('private.invalidate_target_bound_invitation_job(uuid,text,uuid,uuid)')
      ) as routine(signature)
     where has_function_privilege('postgres', routine.signature, 'EXECUTE')
  ),
  3::bigint,
  'the database owner retains all three local worker seams'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'private.materialize_target_bound_invitation_job(uuid,integer,text)'::regprocedure
  ),
  'materialization is security-definer with a fixed empty search path'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.create_invitation(uuid,text,text,uuid)',
    'EXECUTE'
  )
  and has_function_privilege(
    'anon',
    'public.preflight_invitation(text,text)',
    'EXECUTE'
  ),
  'legacy local create and preflight ACLs remain explicitly isolated and unchanged'
);

set local timezone to 'UTC';
select encode(private.invitation_recipient_binding(
  '10000000-0000-4000-8000-000000000031',
  'Target@Example.Test',
  '2026-08-30 12:34:56.123456+00'::timestamptz
), 'hex') as binding \gset utc_
set local timezone to 'America/Los_Angeles';
select is(
  encode(private.invitation_recipient_binding(
    '10000000-0000-4000-8000-000000000031',
    'target@example.test',
    '2026-08-30 12:34:56.123456+00'::timestamptz
  ), 'hex'),
  :'utc_binding'::text,
  'recipient binding is canonical across session timezones and email case'
);

reset timezone;

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000031', 'target-bound-one@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000032', 'wrong-target@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000033', 'target-authority-loss@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000034', 'target-binding-drift@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000035', 'target-detached@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000036', 'target-load-retry@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000037', 'target-withdrawal@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000038', 'target-expiry@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000039', 'target-closure@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000040', 'target-activation@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000041', 'target-accept-replay@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000042', 'target-cross-link@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000043', 'requester-closure-organizer@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000044', 'target-requester-closure@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000045', 'target-direct-expiry@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000046', 'target-load-closure@example.test', statement_timestamp(), '{}');

select 'token-' || repeat('a', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('a', 40), 'sha256'), 'hex') as token_hash
  \gset target_one_
select 'token-' || repeat('b', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('b', 40), 'sha256'), 'hex') as token_hash
  \gset authority_loss_
select 'token-' || repeat('c', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('c', 40), 'sha256'), 'hex') as token_hash
  \gset binding_drift_
select 'token-' || repeat('d', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('d', 40), 'sha256'), 'hex') as token_hash
  \gset detached_
select 'token-' || repeat('e', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('e', 40), 'sha256'), 'hex') as token_hash
  \gset load_retry_
select 'token-' || repeat('f', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('f', 40), 'sha256'), 'hex') as token_hash
  \gset withdrawal_
select 'token-' || repeat('g', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('g', 40), 'sha256'), 'hex') as token_hash
  \gset target_closure_
select 'token-' || repeat('h', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('h', 40), 'sha256'), 'hex') as token_hash
  \gset activation_
select 'token-' || repeat('i', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('i', 40), 'sha256'), 'hex') as token_hash
  \gset accept_replay_
select 'token-' || repeat('j', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('j', 40), 'sha256'), 'hex') as token_hash
  \gset cross_link_
select 'token-' || repeat('k', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('k', 40), 'sha256'), 'hex') as token_hash
  \gset requester_closure_
select 'token-' || repeat('l', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('l', 40), 'sha256'), 'hex') as token_hash
  \gset direct_expiry_
select 'token-' || repeat('m', 40) as raw_token,
       encode(extensions.digest('token-' || repeat('m', 40), 'sha256'), 'hex') as token_hash
  \gset load_closure_

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000031',
  'Target One',
  '92000000-0000-4000-8000-000000000001'
) as job_id \gset target_one_job_

reset role;
select is(
  (select expires_at from private.invitation_jobs where id = :'target_one_job_job_id'::uuid),
  (select requested_at + interval '48 hours' from private.invitation_jobs where id = :'target_one_job_job_id'::uuid),
  'new jobs preserve the existing 48-hour invitation lifetime'
);

select * from private.materialize_target_bound_invitation_job(
  :'target_one_job_job_id'::uuid, 1, :'target_one_token_hash'
) \gset target_one_materialized_

select is(:'target_one_materialized_state'::text, 'materialized'::text,
  'an authorized queued job materializes atomically');
select is(
  (select target_auth_user_id from private.invitations
    where id = :'target_one_materialized_invitation_id'::uuid),
  '10000000-0000-4000-8000-000000000031'::uuid,
  'the invitation is bound to the exact target Auth UUID'
);
select is(
  (select invitation_id from private.invitation_jobs
    where id = :'target_one_job_job_id'::uuid),
  :'target_one_materialized_invitation_id'::uuid,
  'job and invitation are linked in both directions'
);
select is(
  (
    select count(*)::bigint
      from private.materialize_target_bound_invitation_job(
        :'target_one_job_job_id'::uuid, 1, :'target_one_token_hash'
      )
  ),
  1::bigint,
  'exact materialization replay returns the existing result'
);
select is(
  (
    select count(*)::bigint
      from private.materialize_target_bound_invitation_job(
        :'target_one_job_job_id'::uuid, 1, repeat('f', 64)
      )
  ),
  0::bigint,
  'a materialized job rejects a mismatched token digest without mutation'
);
select is(
  (select state from private.invitation_jobs where id = :'target_one_job_job_id'::uuid),
  'materialized',
  'mismatched replay leaves the valid materialization live'
);

-- Give the wrong Auth UUID the exact invited address while moving the real
-- target aside. Email defense-in-depth now matches the wrong account, but UUID
-- binding must still deny it without consuming or invalidating the invitation.
update auth.users set email = 'target-bound-one-moved@example.test'
 where id = '10000000-0000-4000-8000-000000000031';
update auth.users set email = 'target-bound-one@example.test'
 where id = '10000000-0000-4000-8000-000000000032';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000032', true);
select is(
  public.accept_invitation(:'target_one_raw_token'),
  null::uuid,
  'the same invited email on the wrong Auth UUID is denied generically'
);

reset role;
select is(
  (select state from private.invitation_jobs where id = :'target_one_job_job_id'::uuid),
  'materialized',
  'wrong-UUID probing does not consume or invalidate the target invitation'
);
update auth.users set email = 'wrong-target@example.test'
 where id = '10000000-0000-4000-8000-000000000032';
update auth.users set email = 'target-bound-one@example.test'
 where id = '10000000-0000-4000-8000-000000000031';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000031', true);
select public.accept_invitation(:'target_one_raw_token') as membership_id
  \gset accepted_
select isnt(:'accepted_membership_id'::uuid, null::uuid,
  'the exact target Auth account can accept the target-bound invitation');

reset role;
select is(
  (select state from private.invitation_jobs where id = :'target_one_job_job_id'::uuid),
  'invalidated',
  'successful acceptance terminalizes the materialized job'
);
select is(
  (select invalidation_reason from private.invitation_jobs where id = :'target_one_job_job_id'::uuid),
  'target_accepted',
  'successful acceptance records a constrained terminal reason'
);
select ok(
  (select accepted_at is not null and revoked_at is null
    from private.invitations where id = :'target_one_materialized_invitation_id'::uuid),
  'acceptance terminalizes without revoking the consumed invitation'
);

-- A separately materialized invitation must be revoked with its job when the
-- exact requester organizer generation loses authority.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000033',
  'Authority Loss',
  '92000000-0000-4000-8000-000000000002'
) as job_id \gset authority_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'authority_job_job_id'::uuid, 1, :'authority_loss_token_hash'
) \gset authority_materialized_
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.set_membership_role('40000000-0000-4000-8000-000000000002', 'member');
reset role;
select is(
  (select state from private.invitation_jobs where id = :'authority_job_job_id'::uuid),
  'invalidated',
  'requester demotion terminalizes a materialized job'
);
select is(
  (select invalidation_reason from private.invitation_jobs where id = :'authority_job_job_id'::uuid),
  'requester_authority_lost',
  'demotion records requester authority loss'
);
select ok(
  (select revoked_at is not null and revocation_reason = 'requester_authority_lost'
    from private.invitations where id = :'authority_materialized_invitation_id'::uuid),
  'requester demotion atomically revokes the linked bearer invitation'
);

-- Recipient binding drift is an intentional durable invalidation path. The
-- function returns NULL rather than raising, so both terminal writes commit.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000034',
  'Binding Drift',
  '92000000-0000-4000-8000-000000000003'
) as job_id \gset binding_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'binding_job_job_id'::uuid, 1, :'binding_drift_token_hash'
) \gset binding_materialized_
update auth.users set email = 'target-binding-changed@example.test'
 where id = '10000000-0000-4000-8000-000000000034';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000034', true);
select is(public.accept_invitation(:'binding_drift_raw_token'), null::uuid,
  'recipient-binding drift returns a generic NULL denial');
reset role;
select is(
  (select state from private.invitation_jobs where id = :'binding_job_job_id'::uuid),
  'invalidated',
  'NULL denial commits durable job invalidation'
);
select is(
  (select invalidation_reason from private.invitation_jobs where id = :'binding_job_job_id'::uuid),
  'target_identity_changed',
  'binding drift records its constrained reason'
);
select ok(
  (select revoked_at is not null and revocation_reason = 'target_identity_changed'
    from private.invitations where id = :'binding_materialized_invitation_id'::uuid),
  'binding drift commits paired invitation revocation'
);

-- A retained account person whose membership has already been detached from
-- Auth cannot be silently reattached by invitation acceptance.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000035',
  'Detached Target',
  '92000000-0000-4000-8000-000000000004'
) as job_id \gset detached_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'detached_job_job_id'::uuid, 1, :'detached_token_hash'
) \gset detached_materialized_
insert into public.circle_memberships (
  id, circle_id, user_id, person_id, role, status,
  revoked_at, revoked_by_membership_id
) values (
  '40000000-0000-4000-8000-000000000035',
  '20000000-0000-4000-8000-000000000001',
  null,
  (select person_id from private.invitations
    where id = :'detached_materialized_invitation_id'::uuid),
  'member',
  'revoked',
  statement_timestamp(),
  '40000000-0000-4000-8000-000000000001'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000035', true);
select is(public.accept_invitation(:'detached_raw_token'), null::uuid,
  'a detached retained-person target is denied generically');
reset role;
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = :'detached_job_job_id'::uuid),
  'target_unavailable',
  'detached retained-person denial commits target-unavailable invalidation'
);
select ok(
  (select revoked_at is not null and revocation_reason = 'target_unavailable'
    from private.invitations
   where id = :'detached_materialized_invitation_id'::uuid),
  'detached retained-person denial revokes the paired invitation'
);
select is(
  (
    select count(*)::bigint
      from private.audit_events
     where event_type = 'invitation_job_invalidated'
       and subject_type = 'invitation_job'
       and subject_id = :'detached_job_job_id'::uuid
  ),
  1::bigint,
  'detached retained-person invalidation records exactly one audit event'
);

-- A materialized job remains an authorized, loadable lost-response retry.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000036',
  'Load Retry',
  '92000000-0000-4000-8000-000000000005'
) as job_id \gset load_retry_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'load_retry_job_job_id'::uuid, 1, :'load_retry_token_hash'
) \gset load_retry_materialized_
select is(
  (select state from private.load_target_bound_invitation_job(
    :'load_retry_job_job_id'::uuid
  )),
  'materialized',
  'authorized load returns a live materialized lost-response retry'
);
select ok(
  private.invitation_job_requester_is_authorized(
    :'load_retry_job_job_id'::uuid
  ),
  'the shared requester-authority predicate recognizes a live materialized job'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000036',
    'Load Retry',
    '92000000-0000-4000-8000-000000000005'
  ),
  :'load_retry_job_job_id'::uuid,
  'an exact request-key replay returns the existing materialized job'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000036',
    'Conflicting Load Retry',
    '92000000-0000-4000-8000-000000000005'
  )$$,
  '22023',
  'Invitation delivery could not be requested',
  'materialized idempotency-key conflict preserves the established exception contract'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000036',
    'Conflicting Target Label',
    '92000000-0000-4000-8000-000000000016'
  )$$,
  '22023',
  'Invitation delivery could not be requested',
  'live target-label conflict preserves the established exception contract'
);
reset role;

-- Materialize a second live job and prove that the reciprocal composite FK,
-- independently of the integrity trigger, rejects a cross-linked invitation.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000042',
  'Cross Link',
  '92000000-0000-4000-8000-000000000006'
) as job_id \gset cross_link_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'cross_link_job_job_id'::uuid, 1, :'cross_link_token_hash'
) \gset cross_link_materialized_
alter table private.invitation_jobs disable trigger invitation_jobs_integrity;
alter table private.invitation_jobs
  drop constraint invitation_jobs_invitation_unique;
select throws_ok(
  format(
    'update private.invitation_jobs set invitation_id = %L where id = %L',
    :'cross_link_materialized_invitation_id',
    :'load_retry_job_job_id'
  ),
  '23503',
  'insert or update on table "invitation_jobs" violates foreign key constraint "invitation_jobs_reciprocal_invitation_fkey"',
  'the reciprocal composite FK rejects a cross-job invitation link'
);
alter table private.invitation_jobs
  add constraint invitation_jobs_invitation_unique unique (invitation_id);
alter table private.invitation_jobs enable trigger invitation_jobs_integrity;

-- Direct organizer withdrawal of the invitation must terminalize the job with
-- the organizer as the exact actor, and neither side may remain live.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000037',
  'Withdrawal',
  '92000000-0000-4000-8000-000000000007'
) as job_id \gset withdrawal_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'withdrawal_job_job_id'::uuid, 1, :'withdrawal_token_hash'
) \gset withdrawal_materialized_
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.revoke_invitation(:'withdrawal_materialized_invitation_id'::uuid);
reset role;
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = :'withdrawal_job_job_id'::uuid),
  'organizer_withdrawn',
  'direct invitation withdrawal terminalizes the linked job'
);
select ok(
  (select revoked_at is not null and revocation_reason = 'organizer_withdrawn'
    from private.invitations
   where id = :'withdrawal_materialized_invitation_id'::uuid),
  'direct organizer withdrawal records the exact invitation reason'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = :'withdrawal_job_job_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'organizer withdrawal audit attributes the acting organizer exactly'
);
select throws_ok(
  format(
    'update private.invitation_jobs set state = ''materialized'', invalidated_at = null, invalidated_by_membership_id = null, invalidated_by_closure_request_id = null, invalidation_reason = null where id = %L',
    :'withdrawal_job_job_id'
  ),
  '42501',
  'Invitation job identity is immutable',
  'a terminalized target-bound job cannot be resurrected'
);

-- An expired live row is swept before idempotency lookup so a fresh key can
-- replace it; expiry is a system event and therefore has no fabricated actor.
insert into private.invitation_jobs (
  id, circle_id, requested_by_membership_id,
  requester_authorization_version, target_auth_user_id,
  invited_display_name, request_key, requested_at, expires_at
) values (
  '91000000-0000-4000-8000-000000000038',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  (select updated_at from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000038',
  'Expiry Replacement',
  '92000000-0000-4000-8000-000000000008',
  statement_timestamp() - interval '49 hours',
  statement_timestamp() - interval '1 hour'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000038',
  'Expiry Replacement',
  '92000000-0000-4000-8000-000000000009'
) as job_id \gset expiry_replacement_
reset role;
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = '91000000-0000-4000-8000-000000000038'),
  'expired',
  'request sweep terminalizes an expired live job'
);
select isnt(
  :'expiry_replacement_job_id'::uuid,
  '91000000-0000-4000-8000-000000000038'::uuid,
  'a fresh request key creates a replacement after expiry terminalization'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = '91000000-0000-4000-8000-000000000038'),
  null::uuid,
  'system expiry audit does not impersonate the requester'
);

-- Direct closure revocation also flows invitation -> job and retains the exact
-- closure identifier while keeping the audit actor NULL.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000039',
  'Target Closure',
  '92000000-0000-4000-8000-000000000010'
) as job_id \gset target_closure_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'target_closure_job_job_id'::uuid, 1, :'target_closure_token_hash'
) \gset target_closure_materialized_
insert into private.account_closure_requests (
  id, auth_user_id, request_key
) values (
  '93000000-0000-4000-8000-000000000039',
  '10000000-0000-4000-8000-000000000039',
  '94000000-0000-4000-8000-000000000039'
);
update private.invitations
   set revoked_at = statement_timestamp(),
       revoked_by_closure_request_id = '93000000-0000-4000-8000-000000000039'
 where id = :'target_closure_materialized_invitation_id'::uuid;
select ok(
  (select state = 'invalidated'
      and invalidation_reason = 'account_closure'
      and invalidated_by_closure_request_id =
        '93000000-0000-4000-8000-000000000039'::uuid
    from private.invitation_jobs
   where id = :'target_closure_job_job_id'::uuid),
  'direct target closure revocation terminalizes the job with the exact closure'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = :'target_closure_job_job_id'::uuid),
  null::uuid,
  'closure invalidation audit has no fabricated membership actor'
);

-- Target activation is an explicit membership action and revokes both sides.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000040',
  'Activation',
  '92000000-0000-4000-8000-000000000011'
) as job_id \gset activation_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'activation_job_job_id'::uuid, 1, :'activation_token_hash'
) \gset activation_materialized_
insert into public.circle_memberships (
  id, circle_id, user_id, person_id, role, status
) values (
  '40000000-0000-4000-8000-000000000040',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000040',
  (select person_id from private.invitations
    where id = :'activation_materialized_invitation_id'::uuid),
  'member', 'active'
);
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = :'activation_job_job_id'::uuid),
  'target_became_active',
  'target activation terminalizes the materialized job'
);
select ok(
  (select revoked_at is not null and revocation_reason = 'target_became_active'
    from private.invitations
   where id = :'activation_materialized_invitation_id'::uuid),
  'target activation revokes the linked pending invitation'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = :'activation_job_job_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'target activation audit attributes the organizer performing activation'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000040',
    'Already Active Again',
    '92000000-0000-4000-8000-000000000017'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'pure already-active denial preserves the established authorization exception'
);
reset role;

-- Acceptance is terminal and replay-safe, with one exact acceptor-attributed
-- invalidation audit and no invitation revocation.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000041',
  'Accept Replay',
  '92000000-0000-4000-8000-000000000012'
) as job_id \gset accept_replay_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'accept_replay_job_job_id'::uuid, 1, :'accept_replay_token_hash'
) \gset accept_replay_materialized_
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000041', true);
select public.accept_invitation(:'accept_replay_raw_token') as membership_id
  \gset accept_replay_result_
select is(
  public.accept_invitation(:'accept_replay_raw_token'),
  null::uuid,
  'accepted target-bound invitation replay returns generic NULL'
);
reset role;
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = :'accept_replay_job_job_id'::uuid),
  'target_accepted',
  'first acceptance terminalizes the job as target accepted'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = :'accept_replay_job_job_id'::uuid),
  :'accept_replay_result_membership_id'::uuid,
  'acceptance invalidation audit attributes the accepting membership'
);
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = :'accept_replay_job_job_id'::uuid),
  1::bigint,
  'acceptance and replay retain exactly one job invalidation audit'
);

-- Exercise the actual legacy create-invitation expiry sweep. The legacy sweep
-- supplies the organizer as revoker, but an expired target-bound invitation is
-- normalized to an actorless expiry before reciprocal job terminalization.
insert into public.people (
  id, circle_id, display_name, profile_kind, created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000045',
  '20000000-0000-4000-8000-000000000001',
  'Legacy Sweep Target', 'account',
  '40000000-0000-4000-8000-000000000001'
);
insert into private.invitation_jobs (
  id, circle_id, requested_by_membership_id,
  requester_authorization_version, target_auth_user_id,
  invited_display_name, request_key, requested_at, expires_at
) values (
  '91000000-0000-4000-8000-000000000045',
  '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  (select updated_at from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000045',
  'Legacy Sweep Target',
  '92000000-0000-4000-8000-000000000013',
  statement_timestamp() - interval '49 hours',
  statement_timestamp() - interval '1 hour'
);
with salt as (
  select extensions.gen_random_bytes(16) as value
)
insert into private.invitations (
  id, circle_id, person_id, created_by_membership_id,
  token_hash, email_salt, email_hash, created_at, expires_at,
  invitation_job_id, target_auth_user_id,
  target_email_confirmed_at, recipient_binding
)
select
  '96000000-0000-4000-8000-000000000045',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000045',
  '40000000-0000-4000-8000-000000000001',
  decode(:'direct_expiry_token_hash', 'hex'),
  salt.value,
  extensions.digest(
    pg_catalog.convert_to('target-direct-expiry@example.test', 'UTF8')
      || salt.value,
    'sha256'
  ),
  statement_timestamp() - interval '49 hours',
  statement_timestamp() - interval '1 hour',
  '91000000-0000-4000-8000-000000000045',
  '10000000-0000-4000-8000-000000000045',
  target.email_confirmed_at,
  private.invitation_recipient_binding(
    target.id, lower(btrim(target.email)), target.email_confirmed_at
  )
from salt
join auth.users as target
  on target.id = '10000000-0000-4000-8000-000000000045';
update private.invitation_jobs
   set state = 'materialized',
       materialized_at = statement_timestamp(),
       invitation_id = '96000000-0000-4000-8000-000000000045'
 where id = '91000000-0000-4000-8000-000000000045';
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select * from public.create_invitation(
  '20000000-0000-4000-8000-000000000001',
  'Legacy Sweep Trigger',
  'legacy-sweep-trigger@example.test'
) \gset legacy_sweep_created_
reset role;
select ok(
  (select revocation_reason = 'expired'
      and revoked_by_membership_id is null
      and revoked_by_closure_request_id is null
    from private.invitations
   where id = '96000000-0000-4000-8000-000000000045'),
  'legacy sweep records target-bound expiry without an organizer revoker'
);
select ok(
  (select invalidation_reason = 'expired'
      and invalidated_by_membership_id is null
      and invalidated_by_closure_request_id is null
    from private.invitation_jobs
   where id = '91000000-0000-4000-8000-000000000045'),
  'legacy expiry sweep terminalizes the linked job as a system event'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = '91000000-0000-4000-8000-000000000045'),
  null::uuid,
  'legacy expiry sweep job audit does not impersonate the organizer'
);

-- Locked load reconciliation durably terminalizes a target closure.
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000046',
  'Load Closure',
  '92000000-0000-4000-8000-000000000014'
) as job_id \gset load_closure_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'load_closure_job_job_id'::uuid, 1, :'load_closure_token_hash'
) \gset load_closure_materialized_
insert into private.account_closure_requests (
  id, auth_user_id, request_key
) values (
  '93000000-0000-4000-8000-000000000046',
  '10000000-0000-4000-8000-000000000046',
  '94000000-0000-4000-8000-000000000046'
);
select is(
  (select count(*)::bigint from private.load_target_bound_invitation_job(
    :'load_closure_job_job_id'::uuid
  )),
  0::bigint,
  'load returns no row after reconciling target closure'
);
select ok(
  (select invalidation_reason = 'account_closure'
      and invalidated_by_closure_request_id =
        '93000000-0000-4000-8000-000000000046'::uuid
    from private.invitation_jobs
   where id = :'load_closure_job_job_id'::uuid),
  'load reconciliation commits exact target-closure terminalization'
);

-- Requester closure preparation must also terminalize a materialized job with
-- closure attribution, even though the retained membership detaches afterward.
insert into public.people (
  id, circle_id, display_name, profile_kind, created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000043',
  '20000000-0000-4000-8000-000000000001',
  'Closure Organizer', 'account',
  '40000000-0000-4000-8000-000000000001'
);
insert into public.circle_memberships (
  id, circle_id, user_id, person_id, role, status
) values (
  '40000000-0000-4000-8000-000000000043',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000043',
  '30000000-0000-4000-8000-000000000043',
  'organizer', 'active'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000043', true);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000044',
  'Requester Closure',
  '92000000-0000-4000-8000-000000000015'
) as job_id \gset requester_closure_job_
reset role;
select * from private.materialize_target_bound_invitation_job(
  :'requester_closure_job_job_id'::uuid, 1, :'requester_closure_token_hash'
) \gset requester_closure_materialized_
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000043', true);
select public.request_account_closure(
  '95000000-0000-4000-8000-000000000043'
) as closure_id \gset requester_closure_request_
reset role;
select private.prepare_account_closure(
  :'requester_closure_request_closure_id'::uuid
);
select ok(
  (select invalidation_reason = 'account_closure'
      and invalidated_by_closure_request_id =
        :'requester_closure_request_closure_id'::uuid
    from private.invitation_jobs
   where id = :'requester_closure_job_job_id'::uuid),
  'requester closure preparation terminalizes a materialized job with closure attribution'
);
select ok(
  (select revoked_at is not null and revocation_reason = 'account_closure'
    from private.invitations
   where id = :'requester_closure_materialized_invitation_id'::uuid),
  'requester closure preparation revokes the linked invitation'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'invitation_job_invalidated'
      and subject_id = :'requester_closure_job_job_id'::uuid),
  null::uuid,
  'requester closure audit does not impersonate the closing organizer'
);

select * from finish();
rollback;
