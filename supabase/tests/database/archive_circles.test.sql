begin;
select plan(11);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select public.create_circle('Archive test', '20000000-0000-4000-8000-000000000001') as target \gset
select person_id as author from public.circle_memberships where circle_id = :'target' \gset
select public.create_family_moment(:'target', :'author', 'thought', null, 'Kept post', null, '{}', '2026-09-22', null, null, null, null, 'family');
select lives_ok(format('select public.set_circle_archived(%L, true)', :'target'), 'organizer can archive populated circle');
select ok((select archived_at is not null from public.circles where id = :'target'), 'archive state saved');
select is((select count(*) from public.moments where circle_id = :'target'), 1::bigint, 'history remains visible');
select is((select count(*) from public.circle_memberships where circle_id = :'target' and status = 'active'), 1::bigint, 'sign-in membership preserved');
select throws_ok(format($q$select public.create_family_moment(%L, %L, 'thought', null, 'Stale share', null, '{}', '2026-09-22', null, null, null, null, 'family')$q$, :'target', :'author'),
  '22023', 'Moment could not be created', 'stale composer cannot share');
select lives_ok(format($q$select public.create_family_moment(%L, %L, 'thought', null, 'Private', null, '{}', '2026-09-22', null, null, null, null, 'just_me')$q$, :'target', :'author'), 'personal journal remains usable');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select throws_ok(format('select public.set_circle_archived(%L, false)', :'target'), '42501', 'Circle could not be updated', 'outsider cannot restore');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select lives_ok(format('select public.set_circle_archived(%L, false)', :'target'), 'organizer can restore');
select ok((select archived_at is null from public.circles where id = :'target'), 'restored state saved');
select lives_ok(format($q$select public.create_family_moment(%L, %L, 'thought', null, 'New share', null, '{}', '2026-09-22', null, null, null, null, 'family')$q$, :'target', :'author'), 'restored circle accepts posts');
select ok(not has_function_privilege('anon', 'public.set_circle_archived(uuid,boolean)', 'execute'), 'anonymous mutation denied');
select * from finish();
rollback;
