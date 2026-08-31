begin;

select plan(96);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'account_closure_requests'
  ),
  'private',
  'account closure requests stay outside the exposed schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'account_closure_requests'
  ),
  'the closure request ledger enables and forces RLS'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'account_closure_memberships'
  ),
  'the private closure-to-membership map enables and forces RLS'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'account_closure_requests'
       and column_name in (
         'email', 'normalized_email', 'content_policy', 'media_policy',
         'storage_key', 'auth_deleted_at'
       )
  ),
  0::bigint,
  'the closure ledger stores no email, content, media, or fake deletion policy'
);

select ok(
  not exists (
    select 1
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conrelid =
       'private.account_closure_requests'::regclass
       and constraint_row.contype = 'f'
       and constraint_row.confrelid = 'auth.users'::regclass
  ),
  'closure history has no foreign key back to the replaceable Auth row'
);

select is(
  (
    select is_nullable
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'circle_memberships'
       and column_name = 'user_id'
  ),
  'YES',
  'a retained membership can detach its Auth account'
);

select ok(
  (
    select constraint_row.confdeltype = 'r'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'circle_memberships_user_id_fkey'
  ),
  'the nullable Auth foreign key remains ON DELETE RESTRICT'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%status <> ''active''%user_id IS NOT NULL%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname =
       'circle_memberships_active_auth_attachment_valid'
  ),
  'active memberships still require an Auth attachment'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'private'
       and table_name in (
         'account_closure_requests',
         'account_closure_memberships'
       )
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  0::bigint,
  'browser roles have no direct closure-ledger table privileges'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.request_account_closure(uuid)',
    'EXECUTE'
  ),
  'authenticated users can reach only the public request seam'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.request_account_closure(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot request closure'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.prepare_account_closure(uuid)',
    'EXECUTE'
  ),
  'browser-authenticated users cannot prepare closure'
);

select ok(
  has_schema_privilege('service_role', 'private', 'USAGE')
    and has_function_privilege(
      'service_role',
      'private.prepare_account_closure(uuid)',
      'EXECUTE'
    ),
  'the trusted service role has the exact private prepare seam'
);

select ok(
  not has_function_privilege(
    'service_role',
    'private.request_invitation_job(uuid,uuid,text,uuid)',
    'EXECUTE'
  ),
  'private-schema usage does not expose unrelated invitation mutation'
);

set local role service_role;
select throws_ok(
  $$select * from private.account_closure_requests$$,
  '42501',
  'permission denied for table account_closure_requests',
  'service_role cannot select the closure request ledger directly'
);
select throws_ok(
  $$insert into private.account_closure_requests (
      auth_user_id,
      request_key
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'aa000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'permission denied for table account_closure_requests',
  'service_role cannot insert closure requests directly'
);
select throws_ok(
  $$update private.account_closure_requests set state = state$$,
  '42501',
  'permission denied for table account_closure_requests',
  'service_role cannot update closure requests directly'
);
select throws_ok(
  $$delete from private.account_closure_requests$$,
  '42501',
  'permission denied for table account_closure_requests',
  'service_role cannot delete closure requests directly'
);
select throws_ok(
  $$select * from private.account_closure_memberships$$,
  '42501',
  'permission denied for table account_closure_memberships',
  'service_role cannot select closure membership history directly'
);
select throws_ok(
  $$insert into private.account_closure_memberships (
      closure_request_id,
      circle_id,
      membership_id
    ) values (
      'aa000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '42501',
  'permission denied for table account_closure_memberships',
  'service_role cannot forge closure membership history'
);
select throws_ok(
  $$update private.account_closure_memberships
       set recorded_at = recorded_at$$,
  '42501',
  'permission denied for table account_closure_memberships',
  'service_role cannot update closure membership history directly'
);
select throws_ok(
  $$delete from private.account_closure_memberships$$,
  '42501',
  'permission denied for table account_closure_memberships',
  'service_role cannot delete closure membership history directly'
);
reset role;

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'private.prepare_account_closure(uuid)'::regprocedure
  ),
  'the private prepare function is definer and fixed-path'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.request_account_closure(uuid)'::regprocedure
  ),
  'the public request function is definer and fixed-path'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%invalidated_by_membership_id%invalidated_by_closure_request_id%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitation_jobs_state_valid'
  ),
  'invitation jobs require exactly one terminal invalidation source'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%revoked_by_membership_id%revoked_by_closure_request_id%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'invitations_terminal_state_valid'
  ),
  'legacy invitations require exactly one terminal revocation source'
);

select throws_ok(
  $$update public.circle_memberships
       set user_id = null,
           status = 'revoked',
           revoked_at = statement_timestamp(),
           revoked_by_membership_id =
             '40000000-0000-4000-8000-000000000001'
     where id = '40000000-0000-4000-8000-000000000003'$$,
  '42501',
  'Membership Auth attachment is immutable',
  'direct detachment without a closure mapping is denied'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000031',
  'closure-job-target@example.test',
  statement_timestamp(),
  '{}'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.request_family_export(
  '20000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001'
) as job_id \gset closing_export_
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000031',
  'Closure target',
  'a2000000-0000-4000-8000-000000000001'
) as job_id \gset closing_requester_invite_

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000006',
  true
);
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000002',
  'Closing target elsewhere',
  'a3000000-0000-4000-8000-000000000001'
) as job_id \gset closing_target_invite_

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.create_invitation(
    '20000000-0000-4000-8000-000000000001',
    'Historical email target',
    'organizer-two-a@example.test'
  ) \gset legacy_

reset role;
select count(*) as moment_count
  from public.moments
 where circle_id = '20000000-0000-4000-8000-000000000001'
   and recorded_by_membership_id =
     '40000000-0000-4000-8000-000000000002' \gset before_
select count(*) as note_count
  from public.moment_notes
 where author_membership_id =
   '40000000-0000-4000-8000-000000000002' \gset before_note_
select count(*) as reaction_count
  from public.moment_reactions
 where author_membership_id =
   '40000000-0000-4000-8000-000000000002' \gset before_reaction_

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.request_account_closure(
  'b1000000-0000-4000-8000-000000000001'
) as closure_id \gset coorganizer_

select isnt(
  :'coorganizer_closure_id'::uuid,
  null::uuid,
  'a co-organizer can request account closure'
);

reset role;
select is(
  (
    select state
      from private.account_closure_requests
     where id = :'coorganizer_closure_id'::uuid
  ),
  'requested',
  'the public seam records only a requested closure intent'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select is(
  (
    select count(*)::bigint
      from public.circles
     where id = '20000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'a requested closure keeps ordinary family access until prepare succeeds'
);
select is(
  public.request_account_closure(
    'b1000000-0000-4000-8000-000000000001'
  ),
  :'coorganizer_closure_id'::uuid,
  'a lost-response retry returns the same closure request'
);

reset role;
select is(
  (
    select count(*)::bigint
      from private.account_closure_requests
     where auth_user_id =
       '10000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'idempotent replay creates no duplicate closure history'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  $$select public.request_account_closure(
    'b1000000-0000-4000-8000-000000000002'
  )$$,
  '22023',
  'Account closure could not be requested',
  'a different request key cannot alias an existing closure'
);
select throws_ok(
  $$select * from public.create_invitation(
    '20000000-0000-4000-8000-000000000001',
    'Blocked closing organizer',
    'blocked-closing-organizer@example.test'
  )$$,
  '42501',
  'Invitation could not be created',
  'a requested closer cannot create a legacy invitation'
);
select throws_ok(
  format(
    'select public.accept_invitation(%L)',
    :'legacy_raw_token'
  ),
  '22023',
  'Invitation is not available',
  'a requested closer cannot accept a legacy invitation'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000006',
  true
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'Blocked closing target',
    'b1000000-0000-4000-8000-000000000003'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'another organizer cannot target a requested closer with new delivery work'
);

reset role;
select ok(
  not private.export_job_requester_is_authorized(
    :'closing_export_job_id'::uuid
  ),
  'requested closure immediately blocks queued export work'
);
select ok(
  not private.invitation_job_requester_is_authorized(
    :'closing_requester_invite_job_id'::uuid
  ),
  'requested closure immediately blocks queued invitation work'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  $$select public.request_family_export(
    '20000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Family export could not be requested',
  'requested closure denies new export requests'
);
select throws_ok(
  $$select public.request_invitation_job(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000031',
    'Blocked request',
    'b3000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Invitation delivery could not be requested',
  'requested closure denies new invitation jobs'
);

reset role;
select is(
  private.prepare_account_closure(:'coorganizer_closure_id'::uuid),
  :'coorganizer_closure_id'::uuid,
  'the trusted transaction prepares a co-organizer closure'
);
select is(
  (
    select state
      from private.account_closure_requests
     where id = :'coorganizer_closure_id'::uuid
  ),
  'prepared',
  'the closure becomes prepared only after all mutations succeed'
);
select ok(
  (
    select status = 'revoked' and user_id is null
      from public.circle_memberships
     where id = '40000000-0000-4000-8000-000000000002'
  ),
  'preparation revokes access and detaches Auth in one retained membership'
);
select is(
  (
    select count(*)::bigint
      from private.account_closure_memberships
     where closure_request_id = :'coorganizer_closure_id'::uuid
  ),
  1::bigint,
  'the closure records its exact affected membership'
);
select is(
  (
    select revoked_by_membership_id
      from public.person_guardians
     where id = '50000000-0000-4000-8000-000000000002'
  ),
  '40000000-0000-4000-8000-000000000002'::uuid,
  'guardian removal is truthfully attributed to the closing membership'
);
select ok(
  (
    select state = 'invalidated'
      and invalidated_by_membership_id =
        '40000000-0000-4000-8000-000000000002'
      from private.export_jobs
     where id = :'closing_export_job_id'::uuid
  ),
  'closure terminally invalidates queued export work by its requester'
);
select ok(
  (
    select state = 'invalidated'
      and invalidated_by_membership_id =
        '40000000-0000-4000-8000-000000000002'
      and invalidated_by_closure_request_id is null
      from private.invitation_jobs
     where id = :'closing_requester_invite_job_id'::uuid
  ),
  'requester invitation work keeps truthful membership attribution'
);
select ok(
  (
    select state = 'invalidated'
      and invalidated_by_membership_id is null
      and invalidated_by_closure_request_id =
        :'coorganizer_closure_id'::uuid
      from private.invitation_jobs
     where id = :'closing_target_invite_job_id'::uuid
  ),
  'an unrelated-circle target job uses closure attribution, not a fake actor'
);
select is(
  (
    select (
      (invalidated_by_membership_id is not null)::integer
      + (invalidated_by_closure_request_id is not null)::integer
    )
      from private.invitation_jobs
     where id in (
       :'closing_requester_invite_job_id'::uuid,
       :'closing_target_invite_job_id'::uuid
     )
    order by id
    limit 1
  ),
  1,
  'each terminal invitation job has exactly one invalidation source'
);
select ok(
  (
    select revoked_at is not null
      and revoked_by_membership_id is null
      and revoked_by_closure_request_id = :'coorganizer_closure_id'::uuid
      from private.invitations
     where id = :'legacy_invitation_id'::uuid
  ),
  'pending legacy invitations matching the confirmed email are terminalized'
);
select is(
  (
    select count(*)::bigint
      from private.audit_events
     where event_type = 'account_closure_prepared'
       and subject_id =
         '40000000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'closure creates one truthful per-membership audit event'
);
select is(
  (
    select count(*)::text
      from public.moments
     where circle_id = '20000000-0000-4000-8000-000000000001'
       and recorded_by_membership_id =
         '40000000-0000-4000-8000-000000000002'
  ),
  :'before_moment_count',
  'moment history remains unchanged'
);
select is(
  (
    select count(*)::text
      from public.moment_notes
     where author_membership_id =
       '40000000-0000-4000-8000-000000000002'
  ),
  :'before_note_note_count',
  'comment history remains unchanged'
);
select is(
  (
    select count(*)::text
      from public.moment_reactions
     where author_membership_id =
       '40000000-0000-4000-8000-000000000002'
  ),
  :'before_reaction_reaction_count',
  'reaction history remains unchanged'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select is(
  (
    select count(*)::bigint
      from public.circles
  ),
  0::bigint,
  'a captured JWT loses all family rows after atomic preparation'
);

reset role;
select throws_ok(
  $$update public.circle_memberships
       set user_id = '10000000-0000-4000-8000-000000000002'
     where id = '40000000-0000-4000-8000-000000000002'$$,
  '42501',
  'Membership Auth attachment is immutable',
  'a detached membership can never be reattached'
);
select is(
  private.prepare_account_closure(:'coorganizer_closure_id'::uuid),
  :'coorganizer_closure_id'::uuid,
  'prepare replay is idempotent'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select is(
  public.request_account_closure(
    'b1000000-0000-4000-8000-000000000001'
  ),
  :'coorganizer_closure_id'::uuid,
  'same-key request replay remains idempotent after preparation'
);
select throws_ok(
  $$select public.request_account_closure(
    'b1000000-0000-4000-8000-000000000004'
  )$$,
  '22023',
  'Account closure could not be requested',
  'conflicting-key request replay remains denied after preparation'
);
select throws_ok(
  format(
    'select public.accept_invitation(%L)',
    :'legacy_raw_token'
  ),
  '22023',
  'Invitation is not available',
  'a closing Auth subject cannot reactivate through an old invitation'
);

reset role;
select lives_ok(
  $$delete from auth.users
     where id = '10000000-0000-4000-8000-000000000002'$$,
  'a prepared zero-media fixture no longer blocks Auth deletion'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000002',
  'organizer-two-a@example.test',
  statement_timestamp(),
  '{}'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select is(
  (
    select count(*)::bigint
      from public.circles
  ),
  0::bigint,
  'recreating the same Auth UUID cannot regain a detached journal'
);

reset role;
delete from auth.users
 where id = '10000000-0000-4000-8000-000000000002';

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000032',
  'organizer-two-a@example.test',
  statement_timestamp(),
  '{}'
);

insert into private.invitations (
  id,
  circle_id,
  person_id,
  created_by_membership_id,
  token_hash,
  email_salt,
  email_hash,
  expires_at
) values (
  'c1000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '40000000-0000-4000-8000-000000000001',
  extensions.digest(
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    'sha256'
  ),
  decode('00112233445566778899aabbccddeeff', 'hex'),
  extensions.digest(
    pg_catalog.convert_to('organizer-two-a@example.test', 'UTF8')
      || decode('00112233445566778899aabbccddeeff', 'hex'),
    'sha256'
  ),
  statement_timestamp() + interval '1 day'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000032',
  true
);
select throws_ok(
  $$select public.accept_invitation(
    'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  )$$,
  '22023',
  'Invitation is not available',
  'a recreated same-email Auth UUID cannot claim a detached journal'
);

reset role;
select throws_ok(
  format(
    'update private.invitations set revoked_at = null, '
      'revoked_by_closure_request_id = null where id = %L',
    :'legacy_invitation_id'
  ),
  '42501',
  'Invitation state is immutable',
  'closure-terminalized invitations cannot be resurrected'
);
select is(
  (
    select count(*)::bigint
      from auth.users
     where id = '10000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the prepared Auth row stays deleted inside the fixture transaction'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select public.request_account_closure(
  'd1000000-0000-4000-8000-000000000001'
) as closure_id \gset member_

reset role;
select throws_ok(
  $$delete from auth.users
     where id = '10000000-0000-4000-8000-000000000003'$$,
  '23503',
  'update or delete on table "users" violates foreign key constraint "circle_memberships_user_id_fkey" on table "circle_memberships"',
  'Auth deletion remains restricted before preparation'
);
select is(
  private.prepare_account_closure(:'member_closure_id'::uuid),
  :'member_closure_id'::uuid,
  'a one-circle member closure prepares successfully'
);
select ok(
  (
    select status = 'revoked' and user_id is null
      from public.circle_memberships
     where id = '40000000-0000-4000-8000-000000000003'
  ),
  'one-circle member access is atomically detached'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
select public.request_account_closure(
  'd2000000-0000-4000-8000-000000000001'
) as closure_id \gset revoked_

reset role;
select is(
  private.prepare_account_closure(:'revoked_closure_id'::uuid),
  :'revoked_closure_id'::uuid,
  'an already-revoked member can finish closure preparation'
);
select ok(
  (
    select status = 'revoked'
      and user_id is null
      and revoked_by_membership_id =
        '40000000-0000-4000-8000-000000000001'
      from public.circle_memberships
     where id = '40000000-0000-4000-8000-000000000004'
  ),
  'already-revoked history keeps its original revoker while detaching Auth'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select public.request_family_export(
  '20000000-0000-4000-8000-000000000002',
  'd3000000-0000-4000-8000-000000000010'
) as job_id \gset dual_export_
select public.request_invitation_job(
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000031',
  'Dual-circle requester work',
  'd3000000-0000-4000-8000-000000000011'
) as job_id \gset dual_invite_
select public.request_account_closure(
  'd3000000-0000-4000-8000-000000000001'
) as closure_id \gset dual_

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000006',
  true
);
select throws_ok(
  $$select public.request_account_closure(
    'd3000000-0000-4000-8000-000000000012'
  )$$,
  '23514',
  'Every family must retain an active organizer',
  'the second of two organizers cannot request closure behind a closing peer'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000006',
    'member'
  )$$,
  '23514',
  'A circle must retain an active organizer',
  'the last non-closing organizer cannot be demoted'
);
select throws_ok(
  $$select public.revoke_membership(
    '40000000-0000-4000-8000-000000000006'
  )$$,
  '23514',
  'A circle must retain an active organizer',
  'the last non-closing organizer cannot be revoked'
);

reset role;
insert into private.account_closure_requests (
  auth_user_id,
  request_key
) values (
  '10000000-0000-4000-8000-000000000006',
  'd3000000-0000-4000-8000-000000000013'
);

select throws_ok(
  format(
    'select private.prepare_account_closure(%L)',
    :'dual_closure_id'
  ),
  '23514',
  'Every family must retain an active organizer',
  'prepare rechecks every circle and denies a newly last organizer'
);
select is(
  (
    select count(*)::bigint
      from public.circle_memberships
     where user_id = '10000000-0000-4000-8000-000000000005'
       and status = 'active'
  ),
  2::bigint,
  'last-organizer failure rolls back both circle memberships'
);
select is(
  (
    select count(*)::bigint
      from private.account_closure_memberships
     where closure_request_id = :'dual_closure_id'::uuid
  ),
  0::bigint,
  'all-or-nothing failure leaves no forged closure mapping'
);
select is(
  (
    select state
      from private.account_closure_requests
     where id = :'dual_closure_id'::uuid
  ),
  'requested',
  'a failed prepare remains an honest requested intent'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000033',
  'replacement-organizer-b@example.test',
  statement_timestamp(),
  '{}'
);
insert into public.people (
  id,
  circle_id,
  display_name,
  profile_kind,
  created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000033',
  '20000000-0000-4000-8000-000000000002',
  'Replacement Organizer B',
  'account',
  '40000000-0000-4000-8000-000000000006'
);
insert into public.circle_memberships (
  id,
  circle_id,
  user_id,
  person_id,
  role,
  status
) values (
  '40000000-0000-4000-8000-000000000033',
  '20000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000033',
  '30000000-0000-4000-8000-000000000033',
  'organizer',
  'active'
);

select count(*) as membership_count
  from public.circle_memberships
 where id in (
   '40000000-0000-4000-8000-000000000005',
   '40000000-0000-4000-8000-000000000007'
 ) \gset dual_before_
select count(*) as person_count
  from public.people
 where id in (
   '30000000-0000-4000-8000-000000000005',
   '30000000-0000-4000-8000-000000000007'
 ) \gset dual_before_
select count(*) as circle_count
  from public.circles
 where id in (
   '20000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002'
 ) \gset dual_before_
select count(*) as moment_count
  from public.moments
 where circle_id in (
   '20000000-0000-4000-8000-000000000001',
   '20000000-0000-4000-8000-000000000002'
 ) \gset dual_before_

set local role service_role;
select private.prepare_account_closure(
  :'dual_closure_id'::uuid
) as prepared_id \gset dual_service_
reset role;

select is(
  :'dual_service_prepared_id'::uuid,
  :'dual_closure_id'::uuid,
  'service_role can execute only the reviewed prepare transaction'
);
select is(
  (
    select count(*)::bigint
      from public.circle_memberships
     where id in (
       '40000000-0000-4000-8000-000000000005',
       '40000000-0000-4000-8000-000000000007'
     )
       and status = 'revoked'
       and user_id is null
  ),
  2::bigint,
  'successful dual-circle prepare detaches both memberships'
);
select is(
  (
    select count(*)::bigint
      from private.account_closure_memberships
     where closure_request_id = :'dual_closure_id'::uuid
  ),
  2::bigint,
  'successful dual-circle prepare records exactly two mappings'
);
select is(
  (
    select count(*)::bigint
      from private.audit_events
     where event_type = 'account_closure_prepared'
       and subject_id in (
         '40000000-0000-4000-8000-000000000005',
         '40000000-0000-4000-8000-000000000007'
       )
  ),
  2::bigint,
  'successful dual-circle prepare records exactly two truthful audits'
);
select ok(
  (
    select count(*)::text
      from public.circle_memberships
     where id in (
       '40000000-0000-4000-8000-000000000005',
       '40000000-0000-4000-8000-000000000007'
     )
  ) = :'dual_before_membership_count'
  and (
    select count(*)::text
      from public.people
     where id in (
       '30000000-0000-4000-8000-000000000005',
       '30000000-0000-4000-8000-000000000007'
     )
  ) = :'dual_before_person_count'
  and (
    select count(*)::text
      from public.circles
     where id in (
       '20000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000002'
     )
  ) = :'dual_before_circle_count'
  and (
    select count(*)::text
      from public.moments
     where circle_id in (
       '20000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000002'
     )
  ) = :'dual_before_moment_count',
  'dual-circle preparation retains memberships, people, circles, and moments'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select is(
  (select count(*)::bigint from public.circles),
  0::bigint,
  'the prepared dual-circle subject sees neither former family'
);
reset role;

select prepared_at::text as prepared_at
  from private.account_closure_requests
 where id = :'dual_closure_id'::uuid \gset dual_snapshot_
select invalidated_at::text as export_invalidated_at,
       invalidated_by_membership_id::text as export_invalidator
  from private.export_jobs
 where id = :'dual_export_job_id'::uuid \gset dual_snapshot_
select invalidated_at::text as invitation_invalidated_at,
       invalidated_by_membership_id::text as invitation_invalidator
  from private.invitation_jobs
 where id = :'dual_invite_job_id'::uuid \gset dual_snapshot_

select ok(
  :'dual_snapshot_export_invalidated_at' <> ''
  and :'dual_snapshot_export_invalidator' =
    '40000000-0000-4000-8000-000000000007'
  and :'dual_snapshot_invitation_invalidated_at' <> ''
  and :'dual_snapshot_invitation_invalidator' =
    '40000000-0000-4000-8000-000000000007'
  and (
    select invalidated_by_closure_request_id is null
      from private.invitation_jobs
     where id = :'dual_invite_job_id'::uuid
  ),
  'dual-circle requester jobs are terminally and truthfully invalidated'
);
select lives_ok(
  $$delete from auth.users
     where id = '10000000-0000-4000-8000-000000000005'$$,
  'direct Auth deletion succeeds after dual-circle preparation'
);

set local role service_role;
select private.prepare_account_closure(
  :'dual_closure_id'::uuid
) as prepared_id \gset dual_replay_
reset role;

select is(
  :'dual_replay_prepared_id'::uuid,
  :'dual_closure_id'::uuid,
  'prepare replay succeeds after the Auth row is already gone'
);
select is(
  (
    select prepared_at::text
      from private.account_closure_requests
     where id = :'dual_closure_id'::uuid
  ),
  :'dual_snapshot_prepared_at',
  'prepare replay preserves the original prepared timestamp'
);
select ok(
  (
    select count(*)
      from private.account_closure_memberships
     where closure_request_id = :'dual_closure_id'::uuid
  ) = 2
  and (
    select count(*)
      from private.audit_events
     where event_type = 'account_closure_prepared'
       and subject_id in (
         '40000000-0000-4000-8000-000000000005',
         '40000000-0000-4000-8000-000000000007'
       )
  ) = 2,
  'prepare replay creates no extra mappings or audits'
);
select ok(
  (
    select invalidated_at::text = :'dual_snapshot_export_invalidated_at'
      and invalidated_by_membership_id::text =
        :'dual_snapshot_export_invalidator'
      from private.export_jobs
     where id = :'dual_export_job_id'::uuid
  )
  and (
    select invalidated_at::text = :'dual_snapshot_invitation_invalidated_at'
      and invalidated_by_membership_id::text =
        :'dual_snapshot_invitation_invalidator'
      and invalidated_by_closure_request_id is null
      from private.invitation_jobs
     where id = :'dual_invite_job_id'::uuid
  ),
  'prepare replay preserves terminal timestamps and invalidation attribution'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000007',
  true
);
select throws_ok(
  $$select public.request_account_closure(
    'd4000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Account closure could not be requested',
  'an Auth account with no family membership cannot create closure work'
);

reset role;
select throws_ok(
  $$select private.prepare_account_closure(
    'd5000000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'Account closure could not be prepared',
  'the trusted seam rejects an unknown closure request'
);
select throws_ok(
  format(
    'update private.account_closure_requests set request_key = %L '
      'where id = %L',
    'd6000000-0000-4000-8000-000000000001',
    :'coorganizer_closure_id'
  ),
  '42501',
  'Account closure request identity is immutable',
  'closure request identity cannot be forged'
);
select throws_ok(
  format(
    'delete from private.account_closure_requests where id = %L',
    :'coorganizer_closure_id'
  ),
  '42501',
  'Account closure requests cannot be deleted',
  'closure history cannot be deleted'
);

set local role anon;
select throws_ok(
  $$select public.request_account_closure(
    'd7000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'permission denied for function request_account_closure',
  'anonymous callers are denied at the RPC ACL'
);

set local role authenticated;
select throws_ok(
  $$select * from private.account_closure_requests$$,
  '42501',
  'permission denied for table account_closure_requests',
  'authenticated callers cannot enumerate private closure history'
);
select throws_ok(
  format(
    'select private.prepare_account_closure(%L)',
    :'coorganizer_closure_id'
  ),
  '42501',
  'permission denied for function prepare_account_closure',
  'authenticated callers cannot invoke the trusted preparation seam'
);

reset role;
select * from finish();
rollback;
