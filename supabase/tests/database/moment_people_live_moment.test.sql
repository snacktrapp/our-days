begin;

select plan(7);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'A tagged porch afternoon for both circles.',
    null, array['30000000-0000-4000-8000-000000000002'::uuid],
    '2026-08-29', null, null, null, null, 'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  'a dual-circle member can post a tagged family moment to Cedar and Harbor'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (
    select tagged_people -> 0 ->> 'name'
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where body = 'A tagged porch afternoon for both circles.'
  ),
  'A Organizer Two',
  'the primary circle family feed includes the Cedar tag name'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000002'
      )
     where body = 'A tagged porch afternoon for both circles.'
  ),
  1::bigint,
  'a Harbor-only member sees a Cedar-primary post that also linked Harbor'
);

select is(
  (
    select tagged_people -> 0 ->> 'name'
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000002'
      )
     where body = 'A tagged porch afternoon for both circles.'
  ),
  'A Organizer Two',
  'a Harbor-only member sees the Cedar tag name on a linked moment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_people
     where moment_id = (
       select id
         from public.moments
        where body = 'A tagged porch afternoon for both circles.'
     )
  ),
  1::bigint,
  'a Harbor-only member can read moment_people rows on a linked Cedar-primary moment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_people
     where moment_id = '60000000-0000-4000-8000-000000000007'
  ),
  0::bigint,
  'a Harbor-only member cannot read tags on a Cedar-only moment'
);

select throws_ok(
  $$insert into public.moment_people (
    circle_id, moment_id, person_id, tagged_by_membership_id
  ) values (
    '20000000-0000-4000-8000-000000000001',
    (select id from public.moments where body = 'A tagged porch afternoon for both circles.'),
    '30000000-0000-4000-8000-000000000003',
    '40000000-0000-4000-8000-000000000006'
  )$$,
  '42501',
  'permission denied for table moment_people',
  'a Harbor-only member still cannot write tags on a Cedar-primary moment'
);

select * from finish();
rollback;
