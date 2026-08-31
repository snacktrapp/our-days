begin;

select no_plan();

select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_derivative_jobs'::regclass),
  'the derivative-job ledger enables and forces RLS'
);
select ok(
  (select relrowsecurity and relforcerowsecurity
     from pg_class where oid = 'private.photo_display_derivatives'::regclass),
  'the display-derivative ledger enables and forces RLS'
);
select is(
  (select count(*)::bigint
     from information_schema.role_table_grants
    where table_schema = 'private'
      and table_name in ('photo_derivative_jobs', 'photo_display_derivatives')
      and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
  0::bigint,
  'browser and service roles have no direct derivative-ledger privileges'
);
select is(
  (select count(*)::bigint
     from information_schema.tables
    where table_schema = 'public'
      and table_name in ('photo_derivative_jobs', 'photo_display_derivatives')),
  0::bigint,
  'no derivative ledger is exposed as a public table'
);
select is(
  (select count(*)::bigint
     from information_schema.columns
    where table_schema = 'public' and table_name = 'moments'
      and column_name in (
        'photo_display_derivative_id', 'photo_original_id', 'media_asset_id'
      )),
  0::bigint,
  'the derivative boundary publishes no moment or family-facing media linkage'
);
select is(
  (select row(public, file_size_limit, allowed_mime_types)::text
     from storage.buckets where id = 'our-days-display'),
  row(false, 12582912::bigint, array['image/webp']::text[])::text,
  'the private display bucket enforces the fixed WebP byte profile'
);
select is(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'photo_display_derivatives_mime_valid'),
  'CHECK ((output_mime_type = ''image/webp''::text))'::text,
  'the published display format is fixed to WebP'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'photo_display_derivatives_size_valid') like '%12582912%',
  'display output is capped at twelve MiB'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'photo_display_derivatives_shape_valid')
      like '%2560%6553600%',
  'profile v1 output geometry is pinned to a 2560-pixel edge'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'photo_derivative_jobs_profile_valid') like '%= 1%',
  'transform profile one is pinned in the job ledger'
);
select is(
  (select count(*)::bigint
     from information_schema.columns
    where table_schema = 'private'
      and table_name = 'photo_derivative_jobs'
      and column_name = 'lease_key'),
  0::bigint,
  'raw derivative lease capabilities are never stored'
);
select is(
  (select data_type::text
     from information_schema.columns
    where table_schema = 'private'
      and table_name = 'photo_derivative_jobs'
      and column_name = 'lease_key_hash'),
  'bytea'::text,
  'only a one-way derivative lease digest is stored'
);
select ok(
  (select pg_get_constraintdef(oid)
     from pg_constraint
    where conname = 'photo_display_derivatives_job_identity_fkey') like
    '%FOREIGN KEY (circle_id, derivative_job_id, original_id, requested_by_membership_id, id, lease_attempt_id, object_path, transform_profile_version, source_storage_object_id, source_storage_object_version)%',
  'display completion is bound to the exact job, attempt, path, profile, and source evidence'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.claim_photo_display_derivative(uuid,uuid)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.complete_photo_display_derivative(uuid,uuid,uuid,text,bigint,text,integer,integer,integer,integer)',
    'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.reject_photo_display_derivative(uuid,uuid,text)', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated',
    'public.flag_photo_display_derivative_for_review(uuid,uuid,text)',
    'EXECUTE'
  ),
  'authenticated validators can reach the four derivative coordinators'
);
select ok(
  not has_function_privilege(
    'anon', 'public.claim_photo_display_derivative(uuid,uuid)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.complete_photo_display_derivative(uuid,uuid,uuid,text,bigint,text,integer,integer,integer,integer)',
    'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.reject_photo_display_derivative(uuid,uuid,text)', 'EXECUTE'
  ) and not has_function_privilege(
    'anon',
    'public.flag_photo_display_derivative_for_review(uuid,uuid,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute derivative coordinators'
);
select ok(
  not has_function_privilege(
    'service_role', 'private.claim_photo_display_derivative(uuid,uuid)',
    'EXECUTE'
  ) and not has_function_privilege(
    'authenticated', 'private.claim_photo_display_derivative(uuid,uuid)',
    'EXECUTE'
  ),
  'service and browser roles cannot bypass the public derivative coordinator'
);

select is(
  (select count(*)::bigint from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'our_days_display_%'
      and cmd in ('UPDATE', 'DELETE')),
  0::bigint,
  'display objects have no overwrite, upsert, or delete policy'
);
select ok(
  (select with_check from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname =
        'our_days_display_insert_exact_active_derivative_lease')
    like '%object.upload%'
  and (select with_check from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname =
        'our_days_display_insert_exact_active_derivative_lease')
    not like '%tus%',
  'display insertion is restricted to the standard no-upsert operation'
);
select ok(
  (select qual from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'our_days_originals_select_exact_derivative_lease')
    like '%object.get_authenticated%object.get_authenticated_info%',
  'derivative generation can read only exact authenticated original operations'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000097',
   'photo-derivative-validator-three@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000098',
   'photo-derivative-validator-two@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000099',
   'photo-derivative-validator@example.test', statement_timestamp(), '{}');
insert into private.photo_validator_allowlist (auth_user_id)
values
  ('10000000-0000-4000-8000-000000000097'),
  ('10000000-0000-4000-8000-000000000098'),
  ('10000000-0000-4000-8000-000000000099');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select throws_ok(
  $$select * from public.claim_photo_display_derivative(null, null)$$,
  '42501', 'Photo derivative could not be claimed',
  'null claim scalars fail with the safe public error contract'
);
select throws_ok(
  $$select public.complete_photo_display_derivative(
    null, null, null, null, null, null, null, null, null, null
  )$$,
  '42501', 'Photo derivative could not be completed',
  'null completion scalars fail with the safe public error contract'
);
select throws_ok(
  $$select public.reject_photo_display_derivative(null, null, null)$$,
  '42501', 'Photo derivative could not be rejected',
  'null rejection scalars fail with the safe public error contract'
);
select throws_ok(
  $$select public.flag_photo_display_derivative_for_review(null, null, null)$$,
  '42501', 'Photo derivative could not be flagged',
  'null review scalars fail with the safe public error contract'
);
reset role;

set constraints all deferred;
insert into private.photo_intakes (
  id, circle_id, journal_person_id, requested_by_membership_id,
  requester_authorization_version, request_key, object_path, state,
  requested_at, expires_at, upload_request_key, expected_mime_type,
  expected_size_bytes, expected_sha256, upload_claimed_at,
  upload_expires_at, uploaded_at, validation_completed_at
) values (
  'a1000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001', statement_timestamp(),
  'a2000000-0000-4000-8000-000000000001',
  'intake/a1000000-0000-4000-8000-000000000001', 'verified',
  statement_timestamp(), statement_timestamp() + interval '30 minutes',
  'a3000000-0000-4000-8000-000000000001', 'image/jpeg', 12,
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
  'a4000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'a5000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  'original/a5000000-0000-4000-8000-000000000001/a6000000-0000-4000-8000-000000000001',
  'verified', '10000000-0000-4000-8000-000000000099',
  extensions.digest('fixture', 'sha256'), statement_timestamp(),
  statement_timestamp() + interval '15 minutes', 1,
  'a7000000-0000-4000-8000-000000000001', '', statement_timestamp()
);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'a8000000-0000-4000-8000-000000000001', 'our-days-originals',
  'original/a5000000-0000-4000-8000-000000000001/a6000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000099',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'validation_job_id', 'a4000000-0000-4000-8000-000000000001',
    'intake_id', 'a1000000-0000-4000-8000-000000000001',
    'original_id', 'a5000000-0000-4000-8000-000000000001',
    'lease_attempt_id', 'a6000000-0000-4000-8000-000000000001',
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
  'a5000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'a4000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'a6000000-0000-4000-8000-000000000001',
  'original/a5000000-0000-4000-8000-000000000001/a6000000-0000-4000-8000-000000000001',
  'a8000000-0000-4000-8000-000000000001', '', 'image/jpeg', 12,
  decode(repeat('a', 64), 'hex'), 4, 3, 3, 1, 1
);
set constraints all immediate;

select is(
  (select count(*)::bigint from private.photo_derivative_jobs
    where original_id = 'a5000000-0000-4000-8000-000000000001'),
  1::bigint,
  'inserting an immutable original automatically enqueues exactly one derivative job'
);
select is(
  (select state from private.photo_derivative_jobs
    where original_id = 'a5000000-0000-4000-8000-000000000001'),
  'queued'::text,
  'the automatically enqueued derivative starts unpublished and queued'
);
set constraints all deferred;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'a5000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001'
  )$$,
  '42501', 'Photo derivative could not be claimed',
  'an ordinary family member cannot pose as a derivative validator'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select * from public.claim_photo_display_derivative(
  'a5000000-0000-4000-8000-000000000001',
  'b1000000-0000-4000-8000-000000000001'
) \gset derivative_

select is(
  :'derivative_source_storage_object_id'::uuid,
  'a8000000-0000-4000-8000-000000000001'::uuid,
  'claiming fences the exact immutable original object'
);
select is(
  :'derivative_transform_profile_version'::integer,
  1,
  'claiming returns the pinned transform profile'
);
select is(
  row(
    :'derivative_source_mime_type',
    :'derivative_source_size_bytes'::bigint,
    :'derivative_source_sha256_hex',
    :'derivative_source_width'::integer,
    :'derivative_source_height'::integer,
    :'derivative_source_channels'::integer,
    :'derivative_source_pages'::integer
  )::text,
  row('image/jpeg'::text, 12::bigint, repeat('a', 64), 4, 3, 3, 1)::text,
  'claiming returns the immutable source fingerprint and decode shape'
);
reset role;
select jsonb_build_object(
  'derivative_job_id', :'derivative_derivative_job_id',
  'original_id', 'a5000000-0000-4000-8000-000000000001',
  'derivative_id', split_part(:'derivative_display_object_path', '/', 2),
  'lease_attempt_id', :'derivative_lease_attempt_id',
  'source_storage_object_id', 'a8000000-0000-4000-8000-000000000001',
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
)::text as derivative_upload_metadata \gset
select is(
  :'derivative_display_object_path',
  format(
    'display/%s/%s.webp',
    (select derivative_id from private.photo_derivative_jobs
      where id = :'derivative_derivative_job_id'::uuid),
    :'derivative_lease_attempt_id'
  ),
  'the display path is scoped to the derivative and fresh lease attempt'
);

select is(
  (select octet_length(lease_key_hash) from private.photo_derivative_jobs
    where id = :'derivative_derivative_job_id'::uuid),
  32,
  'the claimed job stores a SHA-256 lease digest'
);
select is(
  (select count(*)::bigint from private.photo_display_derivatives),
  0::bigint,
  'claiming does not publish a display derivative'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_derivative_source_is_readable(
    :'derivative_source_object_path',
    :'derivative_source_storage_object_id'::uuid,
    :'derivative_source_storage_object_version'
  ),
  true,
  'the active validator can read only the exact immutable source evidence'
);
select is(
  private.photo_derivative_source_is_readable(
    :'derivative_source_object_path' || '/wrong',
    :'derivative_source_storage_object_id'::uuid,
    :'derivative_source_storage_object_version'
  ),
  false,
  'the active source-read predicate rejects a wrong object path'
);
select is(
  private.photo_derivative_source_is_readable(
    :'derivative_source_object_path',
    'b2000000-0000-4000-8000-000000000099'::uuid,
    :'derivative_source_storage_object_version'
  ),
  false,
  'the active source-read predicate rejects a wrong Storage object identity'
);
select is(
  private.photo_derivative_source_is_readable(
    :'derivative_source_object_path',
    :'derivative_source_storage_object_id'::uuid,
    'wrong-version'
  ),
  false,
  'the active source-read predicate rejects a wrong Storage object version'
);
select is(
  private.photo_display_path_is_uploadable(
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000099',
    :'derivative_upload_metadata'::jsonb
  ),
  true,
  'the active validator upload predicate accepts only the exact output contract'
);
select is(
  private.photo_display_path_is_uploadable(
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000098',
    :'derivative_upload_metadata'::jsonb
  ),
  false,
  'the upload predicate rejects a wrong object owner'
);
select is(
  (
    select bool_and(not private.photo_display_path_is_uploadable(
      :'derivative_display_object_path',
      '10000000-0000-4000-8000-000000000099', candidate.metadata
    ))
      from (values
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_size_bytes}', '"8"'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_size_bytes}', '8.5'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_size_bytes}', '1e100'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_width}', '2147483648'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_width}', '0'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_width}', '2561'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_height}', '2561'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_channels}', '[]'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_pages}', '2'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_sha256}', to_jsonb('not-a-sha256'::text))),
        (:'derivative_upload_metadata'::jsonb || '{"extra":true}'::jsonb)
      ) as candidate(metadata)
  ),
  true,
  'malformed, fractional, overflowing, out-of-profile, and extra output metadata fail safely'
);
select is(
  (
    select bool_and(not private.photo_display_path_is_uploadable(
      :'derivative_display_object_path',
      '10000000-0000-4000-8000-000000000099', candidate.metadata
    ))
      from (values
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{derivative_job_id}', to_jsonb('b2000000-0000-4000-8000-000000000099'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{original_id}', to_jsonb('b2000000-0000-4000-8000-000000000099'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{derivative_id}', to_jsonb('b2000000-0000-4000-8000-000000000099'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{lease_attempt_id}', to_jsonb('b2000000-0000-4000-8000-000000000099'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{source_storage_object_id}', to_jsonb('b2000000-0000-4000-8000-000000000099'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{source_storage_object_version}', to_jsonb('wrong-version'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{output_mime_type}', to_jsonb('image/jpeg'::text))),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{maximum_size_bytes}', '12582911'::jsonb)),
        (jsonb_set(:'derivative_upload_metadata'::jsonb,
          '{transform_profile_version}', '2'::jsonb))
      ) as candidate(metadata)
  ),
  true,
  'every immutable job, source, MIME, limit, and profile fingerprint mismatch is denied'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000098', true
);
select is(
  private.photo_derivative_source_is_readable(
    :'derivative_source_object_path',
    :'derivative_source_storage_object_id'::uuid,
    :'derivative_source_storage_object_version'
  ) or private.photo_display_path_is_uploadable(
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000098',
    :'derivative_upload_metadata'::jsonb
  ),
  false,
  'a different validator cannot use another active source or display lease'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);
select is(
  private.photo_derivative_source_is_readable(
    :'derivative_source_object_path',
    :'derivative_source_storage_object_id'::uuid,
    :'derivative_source_storage_object_version'
  ) or private.photo_display_path_is_uploadable(
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000001',
    :'derivative_upload_metadata'::jsonb
  ),
  false,
  'a family identity cannot use validator source or display policies'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select throws_ok(
  $$insert into storage.objects (
      id, bucket_id, name, owner_id, metadata, user_metadata
    ) values (
      'b2000000-0000-4000-8000-000000000000', 'our-days-display',
      'display/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.webp',
      '10000000-0000-4000-8000-000000000099',
      '{"mimetype":"image/webp","size":8}', '{}'
    )$$,
  '42501', 'new row violates row-level security policy for table "objects"',
  'the validator cannot upload an unleased display path'
);
select throws_ok(
  format(
    'insert into storage.objects ('
      || 'id,bucket_id,name,owner_id,metadata,user_metadata) values ('
      || '%L::uuid,%L,%L,%L,%L::jsonb,%L::jsonb)',
    'b2000000-0000-4000-8000-000000000002', 'our-days-display',
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000099',
    '{"mimetype":"image/webp","size":8}', '{}'
  ),
  '42501', 'new row violates row-level security policy for table "objects"',
  'the exact leased path still rejects missing output evidence metadata'
);
select throws_ok(
  format(
    'insert into storage.objects ('
      || 'id,bucket_id,name,owner_id,metadata,user_metadata) values ('
      || '%L::uuid,%L,%L,%L,%L::jsonb,%L::jsonb)',
    'b2000000-0000-4000-8000-000000000003', 'our-days-display',
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000099',
    '{"mimetype":"image/webp","size":8}',
    jsonb_set(:'derivative_upload_metadata'::jsonb,
      '{output_size_bytes}', '8.5'::jsonb)::text
  ),
  '42501', 'new row violates row-level security policy for table "objects"',
  'the Storage policy safely denies fractional output metadata'
);
select throws_ok(
  format(
    'insert into storage.objects ('
      || 'id,bucket_id,name,owner_id,metadata,user_metadata) values ('
      || '%L::uuid,%L,%L,%L,%L::jsonb,%L::jsonb)',
    'b2000000-0000-4000-8000-000000000004', 'our-days-display',
    :'derivative_display_object_path',
    '10000000-0000-4000-8000-000000000098',
    '{"mimetype":"image/webp","size":8}',
    :'derivative_upload_metadata'
  ),
  '42501', 'new row violates row-level security policy for table "objects"',
  'the Storage policy denies a wrong display-object owner'
);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'b2000000-0000-4000-8000-000000000001', 'our-days-display',
  :'derivative_display_object_path',
  '10000000-0000-4000-8000-000000000099',
  '{"mimetype":"image/webp","size":8}'::jsonb,
  jsonb_build_object(
    'derivative_job_id', :'derivative_derivative_job_id',
    'original_id', 'a5000000-0000-4000-8000-000000000001',
    'derivative_id', split_part(:'derivative_display_object_path', '/', 2),
    'lease_attempt_id', :'derivative_lease_attempt_id',
    'source_storage_object_id', 'a8000000-0000-4000-8000-000000000001',
    'source_storage_object_version', '', 'output_mime_type', 'image/webp',
    'output_size_bytes', 8, 'output_sha256', repeat('b', 64),
    'output_width', 2, 'output_height', 2,
    'output_channels', 3, 'output_pages', 1,
    'maximum_size_bytes', 12582912, 'transform_profile_version', 1
  )
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', '', 8,
    repeat('b', 64), 2561, 2, 3, 1
  ),
  '42501', 'Photo derivative could not be completed',
  'completion rejects geometry outside the fixed v1 profile'
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000009', '', 8,
    repeat('b', 64), 2, 2, 3, 1
  ),
  '22023', 'Photo derivative display evidence did not match',
  'completion rejects the wrong canonical display object identity'
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', 'wrong-version', 8,
    repeat('b', 64), 2, 2, 3, 1
  ),
  '22023', 'Photo derivative display evidence did not match',
  'completion rejects the wrong canonical display object version'
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', '', 9,
    repeat('b', 64), 2, 2, 3, 1
  ),
  '22023', 'Photo derivative display evidence did not match',
  'completion rejects a size that differs from canonical Storage evidence'
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', '', 8,
    repeat('c', 64), 2, 2, 3, 1
  ),
  '22023', 'Photo derivative display evidence did not match',
  'completion rejects a checksum not bound into canonical Storage metadata'
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', '', 8,
    repeat('b', 64), 3, 2, 3, 1
  ),
  '22023', 'Photo derivative display evidence did not match',
  'completion rejects geometry not bound into canonical Storage metadata'
);
reset role;
select is(
  (select row(
    job.state,
    (select count(*) from private.photo_display_derivatives),
    (select count(*) from private.audit_events
      where event_type = 'photo_display_derivative_generated')
  )::text from private.photo_derivative_jobs as job
    where job.id = :'derivative_derivative_job_id'::uuid),
  row('leased'::text, 0::bigint, 0::bigint)::text,
  'mismatched canonical evidence leaves no derivative or generation audit'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select public.complete_photo_display_derivative(
  :'derivative_derivative_job_id'::uuid,
  'b1000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000001', '', 8, repeat('b', 64),
  2, 2, 3, 1
) as derivative_id \gset completed_
reset role;
set constraints all immediate;
set constraints all deferred;

select is(
  (select state from private.photo_derivative_jobs
    where id = :'derivative_derivative_job_id'::uuid),
  'verified'::text,
  'exact evidence completion terminally verifies the derivative job'
);
select is(
  (select row(
    original_id, lease_attempt_id, object_path, storage_object_id,
    output_mime_type, output_size_bytes, output_width, output_height,
    output_channels, output_pages,
    transform_profile_version, source_storage_object_id,
    source_storage_object_version
  )::text from private.photo_display_derivatives
    where id = :'completed_derivative_id'::uuid),
  row(
    'a5000000-0000-4000-8000-000000000001'::uuid,
    :'derivative_lease_attempt_id'::uuid,
    :'derivative_display_object_path'::text,
    'b2000000-0000-4000-8000-000000000001'::uuid,
    'image/webp'::text, 8::bigint, 2, 2, 3, 1, 1,
    'a8000000-0000-4000-8000-000000000001'::uuid, ''::text
  )::text,
  'the immutable ledger preserves exact source, attempt, display, and transform evidence'
);
select is(
  (select count(*)::bigint from public.moments
    where id = :'completed_derivative_id'::uuid),
  0::bigint,
  'display generation creates no photo moment'
);
select is(
  (select actor_membership_id from private.audit_events
    where event_type = 'photo_display_derivative_generated'
      and subject_id = :'completed_derivative_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the audit attributes generation to the family recorder, not validator identity'
);
select throws_ok(
  format(
    'update private.photo_display_derivatives set output_width = 3 where id = %L::uuid',
    :'completed_derivative_id'
  ),
  '42501', 'Photo display derivatives are immutable',
  'display ledger rows cannot be updated'
);
select throws_ok(
  format(
    'delete from private.photo_display_derivatives where id = %L::uuid',
    :'completed_derivative_id'
  ),
  '42501', 'Photo display derivatives are immutable',
  'display ledger rows cannot be deleted'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select is(
  public.complete_photo_display_derivative(
    :'derivative_derivative_job_id'::uuid,
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', '', 8, repeat('b', 64),
    2, 2, 3, 1
  ),
  :'completed_derivative_id'::uuid,
  'exact same-validator, same-lease completion retry is idempotent'
);
reset role;

update private.photo_validator_allowlist
   set revoked_at = statement_timestamp()
 where auth_user_id = '10000000-0000-4000-8000-000000000099';
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000099', true
);
select throws_ok(
  format(
    'select public.complete_photo_display_derivative('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%s,%L,%s,%s,%s,%s)',
    :'derivative_derivative_job_id',
    'b1000000-0000-4000-8000-000000000001',
    'b2000000-0000-4000-8000-000000000001', '', 8,
    repeat('b', 64), 2, 2, 3, 1
  ),
  '42501', 'Photo derivative could not be completed',
  'validator revocation blocks even an otherwise-idempotent completion retry'
);
reset role;

select ok(
  (select pg_get_functiondef(
    'private.claim_photo_display_derivative(uuid,uuid)'::regprocedure
  )) like '%photo_intake_requester_is_authorized%',
  'claim rechecks the original requester authority'
);
select ok(
  (select pg_get_functiondef(
    'private.complete_photo_display_derivative(uuid,uuid,uuid,text,bigint,text,integer,integer,integer,integer)'::regprocedure
  )) like '%photo_intake_requester_is_authorized%',
  'completion rechecks the original requester authority'
);
select is(
  (select count(*)::bigint from pg_trigger
    where not tgisinternal
      and tgname like 'photo_derivatives_invalidate_after_%'),
  3::bigint,
  'membership, guardian, and closure changes invalidate unpublished derivative work'
);

set constraints all deferred;
insert into private.photo_intakes (
  id, circle_id, journal_person_id, requested_by_membership_id,
  requester_authorization_version, request_key, object_path, state,
  requested_at, expires_at, upload_request_key, expected_mime_type,
  expected_size_bytes, expected_sha256, upload_claimed_at,
  upload_expires_at, uploaded_at, validation_completed_at
) select
  'c1000000-0000-4000-8000-000000000002', circle_id,
  journal_person_id, requested_by_membership_id,
  requester_authorization_version,
  'c2000000-0000-4000-8000-000000000002',
  'intake/c1000000-0000-4000-8000-000000000002', state,
  requested_at, expires_at,
  'c3000000-0000-4000-8000-000000000002', expected_mime_type,
  expected_size_bytes, expected_sha256, upload_claimed_at,
  upload_expires_at, uploaded_at, validation_completed_at
from private.photo_intakes
where id = 'a1000000-0000-4000-8000-000000000001';
insert into private.photo_validation_jobs (
  id, circle_id, intake_id, journal_person_id,
  requested_by_membership_id, original_id, lease_attempt_id,
  canonical_object_path, state, validator_auth_user_id, lease_key_hash,
  lease_started_at, lease_expires_at, attempt_count,
  source_storage_object_id, source_storage_object_version, completed_at
) select
  'c4000000-0000-4000-8000-000000000002', circle_id,
  'c1000000-0000-4000-8000-000000000002', journal_person_id,
  requested_by_membership_id,
  'c5000000-0000-4000-8000-000000000002',
  'c6000000-0000-4000-8000-000000000002',
  'original/c5000000-0000-4000-8000-000000000002/c6000000-0000-4000-8000-000000000002',
  state, validator_auth_user_id, lease_key_hash, lease_started_at,
  lease_expires_at, attempt_count,
  'c7000000-0000-4000-8000-000000000002', '', completed_at
from private.photo_validation_jobs
where id = 'a4000000-0000-4000-8000-000000000001';
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'c8000000-0000-4000-8000-000000000002', 'our-days-originals',
  'original/c5000000-0000-4000-8000-000000000002/c6000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000099',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'validation_job_id', 'c4000000-0000-4000-8000-000000000002',
    'intake_id', 'c1000000-0000-4000-8000-000000000002',
    'original_id', 'c5000000-0000-4000-8000-000000000002',
    'lease_attempt_id', 'c6000000-0000-4000-8000-000000000002',
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
) select
  'c5000000-0000-4000-8000-000000000002', circle_id,
  'c4000000-0000-4000-8000-000000000002',
  'c1000000-0000-4000-8000-000000000002', journal_person_id,
  recorded_by_membership_id,
  'c6000000-0000-4000-8000-000000000002',
  'original/c5000000-0000-4000-8000-000000000002/c6000000-0000-4000-8000-000000000002',
  'c8000000-0000-4000-8000-000000000002', '', verified_mime_type,
  verified_size_bytes, verified_sha256, verified_width, verified_height,
  verified_channels, verified_pages, verification_profile_version
from private.photo_originals
where id = 'a5000000-0000-4000-8000-000000000001';
set constraints all immediate;

select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000098', true
);
update storage.objects
   set id = 'c8000000-0000-4000-8000-000000000099'
 where id = 'c8000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'c5000000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000099'
  )$$,
  '22023', 'Photo derivative source evidence did not match',
  'claim rejects a changed immutable source Storage identity'
);
update storage.objects
   set id = 'c8000000-0000-4000-8000-000000000002'
 where id = 'c8000000-0000-4000-8000-000000000099';
update storage.objects
   set version = 'wrong-version'
 where id = 'c8000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'c5000000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000099'
  )$$,
  '22023', 'Photo derivative source evidence did not match',
  'claim rejects a changed immutable source Storage version'
);
update storage.objects set version = null
 where id = 'c8000000-0000-4000-8000-000000000002';
update storage.objects
   set metadata = jsonb_set(metadata, '{mimetype}', '"image/png"'::jsonb)
 where id = 'c8000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'c5000000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000099'
  )$$,
  '22023', 'Photo derivative source evidence did not match',
  'claim rejects a changed immutable source MIME type'
);
update storage.objects
   set metadata = '{"mimetype":"image/jpeg","size":13}'::jsonb
 where id = 'c8000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'c5000000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000099'
  )$$,
  '22023', 'Photo derivative source evidence did not match',
  'claim rejects a changed immutable source byte count'
);
update storage.objects
   set metadata = '{"mimetype":"image/jpeg","size":12}'::jsonb,
       user_metadata = user_metadata || '{"extra":true}'::jsonb
 where id = 'c8000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'c5000000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000099'
  )$$,
  '22023', 'Photo derivative source evidence did not match',
  'claim rejects changed immutable source user metadata'
);
update storage.objects
   set user_metadata = user_metadata - 'extra',
       name = name || '/missing'
 where id = 'c8000000-0000-4000-8000-000000000002';
select throws_ok(
  $$select * from public.claim_photo_display_derivative(
    'c5000000-0000-4000-8000-000000000002',
    'c9000000-0000-4000-8000-000000000099'
  )$$,
  '22023', 'Photo derivative source evidence did not match',
  'claim rejects a missing exact immutable source path'
);
update storage.objects
   set name = 'original/c5000000-0000-4000-8000-000000000002/c6000000-0000-4000-8000-000000000002'
 where id = 'c8000000-0000-4000-8000-000000000002';
select is(
  (select state from private.photo_derivative_jobs
    where original_id = 'c5000000-0000-4000-8000-000000000002'),
  'queued'::text,
  'every mismatched source claim leaves the derivative job unpublished and queued'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000098', true
);
select * from public.claim_photo_display_derivative(
  'c5000000-0000-4000-8000-000000000002',
  'c9000000-0000-4000-8000-000000000002'
) \gset first_attempt_
reset role;
update private.photo_derivative_jobs
   set lease_started_at = statement_timestamp() - interval '16 minutes',
       lease_expires_at = statement_timestamp() - interval '1 minute'
 where id = :'first_attempt_derivative_job_id'::uuid;

set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000098', true
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  private.photo_derivative_source_is_readable(
    :'first_attempt_source_object_path',
    :'first_attempt_source_storage_object_id'::uuid,
    :'first_attempt_source_storage_object_version'
  ),
  false,
  'the stale validator loses exact original read access after takeover'
);
select is(
  private.photo_display_path_is_readable(
    :'first_attempt_display_object_path'
  ),
  false,
  'the stale validator loses its prior display read-back capability'
);
select set_config('storage.operation', 'object.upload', true);
select is(
  private.photo_display_path_is_uploadable(
    :'first_attempt_display_object_path',
    '10000000-0000-4000-8000-000000000098',
    jsonb_build_object(
      'derivative_job_id', :'first_attempt_derivative_job_id',
      'original_id', 'c5000000-0000-4000-8000-000000000002',
      'derivative_id', split_part(:'first_attempt_display_object_path', '/', 2),
      'lease_attempt_id', :'first_attempt_lease_attempt_id',
      'source_storage_object_id', :'first_attempt_source_storage_object_id',
      'source_storage_object_version',
        :'first_attempt_source_storage_object_version',
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
  ),
  false,
  'the stale validator cannot upload to its superseded display path'
);
select throws_ok(
  format(
    'select * from public.claim_photo_display_derivative(%L::uuid,%L::uuid)',
    'c5000000-0000-4000-8000-000000000002',
    'ca000000-0000-4000-8000-000000000002'
  ),
  '42501', 'Photo derivative could not be claimed',
  'an expired lease cannot be reclaimed by the same validator identity'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000097', true
);
select * from public.claim_photo_display_derivative(
  'c5000000-0000-4000-8000-000000000002',
  'cb000000-0000-4000-8000-000000000002'
) \gset second_attempt_
select isnt(
  :'second_attempt_lease_attempt_id'::uuid,
  :'first_attempt_lease_attempt_id'::uuid,
  'a different validator takeover receives a fresh lease attempt identity'
);
select isnt(
  :'second_attempt_display_object_path'::text,
  :'first_attempt_display_object_path'::text,
  'a takeover receives a fresh canonical display path'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000098', true
);
select throws_ok(
  format(
    'select public.reject_photo_display_derivative(%L::uuid,%L::uuid,%L)',
    :'first_attempt_derivative_job_id',
    'c9000000-0000-4000-8000-000000000002', 'transform_failed'
  ),
  '42501', 'Photo derivative could not be rejected',
  'a stale validator cannot terminate work after a takeover'
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000097', true
);
select is(
  public.flag_photo_display_derivative_for_review(
    :'second_attempt_derivative_job_id'::uuid,
    'cb000000-0000-4000-8000-000000000002', 'display_collision'
  ),
  :'second_attempt_derivative_job_id'::uuid,
  'the current validator can preserve collision evidence for operator review'
);
reset role;
select is(
  (select row(state, rejection_reason)::text
     from private.photo_derivative_jobs
    where id = :'second_attempt_derivative_job_id'::uuid),
  row('operator_review'::text, 'display_collision'::text)::text,
  'a display collision is terminally preserved as operator review'
);
select is(
  (select count(*)::bigint from private.photo_display_derivatives
    where derivative_job_id = :'second_attempt_derivative_job_id'::uuid),
  0::bigint,
  'operator review never publishes a display derivative'
);
set local role authenticated;
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000097', true
);
select is(
  public.flag_photo_display_derivative_for_review(
    :'second_attempt_derivative_job_id'::uuid,
    'cb000000-0000-4000-8000-000000000002', 'display_collision'
  ),
  :'second_attempt_derivative_job_id'::uuid,
  'an exact operator-review retry is idempotent'
);
select set_config('storage.operation', 'object.get_authenticated', true);
select is(
  private.photo_derivative_source_is_readable(
    :'second_attempt_source_object_path',
    :'second_attempt_source_storage_object_id'::uuid,
    :'second_attempt_source_storage_object_version'
  ) or private.photo_display_path_is_readable(
    :'second_attempt_display_object_path'
  ),
  false,
  'operator review closes both source and display read-back capabilities'
);
reset role;
select is(
  (select count(*)::bigint from private.audit_events
    where event_type = 'photo_display_derivative_flagged_for_review'
      and subject_id = :'second_attempt_derivative_job_id'::uuid),
  1::bigint,
  'operator-review retries preserve exactly one audit event'
);

select * from finish();
rollback;
