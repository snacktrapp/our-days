begin;

select plan(7);

select ok(
  (
    select procedure.prosecdef
      and procedure.provolatile = 's'
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'private.current_family_session_is_live()'::regprocedure
  ),
  'session liveness stays security definer, stable, and search_path locked'
);

select ok(
  has_function_privilege(
    'authenticated', 'private.current_family_session_is_live()', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'private.current_family_session_is_live()', 'EXECUTE'
  )
  and not has_function_privilege(
    'service_role', 'private.current_family_session_is_live()', 'EXECUTE'
  ),
  'only the authenticated role can execute the session liveness check'
);

select ok(
  position(
    'id::text' in pg_catalog.pg_get_functiondef(
      'private.current_family_session_is_live()'::regprocedure
    )
  ) = 0,
  'the live session lookup compares the uuid primary key'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"10000000-0000-4000-8000-000000000001","session_id":"not-a-uuid"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select lives_ok(
  $$select private.current_family_session_is_live()$$,
  'a malformed session claim does not raise'
);
select is(
  (select private.current_family_session_is_live()),
  false,
  'a malformed session claim is not live'
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
select is(
  (select private.current_family_session_is_live()),
  false,
  'a claim without a live auth session is not live'
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
select is(
  (select private.current_family_session_is_live()),
  true,
  'a matching live auth session is live'
);
reset role;

select * from finish();
rollback;
