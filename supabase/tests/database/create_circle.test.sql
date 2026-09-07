begin;

select plan(8);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;

select lives_ok(
  $$select public.create_circle('  Cousins  ')$$,
  'an ordinary member can create an additional circle'
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
  $$select public.create_circle('')$$,
  '22023',
  'Group could not be created',
  'a blank name is rejected'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
set local role authenticated;

select throws_ok(
  $$select public.create_circle('No Home')$$,
  '42501',
  'Group could not be created',
  'a person with no membership cannot create a circle'
);

reset role;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
set local role authenticated;

select lives_ok(
  $$select public.create_circle('Harbor Friends')$$,
  'a dual-circle member can create another circle'
);

select is(
  (
    select count(*)::bigint
      from public.circles
  ),
  3::bigint,
  'dual-circle member now sees original two circles plus the new one'
);

reset role;

select * from finish();
rollback;
