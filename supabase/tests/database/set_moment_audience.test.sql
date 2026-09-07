begin;

select plan(11);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'Audience starts on Cedar.',
    null, '{}', '2026-08-29', null, null, null, null, 'family',
    array['20000000-0000-4000-8000-000000000001'::uuid]
  )$$,
  'a dual-circle member can post a Cedar-primary family moment'
);

select lives_ok(
  $$select public.set_moment_audience(
    (select id from public.moments where body = 'Audience starts on Cedar.'),
    (select revision from public.moments where body = 'Audience starts on Cedar.'),
    'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  'the author can add a secondary circle without moving the primary'
);

select is(
  (
    select count(*)::bigint
      from public.moment_circles as link
      join public.moments as moment on moment.id = link.moment_id
     where moment.body = 'Audience starts on Cedar.'
  ),
  2::bigint,
  'edit-audience stores one junction row per selected circle'
);

select is(
  (
    select moment.circle_id
      from public.moments as moment
     where moment.body = 'Audience starts on Cedar.'
  ),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'edit-audience keeps moments.circle_id on the original primary'
);

select is(
  (
    select linked_circle_ids
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000005'
      )
     where body = 'Audience starts on Cedar.'
  ),
  array[
    '20000000-0000-4000-8000-000000000001'::uuid,
    '20000000-0000-4000-8000-000000000002'::uuid
  ],
  'the author journal lists every linked circle'
);

select throws_ok(
  $$select public.set_moment_audience(
    (select id from public.moments where body = 'Audience starts on Cedar.'),
    (select revision from public.moments where body = 'Audience starts on Cedar.'),
    'family',
    array['20000000-0000-4000-8000-000000000002'::uuid]
  )$$,
  '22023',
  'Moment could not be changed',
  'the author cannot drop the primary circle without choosing Just me'
);

select lives_ok(
  $$select public.set_moment_audience(
    (select id from public.moments where body = 'Audience starts on Cedar.'),
    (select revision from public.moments where body = 'Audience starts on Cedar.'),
    'just_me',
    '{}'::uuid[]
  )$$,
  'the author can move the moment to Just me'
);

select is(
  (
    select count(*)::bigint
      from public.moment_circles as link
      join public.moments as moment on moment.id = link.moment_id
     where moment.body = 'Audience starts on Cedar.'
  ),
  0::bigint,
  'Just me clears moment_circles'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000009',
    'thought', null, 'A Harbor child moment stays family.',
    null, '{}', '2026-08-29'
  )$$,
  'a Harbor organizer can record on a managed child journal'
);

select throws_ok(
  $$select public.set_moment_audience(
    (select id from public.moments where body = 'Audience starts on Cedar.'),
    (select revision from public.moments where body = 'Audience starts on Cedar.'),
    'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  '42501',
  'Moment could not be changed',
  'a Harbor-only member cannot change a Cedar-primary audience'
);

select throws_ok(
  $$select public.set_moment_audience(
    (select id from public.moments where body = 'A Harbor child moment stays family.'),
    (select revision from public.moments where body = 'A Harbor child moment stays family.'),
    'just_me',
    '{}'::uuid[]
  )$$,
  '42501',
  'Moment could not be changed',
  'an organizer cannot move another person''s journal to Just me'
);

select * from finish();
rollback;
