begin;
select plan(13);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
set local role authenticated;
select public.create_circle('Delete test', '20000000-0000-4000-8000-000000000001') as target \gset
select throws_ok(format('select public.delete_empty_circle(%L, %L)', :'target', 'Wrong name'),
  '42501', 'Circle could not be deleted', 'stale circle name cannot confirm deletion');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000007', true);
select throws_ok(format('select public.delete_empty_circle(%L, %L)', :'target', 'Delete test'),
  '42501', 'Circle could not be deleted', 'another account cannot delete the circle');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select lives_ok(format('select public.delete_empty_circle(%L, %L)', :'target', 'Delete test'),
  'creator can delete their unused circle');
reset role;
select is((select count(*) from public.circles where id = :'target'), 0::bigint, 'circle removed');
select is((select count(*) from public.people where circle_id = :'target'), 0::bigint, 'unused profile removed');
select is((select count(*) from public.circle_memberships where circle_id = :'target'), 0::bigint, 'unused membership removed');
select lives_ok('set constraints all immediate', 'no dangling identity references');
set constraints all deferred;
select ok(exists(select 1 from public.circle_memberships where user_id = '10000000-0000-4000-8000-000000000003' and status = 'active'), 'original membership preserved');
select ok(not has_function_privilege('anon', 'public.delete_empty_circle(uuid,text)', 'execute'), 'anonymous deletion denied');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select throws_ok($$select public.delete_empty_circle('20000000-0000-4000-8000-000000000001', 'Cedar Circle')$$,
  '23514', 'Keep at least one circle for your journal', 'last circle cannot be deleted');
select public.create_circle('Another circle', '20000000-0000-4000-8000-000000000001') as retained \gset
select throws_ok($$select public.delete_empty_circle('20000000-0000-4000-8000-000000000001', 'Cedar Circle')$$,
  '23514', 'Only an unused circle with no other people can be deleted', 'populated circle cannot be deleted');
select person_id as author from public.circle_memberships where circle_id = :'retained' \gset
select public.create_family_moment(:'retained', :'author', 'thought', null, 'Private journal entry', null, '{}', '2026-09-22', null, null, null, null, 'just_me');
select throws_ok(format('select public.delete_empty_circle(%L, %L)', :'retained', 'Another circle'),
  '23514', 'Only an unused circle with no other people can be deleted', 'private posts also prevent deletion');
select is((select count(*) from public.moments where circle_id = :'retained'), 1::bigint, 'failed deletion preserves private post');
select * from finish();
rollback;
