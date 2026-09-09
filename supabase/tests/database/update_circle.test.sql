begin;

select plan(7);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$select public.update_circle(
    '20000000-0000-4000-8000-000000000001',
    '  Trapp Family  '
  )$$,
  'the circle starter can rename their circle'
);

select is(
  (
    select circle.name
      from public.circles as circle
     where circle.id = '20000000-0000-4000-8000-000000000001'
  ),
  'Trapp Family',
  'the trimmed name is stored'
);

select throws_ok(
  $$select public.update_circle(
    '20000000-0000-4000-8000-000000000001',
    ''
  )$$,
  '22023',
  'Circle could not be renamed',
  'a blank name is rejected'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select throws_ok(
  $$select public.update_circle(
    '20000000-0000-4000-8000-000000000001',
    'Stolen Cedar'
  )$$,
  '42501',
  'Circle could not be renamed',
  'a later organizer cannot rename a circle they did not start'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$select public.update_circle(
    '20000000-0000-4000-8000-000000000001',
    'Member Rename'
  )$$,
  '42501',
  'Circle could not be renamed',
  'an ordinary member cannot rename a circle'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$select public.update_circle(
    '20000000-0000-4000-8000-000000000002',
    'Stolen Harbor'
  )$$,
  '42501',
  'Circle could not be renamed',
  'a Cedar starter cannot rename Harbor'
);

select is(
  (
    select circle.name
      from public.circles as circle
     where circle.id = '20000000-0000-4000-8000-000000000001'
  ),
  'Trapp Family',
  'failed rename attempts leave the starter''s name in place'
);

select * from finish();
rollback;
