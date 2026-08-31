begin;

select no_plan();

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_validator_allowlist'::regclass),
  'the validator allowlist enables and forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_validation_jobs'::regclass),
  'the validation-job ledger enables and forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_originals'::regclass),
  'the immutable-original ledger enables and forces RLS'
);

select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name in (
        'photo_validator_allowlist', 'photo_validation_jobs', 'photo_originals'
      )
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'browser and service roles have no direct promotion-ledger privileges'
);

select is(
  (select count(*)::bigint
     from information_schema.columns
    where table_schema = 'private'
      and table_name = 'photo_validation_jobs'
      and column_name = 'lease_key'),
  0::bigint,
  'raw validation lease keys are never stored'
);
select is(
  (select data_type::text
     from information_schema.columns
    where table_schema = 'private'
      and table_name = 'photo_validation_jobs'
      and column_name = 'lease_key_hash'),
  'bytea'::text,
  'only a one-way validation lease digest is stored'
);
select ok(
  exists(
    select 1 from pg_constraint
     where conrelid = 'private.photo_validation_jobs'::regclass
       and contype = 'u'
       and pg_get_constraintdef(oid) = 'UNIQUE (intake_id)'
  ),
  'each intake has at most one stable validation job and canonical identity'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'photo_originals_job_identity_fkey') like
    '%FOREIGN KEY (circle_id, validation_job_id, id, object_path, intake_id, journal_person_id, recorded_by_membership_id)%',
  'the original ledger uses an exact composite job identity foreign key'
);

select is(
  (select count(*)::bigint from information_schema.tables
    where table_schema = 'public'
      and table_name in ('photo_validation_jobs', 'photo_originals')),
  0::bigint,
  'no validator or original ledger is exposed as a public table'
);
select is(
  (select count(*)::bigint from information_schema.columns
    where table_schema = 'public' and table_name = 'moments'
      and column_name in (
        'photo_original_id', 'photo_intake_id', 'media_asset_id',
        'original_object_path'
      )),
  0::bigint,
  'Phase 4B creates no photo moment or public media linkage'
);

select ok(
  (select not public and file_size_limit = 52428800
     from storage.buckets where id = 'our-days-originals'),
  'the canonical bucket stays private and size bounded'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint where conname = 'photo_originals_mime_valid')
    like '%image/jpeg%image/png%image/webp%'
  and (select pg_get_constraintdef(oid)
     from pg_constraint where conname = 'photo_originals_mime_valid')
    not like '%image/heic%',
  'only JPEG, PNG, and WebP can enter the canonical ledger'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint where conname = 'photo_originals_decode_shape_valid')
    like '%50000000%',
  'canonical decode dimensions are capped at fifty million pixels'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint where conname = 'photo_validation_jobs_state_valid')
    like '%operator_review%canonical_collision%canonical_evidence_mismatch%',
  'canonical collisions and evidence mismatches have a terminal review state'
);

select is(
  (select count(*)::bigint from pg_trigger
    where not tgisinternal
      and tgname like '%verified_promotion_consistency'),
  3::bigint,
  'deferred consistency gates cover intake, job, and original ledgers'
);
select ok(
  (select bool_and(tgdeferrable and tginitdeferred) from pg_trigger
    where not tgisinternal
      and tgname like '%verified_promotion_consistency'),
  'all three promotion consistency gates are initially deferred'
);

select ok(
  has_function_privilege(
    'authenticated', 'public.claim_photo_validation(uuid,uuid)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.complete_photo_validation(uuid,uuid,uuid,text,text,bigint,text,integer,integer,integer,integer)',
    'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.reject_photo_validation(uuid,uuid,text)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.flag_photo_validation_for_review(uuid,uuid,text)', 'EXECUTE'
  ),
  'authenticated validators can reach only the four public coordinators'
);
select ok(
  not has_function_privilege(
    'anon', 'public.claim_photo_validation(uuid,uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.complete_photo_validation(uuid,uuid,uuid,text,text,bigint,text,integer,integer,integer,integer)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.reject_photo_validation(uuid,uuid,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.flag_photo_validation_for_review(uuid,uuid,text)', 'EXECUTE'
  ),
  'anonymous callers cannot execute any validation coordinator'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.claim_photo_validation(uuid,uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'service_role', 'private.claim_photo_validation(uuid,uuid)', 'EXECUTE'
  ),
  'neither browser nor service roles can bypass the public claim coordinator'
);

select is(
  (select count(*)::bigint from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'our_days_originals_%'
      and cmd in ('UPDATE', 'DELETE')),
  0::bigint,
  'canonical objects have no overwrite, upsert, or delete policy'
);
select ok(
  (select with_check from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'our_days_originals_insert_exact_active_validator_lease')
    like '%object.upload%'
  and (select with_check from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'our_days_originals_insert_exact_active_validator_lease')
    not like '%tus%',
  'canonical insertion is restricted to the standard no-upsert upload operation'
);
select ok(
  (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'our_days_intake_select_exact_active_validator_lease')
    like '%object.get_authenticated%object.get_authenticated_info%',
  'a validator can read only the exact leased quarantine source'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000099',
  'photo-validator@example.test', statement_timestamp(), '{}'
);
insert into private.photo_validator_allowlist (auth_user_id)
values ('10000000-0000-4000-8000-000000000099');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select * from public.reserve_photo_intake(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000091'
) \gset accepted_
select * from public.claim_photo_intake_upload(
  :'accepted_intake_id'::uuid,
  'c4000000-0000-4000-8000-000000000091',
  'image/jpeg', 12, repeat('a', 64)
) \gset accepted_upload_
select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd1000000-0000-4000-8000-000000000091', 'our-days-intake',
  :'accepted_object_path', '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'intake_id', :'accepted_intake_id',
    'upload_request_key', 'c4000000-0000-4000-8000-000000000091',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 12,
    'expected_sha256', repeat('a', 64)
  )
);
select * from public.acknowledge_photo_intake(:'accepted_intake_id'::uuid)
  \gset accepted_ack_

reset role;
select is(
  (select count(*)::bigint from private.photo_validation_jobs
    where intake_id = :'accepted_intake_id'::uuid),
  1::bigint,
  'acknowledgement queues exactly one validation job'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  format(
    'select * from public.claim_photo_validation(%L::uuid, %L::uuid)',
    :'accepted_intake_id', 'c5000000-0000-4000-8000-000000000091'
  ),
  '42501', 'Photo validation could not be claimed',
  'an ordinary family member cannot pose as a byte validator'
);

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select * from public.claim_photo_validation(
  :'accepted_intake_id'::uuid,
  'c5000000-0000-4000-8000-000000000091'
) \gset accepted_validation_

select is(
  :'accepted_validation_source_storage_object_id'::uuid,
  'd1000000-0000-4000-8000-000000000091'::uuid,
  'claiming fences the exact quarantine object as evidence'
);
reset role;
select is(
  (select octet_length(lease_key_hash) from private.photo_validation_jobs
    where id = :'accepted_validation_validation_job_id'::uuid),
  32,
  'the leased job stores a SHA-256 lease digest'
);
select isnt(
  encode((select lease_key_hash from private.photo_validation_jobs
    where id = :'accepted_validation_validation_job_id'::uuid), 'hex'),
  'c5000000-0000-4000-8000-000000000091'::text,
  'the raw lease capability is absent from the job ledger'
);
select is(
  (select canonical_object_path from private.photo_validation_jobs
    where id = :'accepted_validation_validation_job_id'::uuid),
  :'accepted_validation_canonical_object_path'::text,
  'the canonical path is deterministic and stable on the one-to-one job'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select throws_ok(
  format(
    'select * from public.claim_photo_validation(%L::uuid, %L::uuid)',
    :'accepted_intake_id', 'c5000000-0000-4000-8000-000000000092'
  ),
  '42501', 'Photo validation could not be claimed',
  'a different lease cannot steal a live claim'
);

select set_config('storage.operation', 'object.upload', true);
select throws_ok(
  format(
    'insert into storage.objects '
      || '(id,bucket_id,name,owner_id,metadata,user_metadata) values '
      || '(%L,%L,%L,%L,%L::jsonb,%L::jsonb)',
    'd2000000-0000-4000-8000-000000000090', 'our-days-originals',
    'original/00000000-0000-4000-8000-000000000000',
    '10000000-0000-4000-8000-000000000099',
    '{"mimetype":"image/jpeg","size":12}', '{}'
  ),
  '42501', 'new row violates row-level security policy for table "objects"',
  'the validator cannot upload to an unleased canonical path'
);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd2000000-0000-4000-8000-000000000091', 'our-days-originals',
  :'accepted_validation_canonical_object_path',
  '10000000-0000-4000-8000-000000000099',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'validation_job_id', :'accepted_validation_validation_job_id',
    'intake_id', :'accepted_intake_id',
    'original_id', split_part(:'accepted_validation_canonical_object_path', '/', 2),
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 12,
    'expected_sha256', repeat('a', 64),
    'verification_profile_version', 1
  )
);
select ok(
  exists(select 1 from storage.objects
    where id = 'd2000000-0000-4000-8000-000000000091'),
  'the exact active validator lease admits one standard canonical upload'
);

select public.complete_photo_validation(
  :'accepted_validation_validation_job_id'::uuid,
  'c5000000-0000-4000-8000-000000000091',
  'd2000000-0000-4000-8000-000000000091', '',
  'image/jpeg', 12, repeat('a', 64), 4, 3, 3, 1
) as original_id \gset accepted_original_

reset role;
select is(
  (select state from private.photo_intakes
    where id = :'accepted_intake_id'::uuid),
  'verified'::text,
  'completion makes the intake terminally verified'
);
select is(
  (select state from private.photo_validation_jobs
    where id = :'accepted_validation_validation_job_id'::uuid),
  'verified'::text,
  'completion makes the leased job terminally verified'
);
select is(
  (select row(
    circle_id, journal_person_id, recorded_by_membership_id,
    verified_width, verified_height, verified_channels, verified_pages
  )::text from private.photo_originals
    where id = :'accepted_original_original_id'::uuid),
  row(
    '20000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000001'::uuid,
    '40000000-0000-4000-8000-000000000001'::uuid,
    4, 3, 3, 1
  )::text,
  'the immutable ledger preserves exact circle, journal, recorder, and decode proof'
);
select is(
  (select count(*)::bigint from public.moments
    where id = :'accepted_original_original_id'::uuid),
  0::bigint,
  'verifying bytes does not create a photo moment'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'photo_original_verified'
      and subject_id = :'accepted_original_original_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the verification audit preserves family-recorder attribution, not validator identity'
);

select throws_ok(
  format(
    'update private.photo_originals set verified_width = 5 where id = %L::uuid',
    :'accepted_original_original_id'
  ),
  '42501', 'Verified photo originals are immutable',
  'canonical ledger rows cannot be updated even by direct database code'
);
select throws_ok(
  format(
    'delete from private.photo_originals where id = %L::uuid',
    :'accepted_original_original_id'
  ),
  '42501', 'Verified photo originals are immutable',
  'canonical ledger rows cannot be deleted even by direct database code'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select is(
  public.complete_photo_validation(
    :'accepted_validation_validation_job_id'::uuid,
    'c5000000-0000-4000-8000-000000000091',
    'd2000000-0000-4000-8000-000000000091', '',
    'image/jpeg', 12, repeat('a', 64), 4, 3, 3, 1
  ),
  :'accepted_original_original_id'::uuid,
  'an exact same-validator, same-lease completion retry is idempotent'
);
select throws_ok(
  format(
    'select public.complete_photo_validation('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%L,%s,%L,%s,%s,%s,%s)',
    :'accepted_validation_validation_job_id',
    'c5000000-0000-4000-8000-000000000092',
    'd2000000-0000-4000-8000-000000000091', '',
    'image/jpeg', 12, repeat('a', 64), 4, 3, 3, 1
  ),
  '42501', 'Photo validation could not be completed',
  'terminal replay still requires the original validator lease capability'
);

reset role;
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select * from public.reserve_photo_intake(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000093'
) \gset review_
select * from public.claim_photo_intake_upload(
  :'review_intake_id'::uuid,
  'c4000000-0000-4000-8000-000000000093',
  'image/heic', 20, repeat('b', 64)
) \gset review_upload_
select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd1000000-0000-4000-8000-000000000093', 'our-days-intake',
  :'review_object_path', '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/heic","size":20}'::jsonb,
  jsonb_build_object(
    'intake_id', :'review_intake_id',
    'upload_request_key', 'c4000000-0000-4000-8000-000000000093',
    'expected_mime_type', 'image/heic', 'expected_size_bytes', 20,
    'expected_sha256', repeat('b', 64)
  )
);
select * from public.acknowledge_photo_intake(:'review_intake_id'::uuid)
  \gset review_ack_
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select * from public.claim_photo_validation(
  :'review_intake_id'::uuid,
  'c5000000-0000-4000-8000-000000000093'
) \gset review_validation_
select throws_ok(
  format(
    'select public.complete_photo_validation('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%L,%s,%L,%s,%s,%s,%s)',
    :'review_validation_validation_job_id',
    'c5000000-0000-4000-8000-000000000093',
    'd2000000-0000-4000-8000-000000000093', '',
    'image/heic', 20, repeat('b', 64), 4, 5, 3, 1
  ),
  '42501', 'Photo validation could not be completed',
  'HEIC and HEIF claims remain rejectable but cannot complete in Phase 4B'
);
select is(
  public.flag_photo_validation_for_review(
    :'review_validation_validation_job_id'::uuid,
    'c5000000-0000-4000-8000-000000000093',
    'canonical_collision'
  ),
  :'review_validation_validation_job_id'::uuid,
  'the exact validator lease can terminalize a canonical collision for review'
);
reset role;
select is(
  (select row(intake.state, job.state, job.rejection_reason)::text
     from private.photo_intakes as intake
     join private.photo_validation_jobs as job on job.intake_id = intake.id
    where intake.id = :'review_intake_id'::uuid),
  row('operator_review', 'operator_review', 'canonical_collision')::text,
  'operator review terminalizes both intake and validation job'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'photo_validation_flagged_for_review'
      and subject_id = :'review_validation_validation_job_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'operator-review audit attribution remains with the family recorder'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select is(
  public.flag_photo_validation_for_review(
    :'review_validation_validation_job_id'::uuid,
    'c5000000-0000-4000-8000-000000000093',
    'canonical_collision'
  ),
  :'review_validation_validation_job_id'::uuid,
  'an exact same-validator, same-lease review retry is idempotent'
);
select throws_ok(
  format(
    'select public.flag_photo_validation_for_review(%L::uuid,%L::uuid,%L)',
    :'review_validation_validation_job_id',
    'c5000000-0000-4000-8000-000000000094',
    'canonical_collision'
  ),
  '42501', 'Photo validation could not be flagged',
  'operator-review replay does not become a lease-bypass capability'
);

reset role;
select * from finish();
rollback;
