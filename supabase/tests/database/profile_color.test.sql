begin;
select plan(9);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select is(public.set_my_profile_color('violet'), true, 'member can save their own color');
select is((select count(*)::integer from public.people where id in (
  '30000000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000007'
) and accent_token = 'violet'), 2, 'all active circles use the same color');
select is((select accent_token from public.people where id = '30000000-0000-4000-8000-000000000001'), 'clay', 'another person remains unchanged');
select throws_ok($$select public.set_my_profile_color('neon')$$, '22023', 'Choose a profile color', 'arbitrary colors rejected');
select throws_ok($$select public.set_my_profile_color(null)$$, '22023', 'Choose a profile color', 'null rejected');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is(public.set_my_profile_color('cyan'), false, 'revoked membership cannot edit its profile');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select is(public.set_my_profile_color('cyan'), false, 'nonmember has no profile to edit');
reset role;
select ok(not has_function_privilege('anon', 'public.set_my_profile_color(text)', 'EXECUTE'), 'anonymous callers cannot save');

-- Reactivation adopts the active profile color rather than its old default.
update public.circle_memberships set status = 'revoked', revoked_at = now(),
  revoked_by_membership_id = '40000000-0000-4000-8000-000000000006'
where id = '40000000-0000-4000-8000-000000000007';
update public.people set accent_token = 'sky' where id = '30000000-0000-4000-8000-000000000007';
update public.circle_memberships set status = 'active', revoked_at = null, revoked_by_membership_id = null
where id = '40000000-0000-4000-8000-000000000007';
select is((select accent_token from public.people where id = '30000000-0000-4000-8000-000000000007'), 'violet', 'reactivated circle inherits current color');
select * from finish();
rollback;
