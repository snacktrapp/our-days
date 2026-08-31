begin;

select plan(115);

select is(
  (
    select namespace.nspname
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where class.relname = 'photo_intakes'
  ),
  'private',
  'photo intake history stays outside the exposed schema'
);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
     where class.oid = 'private.photo_intakes'::regclass
  ),
  'the private intake ledger enables and forces RLS'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'private'
       and table_name = 'photo_intakes'
       and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  ),
  0::bigint,
  'browser and service roles have no direct intake-ledger privileges'
);

select ok(
  (
    select not bucket.public
      from storage.buckets as bucket
     where bucket.id = 'our-days-intake'
       and bucket.name = 'our-days-intake'
  ),
  'the intake bucket is private'
);

select ok(
  (
    select bucket.file_size_limit = 52428800
      and bucket.allowed_mime_types @> array[
        'image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp'
      ]::text[]
      from storage.buckets as bucket
     where bucket.id = 'our-days-intake'
  ),
  'the intake bucket has a bounded photo-oriented declaration surface'
);

select ok(
  (
    select not bucket.public and bucket.file_size_limit = 52428800
      from storage.buckets as bucket
     where bucket.id = 'our-days-originals'
  ),
  'the original-media bucket remains private and unchanged'
);

select ok(
  (
    select not bucket.public and bucket.file_size_limit = 52428800
      from storage.buckets as bucket
     where bucket.id = 'our-days-display'
  ),
  'the display-media bucket remains private and unchanged'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%state = ''reserved''%state = ''upload_claimed''%state = ''uploaded_unverified''%state = ''invalidated''%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'photo_intakes_state_valid'
  ),
  'the quarantine ledger exposes only reserved, claimed, unverified-uploaded, and invalidated states'
);

select ok(
  (
    select pg_catalog.pg_get_constraintdef(constraint_row.oid)
      like '%object_path = (''intake/''::text || (id)::text)%'
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname = 'photo_intakes_path_valid'
  ),
  'the database enforces the opaque server path format'
);

select is(
  (
    select count(*)::bigint
      from information_schema.tables
     where table_schema = 'public'
       and table_name in ('photo_intakes', 'photos', 'media_assets')
  ),
  0::bigint,
  'this phase exposes no public media table'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'moments'
       and column_name in (
         'photo_intake_id', 'media_asset_id', 'original_object_path'
       )
  ),
  0::bigint,
  'moments gain no intake or media publication reference'
);

select is(
  (
    select count(*)::bigint
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'photo_intakes'
       and column_name in (
         'filename', 'original_filename', 'exif',
         'gps', 'accepted_at', 'verified_at', 'published_at', 'purge_at'
       )
  ),
  0::bigint,
  'the ledger makes no filename, EXIF, acceptance, verification, publication, or purge claim'
);

select is(
  (
    select array_agg(column_name::text order by ordinal_position)
      from information_schema.columns
     where table_schema = 'private'
       and table_name = 'photo_intakes'
       and column_name in (
         'upload_request_key', 'expected_mime_type', 'expected_size_bytes',
         'expected_sha256', 'upload_claimed_at', 'upload_expires_at'
       )
  ),
  array[
    'upload_request_key', 'expected_mime_type', 'expected_size_bytes',
    'expected_sha256', 'upload_claimed_at', 'upload_expires_at'
  ]::text[],
  'the claim ledger binds exactly one upload key, fingerprint, and bounded window'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.claim_photo_intake_upload(uuid,uuid,text,bigint,text)',
    'EXECUTE'
  ),
  'authenticated callers can reach the fingerprint-bound claim seam'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.claim_photo_intake_upload(uuid,uuid,text,bigint,text)',
    'EXECUTE'
  ),
  'anonymous callers cannot claim upload capability'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.reserve_photo_intake(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated callers can reach the public reserve seam'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.claim_photo_intake_upload(uuid,uuid,text,bigint,text)',
    'EXECUTE'
  ),
  'the private claim implementation is not browser executable'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.reserve_photo_intake(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot reserve intake paths'
);

select ok(
  has_function_privilege(
    'authenticated',
    'public.acknowledge_photo_intake(uuid)',
    'EXECUTE'
  ),
  'authenticated callers can reach the public acknowledge seam'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.acknowledge_photo_intake(uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot acknowledge intake objects'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.reserve_photo_intake(uuid,uuid,uuid)',
    'EXECUTE'
  ),
  'the private reserve implementation is not browser executable'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.acknowledge_photo_intake(uuid)',
    'EXECUTE'
  ),
  'the private acknowledge implementation is not browser executable'
);

select ok(
  has_function_privilege(
    'authenticated',
    'private.photo_intake_path_is_uploadable(text,text,jsonb)',
    'EXECUTE'
  ),
  'authenticated Storage inserts can call only the boolean path guard'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.photo_intake_path_is_uploadable(text,text,jsonb)',
    'EXECUTE'
  ),
  'anonymous callers cannot probe the intake path guard'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.claim_photo_intake_upload(uuid,uuid,text,bigint,text)'::regprocedure
  ),
  'the public claim function is definer and fixed-path'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.reserve_photo_intake(uuid,uuid,uuid)'::regprocedure
  ),
  'the public reserve function is definer and fixed-path'
);

select ok(
  (
    select procedure.prosecdef
      and 'search_path=""' = any(procedure.proconfig)
      from pg_catalog.pg_proc as procedure
     where procedure.oid =
       'public.acknowledge_photo_intake(uuid)'::regprocedure
  ),
  'the public acknowledge function is definer and fixed-path'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'private.photo_intakes'::regclass
       and trigger_row.tgname = 'photo_intakes_integrity'
       and not trigger_row.tgisinternal
  ),
  'the intake ledger has an immutable-history trigger'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'public.circle_memberships'::regclass
       and trigger_row.tgname =
         'photo_intakes_invalidate_after_membership_change'
       and not trigger_row.tgisinternal
  ),
  'membership authority changes terminalize affected intakes'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_trigger as trigger_row
     where trigger_row.tgrelid = 'public.person_guardians'::regclass
       and trigger_row.tgname =
         'photo_intakes_invalidate_after_guardian_revocation'
       and not trigger_row.tgisinternal
  ),
  'guardian revocation terminalizes affected managed-journal intakes'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_policies as policy
     where policy.schemaname = 'storage'
       and policy.tablename = 'objects'
       and policy.policyname =
         'our_days_intake_insert_exact_live_tus_claim'
       and policy.cmd = 'INSERT'
       and policy.roles = array['authenticated']::name[]
  ),
  'Storage grants the intake bucket one authenticated TUS INSERT policy'
);

select ok(
  (
    select pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
      like '%storage.tus.upload.create%storage.tus.upload.part%'
      and pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid)
        not like '%storage.object.upload%'
      from pg_catalog.pg_policy as policy_row
     where policy_row.polname = 'our_days_intake_insert_exact_live_tus_claim'
       and policy_row.polrelid = 'storage.objects'::regclass
  ),
  'the Storage policy admits only TUS create and part operation names'
);

select is(
  (
    select count(*)::bigint
      from pg_catalog.pg_policies as policy
     where policy.schemaname = 'storage'
       and policy.tablename = 'objects'
       and policy.policyname like 'our_days_intake_%'
       and policy.cmd = 'SELECT'
  ),
  0::bigint,
  'the intake bucket has no SELECT policy for reads, listing, or signed URLs'
);

select is(
  (
    select count(*)::bigint
      from pg_catalog.pg_policies as policy
     where policy.schemaname = 'storage'
       and policy.tablename = 'objects'
       and policy.policyname like 'our_days_intake_%'
       and policy.cmd = 'UPDATE'
  ),
  0::bigint,
  'the intake bucket has no UPDATE policy for overwrite or upsert'
);

select is(
  (
    select count(*)::bigint
      from pg_catalog.pg_policies as policy
     where policy.schemaname = 'storage'
       and policy.tablename = 'objects'
       and policy.policyname like 'our_days_intake_%'
       and policy.cmd = 'DELETE'
  ),
  0::bigint,
  'the intake bucket has no browser DELETE policy'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001'
  ) \gset own_

select is(
  :'own_state'::text,
  'reserved'::text,
  'a valid self-journal intake is reserved'
);
select is(
  :'own_bucket_id'::text,
  'our-days-intake'::text,
  'reservation returns only the quarantine bucket'
);
select ok(
  :'own_object_path' ~
    '^intake/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'the returned path is opaque, generated, and contains no family filename'
);

reset role;
select is(
  (select circle_id from private.photo_intakes
    where id = :'own_intake_id'::uuid),
  '20000000-0000-4000-8000-000000000001'::uuid,
  'the ledger binds the reservation to the exact family'
);
select is(
  (select journal_person_id from private.photo_intakes
    where id = :'own_intake_id'::uuid),
  '30000000-0000-4000-8000-000000000001'::uuid,
  'the ledger binds the reservation to the exact journal'
);
select is(
  (select requested_by_membership_id from private.photo_intakes
    where id = :'own_intake_id'::uuid),
  '40000000-0000-4000-8000-000000000001'::uuid,
  'the database derives requester membership attribution'
);
select is(
  (select requester_authorization_version from private.photo_intakes
    where id = :'own_intake_id'::uuid),
  (select updated_at from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000001'),
  'the reservation captures the exact authorization version'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001'
  ) \gset own_retry_

select is(
  :'own_retry_intake_id'::uuid,
  :'own_intake_id'::uuid,
  'a lost-response retry returns the original intake ID'
);
select is(
  :'own_retry_object_path'::text,
  :'own_object_path'::text,
  'an idempotent retry returns the exact original path'
);

select *
  from public.claim_photo_intake_upload(
    :'own_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000001',
    'image/heic',
    2048,
    repeat('a', 64)
  ) \gset own_claim_

select is(
  :'own_claim_state'::text,
  'upload_claimed'::text,
  'an exact fingerprint advances the reservation to upload_claimed'
);
select is(
  :'own_claim_object_path'::text,
  :'own_object_path'::text,
  'claiming preserves the exact opaque reservation path'
);
reset role;
select is(
  :'own_claim_upload_expires_at'::timestamptz,
  (select upload_claimed_at + interval '2 hours'
     from private.photo_intakes where id = :'own_intake_id'::uuid),
  'the database fixes the bounded TUS upload window at two hours'
);
select is(
  (select encode(expected_sha256, 'hex') from private.photo_intakes
    where id = :'own_intake_id'::uuid),
  repeat('a', 64),
  'the claim stores the exact lowercase SHA-256 declaration'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.claim_photo_intake_upload(
    :'own_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000001',
    'image/heic',
    2048,
    repeat('a', 64)
  ) \gset own_claim_retry_
select is(
  :'own_claim_retry_upload_expires_at'::timestamptz,
  :'own_claim_upload_expires_at'::timestamptz,
  'an exact claim replay neither remints nor extends upload authority'
);

select throws_ok(
  format(
    'select * from public.claim_photo_intake_upload(%L::uuid, %L::uuid, %L, %s, %L)',
    :'own_intake_id',
    'c4000000-0000-4000-8000-000000000001',
    'image/jpeg',
    2048,
    repeat('a', 64)
  ),
  '22023',
  'Photo intake upload claim was reused',
  'the same upload key cannot be rebound to another fingerprint'
);

select throws_ok(
  format(
    'select * from public.claim_photo_intake_upload(%L::uuid, %L::uuid, %L, %s, %L)',
    :'own_intake_id',
    'c4000000-0000-4000-8000-000000000099',
    'Image/HEIC',
    2048,
    repeat('a', 64)
  ),
  '22023',
  'Photo intake upload could not be claimed',
  'claim MIME input must already be canonical lowercase allowlisted text'
);

select throws_ok(
  format(
    'select * from public.claim_photo_intake_upload(%L::uuid, %L::uuid, %L, %s, %L)',
    :'own_intake_id',
    'c4000000-0000-4000-8000-000000000099',
    'image/heic',
    2048,
    repeat('a', 64)
  ),
  '22023',
  'Photo intake upload claim was reused',
  'a claimed intake cannot be rebound to a different upload-attempt key'
);

select throws_ok(
  format(
    'select * from public.claim_photo_intake_upload(%L::uuid, %L::uuid, %L, %s, %L)',
    :'own_intake_id',
    'c4000000-0000-4000-8000-000000000001',
    'image/heic',
    0,
    repeat('a', 64)
  ),
  '22023',
  'Photo intake upload could not be claimed',
  'a claim declaration cannot bind an empty upload'
);

select throws_ok(
  format(
    'select * from public.claim_photo_intake_upload(%L::uuid, %L::uuid, %L, %s, %L)',
    :'own_intake_id',
    'c4000000-0000-4000-8000-000000000001',
    'image/heic',
    2048,
    repeat('A', 64)
  ),
  '22023',
  'Photo intake upload could not be claimed',
  'a SHA-256 declaration must be exactly 64 lowercase hexadecimal characters'
);

reset role;
insert into private.photo_intakes (
  id,
  circle_id,
  journal_person_id,
  requested_by_membership_id,
  requester_authorization_version,
  request_key,
  object_path,
  requested_at,
  expires_at
)
select
  'c3000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  membership.id,
  membership.updated_at,
  'c1000000-0000-4000-8000-000000000013',
  'intake/c3000000-0000-4000-8000-000000000001',
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '1 hour'
from public.circle_memberships as membership
where membership.id = '40000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000013'
  ) \gset expired_retry_
select is(
  :'expired_retry_intake_id'::uuid,
  'c3000000-0000-4000-8000-000000000001'::uuid,
  'same-key replay after expiry returns only the original intake ID'
);
select is(
  :'expired_retry_state'::text,
  'reserved'::text,
  'same-key replay does not create a fresh state after expiry'
);
select is(
  :'expired_retry_object_path'::text,
  'intake/c3000000-0000-4000-8000-000000000001'::text,
  'same-key replay does not mint a fresh path after expiry'
);
select ok(
  not private.photo_intake_path_is_uploadable(
    :'expired_retry_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  'the replayed expired path grants no upload capability'
);

select throws_ok(
  $$select * from public.claim_photo_intake_upload(
    'c3000000-0000-4000-8000-000000000001',
    'c4000000-0000-4000-8000-000000000013',
    'image/jpeg',
    12,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  )$$,
  '22023',
  'Photo intake upload could not be claimed',
  'an expired reservation cannot mint a TUS claim'
);

select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'c1000000-0000-4000-8000-000000000001'
  )$$,
  '22023',
  'Photo intake idempotency key was reused',
  'an idempotency key cannot silently change journals'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000006',
  true
);
select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000006',
    'c1000000-0000-4000-8000-000000000002'
  )$$,
  '22023',
  'Photo intake could not be reserved',
  'an organizer cannot borrow authority across family circles'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000003'
  )$$,
  '22023',
  'Photo intake could not be reserved',
  'an ordinary member cannot reserve another account journal'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000004',
  true
);
select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000004',
    'c1000000-0000-4000-8000-000000000004'
  )$$,
  '22023',
  'Photo intake could not be reserved',
  'a revoked member cannot reserve a path'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'c1000000-0000-4000-8000-000000000005'
  ) \gset child_
select isnt(
  :'child_intake_id'::uuid,
  null::uuid,
  'an organizer can reserve a managed-child journal intake'
);

select set_config('storage.operation', 'storage.object.sign_upload_url', true);
select throws_ok(
  format(
    'insert into storage.objects (id, bucket_id, name, owner_id, metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000000',
    'our-days-intake',
    :'child_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":12}'
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'a live reservation cannot mint a signed-upload bearer capability'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000001',
  false
);

reset role;
select is(
  (select state from private.photo_intakes
    where id = :'child_intake_id'::uuid),
  'reserved',
  'an organizer retains implicit managed-journal intake authority after explicit guardian removal'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.claim_photo_intake_upload(
    :'child_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000005',
    'image/jpeg',
    12,
    repeat('b', 64)
  ) \gset child_claim_
select is(
  :'child_claim_state'::text,
  'upload_claimed'::text,
  'organizer implicit care survives through the fingerprint claim seam'
);
select ok(
  private.photo_intake_path_is_uploadable(
    :'child_object_path',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'intake_id', :'child_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000005',
      'expected_mime_type', 'image/jpeg',
      'expected_size_bytes', 12,
      'expected_sha256', repeat('b', 64)
    )
  ),
  'organizer implicit care keeps the exact child-journal reservation uploadable'
);
select set_config('storage.operation', 'storage.object.sign_upload_url', true);
select throws_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000012',
    'our-days-intake',
    :'child_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":12}',
    jsonb_build_object(
      'intake_id', :'child_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000005',
      'expected_mime_type', 'image/jpeg',
      'expected_size_bytes', 12,
      'expected_sha256', repeat('b', 64)
    )::text
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'signed-upload capability is denied even for an exact live claim'
);
select set_config('storage.operation', 'storage.tus.upload.create', true);
select throws_ok(
  $$insert into storage.objects (
      id, bucket_id, name, owner_id, metadata, user_metadata
    ) values (
      'd1000000-0000-4000-8000-000000000001',
      'our-days-intake',
      'intake/d1000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '{"mimetype":"image/jpeg","size":12}'::jsonb,
      '{}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'TUS create rejects an unreserved path'
);

select throws_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000003',
    'our-days-intake',
    :'own_object_path',
    '10000000-0000-4000-8000-000000000002',
    '{"mimetype":"image/heic","size":2048}',
    jsonb_build_object(
      'intake_id', :'own_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000001',
      'expected_mime_type', 'image/heic',
      'expected_size_bytes', 2048,
      'expected_sha256', repeat('a', 64)
    )::text
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'TUS create cannot assign another Auth owner'
);

select throws_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000006',
    'our-days-intake',
    :'own_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/heic","size":2048}',
    jsonb_build_object(
      'intake_id', :'own_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000001',
      'expected_mime_type', 'image/heic',
      'expected_size_bytes', 2048,
      'expected_sha256', repeat('f', 64)
    )::text
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'TUS create rejects a metadata fingerprint that differs by one bound field'
);

select set_config('storage.operation', 'storage.object.upload', true);
select throws_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000007',
    'our-days-intake',
    :'own_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/heic","size":2048}',
    jsonb_build_object(
      'intake_id', :'own_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000001',
      'expected_mime_type', 'image/heic',
      'expected_size_bytes', 2048,
      'expected_sha256', repeat('a', 64)
    )::text
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'standard upload is denied even for an exact live claim'
);

select set_config('storage.operation', 'storage.tus.upload.create', true);
select lives_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000004',
    'our-days-intake',
    :'own_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/heic","size":2048}',
    jsonb_build_object(
      'intake_id', :'own_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000001',
      'expected_mime_type', 'image/heic',
      'expected_size_bytes', 2048,
      'expected_sha256', repeat('a', 64)
    )::text
  ),
  'TUS create accepts one exact live owner-and-fingerprint-bound claim'
);

select set_config('storage.operation', 'storage.tus.upload.part', true);
select lives_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000008',
    'our-days-intake',
    :'child_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/jpeg","size":12}',
    jsonb_build_object(
      'intake_id', :'child_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000005',
      'expected_mime_type', 'image/jpeg',
      'expected_size_bytes', 12,
      'expected_sha256', repeat('b', 64)
    )::text
  ),
  'TUS part accepts the same exact live claim contract'
);

select set_config('storage.operation', 'storage.tus.upload.get', true);
select throws_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000009',
    'our-days-intake',
    :'own_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{"mimetype":"image/heic","size":2048}',
    jsonb_build_object(
      'intake_id', :'own_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000001',
      'expected_mime_type', 'image/heic',
      'expected_size_bytes', 2048,
      'expected_sha256', repeat('a', 64)
    )::text
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'other TUS operation names do not satisfy the create-and-part policy'
);

select is(
  (select count(*)::bigint from storage.objects
    where bucket_id = 'our-days-intake'),
  0::bigint,
  'the uploader cannot list or read even its quarantined object'
);

with changed as (
  update storage.objects
     set metadata = '{"mimetype":"image/png","size":1}'::jsonb
   where bucket_id = 'our-days-intake'
     and name = :'own_object_path'
  returning 1
)
select is(
  (select count(*)::bigint from changed),
  0::bigint,
  'the uploader cannot update or overwrite its object'
);

select throws_ok(
  format(
    'delete from storage.objects where bucket_id = %L and name = %L',
    'our-days-intake',
    :'own_object_path'
  ),
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'direct SQL cannot delete a quarantined object; HTTP policy denial is tested separately'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select throws_ok(
  format(
    'select * from public.acknowledge_photo_intake(%L::uuid)',
    :'own_intake_id'
  ),
  '22023',
  'Photo intake could not be acknowledged',
  'another family organizer cannot acknowledge the requester upload'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select *
  from public.acknowledge_photo_intake(:'own_intake_id'::uuid)
  \gset acknowledged_

select is(
  :'acknowledged_state'::text,
  'uploaded_unverified'::text,
  'the owner can acknowledge only an explicitly unverified uploaded object'
);
select is(
  :'acknowledged_observed_mime_type_unverified'::text,
  'image/heic'::text,
  'acknowledgement records the Storage MIME label as explicitly unverified'
);
select is(
  :'acknowledged_observed_size_bytes_unverified'::bigint,
  2048::bigint,
  'acknowledgement records the Storage size label as explicitly unverified'
);
select *
  from public.acknowledge_photo_intake(:'own_intake_id'::uuid)
  \gset acknowledged_retry_
select is(
  :'acknowledged_retry_intake_id'::uuid,
  :'own_intake_id'::uuid,
  'an immediate acknowledge retry is idempotent'
);
select ok(
  not private.photo_intake_path_is_uploadable(
    :'own_object_path',
    '10000000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  'an acknowledged path is no longer insertable'
);

reset role;
insert into private.photo_intakes (
  id,
  circle_id,
  journal_person_id,
  requested_by_membership_id,
  requester_authorization_version,
  request_key,
  object_path,
  state,
  requested_at,
  expires_at,
  upload_request_key,
  expected_mime_type,
  expected_size_bytes,
  expected_sha256,
  upload_claimed_at,
  upload_expires_at,
  uploaded_at,
  observed_mime_type_unverified,
  observed_size_bytes_unverified
)
select
  'c3000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  membership.id,
  membership.updated_at,
  'c1000000-0000-4000-8000-000000000014',
  'intake/c3000000-0000-4000-8000-000000000002',
  'uploaded_unverified',
  statement_timestamp() - interval '2 hours',
  statement_timestamp() - interval '1 hour',
  'c4000000-0000-4000-8000-000000000014',
  'image/jpeg',
  12,
  decode(repeat('c', 64), 'hex'),
  statement_timestamp() - interval '3 hours',
  statement_timestamp() - interval '1 hour',
  statement_timestamp() - interval '90 minutes',
  'image/jpeg',
  12
from public.circle_memberships as membership
where membership.id = '40000000-0000-4000-8000-000000000001';

insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
)
values (
  'd1000000-0000-4000-8000-000000000005',
  'our-days-intake',
  'intake/c3000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":12}'::jsonb,
  jsonb_build_object(
    'intake_id', 'c3000000-0000-4000-8000-000000000002',
    'upload_request_key', 'c4000000-0000-4000-8000-000000000014',
    'expected_mime_type', 'image/jpeg',
    'expected_size_bytes', 12,
    'expected_sha256', repeat('c', 64)
  )
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select is(
  (
    select state
      from public.acknowledge_photo_intake(
        'c3000000-0000-4000-8000-000000000002'
      )
  ),
  'uploaded_unverified',
  'a lost acknowledgement response remains idempotent after upload expiry'
);

reset role;
select throws_ok(
  format(
    'update private.photo_intakes set object_path = %L where id = %L::uuid',
    'intake/d1000000-0000-4000-8000-000000000099',
    :'own_intake_id'
  ),
  '42501',
  'Photo intake history is immutable',
  'even the table owner cannot rewrite intake identity'
);
select throws_ok(
  format(
    'delete from private.photo_intakes where id = %L::uuid',
    :'own_intake_id'
  ),
  '42501',
  'Photo intake history cannot be deleted',
  'intake history cannot be deleted'
);

insert into public.person_guardians (
  id,
  circle_id,
  managed_person_id,
  guardian_membership_id,
  created_by_membership_id
)
values (
  '50000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  '40000000-0000-4000-8000-000000000001'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'c1000000-0000-4000-8000-000000000006'
  ) \gset guardian_
select is(
  :'guardian_state'::text,
  'reserved'::text,
  'an active explicit guardian can reserve the managed journal'
);
select *
  from public.claim_photo_intake_upload(
    :'guardian_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000006',
    'image/png',
    100,
    repeat('d', 64)
  ) \gset guardian_claim_
select is(
  :'guardian_claim_state'::text,
  'upload_claimed'::text,
  'an active explicit guardian can bind a managed-journal upload claim'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000003',
  false
);

reset role;
select is(
  (select state from private.photo_intakes
    where id = :'guardian_intake_id'::uuid),
  'invalidated',
  'explicit guardian revocation terminalizes the affected claimed intake'
);
select is(
  (select invalidation_reason from private.photo_intakes
    where id = :'guardian_intake_id'::uuid),
  'guardian_authority_revoked',
  'guardian invalidation records its constrained authority source'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'c1000000-0000-4000-8000-000000000007'
  )$$,
  '22023',
  'Photo intake could not be reserved',
  'revoked guardian authority cannot reserve another path'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select public.set_person_guardian(
  '30000000-0000-4000-8000-000000000008',
  '40000000-0000-4000-8000-000000000002',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008',
    'c1000000-0000-4000-8000-000000000013'
  ) \gset durable_guardian_
select *
  from public.claim_photo_intake_upload(
    :'durable_guardian_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000013',
    'image/jpeg',
    88,
    repeat('9', 64)
  ) \gset durable_guardian_claim_
select is(
  :'durable_guardian_claim_state'::text,
  'upload_claimed'::text,
  'an organizer can claim a managed-journal intake with redundant explicit authority'
);

select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000008'
  ) \gset versioned_
select *
  from public.claim_photo_intake_upload(
    :'versioned_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000008',
    'image/webp',
    99,
    repeat('e', 64)
  ) \gset versioned_claim_
select is(
  :'versioned_claim_state'::text,
  'upload_claimed'::text,
  'the versioned intake reaches the claimed live state'
);
select set_config('storage.operation', 'storage.tus.upload.create', true);
select lives_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000011',
    'our-days-intake',
    :'versioned_object_path',
    '10000000-0000-4000-8000-000000000002',
    '{"mimetype":"image/webp","size":99}',
    jsonb_build_object(
      'intake_id', :'versioned_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000008',
      'expected_mime_type', 'image/webp',
      'expected_size_bytes', 99,
      'expected_sha256', repeat('e', 64)
    )::text
  ),
  'an exact claimed object is accepted before authority changes'
);
select is(
  (
    select state
      from public.acknowledge_photo_intake(:'versioned_intake_id'::uuid)
  ),
  'uploaded_unverified',
  'acknowledgement reaches the uploaded-but-unverified live state'
);

reset role;
update public.circle_memberships
   set role = 'member'
 where id = '40000000-0000-4000-8000-000000000002';
select is(
  (select state from private.photo_intakes
    where id = :'versioned_intake_id'::uuid),
  'uploaded_unverified',
  'role-only change preserves uploaded-unverified self-journal work'
);
select is(
  (select state from private.photo_intakes
    where id = :'durable_guardian_intake_id'::uuid),
  'upload_claimed',
  'explicit guardianship preserves a managed-journal claim after organizer demotion'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'c1000000-0000-4000-8000-000000000008'
  ) \gset invalidated_retry_
select is(
  :'invalidated_retry_intake_id'::uuid,
  :'versioned_intake_id'::uuid,
  'same-key replay after a role change returns the retained intake ID'
);
select is(
  :'invalidated_retry_state'::text,
  'uploaded_unverified'::text,
  'same-key replay preserves the already acknowledged state'
);
select ok(
  not private.photo_intake_path_is_uploadable(
    :'invalidated_retry_object_path',
    '10000000-0000-4000-8000-000000000002',
    '{}'::jsonb
  ),
  'the replayed uploaded-unverified path grants no further upload capability'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000009'
  ) \gset closing_
select *
  from public.claim_photo_intake_upload(
    :'closing_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000009',
    'image/jpeg',
    77,
    repeat('f', 64)
  ) \gset closing_claim_
select is(
  :'closing_claim_state'::text,
  'upload_claimed'::text,
  'the closure candidate begins with a live claimed upload'
);
select public.request_account_closure(
  'c2000000-0000-4000-8000-000000000001'
) as closure_id \gset closing_request_
select throws_ok(
  $$select * from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'c1000000-0000-4000-8000-000000000010'
  )$$,
  '22023',
  'Photo intake could not be reserved',
  'a requested account closure blocks new intake reservations'
);
select throws_ok(
  format(
    'insert into storage.objects '
      || '(id, bucket_id, name, owner_id, metadata, user_metadata) '
      || 'values (%L, %L, %L, %L, %L::jsonb, %L::jsonb)',
    'd1000000-0000-4000-8000-000000000010',
    'our-days-intake',
    :'closing_object_path',
    '10000000-0000-4000-8000-000000000003',
    '{"mimetype":"image/jpeg","size":77}',
    jsonb_build_object(
      'intake_id', :'closing_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000009',
      'expected_mime_type', 'image/jpeg',
      'expected_size_bytes', 77,
      'expected_sha256', repeat('f', 64)
    )::text
  ),
  '42501',
  'new row violates row-level security policy for table "objects"',
  'closure blocking immediately closes an exact previously claimed path'
);

set local role service_role;
select lives_ok(
  format(
    'select private.prepare_account_closure(%L::uuid)',
    :'closing_request_closure_id'
  ),
  'trusted closure preparation succeeds for the ordinary member'
);

reset role;
select is(
  (select state from private.photo_intakes
    where id = :'closing_intake_id'::uuid),
  'invalidated',
  'closure preparation terminalizes the retained intake record'
);
select is(
  (select invalidation_reason from private.photo_intakes
    where id = :'closing_intake_id'::uuid),
  'membership_authority_changed',
  'closure preparation is attributed to its membership authority change'
);
select is(
  (select user_id from public.circle_memberships
    where id = '40000000-0000-4000-8000-000000000003'),
  null::uuid,
  'closure preparation detaches the requester Auth account'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);
select throws_ok(
  format(
    'select * from public.acknowledge_photo_intake(%L::uuid)',
    :'closing_intake_id'
  ),
  '22023',
  'Photo intake could not be acknowledged',
  'a stale JWT cannot acknowledge after closure preparation'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000005',
    'c1000000-0000-4000-8000-000000000011'
  ) \gset dual_a_
select *
  from public.reserve_photo_intake(
    '20000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000007',
    'c1000000-0000-4000-8000-000000000012'
  ) \gset dual_b_
select *
  from public.claim_photo_intake_upload(
    :'dual_a_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000011',
    'image/jpeg',
    11,
    repeat('1', 64)
  ) \gset dual_a_claim_
select *
  from public.claim_photo_intake_upload(
    :'dual_b_intake_id'::uuid,
    'c4000000-0000-4000-8000-000000000012',
    'image/png',
    22,
    repeat('2', 64)
  ) \gset dual_b_claim_

select isnt(
  :'dual_a_intake_id'::uuid,
  :'dual_b_intake_id'::uuid,
  'dual-circle reservations remain distinct family-scoped intents'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);
select public.revoke_membership(
  '40000000-0000-4000-8000-000000000005'
);

reset role;
select is(
  (select state from private.photo_intakes
    where id = :'dual_a_intake_id'::uuid),
  'invalidated',
  'revoking one membership terminalizes that family intake'
);
select is(
  (select invalidation_reason from private.photo_intakes
    where id = :'dual_a_intake_id'::uuid),
  'membership_authority_changed',
  'membership revocation records its constrained invalidation source'
);
select is(
  (select state from private.photo_intakes
    where id = :'dual_b_intake_id'::uuid),
  'upload_claimed',
  'revoking circle A does not terminalize the independent circle B intake'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000005',
  true
);
select ok(
  private.photo_intake_path_is_uploadable(
    :'dual_b_object_path',
    '10000000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'intake_id', :'dual_b_intake_id',
      'upload_request_key', 'c4000000-0000-4000-8000-000000000012',
      'expected_mime_type', 'image/png',
      'expected_size_bytes', 22,
      'expected_sha256', repeat('2', 64)
    )
  ),
  'the still-active circle B claim remains exactly uploadable'
);

reset role;
select * from finish();
rollback;
