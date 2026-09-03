begin;

select no_plan();

select is(
  (select count(*)::bigint from pg_class
    where oid in (
      'private.invitation_provisioner_allowlist'::regclass,
      'private.invitation_delivery_capabilities'::regclass,
      'private.invitation_delivery_worker_allowlist'::regclass,
      'private.invitation_email_requests'::regclass,
      'private.invitation_delivery_receipts'::regclass,
      'private.invitation_coordination_audit_events'::regclass
    ) and relrowsecurity and relforcerowsecurity),
  6::bigint,
  'every Phase 2D private ledger enables and forces RLS'
);

select is(
  (select count(*)::bigint from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name in (
        'invitation_provisioner_allowlist',
        'invitation_delivery_capabilities',
        'invitation_delivery_worker_allowlist',
        'invitation_email_requests', 'invitation_delivery_receipts',
        'invitation_coordination_audit_events'
      )
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  0::bigint,
  'ordinary web and service roles cannot read or mutate coordinator ledgers'
);

select is(
  (select enabled from private.invitation_delivery_capabilities
    where capability = 'email_delivery'),
  true,
  'the invitation delivery capability is enabled for organizer sending'
);

set local role service_role;
select throws_ok(
  $$select * from private.invitation_delivery_capabilities$$,
  '42501', 'permission denied for table invitation_delivery_capabilities',
  'service_role cannot read the private delivery capability'
);
select throws_ok(
  $$update private.invitation_delivery_capabilities set enabled = true$$,
  '42501', 'permission denied for table invitation_delivery_capabilities',
  'service_role cannot enable invitation delivery'
);
reset role;

select is(
  (select count(*)::bigint from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'invitation_email_requests', 'invitation_delivery_receipts',
        'invitation_coordination_audit_events'
      )
      and (
        column_name ~ '(^|_)(raw_)?token($|_)'
        or column_name ~ 'action_url|plaintext'
      )
      and data_type in ('text', 'character varying')),
  0::bigint,
  'no coordinator ledger has a plaintext token or action-URL column'
);

select is(
  (select data_type::text from information_schema.columns
    where table_schema = 'private'
      and table_name = 'invitation_delivery_receipts'
      and column_name = 'token_sha256'),
  'bytea'::text,
  'delivery receipts retain only the invitation token digest'
);

select ok(
  (select condeferrable and condeferred from pg_constraint
    where conname = 'invitation_jobs_email_request_target_fkey')
  and (select condeferrable and condeferred from pg_constraint
    where conname = 'invitation_email_requests_job_fkey'),
  'the reciprocal request/job identity is checked by deferred exact FKs'
);

select ok(
  not exists (
    select 1 from pg_constraint
     where conrelid = 'private.invitation_email_requests'::regclass
       and conname = 'invitation_email_requests_target_fkey'
  ),
  'the replaceable target Auth UUID is durable evidence, not a restrictive FK'
);

select ok(
  (select pg_get_constraintdef(oid) from pg_constraint
    where conname = 'invitation_email_requests_state_valid')
    like '%queued%provisioned%delivered%accepted%invalidated%',
  'email intents have one monotonic bounded state machine'
);

select ok(
  exists (select 1 from pg_indexes
    where schemaname = 'private'
      and indexname = 'invitation_email_requests_one_live_email_idx'
      and indexdef like '%circle_id, normalized_email%'),
  'only one live request may target an email within a circle'
);

select is(
  (select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'invitation_coordination_audit_events'
      and column_name in (
        'normalized_email', 'provider_message_id', 'token_sha256',
        'payload_sha256', 'recipient_binding'
      )),
  null::text[],
  'coordination audit events are content-free'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.request_invitation_email(uuid,text,text,uuid)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.list_pending_invitation_email_requests(uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.request_invitation_email(uuid,text,text,uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role',
    'public.request_invitation_email(uuid,text,text,uuid)', 'EXECUTE'
  ),
  'organizer email coordinators are authenticated-only'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.sweep_expired_invitation_email_requests(integer)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.sweep_expired_invitation_email_requests(integer)', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role',
    'public.sweep_expired_invitation_email_requests(integer)', 'EXECUTE'
  ),
  'the bounded expiry sweep is authenticated-only before worker checks'
);

select is(
  (select count(*)::bigint
    from (values
      ('public.create_invitation(uuid,text,text,uuid)'),
      ('public.preflight_invitation(text,text)'),
      ('public.request_invitation_job(uuid,uuid,text,uuid)')
    ) as routine(signature)
    cross join (values
      ('anon'), ('authenticated'), ('service_role')
    ) as denied(role_name)
    where has_function_privilege(
      denied.role_name, routine.signature, 'EXECUTE'
    )),
  0::bigint,
  'legacy create, preflight, and job-request RPC execution is retired'
);

select ok(
  position(
    'private.accept_phase_2d_invitation' in pg_get_functiondef(
      'private.accept_invitation_dispatch(text)'::regprocedure
    )
  ) > 0
  and position(
    'private.accept_invitation(invitation_token)' in pg_get_functiondef(
      'private.accept_invitation_dispatch(text)'::regprocedure
    )
  ) = 0,
  'the public acceptance dispatch is Phase 2D-only'
);

select is(
  (select count(*)::bigint
    from (values
      ('public.load_invitation_email_request(uuid)'),
      ('public.complete_invitation_email_provisioning(uuid,uuid)'),
      ('public.load_invitation_delivery_job(uuid)'),
      ('public.materialize_invitation_delivery_job(uuid,integer,text)'),
      ('public.read_invitation_delivery_auth(uuid)'),
      ('public.complete_invitation_delivery(uuid,uuid,integer,text,text,text,text,text,text,timestamptz)'),
      ('public.read_delivered_invitation(uuid)')
    ) as routine(signature)
    cross join (values ('anon'), ('service_role')) as denied(role_name)
    where has_function_privilege(
      denied.role_name, routine.signature, 'EXECUTE'
    )),
  0::bigint,
  'anon and service_role have no coordinator execution path'
);

select is(
  (select count(*)::bigint
    from (values
      ('private.load_invitation_email_request(uuid)'),
      ('private.complete_invitation_email_provisioning(uuid,uuid)'),
      ('private.load_invitation_delivery_job(uuid)'),
      ('private.materialize_invitation_delivery_job(uuid,integer,text)'),
      ('private.read_invitation_delivery_auth(uuid)'),
      ('private.complete_invitation_delivery(uuid,uuid,integer,text,text,text,text,text,text,timestamptz)'),
      ('private.read_delivered_invitation(uuid)')
    ) as routine(signature)
    cross join (values ('anon'), ('authenticated'), ('service_role'))
      as denied(role_name)
    where has_function_privilege(
      denied.role_name, routine.signature, 'EXECUTE'
    )),
  0::bigint,
  'no web or service role can bypass a public coordinator wrapper'
);

select ok(
  (select bool_and(prosecdef and 'search_path=""' = any(proconfig))
    from pg_proc
    where oid in (
      'public.request_invitation_email(uuid,text,text,uuid)'::regprocedure,
      'public.load_invitation_email_request(uuid)'::regprocedure,
      'public.complete_invitation_email_provisioning(uuid,uuid)'::regprocedure,
      'public.load_invitation_delivery_job(uuid)'::regprocedure,
      'public.materialize_invitation_delivery_job(uuid,integer,text)'::regprocedure,
      'public.read_invitation_delivery_auth(uuid)'::regprocedure,
      'public.complete_invitation_delivery(uuid,uuid,integer,text,text,text,text,text,text,timestamptz)'::regprocedure,
      'public.read_delivered_invitation(uuid)'::regprocedure,
      'public.sweep_expired_invitation_email_requests(integer)'::regprocedure
    )),
  'every Data API coordinator is security-definer with an empty search path'
);

select is(
  (select array_agg(column_name::text order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'list_pending_invitation_email_requests'
      and false),
  null::text[],
  'pending email requests are exposed only through an RPC, not a public relation'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000071', 'invite-provisioner@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000072', 'invite-delivery@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000073', 'invite-outsider@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000074', 'new-unconfirmed@example.test', null, '{}'),
  ('10000000-0000-4000-8000-000000000075', 'existing-confirmed@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000076', 'second-provisioner@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000077', 'second-delivery@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000078', 'worker-family-probe@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000081', 'wrong-target@example.test', null, '{}'),
  ('10000000-0000-4000-8000-000000000082', 'photo-validator@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000083', 'expired-target@example.test', null, '{}');

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('71000000-0000-4000-8000-000000000071', '10000000-0000-4000-8000-000000000071', statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('71000000-0000-4000-8000-000000000072', '10000000-0000-4000-8000-000000000072', statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('71000000-0000-4000-8000-000000000076', '10000000-0000-4000-8000-000000000076', statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('71000000-0000-4000-8000-000000000077', '10000000-0000-4000-8000-000000000077', statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('71000000-0000-4000-8000-000000000079', '10000000-0000-4000-8000-000000000071', statement_timestamp() - interval '2 days', statement_timestamp() - interval '1 day', statement_timestamp() - interval '1 hour'),
  ('71000000-0000-4000-8000-000000000080', '10000000-0000-4000-8000-000000000071', statement_timestamp(), statement_timestamp(), statement_timestamp() + interval '1 day');
delete from auth.sessions
 where id = '71000000-0000-4000-8000-000000000080';

select throws_ok(
  $$insert into private.invitation_provisioner_allowlist (auth_user_id)
    values ('10000000-0000-4000-8000-000000000001')$$,
  '42501', 'Invitation worker identity separation failed',
  'a family account cannot be allowlisted as a provisioner'
);

insert into private.invitation_provisioner_allowlist (auth_user_id)
values
  ('10000000-0000-4000-8000-000000000071'),
  ('10000000-0000-4000-8000-000000000076');
insert into private.invitation_delivery_worker_allowlist (auth_user_id)
values
  ('10000000-0000-4000-8000-000000000072'),
  ('10000000-0000-4000-8000-000000000077');
insert into private.photo_validator_allowlist (auth_user_id)
values ('10000000-0000-4000-8000-000000000082');

select throws_ok(
  $$insert into private.invitation_delivery_worker_allowlist (auth_user_id)
    values ('10000000-0000-4000-8000-000000000071')$$,
  '42501', 'Invitation worker identity separation failed',
  'provisioning and delivery identities cannot overlap'
);
select throws_ok(
  $$insert into private.photo_validator_allowlist (auth_user_id)
    values ('10000000-0000-4000-8000-000000000072')$$,
  '42501', 'Invitation worker identity separation failed',
  'an invitation worker cannot also become a media validator'
);

insert into public.people (
  id, circle_id, display_name, profile_kind, accent_token,
  created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000078',
  '20000000-0000-4000-8000-000000000001',
  'Worker family separation probe', 'account', 'clay',
  '40000000-0000-4000-8000-000000000001'
);
insert into private.invitation_provisioner_allowlist (auth_user_id)
values ('10000000-0000-4000-8000-000000000078');
select throws_ok(
  $$insert into public.circle_memberships (
      id, circle_id, user_id, person_id, role, status
    ) values (
      '40000000-0000-4000-8000-000000000078',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000078',
      '30000000-0000-4000-8000-000000000078', 'member', 'active'
    )$$,
  '42501', 'Invitation worker identity separation failed',
  'an allowlisted worker cannot later acquire family membership'
);

-- Fail-closed coverage still requires an explicit owner disable. Organizer
-- sending is on by default after 20260903120000.
update private.invitation_delivery_capabilities
   set enabled = false, updated_at = statement_timestamp()
 where capability = 'email_delivery';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.request_invitation_email(
    '20000000-0000-4000-8000-000000000001',
    'capability-disabled@example.test', 'Capability Disabled',
    'a1000000-0000-4000-8000-000000000000')$$,
  '42501', 'Invitation email could not be requested',
  'an organizer direct RPC fails closed while delivery is disabled'
);
reset role;
select is(
  (select count(*)::bigint from private.invitation_email_requests),
  0::bigint,
  'a disabled delivery capability creates no request or side effect'
);

-- Deterministic local activation requires the database owner. This direct
-- private-table update is never available through the Data API or service role.
update private.invitation_delivery_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'email_delivery';
select is(
  (select enabled from private.invitation_delivery_capabilities
    where capability = 'email_delivery'),
  true,
  'the database owner can explicitly activate local invitation delivery tests'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true
);
select throws_ok(
  $$select public.request_invitation_email(
    '20000000-0000-4000-8000-000000000001',
    'ordinary-denied@example.test', 'Denied',
    'a1000000-0000-4000-8000-000000000001')$$,
  '42501', 'Invitation email could not be requested',
  'an ordinary member cannot request provisioning'
);
select is(
  (select count(*)::bigint from public.list_pending_invitation_email_requests(
    '20000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'an ordinary member receives zero pending email requests'
);

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true
);
select is(
  (select count(*)::bigint from public.list_pending_invitation_email_requests(
    '20000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'a revoked member receives zero pending email requests'
);

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true
);
select is(
  (select count(*)::bigint from public.list_pending_invitation_email_requests(
    '20000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'a wrong-circle organizer receives zero pending email requests'
);

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true
);
select throws_ok(
  $$select public.request_invitation_email(
    '20000000-0000-4000-8000-000000000001',
    'no-circle-denied@example.test', 'Denied',
    'a1000000-0000-4000-8000-000000000002')$$,
  '42501', 'Invitation email could not be requested',
  'an account without a circle cannot request provisioning'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  ' NEW-UNCONFIRMED@EXAMPLE.TEST ', ' New Relative ',
  'a1000000-0000-4000-8000-000000000011'
) as request_id \gset unconfirmed_
select is(
  public.request_invitation_email(
    '20000000-0000-4000-8000-000000000001',
    'new-unconfirmed@example.test', 'New Relative',
    'a1000000-0000-4000-8000-000000000011'
  ),
  :'unconfirmed_request_id'::uuid,
  'an organizer retry returns the exact request after a lost response'
);
select throws_ok(
  $$select public.request_invitation_email(
    '20000000-0000-4000-8000-000000000001',
    'different@example.test', 'New Relative',
    'a1000000-0000-4000-8000-000000000011')$$,
  '22023', 'Invitation email could not be requested',
  'an idempotency key cannot be rebound to a different email'
);
select is(
  (select count(*)::bigint from public.list_pending_invitation_email_requests(
    '20000000-0000-4000-8000-000000000001'
  ) where email_request_id = :'unconfirmed_request_id'::uuid),
  1::bigint,
  'family settings can reload the queued request without its address'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000073', true
);
select throws_ok(
  format(
    'select * from public.load_invitation_email_request(%L::uuid)',
    :'unconfirmed_request_id'
  ),
  '42501', 'Invitation provisioning request is unavailable',
  'a non-provisioner cannot read a request'
);

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000071', true
);
select set_config('request.jwt.claims', '', true);
select throws_ok(
  format(
    'select * from public.load_invitation_email_request(%L::uuid)',
    :'unconfirmed_request_id'
  ),
  '42501', 'Invitation provisioning request is unavailable',
  'an allowlisted provisioner without a session claim is denied'
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select throws_ok(
  format(
    'select * from public.load_invitation_email_request(%L::uuid)',
    :'unconfirmed_request_id'
  ),
  '42501', 'Invitation provisioning request is unavailable',
  'a session belonging to another worker cannot authorize provisioning'
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000079"}', true
);
select throws_ok(
  format(
    'select * from public.load_invitation_email_request(%L::uuid)',
    :'unconfirmed_request_id'
  ),
  '42501', 'Invitation provisioning request is unavailable',
  'an expired worker session is denied'
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000080"}', true
);
select throws_ok(
  format(
    'select * from public.load_invitation_email_request(%L::uuid)',
    :'unconfirmed_request_id'
  ),
  '42501', 'Invitation provisioning request is unavailable',
  'a deleted worker session is denied'
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000071"}', true
);
select * from public.load_invitation_email_request(
  :'unconfirmed_request_id'::uuid
) \gset unconfirmed_load_
select is(:'unconfirmed_load_normalized_email'::text,
  'new-unconfirmed@example.test'::text,
  'the provisioner reads exactly the normalized requested address');
select * from public.complete_invitation_email_provisioning(
  :'unconfirmed_request_id'::uuid,
  '10000000-0000-4000-8000-000000000074'
) \gset unconfirmed_provisioned_
select is(:'unconfirmed_provisioned_target_email_confirmed'::boolean, false,
  'a brand-new unconfirmed Auth account is bound without pre-confirmation');
select * from public.complete_invitation_email_provisioning(
  :'unconfirmed_request_id'::uuid,
  '10000000-0000-4000-8000-000000000074'
) \gset unconfirmed_provisioned_retry_
select is(
  :'unconfirmed_provisioned_retry_invitation_job_id'::uuid,
  :'unconfirmed_provisioned_invitation_job_id'::uuid,
  'provisioning completion is exactly replayable after a lost response'
);
select * from public.load_invitation_email_request(
  :'unconfirmed_request_id'::uuid
) \gset unconfirmed_reload_
select is(
  :'unconfirmed_reload_invitation_job_id'::uuid,
  :'unconfirmed_provisioned_invitation_job_id'::uuid,
  'the same provisioner can reload the bound job without Auth Admin'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select is(
  (select state from public.list_pending_invitation_email_requests(
    '20000000-0000-4000-8000-000000000001'
  ) where email_request_id = :'unconfirmed_request_id'::uuid),
  'provisioned'::text,
  'family settings retains organizer control of a provisioned request'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000071', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000071"}', true
);
select throws_ok(
  format(
    'select * from public.load_invitation_delivery_job(%L::uuid)',
    :'unconfirmed_provisioned_invitation_job_id'
  ),
  '42501', 'Invitation delivery job is unavailable',
  'a provisioner cannot pose as the separately allowlisted delivery worker'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000072', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select * from public.load_invitation_delivery_job(
  :'unconfirmed_provisioned_invitation_job_id'::uuid
) \gset unconfirmed_delivery_
select is(:'unconfirmed_delivery_requester_membership_id'::uuid,
  '40000000-0000-4000-8000-000000000001'::uuid,
  'delivery load returns the exact requester identity snapshot');
select 'invite-' || repeat('u', 40) as raw_token,
  encode(extensions.digest('invite-' || repeat('u', 40), 'sha256'), 'hex')
    as token_hash \gset unconfirmed_token_
select * from public.materialize_invitation_delivery_job(
  :'unconfirmed_provisioned_invitation_job_id'::uuid,
  :'unconfirmed_delivery_delivery_version'::integer,
  :'unconfirmed_token_token_hash'
) \gset unconfirmed_materialized_
select * from public.read_invitation_delivery_auth(
  :'unconfirmed_provisioned_invitation_job_id'::uuid
) \gset unconfirmed_auth_
select is(
  (select email_confirmed_at from public.read_invitation_delivery_auth(
    :'unconfirmed_provisioned_invitation_job_id'::uuid
  )),
  null::timestamptz,
  'the locked delivery snapshot reports the target as unconfirmed');
select is(:'unconfirmed_auth_token_sha256_hex'::text,
  :'unconfirmed_token_token_hash'::text,
  'delivery authorization returns the exact materialized token digest');
select statement_timestamp() as provider_accepted_at \gset unconfirmed_provider_
select public.complete_invitation_delivery(
  :'unconfirmed_provisioned_invitation_job_id'::uuid,
  :'unconfirmed_auth_invitation_id'::uuid,
  :'unconfirmed_auth_delivery_version'::integer,
  :'unconfirmed_auth_token_sha256_hex',
  :'unconfirmed_auth_recipient_binding_hex',
  'resend', 'provider-message-unconfirmed', 'provider-key-unconfirmed',
  repeat('a', 64), :'unconfirmed_provider_provider_accepted_at'::timestamptz
) as receipt_id \gset unconfirmed_receipt_
select is(
  public.complete_invitation_delivery(
    :'unconfirmed_provisioned_invitation_job_id'::uuid,
    :'unconfirmed_auth_invitation_id'::uuid,
    :'unconfirmed_auth_delivery_version'::integer,
    :'unconfirmed_auth_token_sha256_hex',
    :'unconfirmed_auth_recipient_binding_hex',
    'resend', 'provider-message-unconfirmed', 'provider-key-unconfirmed',
    repeat('a', 64), :'unconfirmed_provider_provider_accepted_at'::timestamptz
  ),
  :'unconfirmed_receipt_receipt_id'::uuid,
  'provider completion is insert-or-compare idempotent'
);
select throws_ok(
  format(
    'select public.complete_invitation_delivery(%L::uuid,%L::uuid,%s,%L,%L,%L,%L,%L,%L,%L::timestamptz)',
    :'unconfirmed_provisioned_invitation_job_id',
    :'unconfirmed_auth_invitation_id',
    :'unconfirmed_auth_delivery_version',
    :'unconfirmed_auth_token_sha256_hex',
    :'unconfirmed_auth_recipient_binding_hex',
    'resend', 'provider-message-CONFLICT', 'provider-key-unconfirmed',
    repeat('a',64), :'unconfirmed_provider_provider_accepted_at'
  ),
  '22023', 'Invitation delivery receipt did not match',
  'a provider receipt conflict fails closed'
);
select * from public.read_delivered_invitation(
  :'unconfirmed_provisioned_invitation_job_id'::uuid
) \gset unconfirmed_delivered_
select is(:'unconfirmed_delivered_receipt_id'::uuid,
  :'unconfirmed_receipt_receipt_id'::uuid,
  'freshly authorized delivery read returns the full durable receipt');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select is(
  (select state from public.list_pending_invitation_email_requests(
    '20000000-0000-4000-8000-000000000001'
  ) where email_request_id = :'unconfirmed_request_id'::uuid),
  'delivered'::text,
  'family settings retains organizer control of a delivered request'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000074', true
);
select is(public.accept_invitation(:'unconfirmed_token_raw_token'), null::uuid,
  'the exact target cannot accept before Auth email confirmation');
reset role;
select is(
  (select state from private.invitation_email_requests
    where id = :'unconfirmed_request_id'::uuid),
  'delivered'::text,
  'an unconfirmed acceptance attempt leaves delivery pending'
);
update auth.users set email_confirmed_at = statement_timestamp()
 where id = '10000000-0000-4000-8000-000000000074';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000074', true
);
select isnt(public.accept_invitation(:'unconfirmed_token_raw_token'), null::uuid,
  'the same exact Auth UUID can accept after confirming the same email');
reset role;
select is(
  (select state from private.invitation_email_requests
    where id = :'unconfirmed_request_id'::uuid),
  'accepted'::text,
  'successful acceptance terminalizes the email request');
select is(
  (select normalized_email from private.invitation_email_requests
    where id = :'unconfirmed_request_id'::uuid),
  null::text,
  'accepted request history scrubs the operational plaintext address');
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = :'unconfirmed_provisioned_invitation_job_id'::uuid),
  'target_accepted'::text,
  'successful acceptance terminalizes the target-bound job');
select is(
  (select count(*)::bigint from public.circle_memberships
    where circle_id = '20000000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-4000-8000-000000000074'
      and status = 'active'),
  1::bigint,
  'the accepted target has exactly one active membership'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000074', true
);
select is(public.accept_invitation(:'unconfirmed_token_raw_token'), null::uuid,
  'acceptance replay cannot create a second membership');
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000072', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select is(
  public.complete_invitation_delivery(
    :'unconfirmed_provisioned_invitation_job_id'::uuid,
    :'unconfirmed_auth_invitation_id'::uuid,
    :'unconfirmed_auth_delivery_version'::integer,
    :'unconfirmed_auth_token_sha256_hex',
    :'unconfirmed_auth_recipient_binding_hex',
    'resend', 'provider-message-unconfirmed', 'provider-key-unconfirmed',
    repeat('a', 64), :'unconfirmed_provider_provider_accepted_at'::timestamptz
  ),
  :'unconfirmed_receipt_receipt_id'::uuid,
  'an exact provider receipt remains replayable after acceptance'
);
select is(
  (select receipt_id from public.read_delivered_invitation(
    :'unconfirmed_provisioned_invitation_job_id'::uuid
  )),
  :'unconfirmed_receipt_receipt_id'::uuid,
  'the owning worker can recover its durable receipt after acceptance'
);
select is(
  (select count(*)::bigint from public.read_invitation_delivery_auth(
    :'unconfirmed_provisioned_invitation_job_id'::uuid
  )),
  0::bigint,
  'terminal receipt recovery does not restore send authorization'
);
select throws_ok(
  format(
    'select public.complete_invitation_delivery(%L::uuid,%L::uuid,%s,%L,%L,%L,%L,%L,%L,%L::timestamptz)',
    :'unconfirmed_provisioned_invitation_job_id',
    :'unconfirmed_auth_invitation_id',
    :'unconfirmed_auth_delivery_version',
    :'unconfirmed_auth_token_sha256_hex',
    :'unconfirmed_auth_recipient_binding_hex',
    'resend', 'provider-message-unconfirmed', 'provider-key-unconfirmed',
    repeat('b',64), :'unconfirmed_provider_provider_accepted_at'
  ),
  '22023', 'Invitation delivery receipt did not match',
  'terminal receipt replay rejects any evidence mismatch'
);
reset role;

select is(
  (select count(*)::bigint from private.invitation_coordination_audit_events
    where email_request_id = :'unconfirmed_request_id'::uuid
      and event_type in (
        'email_request_created', 'auth_target_bound',
        'invitation_materialized', 'provider_delivery_recorded',
        'email_request_accepted'
      )),
  5::bigint,
  'the successful journey has a complete content-free audit trail'
);

select throws_ok(
  $$update private.invitation_delivery_receipts
       set provider_message_id = 'tampered'$$,
  '42501', 'Invitation delivery receipts are immutable',
  'delivery receipts reject direct mutation'
);
select throws_ok(
  $$delete from private.invitation_email_requests$$,
  '42501', 'Invitation email request history cannot be deleted',
  'email request history rejects direct deletion'
);
select throws_ok(
  $$delete from private.invitation_coordination_audit_events$$,
  '42501', 'Invitation coordination audit is immutable',
  'coordination audit rejects direct deletion'
);

-- Existing-confirmed accounts use the same coordinator without changing their
-- Auth confirmation timestamp.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'existing-confirmed@example.test', 'Existing Relative',
  'a1000000-0000-4000-8000-000000000021'
) as request_id \gset confirmed_
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000076', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000076"}', true
);
select throws_ok(
  format(
    'select * from public.complete_invitation_email_provisioning(%L::uuid,%L::uuid)',
    :'confirmed_request_id', '10000000-0000-4000-8000-000000000081'
  ),
  '22023', 'Invitation provisioning could not be completed',
  'a provisioner cannot bind a request to the wrong Auth identity'
);
select * from public.complete_invitation_email_provisioning(
  :'confirmed_request_id'::uuid,
  '10000000-0000-4000-8000-000000000075'
) \gset confirmed_provisioned_
select is(:'confirmed_provisioned_target_email_confirmed'::boolean, true,
  'an existing confirmed Auth account is accepted by provisioning');
reset role;

-- A dedicated worker identity can never become a family invitation target.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'invite-provisioner@example.test', 'Worker Target',
  'a1000000-0000-4000-8000-000000000041'
) as request_id \gset worker_provisioner_
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'invite-delivery@example.test', 'Worker Target',
  'a1000000-0000-4000-8000-000000000042'
) as request_id \gset worker_delivery_
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'photo-validator@example.test', 'Worker Target',
  'a1000000-0000-4000-8000-000000000043'
) as request_id \gset worker_photo_
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000076', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000076"}', true
);
select is(
  (select count(*)::bigint from public.complete_invitation_email_provisioning(
    :'worker_provisioner_request_id'::uuid,
    '10000000-0000-4000-8000-000000000071'
  )),
  0::bigint,
  'an active provisioner cannot be bound as an invitation target'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000071', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000071"}', true
);
select is(
  (select count(*)::bigint from public.complete_invitation_email_provisioning(
    :'worker_delivery_request_id'::uuid,
    '10000000-0000-4000-8000-000000000072'
  )),
  0::bigint,
  'an active delivery worker cannot be bound as an invitation target'
);
select is(
  (select count(*)::bigint from public.complete_invitation_email_provisioning(
    :'worker_photo_request_id'::uuid,
    '10000000-0000-4000-8000-000000000082'
  )),
  0::bigint,
  'an active photo validator cannot be bound as an invitation target'
);
reset role;

select is(
  (select count(*)::bigint from private.invitation_email_requests
    where id in (
      :'worker_provisioner_request_id'::uuid,
      :'worker_delivery_request_id'::uuid,
      :'worker_photo_request_id'::uuid
    ) and state = 'invalidated'
      and invalidation_reason = 'target_identity_changed'
      and normalized_email is null),
  3::bigint,
  'all worker-target attempts terminalize and scrub their email intents'
);

-- Malformed coordinator inputs fail with generic contracts.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.request_invitation_email(
    '20000000-0000-4000-8000-000000000001', 'not-an-email', '', null)$$,
  '22023', 'Invitation email could not be requested',
  'malformed organizer input is rejected generically'
);
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000072', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select throws_ok(
  $$select * from public.materialize_invitation_delivery_job(
    null, 0, 'not-a-hash')$$,
  '42501', 'Invitation delivery could not be materialized',
  'malformed materialization evidence is rejected generically'
);
select throws_ok(
  $$select public.complete_invitation_delivery(
    null, null, 0, 'bad', 'bad', 'BAD PROVIDER', '', '', 'bad', null)$$,
  '42501', 'Invitation delivery could not be completed',
  'malformed receipt evidence is rejected generically'
);
reset role;

-- A periodic worker can invalidate expired work in bounded batches. Queue and
-- target-bound fixtures use old timestamps so the test never waits on a clock.
insert into private.invitation_email_requests (
  id, circle_id, requested_by_membership_id,
  requester_authorization_version, normalized_email, email_salt, email_hash,
  invited_display_name, request_key, requested_at, expires_at
)
select
  fixture.id, '20000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', membership.updated_at,
  fixture.email, decode(repeat('ab', 16), 'hex'),
  extensions.digest(
    pg_catalog.convert_to(fixture.email, 'UTF8')
      || decode(repeat('ab', 16), 'hex'), 'sha256'
  ), fixture.display_name, fixture.request_key,
  statement_timestamp() - interval '49 hours',
  statement_timestamp() - interval '1 hour'
from (values
  ('81000000-0000-4000-8000-000000000001'::uuid,
    'expired-one@example.test', 'Expired One',
    'a1000000-0000-4000-8000-000000000051'::uuid),
  ('81000000-0000-4000-8000-000000000002'::uuid,
    'expired-two@example.test', 'Expired Two',
    'a1000000-0000-4000-8000-000000000052'::uuid)
) as fixture(id, email, display_name, request_key)
cross join public.circle_memberships as membership
where membership.id = '40000000-0000-4000-8000-000000000001';

insert into private.invitation_email_requests (
  id, circle_id, requested_by_membership_id,
  requester_authorization_version, normalized_email, email_salt, email_hash,
  invited_display_name, request_key, state, requested_at, expires_at,
  provisioned_at, provisioned_by_auth_user_id, target_auth_user_id,
  invitation_job_id
)
select
  '81000000-0000-4000-8000-000000000003',
  membership.circle_id, membership.id, membership.updated_at,
  'expired-target@example.test', decode(repeat('cd', 16), 'hex'),
  extensions.digest(
    pg_catalog.convert_to('expired-target@example.test', 'UTF8')
      || decode(repeat('cd', 16), 'hex'), 'sha256'
  ), 'Expired Target', 'a1000000-0000-4000-8000-000000000053',
  'provisioned', statement_timestamp() - interval '49 hours',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '48 hours',
  '10000000-0000-4000-8000-000000000071',
  '10000000-0000-4000-8000-000000000083',
  '82000000-0000-4000-8000-000000000003'
from public.circle_memberships as membership
where membership.id = '40000000-0000-4000-8000-000000000001';

insert into private.invitation_jobs (
  id, circle_id, requested_by_membership_id,
  requester_authorization_version, target_auth_user_id,
  invited_display_name, request_key, requested_at, expires_at,
  email_request_id, provisioned_by_auth_user_id
)
select
  '82000000-0000-4000-8000-000000000003',
  request.circle_id, request.requested_by_membership_id,
  request.requester_authorization_version, request.target_auth_user_id,
  request.invited_display_name, request.request_key,
  request.requested_at, request.expires_at, request.id,
  request.provisioned_by_auth_user_id
from private.invitation_email_requests as request
where request.id = '81000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select public.sweep_expired_invitation_email_requests(1)$$,
  '42501', 'Invitation expiry sweep is unavailable',
  'an organizer cannot invoke the worker expiry sweep'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000072', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select throws_ok(
  $$select public.sweep_expired_invitation_email_requests(0)$$,
  '42501', 'Invitation expiry sweep is unavailable',
  'the expiry sweep rejects an unbounded or empty batch'
);
select is(
  public.sweep_expired_invitation_email_requests(1),
  1,
  'the expiry sweep processes no more than its requested batch size'
);
reset role;
select is(
  (select count(*)::bigint from private.invitation_email_requests
    where id in (
      '81000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000003'
    ) and state in ('queued', 'provisioned', 'delivered')),
  2::bigint,
  'one bounded sweep leaves the remaining expired work for a later invocation'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000072', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select is(
  public.sweep_expired_invitation_email_requests(100),
  2,
  'a later bounded sweep drains the remaining expired work'
);
reset role;

select is(
  (select count(*)::bigint from private.invitation_email_requests
    where id in (
      '81000000-0000-4000-8000-000000000001',
      '81000000-0000-4000-8000-000000000002',
      '81000000-0000-4000-8000-000000000003'
    ) and state = 'invalidated'
      and invalidation_reason = 'expired'
      and normalized_email is null),
  3::bigint,
  'expiry invalidates every selected request and scrubs its plaintext email'
);
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = '82000000-0000-4000-8000-000000000003'),
  'expired'::text,
  'expiry cascades into a target-bound invitation job'
);

-- Proactive authority-loss triggers cover queued requests and provisioned jobs.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'demotion-probe@example.test', 'Demotion Probe',
  'a1000000-0000-4000-8000-000000000022'
) as request_id \gset demotion_
reset role;
update public.circle_memberships set role = 'member'
 where id = '40000000-0000-4000-8000-000000000002';
select is(
  (select invalidation_reason from private.invitation_email_requests
    where id = :'demotion_request_id'::uuid),
  'requester_authority_lost'::text,
  'organizer demotion terminalizes a queued request'
);

-- Target email drift is detected under the locked delivery retry and revokes
-- the linked invitation rather than sending to a changed identity.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'email-drift@example.test', 'Email Drift',
  'a1000000-0000-4000-8000-000000000031'
) as request_id \gset drift_
reset role;
select id as auth_user_id from auth.users
 where lower(btrim(email)) = 'email-drift@example.test'
 \gset drift_target_
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000071', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000071"}', true
);
select * from public.complete_invitation_email_provisioning(
  :'drift_request_id'::uuid,
  :'drift_target_auth_user_id'::uuid
) \gset drift_provisioned_
reset role;
update auth.users set email = 'changed-address@example.test'
 where id = :'drift_target_auth_user_id'::uuid;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000072', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000072"}', true
);
select is(
  (select count(*)::bigint from public.load_invitation_delivery_job(
    :'drift_provisioned_invitation_job_id'::uuid
  )),
  0::bigint,
  'delivery retry returns no row after target email drift'
);
reset role;
select is(
  (select invalidation_reason from private.invitation_email_requests
    where id = :'drift_request_id'::uuid),
  'target_identity_changed'::text,
  'target email drift terminalizes the request and job'
);

-- Revoking a provisioner invalidates every live target it bound.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'provisioner-revoke@example.test', 'Provisioner Revoke',
  'a1000000-0000-4000-8000-000000000032'
) as request_id \gset provisioner_revoke_
reset role;
select id as auth_user_id from auth.users
 where lower(btrim(email)) = 'provisioner-revoke@example.test'
 \gset provisioner_revoke_target_
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000076', true
);
select set_config(
  'request.jwt.claims', '{"session_id":"71000000-0000-4000-8000-000000000076"}', true
);
select * from public.complete_invitation_email_provisioning(
  :'provisioner_revoke_request_id'::uuid,
  :'provisioner_revoke_target_auth_user_id'::uuid
) \gset provisioner_revoke_bound_
reset role;
update private.invitation_provisioner_allowlist
   set revoked_at = statement_timestamp()
 where auth_user_id = '10000000-0000-4000-8000-000000000076';
select is(
  (select invalidation_reason from private.invitation_email_requests
    where id = :'provisioner_revoke_request_id'::uuid),
  'provisioner_revoked'::text,
  'provisioner revocation terminalizes its live request'
);
select is(
  (select normalized_email from private.invitation_email_requests
    where id = :'provisioner_revoke_request_id'::uuid),
  null::text,
  'invalidated request history scrubs the operational plaintext address'
);
select is(
  (select invalidation_reason from private.invitation_jobs
    where id = :'provisioner_revoke_bound_invitation_job_id'::uuid),
  'provisioner_revoked'::text,
  'provisioner revocation terminalizes the linked job'
);
select lives_ok(
  format(
    'delete from auth.users where id = %L::uuid',
    :'provisioner_revoke_target_auth_user_id'
  ),
  'prepared target Auth deletion is not structurally blocked by request history'
);
select is(
  (select target_auth_user_id from private.invitation_email_requests
    where id = :'provisioner_revoke_request_id'::uuid),
  :'provisioner_revoke_target_auth_user_id'::uuid,
  'durable request history retains only the detached target UUID evidence'
);

-- Magic-link path: a queued request plus the confirmed Auth user can join
-- without a delivery token.
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select public.request_invitation_email(
  '20000000-0000-4000-8000-000000000001',
  'magic-link-invitee@example.test', 'Magic Link Guest',
  'a1000000-0000-4000-8000-000000000099'
) as request_id \gset magic_invite_
reset role;
select id as auth_user_id from auth.users
 where lower(btrim(email)) = 'magic-link-invitee@example.test'
 \gset magic_invitee_
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', :'magic_invitee_auth_user_id', true
);
select public.accept_pending_invitation_for_current_user()
  as membership_id \gset magic_accepted_
reset role;
select ok(
  exists (
    select 1 from public.circle_memberships
     where id = :'magic_accepted_membership_id'::uuid
       and user_id = :'magic_invitee_auth_user_id'::uuid
       and status = 'active'
  ),
  'an invited confirmed Auth user can accept without a delivery token'
);
select is(
  (select invalidation_reason from private.invitation_email_requests
    where id = :'magic_invite_request_id'::uuid),
  'target_became_active',
  'accepting a pending invitation consumes the queued request'
);

select is(
  (select count(*)::bigint from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'invitation_jobs', 'invitations', 'invitation_delivery_receipts',
        'invitation_coordination_audit_events'
      ) and column_name = 'normalized_email'),
  0::bigint,
  'jobs, invitations, receipts, and audit never retain plaintext recipient email'
);

select * from finish();
rollback;
