begin;

select plan(27);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'found_search_claims'
  ),
  'private',
  'Found search claims stay outside the exposed schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'found_search_claims'
  ),
  'Found search claims force row level security'
);

select is(
  (
    select array_agg(attribute.attname order by attribute.attnum)
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as class
        on class.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'found_search_claims'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ),
  array['claim_id', 'user_id', 'usage_date', 'claimed_at', 'refunded_at']::name[],
  'Found search claims store an id and a timestamp, not the query'
);

select ok(
  not has_table_privilege('anon', 'private.found_search_claims', 'select')
    and not has_table_privilege('authenticated', 'private.found_search_claims', 'select')
    and not has_table_privilege('anon', 'private.found_search_claims', 'insert')
    and not has_table_privilege('authenticated', 'private.found_search_claims', 'update')
    and not has_table_privilege('service_role', 'private.found_search_claims', 'select'),
  'API roles have no grants on Found search claims'
);

select ok(
  not has_function_privilege('anon', 'public.refund_found_search(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.refund_found_search(uuid)', 'execute'),
  'anon cannot refund a Found search'
);

select ok(
  has_function_privilege('authenticated', 'public.refund_found_search(uuid)', 'execute')
    and has_function_privilege('authenticated', 'private.refund_found_search(uuid)', 'execute'),
  'authenticated can refund a Found search'
);

select ok(
  not has_function_privilege('service_role', 'public.refund_found_search(uuid)', 'execute'),
  'the service role is not granted Found search refunds'
);

select ok(
  (
    select prosecdef
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = proc.pronamespace
     where namespace.nspname = 'private'
       and proc.proname = 'refund_found_search'
  ),
  'private refund_found_search is security definer'
);

select ok(
  not (
    select prosecdef
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = proc.pronamespace
     where namespace.nspname = 'public'
       and proc.proname = 'refund_found_search'
  ),
  'public refund_found_search stays security invoker'
);

select ok(
  position(
    '40001' in pg_catalog.pg_get_functiondef('private.refund_found_search(uuid)'::regprocedure)
  ) = 0
    and position(
      '40001' in pg_catalog.pg_get_functiondef('public.refund_found_search(uuid)'::regprocedure)
    ) = 0
    and position(
      '40001' in pg_catalog.pg_get_functiondef('private.claim_found_search()'::regprocedure)
    ) = 0,
  'Found search refund does not raise serialization failures'
);

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok(
  'select public.refund_found_search(null)',
  '42501',
  'Sign in to continue',
  'a signed-out session cannot refund a Found search'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select set_config('found.claim_one', public.claim_found_search(), true);
reset role;

select ok(
  current_setting('found.claim_one') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'a claim returns an id'
);

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  1,
  'the claim uses one daily search'
);

set local role authenticated;
select is(
  public.refund_found_search(current_setting('found.claim_one')::uuid),
  'refunded',
  'the caller can refund their own recent claim'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  0,
  'a refund gives the daily search back'
);

set local role authenticated;
select is(
  public.refund_found_search(current_setting('found.claim_one')::uuid),
  'ignored',
  'a claim cannot be refunded twice'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  0,
  'a second refund leaves the counter alone'
);

set local role authenticated;
select set_config('found.claim_two', public.claim_found_search(), true);
select is(
  public.refund_found_search(null),
  'ignored',
  'a missing claim id is ignored'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  1,
  'ignoring a null id keeps the new claim'
);

update private.found_search_claims
   set claimed_at = pg_catalog.statement_timestamp() - interval '11 minutes'
 where claim_id = current_setting('found.claim_two')::uuid;

set local role authenticated;
select is(
  public.refund_found_search(current_setting('found.claim_two')::uuid),
  'ignored',
  'a claim older than 10 minutes is not refunded'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  1,
  'an old claim stays counted'
);

update private.found_search_claims
   set claimed_at = pg_catalog.statement_timestamp() - interval '9 minutes'
 where claim_id = current_setting('found.claim_two')::uuid;

set local role authenticated;
select is(
  public.refund_found_search(current_setting('found.claim_two')::uuid),
  'refunded',
  'a claim from the last 10 minutes can be refunded'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  0,
  'a nine-minute-old claim is given back'
);

set local role authenticated;
select set_config('found.claim_three', public.claim_found_search(), true);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
set local role authenticated;
select is(
  public.refund_found_search(current_setting('found.claim_three')::uuid),
  'ignored',
  'another person cannot refund the claim'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000004'
  ),
  1,
  'the owner still holds the unrefunded claim'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
set local role authenticated;
select throws_ok(
  'select count(*) from private.found_search_claims',
  '42501',
  'permission denied for table found_search_claims',
  'a member cannot read Found search claims'
);
select throws_ok(
  $$update private.found_search_claims set refunded_at = statement_timestamp()$$,
  '42501',
  'permission denied for table found_search_claims',
  'a member cannot write Found search claims'
);
reset role;

select * from finish();
rollback;
