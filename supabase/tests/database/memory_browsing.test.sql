begin;

select plan(48);

select ok(
  not has_function_privilege(
    'anon', 'public.list_memory_years(uuid,integer,integer)', 'EXECUTE'
  ),
  'anonymous clients cannot list memory years'
);
select ok(
  not has_function_privilege(
    'anon',
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamptz,uuid,integer,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot list memory moments'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.list_memory_years(uuid,integer,integer)', 'EXECUTE'
  ),
  'authenticated clients can invoke the authorized year listing'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamptz,uuid,integer,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients can invoke the authorized memory listing'
);
select ok(
  (
    select bool_and(not procedure.prosecdef)
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in ('list_memory_years', 'list_memory_moments')
  ),
  'memory reads run with invoker rights'
);
select ok(
  (
    select bool_and(procedure.provolatile = 's')
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in ('list_memory_years', 'list_memory_moments')
  ),
  'memory reads are stable within a statement'
);
select ok(
  (
    select bool_and('search_path=""' = any(procedure.proconfig))
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in ('list_memory_years', 'list_memory_moments')
  ),
  'memory reads pin an empty search path'
);
select ok(
  pg_catalog.pg_get_function_result(
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamptz,uuid,integer,timestamptz)'::regprocedure
  ) not like '%note%'
  and pg_catalog.pg_get_function_result(
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamptz,uuid,integer,timestamptz)'::regprocedure
  ) not like '%reaction%',
  'memory feed rows expose neither notes nor reactions'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'An unsupported infinite date', '-infinity'
  )$$,
  '22023', 'Moment could not be created',
  'an infinite occurrence date cannot poison family date browsing'
);
select throws_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000001', 1,
    'An unsupported BC date', '0001-01-01 BC'
  )$$,
  '22023', 'Moment could not be changed',
  'a BC occurrence date cannot poison family date browsing'
);
select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'An unsupported five-digit year', '10000-01-01'
  )$$,
  '22023', 'Moment could not be created',
  'a year beyond the application range cannot create a broken year link'
);
select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'An unsupported positive infinite date', 'infinity'
  )$$,
  '22023', 'Moment could not be created',
  'a positive infinite occurrence date cannot poison date browsing'
);
select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'An unsupported infinite instant', '2026-08-28', 'infinity', 'UTC'
  )$$,
  '22023', 'Moment could not be created',
  'an infinite precise instant cannot poison timeline formatting'
);

select is(
  (select pg_catalog.array_agg(memory_year order by memory_year desc)
   from public.list_memory_years('20000000-0000-4000-8000-000000000001')),
  array[2026, 2021, 2020],
  'available years are distinct, descending, live, and circle-scoped'
);
select throws_ok(
  $$select * from public.list_memory_years(
    '20000000-0000-4000-8000-000000000001', null, 201
  )$$,
  '22023', 'Memory years could not be listed',
  'year catalog pages are bounded at the database boundary'
);

select is(
  (select count(*)::bigint from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2026
  )),
  3::bigint,
  'year browsing returns only live moments from the selected family and year'
);

select is(
  (select count(*)::bigint from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 1998
  )),
  0::bigint,
  'a valid year without moments is an honest empty result'
);

select is(
  (select pg_catalog.string_agg(body, '|' order by occurred_on desc, moment_id desc)
   from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 8,
    anniversary_day => 28
  )),
  'A small ordinary morning worth keeping.',
  'On This Day uses the saved calendar date and cannot cross family boundaries'
);

select is(
  (select count(*)::bigint from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 8,
    anniversary_day => 20
  )),
  0::bigint,
  'trashed moments stay out of On This Day'
);

select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2026,
    anniversary_month => 8,
    anniversary_day => 28
  )$$,
  '22023', 'Memories could not be listed',
  'year and anniversary filters cannot be combined'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001'
  )$$,
  '22023', 'Memories could not be listed',
  'a memory listing requires exactly one date mode'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 0
  )$$,
  '22023', 'Memories could not be listed',
  'out-of-range years are rejected'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 2,
    anniversary_day => 30
  )$$,
  '22023', 'Memories could not be listed',
  'impossible anniversaries are rejected'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2026,
    page_size => 51
  )$$,
  '22023', 'Memories could not be listed',
  'oversized database pages are rejected'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2026,
    snapshot_at => statement_timestamp() + interval '1 minute'
  )$$,
  '22023', 'Memories could not be listed',
  'future snapshots are rejected'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2026,
    cursor_occurred_on => '2026-08-28'
  )$$,
  '22023', 'Memories could not be listed',
  'partial cursors are rejected'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2026,
    cursor_occurred_on => '2026-08-28',
    cursor_has_precise_time => false,
    cursor_moment_id => '60000000-0000-4000-8000-000000000001'
  )$$,
  '22023', 'Memories could not be listed',
  'non-empty cursors require the original snapshot'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    memory_year => 2021,
    cursor_occurred_on => '2026-08-28',
    cursor_has_precise_time => false,
    cursor_moment_id => '60000000-0000-4000-8000-000000000001',
    snapshot_at => statement_timestamp()
  )$$,
  '22023', 'Memories could not be listed',
  'a cursor cannot be replayed into another year'
);

reset role;
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, body, occurred_on
) values
  ('61000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'Leap day exact', '2024-02-29'),
  ('61000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'February twenty-eight exact', '2023-02-28');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is(
  (select pg_catalog.string_agg(body, '|' order by occurred_on)
   from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 2,
    anniversary_day => 29
  )),
  'Leap day exact',
  'February 29 memories appear only on the exact leap-day anniversary'
);
select is(
  (select pg_catalog.string_agg(body, '|' order by occurred_on)
   from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 2,
    anniversary_day => 28
  )),
  'February twenty-eight exact',
  'February 28 does not absorb leap-day memories'
);

select throws_ok(
  $$select * from public.list_memory_years('20000000-0000-4000-8000-000000000002')$$,
  '42501', 'Memories could not be listed',
  'an active member cannot enumerate another family archive'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000002', memory_year => 2026
  )$$,
  '42501', 'Memories could not be listed',
  'an active member cannot read another family memory journey'
);
select throws_ok(
  $$select * from public.list_memory_years('20000000-0000-4000-8000-999999999999')$$,
  '42501', 'Memories could not be listed',
  'a nonexistent family produces the same denial as another family'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select throws_ok(
  $$select * from public.list_memory_years('20000000-0000-4000-8000-000000000001')$$,
  '42501', 'Memories could not be listed',
  'a revoked member cannot enumerate memory years with a stale identity'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001', memory_year => 2026
  )$$,
  '42501', 'Memories could not be listed',
  'a revoked member cannot read a memory journey with a stale identity'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 8, anniversary_day => 28
  )$$,
  '42501', 'Memories could not be listed',
  'a revoked member cannot read On This Day with a stale identity'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select throws_ok(
  $$select * from public.list_memory_years('20000000-0000-4000-8000-000000000001')$$,
  '42501', 'Memories could not be listed',
  'an authenticated identity without a circle cannot enumerate years'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001', memory_year => 2026
  )$$,
  '42501', 'Memories could not be listed',
  'an authenticated identity without a circle cannot read memories'
);
select throws_ok(
  $$select * from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001',
    anniversary_month => 8, anniversary_day => 28
  )$$,
  '42501', 'Memories could not be listed',
  'an authenticated identity without a circle cannot read On This Day'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select is(
  (select count(*)::bigint from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000001', memory_year => 2026
  )),
  3::bigint,
  'a dual-circle member reads circle A only when circle A is requested'
);
select is(
  (select count(*)::bigint from public.list_memory_moments(
    circle_id => '20000000-0000-4000-8000-000000000002', memory_year => 2026
  )),
  1::bigint,
  'a dual-circle member reads circle B only when circle B is requested'
);

reset role;
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, body, occurred_on
)
select
  ('63000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  format('Year catalog fixture %s', sequence),
  pg_catalog.make_date(999 + sequence, 1, 1)
from generate_series(1, 205) as sequence;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
create temporary table memory_year_page_one on commit drop as
select * from public.list_memory_years(
  '20000000-0000-4000-8000-000000000001', null, 200
);
create temporary table memory_year_page_two on commit drop as
select * from public.list_memory_years(
  '20000000-0000-4000-8000-000000000001',
  (select min(memory_year) from memory_year_page_one),
  200
);
select is(
  (select count(*)::bigint from memory_year_page_one),
  200::bigint,
  'the year catalog page is explicitly bounded'
);
select is(
  (select count(*)::bigint from (
    select memory_year from memory_year_page_one
    union all
    select memory_year from memory_year_page_two
  ) years),
  (select count(distinct pg_catalog.date_part('year', occurred_on))::bigint
   from public.moments
   where circle_id = '20000000-0000-4000-8000-000000000001'
     and trashed_at is null),
  'keyset year pages expose every distinct live year without silent truncation'
);

reset role;
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, body, occurred_on,
  occurred_at, occurred_timezone, time_precision
)
select
  ('62000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '30000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  format('Memory pagination fixture %s', sequence),
  '2018-02-03'::date,
  '2018-02-03 18:00:00+00'::timestamptz,
  'America/Los_Angeles',
  'minute'
from generate_series(1, 42) as sequence;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
create temporary table memory_page_one on commit drop as
select * from public.list_memory_moments(
  circle_id => '20000000-0000-4000-8000-000000000001',
  anniversary_month => 2,
  anniversary_day => 3,
  page_size => 20
);

reset role;
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, body, occurred_on,
  created_at, updated_at
)
select
  '62000000-0000-4000-8000-999999999999',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Inserted after the memory snapshot',
  '2018-02-03',
  feed_snapshot_at + interval '1 second',
  feed_snapshot_at + interval '1 second'
from memory_page_one limit 1;

update public.moments
set body = 'Edited after the memory snapshot',
    updated_at = (select feed_snapshot_at + interval '1 second' from memory_page_one limit 1)
where id = '62000000-0000-4000-8000-000000000042';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
create temporary table memory_page_two on commit drop as
select * from public.list_memory_moments(
  circle_id => '20000000-0000-4000-8000-000000000001',
  anniversary_month => 2,
  anniversary_day => 3,
  cursor_occurred_on => (select occurred_on from memory_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_has_precise_time => (select occurred_at is not null from memory_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_occurred_at => (select occurred_at from memory_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_moment_id => (select moment_id from memory_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from memory_page_one limit 1)
);
create temporary table memory_page_three on commit drop as
select * from public.list_memory_moments(
  circle_id => '20000000-0000-4000-8000-000000000001',
  anniversary_month => 2,
  anniversary_day => 3,
  cursor_occurred_on => (select occurred_on from memory_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_has_precise_time => (select occurred_at is not null from memory_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_occurred_at => (select occurred_at from memory_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_moment_id => (select moment_id from memory_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from memory_page_one limit 1)
);

select is((select count(*)::bigint from memory_page_one), 20::bigint, 'the first memory page is bounded');
select is(
  (select count(*)::bigint from (
    select moment_id from memory_page_one union all
    select moment_id from memory_page_two union all
    select moment_id from memory_page_three
  ) pages),
  42::bigint,
  'stable keyset pagination covers every equal-time memory exactly once'
);
select is(
  (select count(distinct moment_id)::bigint from (
    select moment_id from memory_page_one union all
    select moment_id from memory_page_two union all
    select moment_id from memory_page_three
  ) pages),
  42::bigint,
  'memory keyset pages contain no duplicate moments'
);
select is(
  (select count(*)::bigint from (
    select body from memory_page_one union all
    select body from memory_page_two union all
    select body from memory_page_three
  ) pages where body in ('Inserted after the memory snapshot', 'Edited after the memory snapshot')),
  0::bigint,
  'insertions and edits after page one do not enter its memory snapshot'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'moments_live_circle_anniversary_idx'
      and indexdef like '%WHERE (trashed_at IS NULL)%'
  ),
  'On This Day has a live-only circle anniversary index'
);

select * from finish();
rollback;
