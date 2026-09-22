begin;
select no_plan();
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('test.share_post', public.create_family_moment(
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005',
  'thought', null, 'Private before sharing.', null, '{}', '2026-08-29',
  null, null, null, null, 'just_me', '{}')::text, true);
select set_config('test.share_note', public.create_moment_note(current_setting('test.share_post')::uuid, 'My private comment')::text, true);
select public.set_moment_reaction(current_setting('test.share_post')::uuid, 'held-close');

select throws_ok($q$select public.share_private_moment(current_setting('test.share_post')::uuid, 999,
  '20000000-0000-4000-8000-000000000002', null, 'Changed', null, '{}', '2026-08-29')$q$,
  '40001', 'Moment changed elsewhere', 'stale share rejected');
select is((select audience from public.moments where id=current_setting('test.share_post')::uuid), 'just_me', 'failed share stays private');
select lives_ok($q$select public.share_private_moment(current_setting('test.share_post')::uuid, 1,
  '20000000-0000-4000-8000-000000000002', null, 'Shared only to Harbor.', null, '{}', '2026-08-29')$q$, 'author shares private post with content atomically');
select is((select array_agg(circle_id) from public.moment_circles where moment_id=current_setting('test.share_post')::uuid),
  array['20000000-0000-4000-8000-000000000002'::uuid], 'only chosen destination is an audience');
select is((select circle_id from public.moments where id=current_setting('test.share_post')::uuid),
  '20000000-0000-4000-8000-000000000001'::uuid, 'storage circle unchanged');
select is((select occurred_on from public.moments where id=current_setting('test.share_post')::uuid), '2026-08-29'::date, 'date preserved');
select lives_ok($q$select public.update_family_moment(current_setting('test.share_post')::uuid,
  (select revision from public.moments where id=current_setting('test.share_post')::uuid), null,
  'Shared only to Harbor.', null, '{}', '2026-08-29', null, null, null, null, 'family')$q$, 'subsequent ordinary edit succeeds');
select is((select count(*) from public.moment_circles where moment_id=current_setting('test.share_post')::uuid), 1::bigint, 'ordinary edit does not re-add original circle');
select throws_ok($q$select public.share_private_moment(current_setting('test.share_post')::uuid,
  (select revision from public.moments where id=current_setting('test.share_post')::uuid),
  '20000000-0000-4000-8000-000000000001', null, 'Moved', null, '{}', '2026-08-29')$q$,
  '42501', 'Moment could not be shared', 'cannot use one-way operation to move shared post');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select is((select count(*) from public.moments where id=current_setting('test.share_post')::uuid), 0::bigint, 'original-only member cannot read post');
select is((select count(*) from public.list_timeline_moments('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005') where moment_id=current_setting('test.share_post')::uuid), 0::bigint, 'original-circle personal feed cannot leak shared post');
select is((select count(*) from public.get_moment_conversation(current_setting('test.share_post')::uuid)), 0::bigint, 'original member cannot read conversation');
select throws_ok($q$select public.create_moment_note(current_setting('test.share_post')::uuid,'Not allowed')$q$, '42501', 'Note could not be saved', 'original-only member cannot comment');
select throws_ok($q$select public.set_moment_reaction(current_setting('test.share_post')::uuid,'held-close')$q$, '42501', 'Response could not be saved', 'original-only member cannot react');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select is((select count(*) from public.moments where id=current_setting('test.share_post')::uuid), 1::bigint, 'destination-only member can read post');
select is((select notes->0->>'body' from public.get_moment_conversation(current_setting('test.share_post')::uuid)), 'My private comment', 'author comment preserved');
select is((select jsonb_array_length(reactions) from public.get_moment_conversation(current_setting('test.share_post')::uuid)), 1, 'author reaction preserved');
select lives_ok($q$select set_config('test.recipient_note',public.create_moment_note(current_setting('test.share_post')::uuid,'Hello from Harbor')::text,true)$q$, 'destination-only member can comment');
select lives_ok($q$select public.set_moment_reaction(current_setting('test.share_post')::uuid,'held-close')$q$, 'destination-only member can react');
select lives_ok($q$select public.set_moment_reaction(current_setting('test.share_post')::uuid,'held-close')$q$, 'retry does not duplicate reaction');
select is((select jsonb_array_length(reactions) from public.get_moment_conversation(current_setting('test.share_post')::uuid)), 2, 'one reaction per account');
select is((select display_name from public.visible_moment_authors(array['40000000-0000-4000-8000-000000000005'::uuid])), 'A Dual Member', 'destination member resolves original author without roster access');
select is((select accent_token from public.visible_moment_authors(array['40000000-0000-4000-8000-000000000005'::uuid])), 'plum', 'author color preserved across circles');
select is((select count(*) from public.visible_moment_authors(array['40000000-0000-4000-8000-000000000002'::uuid])), 0::bigint, 'unrelated roster identity is not exposed');
select lives_ok($q$select public.update_moment_note(current_setting('test.recipient_note')::uuid,1,'Edited from Harbor')$q$, 'recipient can edit own comment');
select throws_ok($q$select public.update_moment_note(current_setting('test.share_note')::uuid,1,'Cannot edit author')$q$, '42501', 'Note could not be changed', 'recipient cannot edit author comment');
select lives_ok($q$select public.trash_moment_note(current_setting('test.recipient_note')::uuid,2)$q$, 'recipient can remove own comment');
select lives_ok($q$select public.set_moment_reaction(current_setting('test.share_post')::uuid,null)$q$, 'recipient can unheart');
select is((select jsonb_array_length(reactions) from public.get_moment_conversation(current_setting('test.share_post')::uuid)), 1, 'only recipient heart removed');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select set_config('test.second_private', public.create_family_moment(
  '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000005',
  'thought', null, 'Remain private.', null, '{}', '2026-08-29',
  null, null, null, null, 'just_me', '{}')::text, true);
select throws_ok($q$select public.share_private_moment(current_setting('test.second_private')::uuid,1,
  '20000000-0000-4000-8000-000000000099',null,'Do not save',null,'{}','2026-08-29')$q$,
  '42501','Moment could not be shared','nonmember destination rejected');
select is((select body from public.moments where id=current_setting('test.second_private')::uuid),'Remain private.','invalid destination preserves content');
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select throws_ok($q$select public.share_private_moment(current_setting('test.second_private')::uuid,1,
  '20000000-0000-4000-8000-000000000001',null,'Do not save',null,'{}','2026-08-29')$q$,
  '42501','Moment could not be shared','organizer cannot share someone else private post');
select * from finish();
rollback;
