begin;

select plan(25);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_milestone_memories(uuid,date,boolean,timestamptz,uuid,integer,timestamptz)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute milestone browsing'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.list_milestone_memories(uuid,date,boolean,timestamptz,uuid,integer,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients can execute milestone browsing'
);

select ok(
  not (
    select procedure.prosecdef
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.list_milestone_memories(uuid,date,boolean,timestamptz,uuid,integer,timestamptz)'::regprocedure
  ),
  'milestone browsing remains security invoker'
);

select is(
  (
    select procedure.provolatile
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.list_milestone_memories(uuid,date,boolean,timestamptz,uuid,integer,timestamptz)'::regprocedure
  ),
  's'::"char",
  'milestone browsing is stable'
);

select is(
  (
    select procedure.proconfig
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.list_milestone_memories(uuid,date,boolean,timestamptz,uuid,integer,timestamptz)'::regprocedure
  ),
  array['search_path=""']::text[],
  'milestone browsing pins an empty search path'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'moments_live_circle_milestone_idx'
       and indexdef like '%WHERE ((trashed_at IS NULL) AND (kind = ''milestone''::text))%'
  ),
  'live milestone browsing has a dedicated partial index'
);

insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, kind, title, body,
  occurred_on, occurred_at, occurred_timezone, time_precision
)
values
  (
    '60000000-0000-4000-8000-000000000081',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'milestone', 'A later milestone', 'Held in its true order.',
    '2024-05-01', null, null, 'date'
  ),
  (
    '60000000-0000-4000-8000-000000000082',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'milestone', 'An earlier milestone', '',
    '2018-02-03', '2018-02-03 18:00:00+00', 'America/Los_Angeles', 'minute'
  ),
  (
    '60000000-0000-4000-8000-000000000083',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'milestone', 'A trashed milestone', '',
    '2025-01-01', null, null, 'date'
  );

update public.moments
   set trashed_at = statement_timestamp(),
       trashed_by_user_id = '10000000-0000-4000-8000-000000000001'
 where id = '60000000-0000-4000-8000-000000000083';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select is(
  (
    select count(*)::bigint
      from public.list_milestone_memories(
        '20000000-0000-4000-8000-000000000001'
      )
  ),
  3::bigint,
  'an active member sees every live milestone in their circle'
);

select ok(
  not exists (
    select 1
      from public.list_milestone_memories(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_kind <> 'milestone'
        or moment_circle_id <> '20000000-0000-4000-8000-000000000001'
        or moment_id = '60000000-0000-4000-8000-000000000083'
  ),
  'the result excludes other kinds, circles, and trashed milestones'
);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'Milestones could not be listed',
  'a member cannot browse another circle milestones'
);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001', page_size => 0
  )$$,
  '22023',
  'Milestones could not be listed',
  'page size must stay inside the reviewed bound'
);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001', page_size => 51
  )$$,
  '22023',
  'Milestones could not be listed',
  'oversized milestone pages fail closed'
);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001',
    cursor_occurred_on => date '2024-05-01'
  )$$,
  '22023',
  'Milestones could not be listed',
  'partial milestone cursors fail closed'
);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001',
    cursor_occurred_on => date '2024-05-01',
    cursor_has_precise_time => false,
    cursor_moment_id => '60000000-0000-4000-8000-000000000081'
  )$$,
  '22023',
  'Milestones could not be listed',
  'a milestone cursor requires its original snapshot'
);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001',
    snapshot_at => statement_timestamp() + interval '1 minute'
  )$$,
  '22023',
  'Milestones could not be listed',
  'future milestone snapshots fail closed'
);

create temporary table milestone_page_one on commit drop as
select * from public.list_milestone_memories(
  '20000000-0000-4000-8000-000000000001', page_size => 2
);

select is(
  (
    select moment_id
      from milestone_page_one
     order by occurred_on desc, occurred_at desc nulls last, moment_id desc
     offset 1 limit 1
  ),
  '60000000-0000-4000-8000-000000000007'::uuid,
  'the first bounded page ends on the expected milestone'
);

create temporary table milestone_page_two on commit drop as
select * from public.list_milestone_memories(
  circle_id => '20000000-0000-4000-8000-000000000001',
  cursor_occurred_on => (
    select occurred_on from milestone_page_one
     order by occurred_on desc, occurred_at desc nulls last, moment_id desc
     offset 1 limit 1
  ),
  cursor_has_precise_time => (
    select occurred_at is not null from milestone_page_one
     order by occurred_on desc, occurred_at desc nulls last, moment_id desc
     offset 1 limit 1
  ),
  cursor_occurred_at => (
    select occurred_at from milestone_page_one
     order by occurred_on desc, occurred_at desc nulls last, moment_id desc
     offset 1 limit 1
  ),
  cursor_moment_id => (
    select moment_id from milestone_page_one
     order by occurred_on desc, occurred_at desc nulls last, moment_id desc
     offset 1 limit 1
  ),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from milestone_page_one limit 1)
);

select is(
  (select count(*)::bigint from milestone_page_two),
  1::bigint,
  'the next milestone page continues after the exact keyset cursor'
);

select ok(
  not exists (
    select moment_id from milestone_page_two
     where moment_id in (
      '60000000-0000-4000-8000-000000000007',
      '60000000-0000-4000-8000-000000000081'
    )
  ),
  'milestone pagination does not repeat earlier rows'
);

reset role;
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, kind, title, body,
  occurred_on
)
select
  ('63000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '30000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'milestone',
  format('Equal-date milestone %s', sequence),
  '',
  '2010-01-01'::date
from generate_series(1, 42) as sequence;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
create temporary table milestone_tie_page_one on commit drop as
select * from public.list_milestone_memories(
  circle_id => '20000000-0000-4000-8000-000000000001',
  page_size => 20
);

reset role;
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_user_id, kind, title, body,
  occurred_on, created_at, updated_at
)
select
  '63000000-0000-4000-8000-999999999999',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'milestone',
  'Inserted after the milestone snapshot',
  '',
  '2010-01-01',
  feed_snapshot_at + interval '1 second',
  feed_snapshot_at + interval '1 second'
from milestone_tie_page_one limit 1;

update public.moments
   set title = 'Edited after the milestone snapshot',
       updated_at = (
         select feed_snapshot_at + interval '1 second'
           from milestone_tie_page_one limit 1
       )
 where id = '63000000-0000-4000-8000-000000000042';

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
create temporary table milestone_tie_page_two on commit drop as
select * from public.list_milestone_memories(
  circle_id => '20000000-0000-4000-8000-000000000001',
  cursor_occurred_on => (select occurred_on from milestone_tie_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_has_precise_time => (select occurred_at is not null from milestone_tie_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_occurred_at => (select occurred_at from milestone_tie_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_moment_id => (select moment_id from milestone_tie_page_one order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from milestone_tie_page_one limit 1)
);
create temporary table milestone_tie_page_three on commit drop as
select * from public.list_milestone_memories(
  circle_id => '20000000-0000-4000-8000-000000000001',
  cursor_occurred_on => (select occurred_on from milestone_tie_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_has_precise_time => (select occurred_at is not null from milestone_tie_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_occurred_at => (select occurred_at from milestone_tie_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  cursor_moment_id => (select moment_id from milestone_tie_page_two order by occurred_on desc, occurred_at desc nulls last, moment_id desc offset 19 limit 1),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from milestone_tie_page_one limit 1)
);

select is(
  (select count(*)::bigint from milestone_tie_page_one),
  20::bigint,
  'the first milestone tie page is bounded'
);
select is(
  (select count(*)::bigint from (
    select moment_id from milestone_tie_page_one union all
    select moment_id from milestone_tie_page_two union all
    select moment_id from milestone_tie_page_three
  ) pages),
  45::bigint,
  'stable keyset pagination covers every milestone exactly once'
);
select is(
  (select count(distinct moment_id)::bigint from (
    select moment_id from milestone_tie_page_one union all
    select moment_id from milestone_tie_page_two union all
    select moment_id from milestone_tie_page_three
  ) pages),
  45::bigint,
  'milestone tie pages contain no duplicate moments'
);
select is(
  (select count(*)::bigint from (
    select moment_title from milestone_tie_page_one union all
    select moment_title from milestone_tie_page_two union all
    select moment_title from milestone_tie_page_three
  ) pages where moment_title in (
    'Inserted after the milestone snapshot',
    'Edited after the milestone snapshot'
  )),
  0::bigint,
  'insertions and edits after page one do not enter its milestone snapshot'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Milestones could not be listed',
  'an authenticated account without a circle cannot browse milestones'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Milestones could not be listed',
  'a revoked member cannot browse milestones with a stale JWT'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select is(
  (
    select count(*)::bigint
      from public.list_milestone_memories(
        '20000000-0000-4000-8000-000000000002'
      )
  ),
  0::bigint,
  'a circle with no milestones receives an empty result'
);

reset role;
set local role anon;
select throws_ok(
  $$select * from public.list_milestone_memories(
    '20000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'permission denied for function list_milestone_memories',
  'anonymous callers cannot invoke milestone browsing'
);

reset role;

select * from finish();
rollback;
