begin;

select plan(9);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'Cedar family from Dual.',
    null, '{}', '2026-08-21', null, null, null, null, 'family',
    array['20000000-0000-4000-8000-000000000001'::uuid]
  )$$,
  'dual member can post a Cedar family moment'
);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000007',
    'thought', null, 'Harbor family from Dual.',
    null, '{}', '2026-08-22', null, null, null, null, 'family',
    array['20000000-0000-4000-8000-000000000002'::uuid]
  )$$,
  'dual member can post a Harbor family moment'
);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'Just me from Dual.',
    null, '{}', '2026-08-23', null, null, null, null, 'just_me'
  )$$,
  'dual member can post Just me on Cedar'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000005'
      )
     where body in (
       'Cedar family from Dual.',
       'Harbor family from Dual.',
       'Just me from Dual.'
     )
  ),
  3::bigint,
  'YOU from Cedar includes family and Just me across memberships'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000007'
      )
     where body in (
       'Cedar family from Dual.',
       'Harbor family from Dual.',
       'Just me from Dual.'
     )
  ),
  3::bigint,
  'YOU from Harbor includes the same recorder posts without switching circles'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where body in (
       'Cedar family from Dual.',
       'Harbor family from Dual.',
       'Just me from Dual.'
     )
  ),
  1::bigint,
  'Cedar family feed stays circle-scoped and omits Just me'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'thought', null, 'Child journal from organizer.',
    null, '{}', '2026-08-24', null, null, null, null, 'family',
    array['20000000-0000-4000-8000-000000000001'::uuid]
  )$$,
  'an organizer can record on a managed child journal'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
      )
     where body = 'Child journal from organizer.'
  ),
  0::bigint,
  'YOU does not pull moments recorded onto another person''s journal'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000005'
      )
     where body in (
       'Cedar family from Dual.',
       'Harbor family from Dual.',
       'Just me from Dual.'
     )
  ),
  1::bigint,
  'another adult''s journal stays circle-scoped and never includes their Just me'
);

select * from finish();
rollback;
