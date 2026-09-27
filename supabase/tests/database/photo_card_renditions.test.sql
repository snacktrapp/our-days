begin;

select no_plan();

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_card_renditions'::regclass),
  'photo card renditions enable and force RLS'
);
select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name = 'photo_card_renditions'
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'browser and service roles have no direct card-rendition privileges'
);
select is(
  (select count(*)::bigint
     from information_schema.tables
    where table_schema = 'public'
      and table_name = 'photo_card_renditions'),
  0::bigint,
  'the card ledger is not exposed as a public table'
);
select ok(
  exists (
    select 1
      from pg_trigger
     where tgname = 'photo_card_renditions_integrity'
       and tgrelid = 'private.photo_card_renditions'::regclass
       and not tgisinternal
  ),
  'photo card renditions have an immutability trigger'
);
select ok(
  pg_get_function_result('public.get_photo_moment_delivery(uuid)'::regprocedure)
    like '%card_renditions jsonb%',
  'delivery returns card renditions beside the display descriptor'
);
select ok(
  (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname =
        'our_days_display_select_exact_active_derivative_lease')
    like '%photo_card_path_is_readable%'
  and (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname =
        'our_days_display_select_exact_active_derivative_lease')
    not like '%allow_any_operation%',
  'card reads use the path predicate without a Storage operation allow-list'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class
    where oid = 'private.photo_card_backfill_leases'::regclass),
  'photo card backfill leases enable and force RLS'
);
select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name = 'photo_card_backfill_leases'
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'browser and service roles have no direct backfill-lease privileges'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class
    where oid = 'private.photo_card_backfill_lease_claims'::regclass),
  'photo card backfill lease claims enable and force RLS'
);
select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name = 'photo_card_backfill_lease_claims'
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'browser and service roles have no direct backfill-lease-claim privileges'
);
select ok(
  exists (
    select 1
      from pg_trigger
     where tgname = 'photo_card_backfill_lease_claims_append_only'
       and tgrelid = 'private.photo_card_backfill_lease_claims'::regclass
       and not tgisinternal
  ),
  'photo card backfill lease claims have an append-only trigger'
);
select ok(
  has_function_privilege(
    'authenticated',
    'public.list_photo_card_backfill_candidates(integer, uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.list_photo_card_backfill_candidates(integer, uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'service_role',
    'public.list_photo_card_backfill_candidates(integer, uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated',
    'private.list_photo_card_backfill_candidates(integer, uuid)',
    'EXECUTE'
  ),
  'the backfill list is a validator RPC and is not granted on the private function'
);
select ok(
  pg_get_functiondef(
    'private.list_photo_card_backfill_candidates(integer, uuid)'::regprocedure
  ) like '%least(requested_batch_limit, 10)%',
  'backfill listing never returns more than 10 rows'
);
select ok(
  pg_get_functiondef(
    'private.photo_display_path_is_readable(text)'::regprocedure
  ) like '%state = ''leased''%'
  and pg_get_functiondef(
    'private.photo_display_path_is_readable(text)'::regprocedure
  ) not like '%allow_any_operation%',
  'display reads stay on the live job lease or family moment rule'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000096',
  'photo-card-validator@example.test', statement_timestamp(), '{}'
), (
  '10000000-0000-4000-8000-000000000095',
  'photo-card-other-validator@example.test', statement_timestamp(), '{}'
);
insert into private.photo_validator_allowlist (auth_user_id)
values
  ('10000000-0000-4000-8000-000000000096'),
  ('10000000-0000-4000-8000-000000000095');

set constraints all deferred;
insert into private.photo_intakes (
  id, circle_id, journal_person_id, requested_by_membership_id,
  requester_authorization_version, request_key, object_path, state,
  requested_at, expires_at, upload_request_key, expected_mime_type,
  expected_size_bytes, expected_sha256, upload_claimed_at,
  upload_expires_at, uploaded_at, validation_completed_at
) values (
  'e1000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', statement_timestamp(),
  'e2000000-0000-4000-8000-000000000001',
  'intake/e1000000-0000-4000-8000-000000000001', 'verified',
  statement_timestamp(), statement_timestamp() + interval '30 minutes',
  'e3000000-0000-4000-8000-000000000001', 'image/jpeg', 12,
  decode(repeat('a', 64), 'hex'), statement_timestamp(),
  statement_timestamp() + interval '2 hours', statement_timestamp(),
  statement_timestamp()
);
insert into private.photo_validation_jobs (
  id, circle_id, intake_id, journal_person_id,
  requested_by_membership_id, original_id, lease_attempt_id,
  canonical_object_path, state, validator_auth_user_id, lease_key_hash,
  lease_started_at, lease_expires_at, attempt_count,
  source_storage_object_id, source_storage_object_version, completed_at
) values (
  'e4000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'original/e5000000-0000-4000-8000-000000000001/e6000000-0000-4000-8000-000000000001',
  'verified', '10000000-0000-4000-8000-000000000096',
  extensions.digest('fixture', 'sha256'), statement_timestamp(),
  statement_timestamp() + interval '15 minutes', 1,
  'e7000000-0000-4000-8000-000000000001', '', statement_timestamp()
);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'e7000000-0000-4000-8000-000000000001', 'our-days-originals',
  'original/e5000000-0000-4000-8000-000000000001/e6000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000096',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'validation_job_id', 'e4000000-0000-4000-8000-000000000001',
    'intake_id', 'e1000000-0000-4000-8000-000000000001',
    'original_id', 'e5000000-0000-4000-8000-000000000001',
    'lease_attempt_id', 'e6000000-0000-4000-8000-000000000001',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 12,
    'expected_sha256', repeat('a', 64),
    'verification_profile_version', 1
  )
);
insert into private.photo_originals (
  id, circle_id, validation_job_id, intake_id, journal_person_id,
  recorded_by_membership_id, lease_attempt_id, object_path,
  storage_object_id, storage_object_version, verified_mime_type,
  verified_size_bytes, verified_sha256, verified_width, verified_height,
  verified_channels, verified_pages, verification_profile_version
) values (
  'e5000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'e6000000-0000-4000-8000-000000000001',
  'original/e5000000-0000-4000-8000-000000000001/e6000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001', '', 'image/jpeg', 12,
  decode(repeat('a', 64), 'hex'), 4, 3, 3, 1, 1
);
set constraints all immediate;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000096', true
);
select * from public.claim_photo_display_derivative(
  'e5000000-0000-4000-8000-000000000001',
  'ea000000-0000-4000-8000-000000000001'
) \gset cardfix_
reset role;

set constraints all deferred;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000096', true
);
select set_config('storage.operation', 'object.upload', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'e8000000-0000-4000-8000-000000000001', 'our-days-display',
  :'cardfix_display_object_path',
  '10000000-0000-4000-8000-000000000096',
  '{"mimetype":"image/webp","size":8}'::jsonb,
  jsonb_build_object(
    'derivative_job_id', :'cardfix_derivative_job_id',
    'original_id', 'e5000000-0000-4000-8000-000000000001',
    'derivative_id', split_part(:'cardfix_display_object_path', '/', 2),
    'lease_attempt_id', :'cardfix_lease_attempt_id',
    'source_storage_object_id', 'e7000000-0000-4000-8000-000000000001',
    'source_storage_object_version', '',
    'output_mime_type', 'image/webp',
    'output_size_bytes', 8,
    'output_sha256', repeat('b', 64),
    'output_width', 2,
    'output_height', 2,
    'output_channels', 3,
    'output_pages', 1,
    'maximum_size_bytes', 12582912,
    'transform_profile_version', 1
  )
);
select public.complete_photo_display_derivative(
  :'cardfix_derivative_job_id'::uuid,
  'ea000000-0000-4000-8000-000000000001',
  'e8000000-0000-4000-8000-000000000001', '', 8, repeat('b', 64),
  2, 2, 3, 1
) as derivative_id \gset carddone_
reset role;
set constraints all immediate;

select is(
  (select state from private.photo_derivative_jobs
    where id = :'cardfix_derivative_job_id'::uuid),
  'verified'::text,
  'the card fixture completes a verified display derivative'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000096', true
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  private.photo_display_path_is_readable(:'cardfix_display_object_path'),
  false,
  'the worker cannot read a display photo without a lease'
);
select is(
  private.photo_display_backfill_path_is_readable(
    :'cardfix_display_object_path'
  ),
  false,
  'a display photo stays unreadable before a backfill lease'
);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  false,
  'the worker cannot read a card path without a job or backfill lease'
);
select throws_ok(
  $$select * from public.list_photo_card_backfill_candidates(0, null)$$,
  '22023', 'Photo card backfill candidates could not be listed',
  'a backfill list rejects an empty batch'
);
select is(
  (select display_derivative_id
     from public.list_photo_card_backfill_candidates(10, null)
    where display_derivative_id = :'carddone_derivative_id'::uuid),
  :'carddone_derivative_id'::uuid,
  'the validator lists a display derivative missing a 1080 card'
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_card_path_is_uploadable(
    :'cardfix_display_object_path' || '.card-1080.webp',
    '10000000-0000-4000-8000-000000000096',
    jsonb_build_object(
      'card_width', 1080,
      'display_derivative_id', :'carddone_derivative_id',
      'original_id', 'e5000000-0000-4000-8000-000000000001',
      'output_height', 2,
      'output_mime_type', 'image/webp',
      'output_sha256', repeat('c', 64),
      'output_size_bytes', 6,
      'output_width', 2
    )
  ),
  false,
  'a worker with no lease cannot upload a card'
);
select throws_ok(
  format(
    'select public.record_photo_card_rendition(%L::uuid, 1080, %L::uuid, %L, 6, %L, 2, 2)',
    :'carddone_derivative_id',
    'e9000000-0000-4000-8000-000000000001',
    '',
    repeat('c', 64)
  ),
  '42501', 'Photo card rendition could not be recorded',
  'a worker with no lease cannot record a card'
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  (select state
     from public.claim_photo_card_backfill_lease(
       :'carddone_derivative_id'::uuid
     )),
  'leased'::text,
  'the validator claims a short per-photo backfill lease'
);
reset role;
select id as first_claim_id
  from private.photo_card_backfill_lease_claims
 where display_derivative_id = :'carddone_derivative_id'::uuid
   and validator_auth_user_id = '10000000-0000-4000-8000-000000000096'
\gset cardclaim_
select is(
  (select count(*)::bigint
     from private.photo_card_backfill_lease_claims
    where display_derivative_id = :'carddone_derivative_id'::uuid
      and validator_auth_user_id = '10000000-0000-4000-8000-000000000096'
      and claimed_at is not null),
  1::bigint,
  'claiming a backfill lease records who claimed it and when'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000096', true
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  private.photo_display_backfill_path_is_readable(
    :'cardfix_display_object_path'
  ),
  true,
  'the backfill lease grants a read of that display path'
);
select is(
  private.photo_display_path_is_readable(:'cardfix_display_object_path'),
  false,
  'the live display rule still ignores a backfill lease'
);
select is(
  private.photo_display_backfill_path_is_readable(
    :'cardfix_display_object_path' || '.other'
  ),
  false,
  'a backfill lease does not grant a different display path'
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_display_backfill_path_is_readable(
    :'cardfix_display_object_path'
  ),
  false,
  'a backfill lease does not grant display writes or non-read operations'
);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  false,
  'the upload-then-read-back window is not an upload operation'
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  true,
  'a leased worker can read a card path before its row exists'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000095', true
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_card_path_is_uploadable(
    :'cardfix_display_object_path' || '.card-1080.webp',
    '10000000-0000-4000-8000-000000000095',
    jsonb_build_object(
      'card_width', 1080,
      'display_derivative_id', :'carddone_derivative_id',
      'original_id', 'e5000000-0000-4000-8000-000000000001',
      'output_height', 2,
      'output_mime_type', 'image/webp',
      'output_sha256', repeat('c', 64),
      'output_size_bytes', 6,
      'output_width', 2
    )
  ),
  false,
  'another worker''s lease does not allow a card upload'
);
select throws_ok(
  format(
    'select public.record_photo_card_rendition(%L::uuid, 1080, %L::uuid, %L, 6, %L, 2, 2)',
    :'carddone_derivative_id',
    'e9000000-0000-4000-8000-000000000001',
    '',
    repeat('c', 64)
  ),
  '42501', 'Photo card rendition could not be recorded',
  'another worker''s lease does not allow a card record'
);
reset role;
update private.photo_card_backfill_leases
   set lease_started_at = statement_timestamp() - interval '3 minutes',
       lease_expires_at = statement_timestamp() - interval '1 minute'
 where display_derivative_id = :'carddone_derivative_id'::uuid;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000096', true
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_card_path_is_uploadable(
    :'cardfix_display_object_path' || '.card-1080.webp',
    '10000000-0000-4000-8000-000000000096',
    jsonb_build_object(
      'card_width', 1080,
      'display_derivative_id', :'carddone_derivative_id',
      'original_id', 'e5000000-0000-4000-8000-000000000001',
      'output_height', 2,
      'output_mime_type', 'image/webp',
      'output_sha256', repeat('c', 64),
      'output_size_bytes', 6,
      'output_width', 2
    )
  ),
  false,
  'a worker whose lease expired cannot upload a card'
);
select throws_ok(
  format(
    'select public.record_photo_card_rendition(%L::uuid, 1080, %L::uuid, %L, 6, %L, 2, 2)',
    :'carddone_derivative_id',
    'e9000000-0000-4000-8000-000000000001',
    '',
    repeat('c', 64)
  ),
  '42501', 'Photo card rendition could not be recorded',
  'a worker whose lease expired cannot record a card'
);
select is(
  (select state
     from public.claim_photo_card_backfill_lease(
       :'carddone_derivative_id'::uuid
     )),
  'leased'::text,
  'the validator reclaims an expired backfill lease'
);
reset role;
select is(
  (select count(*)::bigint
     from private.photo_card_backfill_lease_claims
    where display_derivative_id = :'carddone_derivative_id'::uuid),
  2::bigint,
  'a later claim appends another row instead of overwriting the latest claim'
);
select is(
  (select validator_auth_user_id::text
     from private.photo_card_backfill_lease_claims
    where id = :'cardclaim_first_claim_id'::uuid),
  '10000000-0000-4000-8000-000000000096',
  'a later claim leaves the earlier claim row in place'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000096', true
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_card_path_is_uploadable(
    :'cardfix_display_object_path' || '.card-1080.webp',
    '10000000-0000-4000-8000-000000000096',
    jsonb_build_object(
      'card_width', 1080,
      'display_derivative_id', :'carddone_derivative_id',
      'original_id', 'e5000000-0000-4000-8000-000000000001',
      'output_height', 2,
      'output_mime_type', 'image/webp',
      'output_sha256', repeat('c', 64),
      'output_size_bytes', 6,
      'output_width', 2
    )
  ),
  true,
  'a lease holder can upload a card'
);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'e9000000-0000-4000-8000-000000000001', 'our-days-display',
  :'cardfix_display_object_path' || '.card-1080.webp',
  '10000000-0000-4000-8000-000000000096',
  '{"mimetype":"image/webp","size":6}'::jsonb,
  jsonb_build_object(
    'card_width', 1080,
    'display_derivative_id', :'carddone_derivative_id',
    'original_id', 'e5000000-0000-4000-8000-000000000001',
    'output_height', 2,
    'output_mime_type', 'image/webp',
    'output_sha256', repeat('c', 64),
    'output_size_bytes', 6,
    'output_width', 2
  )
);
select public.record_photo_card_rendition(
  :'carddone_derivative_id'::uuid,
  1080,
  'e9000000-0000-4000-8000-000000000001',
  '',
  6,
  repeat('c', 64),
  2,
  2
) as id \gset cardrow_
select ok(
  :'cardrow_id'::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  'a lease holder can record a card'
);
select is(
  public.record_photo_card_rendition(
    :'carddone_derivative_id'::uuid,
    1080,
    'e9000000-0000-4000-8000-000000000001',
    '',
    6,
    repeat('c', 64),
    2,
    2
  ),
  :'cardrow_id'::uuid,
  'recording the same card evidence is idempotent'
);
select throws_ok(
  format(
    'select public.record_photo_card_rendition(%L::uuid, 1080, %L::uuid, %L, 6, %L, 2, 2)',
    :'carddone_derivative_id',
    'e9000000-0000-4000-8000-000000000001',
    '',
    repeat('d', 64)
  ),
  '42501', 'Photo card rendition could not be recorded',
  'a different card checksum cannot replace a recorded rendition'
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  false,
  'a recorded card is outside the worker upload-then-read-back window'
);
select is(
  (select count(*)::bigint
     from public.list_photo_card_backfill_candidates(10, null)
    where display_derivative_id = :'carddone_derivative_id'::uuid),
  0::bigint,
  'a recorded 1080 card leaves the backfill candidate list'
);
select public.release_photo_card_backfill_lease(
  :'carddone_derivative_id'::uuid
);
select is(
  private.photo_display_backfill_path_is_readable(
    :'cardfix_display_object_path'
  ),
  false,
  'releasing the backfill lease removes the display read'
);
reset role;

select throws_ok(
  format(
    'update private.photo_card_renditions set output_width = 3 where id = %L::uuid',
    :'cardrow_id'
  ),
  '42501', 'Photo card renditions are immutable',
  'card ledger rows cannot be updated'
);
select throws_ok(
  format(
    'delete from private.photo_card_renditions where id = %L::uuid',
    :'cardrow_id'
  ),
  '42501', 'Photo card renditions are immutable',
  'card ledger rows cannot be deleted'
);
select throws_ok(
  format(
    'update private.photo_card_backfill_lease_claims set claimed_at = statement_timestamp() where id = %L::uuid',
    :'cardclaim_first_claim_id'
  ),
  '42501', 'Photo card backfill lease claims are append-only',
  'backfill lease claims cannot be updated'
);
select throws_ok(
  format(
    'delete from private.photo_card_backfill_lease_claims where id = %L::uuid',
    :'cardclaim_first_claim_id'
  ),
  '42501', 'Photo card backfill lease claims are append-only',
  'backfill lease claims cannot be deleted'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_card_path_is_uploadable(
    :'cardfix_display_object_path' || '.card-1080.webp',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'card_width', 1080,
      'display_derivative_id', :'carddone_derivative_id',
      'original_id', 'e5000000-0000-4000-8000-000000000001',
      'output_height', 2,
      'output_mime_type', 'image/webp',
      'output_sha256', repeat('c', 64),
      'output_size_bytes', 6,
      'output_width', 2
    )
  ),
  false,
  'a family identity cannot upload a card path'
);
select throws_ok(
  format(
    'select public.record_photo_card_rendition(%L::uuid, 1080, %L::uuid, %L, 6, %L, 2, 2)',
    :'carddone_derivative_id',
    'e9000000-0000-4000-8000-000000000001',
    '',
    repeat('c', 64)
  ),
  '42501', 'Photo card rendition could not be recorded',
  'a family identity cannot record a card rendition'
);
select throws_ok(
  $$select count(*) from private.photo_card_renditions$$,
  '42501', 'permission denied for table photo_card_renditions',
  'authenticated callers cannot read the card ledger'
);
select throws_ok(
  $$select * from public.list_photo_card_backfill_candidates(10, null)$$,
  '42501', 'Photo card backfill candidates could not be listed',
  'a family member cannot list card backfill candidates'
);
select throws_ok(
  format(
    'select * from public.claim_photo_card_backfill_lease(%L::uuid)',
    :'carddone_derivative_id'
  ),
  '42501', 'Photo card backfill lease could not be claimed',
  'a family member cannot claim a card backfill lease'
);
reset role;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  ('72000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001', statement_timestamp(),
   statement_timestamp(), statement_timestamp() + interval '1 day'),
  ('72000000-0000-4000-8000-000000000006',
   '10000000-0000-4000-8000-000000000006', statement_timestamp(),
   statement_timestamp(), statement_timestamp() + interval '1 day');
insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_membership_id,
  kind, audience, body, occurred_on
) values (
  'eb000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'photo', 'family', 'A card worth keeping.', '2024-06-15'
);
insert into public.moment_photos (
  id, circle_id, moment_id, original_id, display_derivative_id,
  display_width, display_height, sort_order
) values (
  'eb100000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'eb000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  :'carddone_derivative_id'::uuid,
  2, 2, 0
);
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
select set_config('storage.operation', 'object.sign', true);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  true,
  'a same-circle member can read a card on a live moment'
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
select set_config('storage.operation', 'object.sign', true);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  false,
  'a member of another circle cannot read a card'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000001"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select public.set_written_moment_trashed(
  'eb000000-0000-4000-8000-000000000001', 1, true
);
select set_config('storage.operation', 'object.sign', true);
select is(
  private.photo_card_path_is_readable(
    :'cardfix_display_object_path' || '.card-1080.webp'
  ),
  false,
  'a trashed moment card is unreadable'
);
reset role;

select * from finish();
rollback;
