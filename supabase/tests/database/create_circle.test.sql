begin;

select plan(11);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select lives_ok(
  $$select public.create_circle(
    '  Cousins  ',
    '20000000-0000-4000-8000-000000000001'
  )$$,
  'an ordinary member can create an additional circle from their source circle'
);

select is(
  (
    select count(*)::bigint
      from public.circles
     where name = 'Cousins'
  ),
  1::bigint,
  'the new circle keeps the trimmed name'
);

select is(
  (
    select membership.role
      from public.circle_memberships as membership
      join public.circles as circle on circle.id = membership.circle_id
     where circle.name = 'Cousins'
       and membership.user_id = '10000000-0000-4000-8000-000000000003'
  ),
  'organizer',
  'the creator becomes organizer of the new circle'
);

select is(
  (
    select count(*)::bigint
      from public.circles
     where name = 'Cedar Circle'
  ),
  1::bigint,
  'creating a group leaves the existing circle in place'
);

select throws_ok(
  $$select public.create_circle('', '20000000-0000-4000-8000-000000000001')$$,
  '22023',
  'Circle could not be created',
  'a blank name is rejected'
);

select throws_ok(
  $$select public.create_circle(
    'Stolen Harbor',
    '20000000-0000-4000-8000-000000000002'
  )$$,
  '42501',
  'Circle could not be created',
  'a Cedar member cannot start from Harbor'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
set local role authenticated;

select throws_ok(
  $$select public.create_circle(
    'No Home',
    '20000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'Circle could not be created',
  'a person with no membership cannot create a circle'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
set local role authenticated;

select lives_ok(
  $$select public.create_circle(
    'Harbor Friends',
    '20000000-0000-4000-8000-000000000002'
  )$$,
  'a dual-circle member can create from the Harbor source they pick'
);

select is(
  (
    select count(*)::bigint
      from public.circles
  ),
  3::bigint,
  'dual-circle member now sees original two circles plus the new one'
);

select is(
  (
    select circle.time_zone
      from public.circles as circle
     where circle.name = 'Harbor Friends'
  ),
  'UTC',
  'Harbor source copies Harbor timezone, not Cedar earliest membership'
);

select is(
  (
    select person.display_name
      from public.people as person
      join public.circles as circle on circle.id = person.circle_id
     where circle.name = 'Harbor Friends'
  ),
  'B Dual Organizer',
  'Harbor source copies the Harbor person, not the Cedar person'
);

reset role;

select * from finish();
rollback;
