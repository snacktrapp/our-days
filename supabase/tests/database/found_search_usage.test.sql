begin;

select plan(18);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'found_search_usage'
  ),
  'private',
  'Found search usage stays outside the exposed schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'found_search_usage'
  ),
  'Found search usage forces row level security'
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
       and class.relname = 'found_search_usage'
       and attribute.attnum > 0
       and not attribute.attisdropped
  ),
  array['user_id', 'usage_date', 'count']::name[],
  'Found search usage stores only the counter'
);

select ok(
  not has_table_privilege('anon', 'private.found_search_usage', 'select')
    and not has_table_privilege('authenticated', 'private.found_search_usage', 'select')
    and not has_table_privilege('anon', 'private.found_search_usage', 'insert')
    and not has_table_privilege('authenticated', 'private.found_search_usage', 'update'),
  'API roles have no grants on Found search usage'
);

select ok(
  not has_function_privilege('anon', 'public.claim_found_search()', 'execute')
    and not has_function_privilege('anon', 'private.claim_found_search()', 'execute'),
  'anon cannot claim a Found search'
);

select ok(
  has_function_privilege('authenticated', 'public.claim_found_search()', 'execute')
    and has_function_privilege('authenticated', 'private.claim_found_search()', 'execute'),
  'authenticated can claim a Found search'
);

select ok(
  not has_function_privilege('service_role', 'public.claim_found_search()', 'execute'),
  'the service role is not granted Found search claims'
);

select ok(
  (
    select prosecdef
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = proc.pronamespace
     where namespace.nspname = 'private'
       and proc.proname = 'claim_found_search'
  ),
  'private claim_found_search is security definer'
);

select ok(
  not (
    select prosecdef
      from pg_catalog.pg_proc as proc
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = proc.pronamespace
     where namespace.nspname = 'public'
       and proc.proname = 'claim_found_search'
  ),
  'public claim_found_search stays security invoker'
);

select ok(
  position(
    '40001' in pg_catalog.pg_get_functiondef('private.claim_found_search()'::regprocedure)
  ) = 0
    and position(
      '40001' in pg_catalog.pg_get_functiondef('public.claim_found_search()'::regprocedure)
    ) = 0,
  'claim_found_search does not raise serialization failures'
);

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
select throws_ok(
  'select public.claim_found_search()',
  '42501',
  'Sign in to continue',
  'a signed-out session cannot claim a Found search'
);
reset role;

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
set local role authenticated;
select is(
  public.claim_found_search(),
  'claimed',
  'the first Found search of the day is claimed'
);
select lives_ok(
  $$
    do $claims$
    begin
      for claim_index in 2..10 loop
        if public.claim_found_search() is distinct from 'claimed' then
          raise exception 'expected claimed';
        end if;
      end loop;
    end
    $claims$;
  $$,
  'claims 2 through 10 are claimed'
);
select is(
  public.claim_found_search(),
  'capped',
  'the 11th Found search is capped'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000001'
  ),
  10,
  'the daily counter stays at 10'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
set local role authenticated;
select is(
  public.claim_found_search(),
  'claimed',
  'another person has a separate counter'
);
reset role;

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000003'
  ),
  1,
  'the second counter starts at 1'
);

select is(
  (
    select count
      from private.found_search_usage
     where user_id = '10000000-0000-4000-8000-000000000001'
  ),
  10,
  'the first counter is unchanged by the second person'
);

select * from finish();
rollback;
