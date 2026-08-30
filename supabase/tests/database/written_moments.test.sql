begin;

select plan(44);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::bigint from public.moments),
  4::bigint,
  'an active circle A member sees only live circle A moments'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001'
  )),
  4::bigint,
  'the combined feed returns all live moments in the requested circle'
);

select is(
  (select count(*)::bigint from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  )),
  1::bigint,
  'the personal feed returns only the selected journal'
);

select is(
  (select moment_id from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    null,
    '2026-08-27',
    true,
    '2026-08-27 17:15:00+00',
    '60000000-0000-4000-8000-000000000003',
    1
  )),
  '60000000-0000-4000-8000-000000000002'::uuid,
  'an equal-timestamp cursor continues by UUID without skipping'
);

select is(
  (select moment_id from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    null,
    '2026-08-28',
    false,
    null,
    '60000000-0000-4000-8000-000000000001',
    1
  )),
  '60000000-0000-4000-8000-000000000003'::uuid,
  'a date-only cursor advances to the next older date'
);

select is(
  public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '  A newly written thought.  ',
    '2026-08-29'
  ) is not null,
  true,
  'an adult can create a moment in their own journal'
);

select is(
  public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'A guardian records this faithfully.',
    '2020-01-02'
  ) is not null,
  true,
  'a guardian can create a backdated managed-child moment under PD-001'
);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'An unauthorized rewrite boundary.',
    '2026-08-29'
  )$$,
  '42501',
  'Moment could not be created',
  'an organizer cannot write in another adult journal under PD-002'
);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000009',
    'Wrong circle.',
    '2026-08-29'
  )$$,
  '42501',
  'Moment could not be created',
  'a caller cannot borrow authority in another circle'
);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Mismatched local date.',
    '2026-08-27',
    '2026-08-28 07:30:00+00',
    'America/Los_Angeles'
  )$$,
  '22023',
  'Moment could not be created',
  'precise times must agree with the authoritative date in their timezone'
);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    E' \n\t ',
    '2026-08-29'
  )$$,
  '22023',
  'Moment could not be created',
  'whitespace-only thoughts are rejected'
);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'Minute precision cannot hide seconds.',
    '2026-08-27',
    '2026-08-27 17:15:30+00',
    'America/Los_Angeles'
  )$$,
  '22023',
  'Moment could not be created',
  'minute precision rejects second-level instants'
);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A future moment is not history yet.',
    '2999-01-01'
  )$$,
  '22023',
  'Moment could not be created',
  'future dates are rejected in the circle calendar'
);

select throws_ok(
  $$select * from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    null,
    '2026-08-27'
  )$$,
  '22023',
  'Timeline could not be listed',
  'partial cursors fail instead of silently restarting'
);

select throws_ok(
  $$select * from public.list_timeline_moments(
    '20000000-0000-4000-8000-000000000001',
    null, null, null, null, null, 0
  )$$,
  '22023',
  'Timeline could not be listed',
  'page size must remain within the reviewed bound'
);

select lives_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000001',
    1,
    'The ordinary morning became even more memorable.',
    '2026-08-28'
  )$$,
  'an adult can edit their own written moment'
);

select lives_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000002',
    1,
    'Either active guardian can correct the child journal.',
    '2026-08-27'
  )$$,
  'a guardian can edit a managed-child moment regardless of recorder'
);

select throws_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000003',
    1,
    'An organizer must not rewrite another adult.',
    '2026-08-27'
  )$$,
  '42501',
  'Moment could not be changed',
  'an organizer cannot edit another adult moment'
);

select lives_ok(
  $$select public.set_written_moment_trashed(
    '60000000-0000-4000-8000-000000000001', 2, true
  )$$,
  'an adult can move their own moment to reversible trash'
);

select is(
  (select count(*)::bigint from public.moments where id = '60000000-0000-4000-8000-000000000001'),
  0::bigint,
  'trashed moments disappear from the ordinary RLS read surface'
);

select is(
  (select count(*)::bigint from public.list_manageable_trashed_written_moments(
    '20000000-0000-4000-8000-000000000001'
  )),
  2::bigint,
  'the actor sees only trash they can restore, including managed-child trash'
);

select lives_ok(
  $$select public.set_written_moment_trashed(
    '60000000-0000-4000-8000-000000000001', 3, false
  )$$,
  'an authorized actor can restore a moment'
);

select lives_ok(
  $$select public.set_written_moment_trashed(
    '60000000-0000-4000-8000-000000000001', 4, false
  )$$,
  'restore is idempotent'
);

select throws_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000001',
    2,
    'A stale tab must not overwrite the latest version.',
    '2026-08-28'
  )$$,
  '40001',
  'Moment changed elsewhere',
  'optimistic concurrency rejects a stale edit after authorization'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select lives_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000002',
    2,
    'The second guardian can edit this child memory too.',
    '2026-08-27'
  )$$,
  'the second active guardian receives the same managed-child authority'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select lives_ok(
  $$select public.update_written_moment(
    '60000000-0000-4000-8000-000000000004',
    1,
    'The adult corrected their own historical page.',
    '2021-04-03'
  )$$,
  'an ordinary adult member can edit their own historical moment'
);

select throws_ok(
  $$select public.set_written_moment_trashed(
    '60000000-0000-4000-8000-000000000002', 3, true
  )$$,
  '42501',
  'Moment could not be changed',
  'a non-guardian cannot trash a managed-child moment'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'A role in another circle grants nothing here.',
    '2026-08-29'
  )$$,
  '42501',
  'Moment could not be created',
  'a dual-circle member cannot borrow organizer authority across circles'
);

select is(
  public.create_written_moment(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000009',
    'The organizer can care for a managed journal in this circle.',
    '2026-08-29'
  ) is not null,
  true,
  'an in-circle organizer can manage child content under PD-002'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);

select is((select count(*)::bigint from public.moments), 0::bigint, 'a revoked member reads no moments');

select throws_ok(
  $$select public.create_written_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000004',
    'A stale token cannot write.',
    '2026-08-29'
  )$$,
  '42501',
  'Moment could not be created',
  'a revoked member cannot create with a stale identity token'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is((select count(*)::bigint from public.moments), 2::bigint, 'circle B sees only its own live moments');
select is(
  (select count(*)::bigint from public.list_manageable_trashed_written_moments(
    '20000000-0000-4000-8000-000000000001'
  )),
  0::bigint,
  'circle B cannot inspect circle A trash'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

insert into public.moments (
  id,
  circle_id,
  journal_person_id,
  recorded_by_user_id,
  body,
  occurred_on,
  occurred_at,
  occurred_timezone,
  time_precision
)
select
  ('70000000-0000-4000-8000-' || lpad(sequence::text, 12, '0'))::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '30000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  format('Pagination fixture %s', sequence),
  '2018-02-03'::date,
  '2018-02-03 18:00:00+00'::timestamptz,
  'America/Los_Angeles',
  'minute'
from generate_series(1, 42) as sequence;

create temporary table pagination_page_one on commit drop as
select *
from public.list_timeline_moments(
  circle_id => '20000000-0000-4000-8000-000000000001',
  journal_person_id => '30000000-0000-4000-8000-000000000001',
  page_size => 20
);

insert into public.moments (
  id,
  circle_id,
  journal_person_id,
  recorded_by_user_id,
  body,
  occurred_on,
  created_at,
  updated_at
)
select
  '70000000-0000-4000-8000-999999999999'::uuid,
  '20000000-0000-4000-8000-000000000001'::uuid,
  '30000000-0000-4000-8000-000000000001'::uuid,
  '10000000-0000-4000-8000-000000000001'::uuid,
  'Inserted after the feed snapshot',
  '2018-02-03'::date,
  feed_snapshot_at + interval '1 second',
  feed_snapshot_at + interval '1 second'
from pagination_page_one
limit 1;

update public.moments
set
  body = 'Edited after the feed snapshot',
  occurred_on = '2026-08-29',
  occurred_at = null,
  occurred_timezone = null,
  time_precision = 'date',
  updated_at = (
    select feed_snapshot_at + interval '1 second'
    from pagination_page_one
    limit 1
  )
where id = '70000000-0000-4000-8000-000000000001';

create temporary table pagination_page_two on commit drop as
select *
from public.list_timeline_moments(
  circle_id => '20000000-0000-4000-8000-000000000001',
  journal_person_id => '30000000-0000-4000-8000-000000000001',
  cursor_occurred_on => (
    select occurred_on from pagination_page_one
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  cursor_has_precise_time => (
    select occurred_at is not null from pagination_page_one
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  cursor_occurred_at => (
    select occurred_at from pagination_page_one
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  cursor_moment_id => (
    select moment_id from pagination_page_one
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from pagination_page_one limit 1)
);

create temporary table pagination_page_three on commit drop as
select *
from public.list_timeline_moments(
  circle_id => '20000000-0000-4000-8000-000000000001',
  journal_person_id => '30000000-0000-4000-8000-000000000001',
  cursor_occurred_on => (
    select occurred_on from pagination_page_two
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  cursor_has_precise_time => (
    select occurred_at is not null from pagination_page_two
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  cursor_occurred_at => (
    select occurred_at from pagination_page_two
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  cursor_moment_id => (
    select moment_id from pagination_page_two
    order by occurred_on desc, occurred_at desc nulls last, moment_id desc
    offset 19 limit 1
  ),
  page_size => 20,
  snapshot_at => (select feed_snapshot_at from pagination_page_one limit 1)
);

select is(
  (select count(*)::bigint from pagination_page_one),
  20::bigint,
  'a full first page is returned for a long equal-time journal'
);

select is(
  (
    select count(*)::bigint
    from (
      select moment_id from pagination_page_one
      union all
      select moment_id from pagination_page_two
      union all
      select moment_id from pagination_page_three
    ) as pages
  ),
  (
    select count(*)::bigint
    from public.moments
    where circle_id = '20000000-0000-4000-8000-000000000001'
      and journal_person_id = '30000000-0000-4000-8000-000000000001'
      and trashed_at is null
      and created_at <= (select feed_snapshot_at from pagination_page_one limit 1)
      and updated_at <= (select feed_snapshot_at from pagination_page_one limit 1)
  ),
  'three pages cover the complete personal-feed snapshot'
);

select is(
  (
    select count(distinct moment_id)::bigint
    from (
      select moment_id from pagination_page_one
      union all
      select moment_id from pagination_page_two
      union all
      select moment_id from pagination_page_three
    ) as pages
  ),
  (
    select count(*)::bigint
    from (
      select moment_id from pagination_page_one
      union all
      select moment_id from pagination_page_two
      union all
      select moment_id from pagination_page_three
    ) as pages
  ),
  'equal-time pagination returns no duplicate moments'
);

select is(
  (
    select count(*)::bigint
    from (
      select body from pagination_page_one
      union all
      select body from pagination_page_two
      union all
      select body from pagination_page_three
    ) as pages
    where body = 'Inserted after the feed snapshot'
  ),
  0::bigint,
  'a historical insertion made after page one does not destabilize later pages'
);

select is(
  (
    select count(*)::bigint
    from (
      select body from pagination_page_one
      union all
      select body from pagination_page_two
      union all
      select body from pagination_page_three
    ) as pages
    where body = 'Edited after the feed snapshot'
  ),
  0::bigint,
  'a historical edit made after page one does not move into the active snapshot'
);

select throws_ok(
  $$update public.moments
       set journal_person_id = '30000000-0000-4000-8000-000000000008'
     where id = '60000000-0000-4000-8000-000000000001'$$,
  '42501',
  'Moment identity is immutable',
  'journal ownership cannot be rewritten directly'
);

select throws_ok(
  $$delete from public.moments
     where id = '60000000-0000-4000-8000-000000000001'$$,
  '42501',
  'Moments must use the reviewed deletion workflow',
  'hard deletion is unavailable before PD-005'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into public.moments (
    circle_id, journal_person_id, recorded_by_user_id, body, occurred_on
  ) values (
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'Direct browser insert.',
    '2026-08-29'
  )$$,
  '42501',
  'permission denied for table moments',
  'authenticated clients cannot bypass the mutation RPC'
);

reset role;

select ok(
  (select count(*) from private.audit_events where event_type like 'moment_%') >= 6,
  'moment mutations leave membership-attributed audit events'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'moments_live_circle_timeline_idx'
       and indexdef like '%occurred_on DESC, ((occurred_at IS NOT NULL)) DESC, occurred_at DESC NULLS LAST, id DESC%'
  ),
  'the combined feed has a stable partial keyset index'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_indexes
     where schemaname = 'public'
       and indexname = 'moments_live_person_timeline_idx'
       and indexdef like '%journal_person_id, occurred_on DESC, ((occurred_at IS NOT NULL)) DESC, occurred_at DESC NULLS LAST, id DESC%'
  ),
  'personal feeds have a stable partial keyset index'
);

select * from finish();
rollback;
