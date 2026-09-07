begin;

select plan(12);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'A porch afternoon for both circles.',
    null, '{}', '2026-08-29', null, null, null, null, 'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  'a dual-circle member can post one moment to both circles'
);

select is(
  (
    select count(*)::bigint
      from public.moment_circles as link
      join public.moments as moment on moment.id = link.moment_id
     where moment.body = 'A porch afternoon for both circles.'
  ),
  2::bigint,
  'a multi-circle family moment stores one junction row per selected circle'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where body = 'A porch afternoon for both circles.'
  ),
  1::bigint,
  'the primary circle family feed includes the shared moment'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000002'
      )
     where body = 'A porch afternoon for both circles.'
  ),
  1::bigint,
  'the secondary circle family feed includes the same moment'
);

select lives_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'thought', null, 'A Dual Member keeps this just for me.',
    null, '{}', '2026-08-29', null, null, null, null, 'just_me'
  )$$,
  'Just Me still writes on the recorder journal'
);

select is(
  (
    select count(*)::bigint
      from public.moment_circles as link
      join public.moments as moment on moment.id = link.moment_id
     where moment.body = 'A Dual Member keeps this just for me.'
  ),
  0::bigint,
  'Just Me never writes moment_circles rows'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000002'
      )
     where body = 'A porch afternoon for both circles.'
  ),
  1::bigint,
  'a Harbor-only member sees a Family-primary post that also linked Harbor'
);

select is(
  (
    select coalesce(journal_person_name, '') || coalesce(recorder_person_name, '')
      from public.list_timeline_moments(
        '20000000-0000-4000-8000-000000000002'
      )
     where body = 'A porch afternoon for both circles.'
  ),
  '',
  'a Harbor-only member does not receive Cedar people names on a Cedar-primary post'
);

select is(
  (
    select count(*)::bigint
      from public.moments
     where body = 'A Dual Member keeps this just for me.'
  ),
  0::bigint,
  'a Harbor organizer cannot read another member''s Just Me moment'
);

select is(
  (
    select count(*)::bigint
      from public.moment_circles as link
      join public.moments as moment on moment.id = link.moment_id
     where moment.body = 'A porch afternoon for both circles.'
       and link.circle_id = '20000000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'Harbor-only members cannot see the Cedar junction row'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select is(
  (
    select count(*)::bigint
      from public.moments
     where body = 'A Dual Member keeps this just for me.'
  ),
  0::bigint,
  'a Cedar organizer cannot read another member''s Just Me moment'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'thought', null, 'A member cannot borrow Harbor.',
    null, '{}', '2026-08-29', null, null, null, null, 'family',
    array[
      '20000000-0000-4000-8000-000000000001'::uuid,
      '20000000-0000-4000-8000-000000000002'::uuid
    ]
  )$$,
  '42501',
  'Moment could not be created',
  'a member cannot link a circle they do not belong to'
);

select * from finish();
rollback;
