begin;
select plan(17);
select count(*) as count from auth.users \gset original_auth_
select md5(string_agg(row_to_json(m)::text, '' order by id)) as fingerprint
  from public.moments m \gset original_moments_
-- The dual-circle account organizes both circles for this test.
update public.circle_memberships set role = 'organizer'
where id = '40000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select is((select count(*)::integer from public.list_existing_circle_members(
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),3,
  'lists active account members only, excluding existing destination member and revoked member');
select public.add_existing_circle_member('40000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002') as id \gset added_
select is(public.add_existing_circle_member('40000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002'), :'added_id'::uuid,'retry returns same membership');
select is((select role from public.circle_memberships where id=:'added_id'::uuid),'member','adds as member, not organizer');
select is((select status from public.circle_memberships where id='40000000-0000-4000-8000-000000000003'),'active','source membership unchanged');
select is((select count(*)::integer from public.list_existing_circle_members(
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),2,'added account no longer offered');
select throws_ok($$select public.add_existing_circle_member('40000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000002')$$,'42501','Member could not be added','revoked source cannot be added');
select throws_ok($$select public.add_existing_circle_member('40000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000001')$$,'42501','Member could not be added','same circle rejected');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.add_existing_circle_member('40000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002')$$,'42501','Member could not be added','source organizer without target authority rejected');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000006',true);
select throws_ok($$select public.add_existing_circle_member('40000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000002')$$,'42501','Member could not be added','target organizer without source authority rejected');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select is((select count(*)::integer from public.list_existing_circle_members(
  '20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002')),0,'ordinary member cannot browse candidates');
select is((select count(*)::integer from public.circle_memberships where user_id=auth.uid() and status='active'),2,'same account has access to both circles');
reset role;
select is((select count(*)::integer from private.audit_events where subject_id=:'added_id'::uuid and event_type='membership_added'),1,'one audit record despite retry');
select is((select count(*) from auth.users), :'original_auth_count'::bigint,'no new account is created');
select is((select md5(string_agg(row_to_json(m)::text, '' order by id)) from public.moments m),
  :'original_moments_fingerprint','existing posts and their audiences are unchanged');
update public.circle_memberships set status='revoked',revoked_at=now(),
  revoked_by_membership_id='40000000-0000-4000-8000-000000000007' where id=:'added_id'::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.add_existing_circle_member('40000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000002')$$,'42501','Member could not be added','shortcut does not undo prior removal');
select is((select status from public.circle_memberships where id='40000000-0000-4000-8000-000000000003'),'active','removal in destination leaves source active');
reset role;
select ok(not has_function_privilege('anon','public.add_existing_circle_member(uuid,uuid)','execute'),'anonymous callers denied');
select * from finish();
rollback;
