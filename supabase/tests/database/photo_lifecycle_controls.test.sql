begin;

select no_plan();

update private.photo_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'photo_publication';

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select extensions.gen_random_uuid(), auth_user.id, statement_timestamp(),
  statement_timestamp(), statement_timestamp() + interval '1 day'
from auth.users as auth_user;

create function pg_temp.set_lifecycle_user(test_user_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  test_session_id uuid;
begin
  select session.id into test_session_id
    from auth.sessions as session
   where session.user_id = test_user_id
   order by session.created_at desc limit 1;
  perform set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', test_user_id::text,
      'session_id', test_session_id::text
    )::text,
    true
  );
  return set_config('request.jwt.claim.sub', test_user_id::text, true);
end;
$$;

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class
    where oid = 'private.photo_object_cleanup_jobs'::regclass),
  'the cleanup ledger enables and forces RLS'
);
select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name = 'photo_object_cleanup_jobs'
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'no API role has direct cleanup-ledger privileges'
);
select ok(
  has_function_privilege(
    'authenticated', 'public.cancel_photo_intake(uuid)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.list_my_photo_intakes(uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.cancel_photo_intake(uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role', 'public.cancel_photo_intake(uuid)', 'EXECUTE'
  ),
  'only authenticated members can reach lifecycle RPCs'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.enforce_photo_intake_quota()', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role', 'private.enqueue_photo_object_cleanup()', 'EXECUTE'
  ),
  'quota and cleanup trigger functions are not callable API surfaces'
);

set local role authenticated;
select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000001'::uuid
);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'A reservation that can be reconsidered.', '', '{}'::uuid[],
  '2024-05-01', null, null,
  'e1000000-0000-4000-8000-000000000001'
) \gset reserved_

select is(
  (select count(*)::bigint from public.list_my_photo_intakes(
      '20000000-0000-4000-8000-000000000001'
    )
    where intake_id = :'reserved_intake_id'::uuid
      and status = 'reserved' and can_cancel),
  1::bigint,
  'the requester sees a server-authoritative cancellable reservation'
);

select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000002'::uuid
);
select is(
  (select count(*)::bigint from public.list_my_photo_intakes(
      '20000000-0000-4000-8000-000000000001'
    )
    where intake_id = :'reserved_intake_id'::uuid),
  0::bigint,
  'another active family member cannot list the requester photo intake'
);
select throws_ok(
  format(
    'select * from public.cancel_photo_intake(%L::uuid)',
    :'reserved_intake_id'
  ),
  '42501', 'Photo intake could not be cancelled',
  'another active family member cannot cancel the requester photo intake'
);

select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000006'::uuid
);
select throws_ok(
  format(
    'select * from public.cancel_photo_intake(%L::uuid)',
    :'reserved_intake_id'
  ),
  '42501', 'Photo intake could not be cancelled',
  'a different family circle cannot cancel the requester photo intake'
);

select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000001'::uuid
);
select * from public.cancel_photo_intake(:'reserved_intake_id'::uuid)
  \gset cancelled_reserved_
select is(
  row(:'cancelled_reserved_state', :'cancelled_reserved_cleanup_state')::text,
  row('invalidated'::text, 'not_required'::text)::text,
  'cancelling a reservation closes it without inventing cleanup work'
);
select * from public.cancel_photo_intake(:'reserved_intake_id'::uuid)
  \gset cancelled_reserved_retry_
select is(
  row(
    :'cancelled_reserved_retry_state',
    :'cancelled_reserved_retry_cleanup_state'
  )::text,
  row('invalidated'::text, 'not_required'::text)::text,
  'requester cancellation is idempotent'
);
reset role;

select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'photo_intake_cancelled'
      and subject_id = :'reserved_intake_id'::uuid),
  1::bigint,
  'cancellation replay records exactly one audit event'
);

set local role authenticated;
select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000001'::uuid
);
select * from public.get_photo_moment_status(:'reserved_intake_id'::uuid)
  \gset cancelled_status_
select is(
  :'cancelled_status_status', 'cancelled'::text,
  'the existing status RPC reports logical cancellation truthfully'
);
select is(
  (select count(*)::bigint from public.list_my_photo_intakes(
      '20000000-0000-4000-8000-000000000001'
    )
    where intake_id = :'reserved_intake_id'::uuid),
  0::bigint,
  'a never-uploaded cancellation no longer consumes or appears as unfinished work'
);

select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'A claimed upload that is stopped.', '', '{}'::uuid[],
  '2024-05-02', null, null,
  'e1000000-0000-4000-8000-000000000002'
) \gset claimed_
select * from public.claim_photo_intake_upload(
  :'claimed_intake_id'::uuid,
  'e1100000-0000-4000-8000-000000000002',
  'image/jpeg', 12, repeat('a', 64)
) \gset claimed_upload_
select * from public.cancel_photo_intake(:'claimed_intake_id'::uuid)
  \gset cancelled_claimed_
select is(
  row(:'cancelled_claimed_state', :'cancelled_claimed_cleanup_state')::text,
  row('invalidated'::text, 'queued'::text)::text,
  'cancelling a claimed upload closes authority and queues cleanup'
);
reset role;

select ok(
  exists (
    select 1 from private.photo_object_cleanup_jobs as cleanup
    join private.photo_intakes as intake on intake.id = cleanup.intake_id
    where cleanup.intake_id = :'claimed_intake_id'::uuid
      and cleanup.circle_id = intake.circle_id
      and cleanup.bucket_id = 'our-days-intake'
      and cleanup.object_path = intake.object_path
      and cleanup.state = 'queued'
      and cleanup.not_before = intake.upload_expires_at + interval '25 hours'
  ),
  'cleanup is bound to the exact quarantine target after the TUS safety horizon'
);

set local role authenticated;
select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000001'::uuid
);
select is(
  (select count(*)::bigint from public.list_my_photo_intakes(
      '20000000-0000-4000-8000-000000000001'
    )
    where intake_id = :'claimed_intake_id'::uuid
      and status = 'cancelled_cleanup_pending'
      and not can_cancel and cleanup_state = 'queued'),
  1::bigint,
  'quota-counted cancelled bytes remain visible until verified cleanup'
);

select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'A photo that reached private processing.', '', '{}'::uuid[],
  '2024-05-03', null, null,
  'e1000000-0000-4000-8000-000000000003'
) \gset processing_
select * from public.claim_photo_intake_upload(
  :'processing_intake_id'::uuid,
  'e1100000-0000-4000-8000-000000000003',
  'image/jpeg', 12, repeat('b', 64)
) \gset processing_upload_
select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'e1200000-0000-4000-8000-000000000003', 'our-days-intake',
  :'processing_object_path', '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'intake_id', :'processing_intake_id',
    'upload_request_key', 'e1100000-0000-4000-8000-000000000003',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 12,
    'expected_sha256', repeat('b', 64)
  )
);
select * from public.acknowledge_photo_intake(:'processing_intake_id'::uuid);
select throws_ok(
  format(
    'select * from public.cancel_photo_intake(%L::uuid)',
    :'processing_intake_id'
  ),
  'P0001', 'PHOTO_CANCELLATION_TOO_LATE',
  'cancellation fails closed after acknowledgement begins processing'
);
reset role;

-- Account open-work quota: three simultaneous reservations are allowed; the
-- fourth fails, cancellation releases one slot, and an exact replay never
-- consumes another slot.
set local role authenticated;
select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000002'::uuid
);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', '', '', '{}'::uuid[],
  '2024-06-01', null, null,
  'e2000000-0000-4000-8000-000000000001'
) \gset molly_one_
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', '', '', '{}'::uuid[],
  '2024-06-02', null, null,
  'e2000000-0000-4000-8000-000000000002'
) \gset molly_two_
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', '', '', '{}'::uuid[],
  '2024-06-03', null, null,
  'e2000000-0000-4000-8000-000000000003'
) \gset molly_three_
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', '', '', '{}'::uuid[],
  '2024-06-03', null, null,
  'e2000000-0000-4000-8000-000000000003'
) \gset molly_three_retry_
select is(
  :'molly_three_retry_intake_id'::uuid, :'molly_three_intake_id'::uuid,
  'an exact reservation replay succeeds while the account is at quota'
);
select throws_ok(
  $$select * from public.reserve_photo_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002', '', '', '{}'::uuid[],
    '2024-06-04', null, null,
    'e2000000-0000-4000-8000-000000000004'
  )$$,
  'P0001', 'PHOTO_ACCOUNT_OPEN_QUOTA',
  'a fourth simultaneous reservation is rejected with a stable quota code'
);
select * from public.cancel_photo_intake(:'molly_one_intake_id'::uuid);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002', '', '', '{}'::uuid[],
  '2024-06-04', null, null,
  'e2000000-0000-4000-8000-000000000004'
) \gset molly_four_
select isnt(
  :'molly_four_intake_id'::uuid, null::uuid,
  'cancelling a never-uploaded reservation releases its open-work slot'
);
reset role;

-- Account byte liability: three claimed-and-cancelled 50 MiB liabilities are
-- retained until cleanup completion even though their declared files are tiny.
set local role authenticated;
select pg_temp.set_lifecycle_user(
  '10000000-0000-4000-8000-000000000006'::uuid
);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000006', '', '', '{}'::uuid[],
  '2024-07-01', null, null,
  'e3000000-0000-4000-8000-000000000001'
) \gset bytes_one_
select * from public.claim_photo_intake_upload(
  :'bytes_one_intake_id'::uuid,
  'e3100000-0000-4000-8000-000000000001',
  'image/jpeg', 1, repeat('c', 64)
);
select * from public.cancel_photo_intake(:'bytes_one_intake_id'::uuid);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000006', '', '', '{}'::uuid[],
  '2024-07-02', null, null,
  'e3000000-0000-4000-8000-000000000002'
) \gset bytes_two_
select * from public.claim_photo_intake_upload(
  :'bytes_two_intake_id'::uuid,
  'e3100000-0000-4000-8000-000000000002',
  'image/jpeg', 1, repeat('d', 64)
);
select * from public.cancel_photo_intake(:'bytes_two_intake_id'::uuid);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000006', '', '', '{}'::uuid[],
  '2024-07-03', null, null,
  'e3000000-0000-4000-8000-000000000003'
) \gset bytes_three_
select * from public.claim_photo_intake_upload(
  :'bytes_three_intake_id'::uuid,
  'e3100000-0000-4000-8000-000000000003',
  'image/jpeg', 1, repeat('e', 64)
);
select * from public.cancel_photo_intake(:'bytes_three_intake_id'::uuid);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000006', '', '', '{}'::uuid[],
  '2024-07-04', null, null,
  'e3000000-0000-4000-8000-000000000004'
) \gset bytes_four_
select throws_ok(
  format(
    $$select * from public.claim_photo_intake_upload(
      %L::uuid, 'e3100000-0000-4000-8000-000000000004',
      'image/jpeg', 1, repeat('f', 64)
    )$$,
    :'bytes_four_intake_id'
  ),
  'P0001', 'PHOTO_ACCOUNT_BYTE_QUOTA',
  'three unresolved fixed-size liabilities prevent another upload claim'
);
reset role;

select is(
  (select count(*)::bigint from private.photo_object_cleanup_jobs
    where intake_id in (
      :'bytes_one_intake_id'::uuid, :'bytes_two_intake_id'::uuid,
      :'bytes_three_intake_id'::uuid
    )),
  3::bigint,
  'each cancelled claimed upload has exactly one durable cleanup job'
);
select throws_ok(
  format(
    $$update private.photo_object_cleanup_jobs
         set object_path = 'intake/00000000-0000-0000-0000-000000000000'
       where intake_id = %L::uuid$$,
    :'bytes_one_intake_id'
  ),
  '42501', 'Photo cleanup identity is immutable',
  'even a privileged maintenance path cannot retarget a cleanup job'
);

select * from finish();
rollback;
