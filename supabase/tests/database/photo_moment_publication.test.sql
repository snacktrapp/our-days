begin;

select no_plan();

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_capabilities'::regclass),
  'the photo capability ledger enables and forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_moment_requests'::regclass),
  'the private photo-moment request ledger enables and forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_moment_request_people'::regclass),
  'the private staged-tag ledger enables and forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'public.moment_photos'::regclass),
  'the family photo linkage enables and forces RLS'
);
select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name in (
        'photo_capabilities', 'photo_moment_requests',
        'photo_moment_request_people'
      )
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'browser and service roles have no direct private publication privileges'
);
select ok(
  has_table_privilege('authenticated', 'public.moment_photos', 'SELECT')
    and not has_table_privilege('authenticated', 'public.moment_photos', 'INSERT')
    and not has_table_privilege('authenticated', 'public.moment_photos', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.moment_photos', 'DELETE'),
  'family clients receive only the RLS-filtered photo-link read surface'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.reserve_photo_moment(uuid,uuid,text,text,uuid[],date,timestamptz,text,uuid)',
    'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.get_photo_moment_status(uuid)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.get_photo_moment_delivery(uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.reserve_photo_moment(uuid,uuid,text,text,uuid[],date,timestamptz,text,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.get_photo_moment_delivery(uuid)', 'EXECUTE'
  ),
  'only authenticated callers can reach the public photo-moment coordinators'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.publish_photo_moment_if_ready(uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role', 'private.publish_photo_moment_if_ready(uuid)', 'EXECUTE'
  ),
  'browser and service roles cannot invoke the privileged publisher'
);
select is(
  (select jsonb_object_agg(capability, enabled order by capability)
     from private.photo_capabilities),
  '{"family_derivative_delivery": false, "photo_publication": false}'::jsonb,
  'publication and family delivery are independently disabled by default'
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('72000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', statement_timestamp(),
   statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('72000000-0000-4000-8000-000000000004',
   '10000000-0000-4000-8000-000000000004', statement_timestamp(),
   statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('72000000-0000-4000-8000-000000000006',
   '10000000-0000-4000-8000-000000000006', statement_timestamp(),
   statement_timestamp(), statement_timestamp() + interval '1 day');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select * from public.reserve_photo_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A bright afternoon worth keeping.', 'Back garden',
    array['30000000-0000-4000-8000-000000000002']::uuid[],
    '2024-06-15', null, null,
    'd4000000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'Photo moment could not be reserved',
  'default-off publication rejects staging with a safe contract'
);
select throws_ok(
  $$select public.create_family_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001', 'photo', '',
    'A forged photo without verified media.', '', '{}'::uuid[],
    '2024-06-15', null, null
  )$$,
  '22023', 'Moment could not be created',
  'the general moment RPC cannot forge a photo without verified media'
);
reset role;
select is(
  (select row(
    (select count(*) from private.photo_intakes
      where request_key = 'd4000000-0000-4000-8000-000000000001'),
    (select count(*) from private.photo_moment_requests
      where request_key = 'd4000000-0000-4000-8000-000000000001'),
    (select count(*) from public.moment_photos)
  )::text),
  row(0::bigint, 0::bigint, 0::bigint)::text,
  'default-off rejection leaves no intake, staged request, or photo link'
);

update private.photo_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'photo_publication';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'A bright afternoon worth keeping.', 'Back garden',
  array['30000000-0000-4000-8000-000000000002']::uuid[],
  '2024-06-15', null, null,
  'd4000000-0000-4000-8000-000000000001'
) \gset photo_

select * from public.reserve_photo_moment(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'A bright afternoon worth keeping.', 'Back garden',
  array['30000000-0000-4000-8000-000000000002']::uuid[],
  '2024-06-15', null, null,
  'd4000000-0000-4000-8000-000000000001'
) \gset photo_retry_

select is(
  row(:'photo_retry_intake_id'::uuid, :'photo_retry_moment_id'::uuid)::text,
  row(:'photo_intake_id'::uuid, :'photo_moment_id'::uuid)::text,
  'an identical retry returns the stable intake and future moment identities'
);
select throws_ok(
  $$select * from public.reserve_photo_moment(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'A changed caption must not overwrite staging.', 'Back garden',
    array['30000000-0000-4000-8000-000000000002']::uuid[],
    '2024-06-15', null, null,
    'd4000000-0000-4000-8000-000000000001'
  )$$,
  '22023', 'Photo moment could not be reserved',
  'reusing a request key with changed payload is denied'
);
select * from public.get_photo_moment_status(:'photo_intake_id'::uuid)
  \gset staged_
select is(
  :'staged_status', 'uploading'::text,
  'a staged photo reports uploading without exposing a moment early'
);

select * from public.claim_photo_intake_upload(
  :'photo_intake_id'::uuid,
  'd4100000-0000-4000-8000-000000000001',
  'image/jpeg', 12, repeat('a', 64)
) \gset upload_
select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd4200000-0000-4000-8000-000000000001', 'our-days-intake',
  :'photo_object_path', '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'intake_id', :'photo_intake_id',
    'upload_request_key', 'd4100000-0000-4000-8000-000000000001',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 12,
    'expected_sha256', repeat('a', 64)
  )
);
select * from public.acknowledge_photo_intake(:'photo_intake_id'::uuid)
  \gset acknowledged_
reset role;

select is(
  (select count(*)::bigint from private.photo_moment_requests
    where intake_id = :'photo_intake_id'::uuid),
  1::bigint,
  'staging persists exactly one immutable photo request'
);
select is(
  (select count(*)::bigint from private.photo_moment_request_people
    where request_id = (select id from private.photo_moment_requests
      where intake_id = :'photo_intake_id'::uuid)),
  1::bigint,
  'staging persists exactly one circle-bound family tag'
);
select is(
  (select count(*)::bigint from public.moments
    where id = :'photo_moment_id'::uuid),
  0::bigint,
  'acknowledgement alone cannot publish a photo moment'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000099',
  'phase-4d-validator@example.test', statement_timestamp(), '{}'
);
insert into private.photo_validator_allowlist (auth_user_id)
values ('10000000-0000-4000-8000-000000000099');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select * from public.claim_photo_validation(
  :'photo_intake_id'::uuid,
  'd4300000-0000-4000-8000-000000000001'
) \gset validation_
select set_config('storage.operation', 'object.upload', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd4400000-0000-4000-8000-000000000001', 'our-days-originals',
  :'validation_canonical_object_path',
  '10000000-0000-4000-8000-000000000099',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'validation_job_id', :'validation_validation_job_id',
    'intake_id', :'photo_intake_id',
    'original_id', split_part(:'validation_canonical_object_path', '/', 2),
    'lease_attempt_id', :'validation_lease_attempt_id',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 12,
    'expected_sha256', repeat('a', 64),
    'verification_profile_version', 1
  )
);
select public.complete_photo_validation(
  :'validation_validation_job_id'::uuid,
  'd4300000-0000-4000-8000-000000000001',
  'd4400000-0000-4000-8000-000000000001', '',
  'image/jpeg', 12, repeat('a', 64), 4, 3, 3, 1
) as original_id \gset original_

select * from public.claim_photo_display_derivative(
  :'original_original_id'::uuid,
  'd4500000-0000-4000-8000-000000000001'
) \gset derivative_
select jsonb_build_object(
  'derivative_job_id', :'derivative_derivative_job_id',
  'original_id', :'original_original_id',
  'derivative_id', split_part(:'derivative_display_object_path', '/', 2),
  'lease_attempt_id', :'derivative_lease_attempt_id',
  'source_storage_object_id', 'd4400000-0000-4000-8000-000000000001',
  'source_storage_object_version', '',
  'output_mime_type', 'image/webp', 'output_size_bytes', 8,
  'output_sha256', repeat('b', 64), 'output_width', 2,
  'output_height', 2, 'output_channels', 3, 'output_pages', 1,
  'maximum_size_bytes', 12582912, 'transform_profile_version', 1
)::text as derivative_metadata \gset
select set_config('storage.operation', 'object.upload', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd4600000-0000-4000-8000-000000000001', 'our-days-display',
  :'derivative_display_object_path',
  '10000000-0000-4000-8000-000000000099',
  '{"mimetype":"image/webp","size":8}'::jsonb,
  :'derivative_metadata'::jsonb
);
select public.complete_photo_display_derivative(
  :'derivative_derivative_job_id'::uuid,
  'd4500000-0000-4000-8000-000000000001',
  'd4600000-0000-4000-8000-000000000001', '',
  8, repeat('b', 64), 2, 2, 3, 1
) as display_derivative_id \gset completed_
reset role;

set constraints all immediate;
set constraints all deferred;

select is(
  (select row(kind, body, place_name, occurred_on, time_precision)::text
     from public.moments where id = :'photo_moment_id'::uuid),
  row(
    'photo'::text, 'A bright afternoon worth keeping.'::text,
    'Back garden'::text, '2024-06-15'::date, 'date'::text
  )::text,
  'verified derivative readiness atomically publishes the staged chronology'
);
select is(
  (select count(*)::bigint from public.moment_photos
    where moment_id = :'photo_moment_id'::uuid
      and original_id = :'original_original_id'::uuid
      and display_derivative_id = :'completed_display_derivative_id'::uuid),
  1::bigint,
  'publication creates exactly one immutable original-to-display photo link'
);
select is(
  (select count(*)::bigint from public.moment_people
    where moment_id = :'photo_moment_id'::uuid
      and person_id = '30000000-0000-4000-8000-000000000002'),
  1::bigint,
  'publication copies the staged family tag exactly once'
);
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'moment_created'
      and subject_id = :'photo_moment_id'::uuid
      and actor_membership_id = '40000000-0000-4000-8000-000000000001'),
  1::bigint,
  'publication emits exactly one recorder-attributed creation audit'
);
select is(
  private.publish_photo_moment_if_ready(:'photo_intake_id'::uuid),
  :'photo_moment_id'::uuid,
  'publication retry returns the stable moment identity'
);
select is(
  (select row(
    (select count(*) from public.moments
      where id = :'photo_moment_id'::uuid),
    (select count(*) from public.moment_photos
      where moment_id = :'photo_moment_id'::uuid),
    (select count(*) from private.audit_events
      where event_type = 'moment_created'
        and subject_id = :'photo_moment_id'::uuid)
  )::text),
  row(1::bigint, 1::bigint, 1::bigint)::text,
  'publication retry creates no duplicate moment, link, or audit'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select is(
  (select count(*)::bigint
     from public.get_photo_moment_delivery(:'photo_moment_id'::uuid)),
  0::bigint,
  'publication does not bypass the independently default-off delivery gate'
);
reset role;

update private.photo_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'family_derivative_delivery';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select is(
  (select row(
    bucket_id, object_path, output_mime_type, output_size_bytes,
    output_sha256_hex, output_width, output_height
  )::text from public.get_photo_moment_delivery(:'photo_moment_id'::uuid)),
  row(
    'our-days-display'::text, :'derivative_display_object_path'::text,
    'image/webp'::text, 8::bigint, repeat('b', 64), 2, 2
  )::text,
  'a live family session receives only the verified display descriptor'
);
select is(
  private.photo_display_path_is_readable(:'derivative_display_object_path'),
  true,
  'the live family session can read the exact published display path'
);
select is(
  (select count(*)::bigint from public.moment_photos
    where moment_id = :'photo_moment_id'::uuid),
  1::bigint,
  'the active circle member sees the photo link through RLS'
);
select public.set_written_moment_trashed(
  :'photo_moment_id'::uuid, 1, true
) as revision \gset trashed_
select is(
  (select count(*)::bigint
     from public.get_photo_moment_delivery(:'photo_moment_id'::uuid)),
  0::bigint,
  'trash immediately denies the family delivery descriptor'
);
select is(
  private.photo_display_path_is_readable(:'derivative_display_object_path'),
  false,
  'trash immediately revokes the Storage read predicate'
);
select is(
  (select count(*)::bigint from public.moment_photos
    where moment_id = :'photo_moment_id'::uuid),
  0::bigint,
  'trash hides the photo link from the ordinary RLS surface'
);
select public.set_written_moment_trashed(
  :'photo_moment_id'::uuid, :'trashed_revision'::bigint, false
) as revision \gset restored_
select is(
  (select count(*)::bigint
     from public.get_photo_moment_delivery(:'photo_moment_id'::uuid)),
  1::bigint,
  'restore re-enables family delivery without republishing media'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000006","session_id":"72000000-0000-4000-8000-000000000006"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true
);
select is(
  (select count(*)::bigint
     from public.get_photo_moment_delivery(:'photo_moment_id'::uuid)),
  0::bigint,
  'a live member of another circle receives no delivery descriptor'
);
select is(
  (select count(*)::bigint from public.moment_photos
    where moment_id = :'photo_moment_id'::uuid),
  0::bigint,
  'a live member of another circle sees no photo linkage'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000004","session_id":"72000000-0000-4000-8000-000000000004"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true
);
select is(
  (select count(*)::bigint
     from public.get_photo_moment_delivery(:'photo_moment_id'::uuid)),
  0::bigint,
  'a revoked member receives no delivery descriptor despite a live Auth session'
);
select is(
  private.photo_display_path_is_readable(:'derivative_display_object_path'),
  false,
  'a revoked member cannot read the published display object'
);
reset role;

select * from finish();
rollback;
