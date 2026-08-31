begin;

select no_plan();

update private.photo_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'photo_publication';

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values (
  '73000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '1 day'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"73000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'A guarded upload.', '', '{}'::uuid[], '2024-06-15', null, null,
  'd5000000-0000-4000-8000-000000000001'
) \gset guarded_
reset role;

delete from auth.sessions
 where id = '73000000-0000-4000-8000-000000000001';

set local role authenticated;
select throws_ok(
  format(
    $$select * from public.claim_photo_intake_upload(
      %L::uuid, 'd5100000-0000-4000-8000-000000000001',
      'image/jpeg', 12, repeat('a', 64)
    )$$,
    :'guarded_intake_id'
  ),
  '42501', 'Photo intake upload could not be claimed',
  'a deleted Auth session cannot claim a staged upload'
);
select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'd5000000-0000-4000-8000-000000000002'
  )$$,
  '42501', 'Photo intake could not be reserved',
  'a deleted Auth session cannot use the legacy reservation surface'
);
reset role;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values (
  '73000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(), statement_timestamp(),
  statement_timestamp() + interval '1 day'
);

set local role authenticated;
select * from public.claim_photo_intake_upload(
  :'guarded_intake_id'::uuid,
  'd5100000-0000-4000-8000-000000000001',
  'image/jpeg', 12, repeat('a', 64)
) \gset claimed_
reset role;

delete from auth.sessions
 where id = '73000000-0000-4000-8000-000000000001';

set local role authenticated;
select is(
  private.photo_intake_path_is_uploadable(
    :'claimed_object_path',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'intake_id', :'guarded_intake_id',
      'upload_request_key', 'd5100000-0000-4000-8000-000000000001',
      'expected_mime_type', 'image/jpeg',
      'expected_size_bytes', 12,
      'expected_sha256', repeat('a', 64)
    )
  ),
  false,
  'a deleted Auth session cannot authorize a TUS create or part'
);
select throws_ok(
  format(
    $$select * from public.acknowledge_photo_intake(%L::uuid)$$,
    :'guarded_intake_id'
  ),
  '42501', 'Photo intake could not be acknowledged',
  'a deleted Auth session cannot acknowledge uploaded bytes'
);
reset role;
select is(
  (select count(*)::bigint from private.photo_intakes
    where request_key = 'd5000000-0000-4000-8000-000000000002'),
  0::bigint,
  'stale-session legacy reservation denial creates no orphan intake'
);

select * from finish();
rollback;
