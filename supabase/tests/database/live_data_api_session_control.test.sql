begin;

select plan(13);

select ok(
  (
    select not procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'private.enforce_live_data_api_session()'::regprocedure
  ),
  'the pre-request guard preserves the request role with a fixed path'
);

select ok(
  has_function_privilege(
    'anon', 'private.enforce_live_data_api_session()', 'EXECUTE'
  )
  and has_function_privilege(
    'authenticated', 'private.enforce_live_data_api_session()', 'EXECUTE'
  )
  and has_function_privilege(
    'service_role', 'private.enforce_live_data_api_session()', 'EXECUTE'
  ),
  'only Data API request roles can invoke the registered guard'
);

select ok(
  not has_function_privilege(
    'authenticated', 'public.reserve_photo_intake(uuid,uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.reserve_photo_intake(uuid,uuid,uuid)', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'public.reserve_photo_intake(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'no application or service API role can use the raw reservation seam'
);

select is(
  (
    select setting
      from pg_catalog.pg_db_role_setting as role_setting
     join pg_catalog.pg_roles as role
        on role.oid = role_setting.setrole
      join pg_catalog.pg_database as database_row
        on database_row.oid = role_setting.setdatabase
      cross join lateral unnest(role_setting.setconfig) as setting
     where role.rolname = 'authenticator'
       and database_row.datname = current_database()
       and setting like 'pgrst.db_pre_request=%'
  ),
  'pgrst.db_pre_request=private.enforce_live_data_api_session'::text,
  'PostgREST registers the exact database-scoped private pre-request guard'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok(
  $$select private.enforce_live_data_api_session()$$,
  'anonymous invitation preflight requests remain outside session checks'
);
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select lives_ok(
  $$select private.enforce_live_data_api_session()$$,
  'a mismatched JWT claim cannot turn the anonymous database role into a user request'
);
reset role;

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $$select private.enforce_live_data_api_session()$$,
  'the trusted service control plane remains outside user-session checks'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"10000000-0000-4000-8000-000000000001","session_id":"74000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select private.enforce_live_data_api_session()$$,
  '42501', 'Family session is unavailable',
  'a mismatched JWT claim cannot exempt the authenticated database role'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","session_id":"74000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select private.enforce_live_data_api_session()$$,
  '42501', 'Family session is unavailable',
  'an authenticated token without a live Auth session is rejected'
);
reset role;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values (
  '74000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '1 day'
);

set local role authenticated;
select lives_ok(
  $$select private.enforce_live_data_api_session()$$,
  'a matching live Auth session reaches the family Data API'
);
reset role;

update auth.sessions
   set user_id = '10000000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok(
  $$select private.enforce_live_data_api_session()$$,
  '42501', 'Family session is unavailable',
  'a session belonging to another account is rejected'
);
reset role;

update auth.sessions
   set user_id = '10000000-0000-4000-8000-000000000001',
       not_after = statement_timestamp() - interval '1 second';
set local role authenticated;
select throws_ok(
  $$select private.enforce_live_data_api_session()$$,
  '42501', 'Family session is unavailable',
  'an expired Auth session is rejected'
);
reset role;

update auth.sessions
   set not_after = statement_timestamp() + interval '1 day';
set local role authenticated;
select public.request_account_closure(
  'f7000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$select private.enforce_live_data_api_session()$$,
  '42501', 'Family session is unavailable',
  'an account with closure in progress is rejected'
);
reset role;

select * from finish();
rollback;
