begin;

select no_plan();

update private.photo_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'photo_publication';

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select extensions.gen_random_uuid(), auth_user.id, statement_timestamp(),
  statement_timestamp(), statement_timestamp() + interval '1 day'
from auth.users as auth_user;

create function pg_temp.set_photo_test_user(test_user_id uuid)
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
  if test_session_id is null then
    insert into auth.sessions (
      id, user_id, created_at, updated_at, not_after
    ) values (
      extensions.gen_random_uuid(), test_user_id, statement_timestamp(),
      statement_timestamp(), statement_timestamp() + interval '1 day'
    ) returning id into test_session_id;
  end if;
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
    '%FOREIGN KEY (circle_id, validation_job_id, id, lease_attempt_id, object_path, intake_id, journal_person_id, recorded_by_membership_id)%',
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

select throws_ok(
  $$insert into private.photo_validator_allowlist (auth_user_id)
    values ('10000000-0000-4000-8000-000000000001')$$,
  '42501', 'Photo validator identity separation failed',
  'an existing family identity cannot be allowlisted as a validator'
);
insert into private.photo_validator_allowlist (auth_user_id)
values ('10000000-0000-4000-8000-000000000099');

insert into public.people (
  id, circle_id, display_name, profile_kind, accent_token,
  created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000099',
  '20000000-0000-4000-8000-000000000001',
  'Validator separation probe', 'account', 'clay',
  '40000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$insert into public.circle_memberships (
      id, circle_id, user_id, person_id, role, status
    ) values (
      '40000000-0000-4000-8000-000000000099',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000099',
      '30000000-0000-4000-8000-000000000099',
      'member', 'active'
    )$$,
  '42501', 'Photo validator identity separation failed',
  'an active validator identity cannot be attached to a family membership'
);

set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000099'::uuid);
select throws_ok(
  $$select * from public.claim_photo_validation(null, null)$$,
  '42501', 'Photo validation could not be claimed',
  'null claim scalars fail with the safe public error contract'
);
select throws_ok(
  $$select public.complete_photo_validation(
    null, null, null, null, null, null, null, null, null, null, null
  )$$,
  '42501', 'Photo validation could not be completed',
  'null completion scalars fail with the safe public error contract'
);
select throws_ok(
  $$select public.reject_photo_validation(null, null, null)$$,
  '42501', 'Photo validation could not be rejected',
  'null rejection scalars fail with the safe public error contract'
);
select throws_ok(
  $$select public.flag_photo_validation_for_review(null, null, null)$$,
  '42501', 'Photo validation could not be flagged',
  'null review scalars fail with the safe public error contract'
);
select lives_ok(
  $outer$
  do $null_contract$
  declare
    probe record;
    caught_state text;
    caught_message text;
  begin
    for probe in
      select * from (values
        ('claim intake',
          $$select * from public.claim_photo_validation(null, 'e2000000-0000-4000-8000-000000000001')$$,
          'Photo validation could not be claimed'),
        ('claim lease',
          $$select * from public.claim_photo_validation('e1000000-0000-4000-8000-000000000001', null)$$,
          'Photo validation could not be claimed'),
        ('complete job',
          $$select public.complete_photo_validation(null, 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, repeat('a',64), 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete lease',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', null, 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, repeat('a',64), 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete storage object',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', null, '', 'image/jpeg', 1, repeat('a',64), 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete storage version',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', null, 'image/jpeg', 1, repeat('a',64), 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete mime',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', null, 1, repeat('a',64), 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete size',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', null, repeat('a',64), 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete hash',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, null, 1, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete width',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, repeat('a',64), null, 1, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete height',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, repeat('a',64), 1, null, 3, 1)$$,
          'Photo validation could not be completed'),
        ('complete channels',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, repeat('a',64), 1, 1, null, 1)$$,
          'Photo validation could not be completed'),
        ('complete pages',
          $$select public.complete_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 'e3000000-0000-4000-8000-000000000001', '', 'image/jpeg', 1, repeat('a',64), 1, 1, 3, null)$$,
          'Photo validation could not be completed'),
        ('reject job',
          $$select public.reject_photo_validation(null, 'e2000000-0000-4000-8000-000000000001', 'decode_failed')$$,
          'Photo validation could not be rejected'),
        ('reject lease',
          $$select public.reject_photo_validation('e1000000-0000-4000-8000-000000000001', null, 'decode_failed')$$,
          'Photo validation could not be rejected'),
        ('reject reason',
          $$select public.reject_photo_validation('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', null)$$,
          'Photo validation could not be rejected'),
        ('review job',
          $$select public.flag_photo_validation_for_review(null, 'e2000000-0000-4000-8000-000000000001', 'canonical_collision')$$,
          'Photo validation could not be flagged'),
        ('review lease',
          $$select public.flag_photo_validation_for_review('e1000000-0000-4000-8000-000000000001', null, 'canonical_collision')$$,
          'Photo validation could not be flagged'),
        ('review reason',
          $$select public.flag_photo_validation_for_review('e1000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', null)$$,
          'Photo validation could not be flagged')
      ) as probes(label, statement, expected_message)
    loop
      begin
        execute probe.statement;
        raise exception 'null contract unexpectedly accepted %', probe.label;
      exception when others then
        get stacked diagnostics
          caught_state = returned_sqlstate,
          caught_message = message_text;
        if caught_state <> '42501'
          or caught_message <> probe.expected_message then
          raise exception 'unsafe null contract for %: [%] %',
            probe.label, caught_state, caught_message;
        end if;
      end;
    end loop;
  end;
  $null_contract$;
  $outer$,
  'each nullable public coordinator scalar independently fails with its safe contract'
);
reset role;

set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000001'::uuid);
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
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000001'::uuid);
select throws_ok(
  format(
    'select * from public.claim_photo_validation(%L::uuid, %L::uuid)',
    :'accepted_intake_id', 'c5000000-0000-4000-8000-000000000091'
  ),
  '42501', 'Photo validation could not be claimed',
  'an ordinary family member cannot pose as a byte validator'
);

select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000099'::uuid);
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
  format(
    'original/%s/%s',
    (select original_id from private.photo_validation_jobs
      where id = :'accepted_validation_validation_job_id'::uuid),
    :'accepted_validation_lease_attempt_id'
  ),
  'the canonical path is scoped to the immutable original and current lease attempt'
);
set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000099'::uuid);
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
    'lease_attempt_id', :'accepted_validation_lease_attempt_id',
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
    lease_attempt_id,
    verified_width, verified_height, verified_channels, verified_pages
  )::text from private.photo_originals
    where id = :'accepted_original_original_id'::uuid),
  row(
    '20000000-0000-4000-8000-000000000001'::uuid,
    '30000000-0000-4000-8000-000000000001'::uuid,
    '40000000-0000-4000-8000-000000000001'::uuid,
    :'accepted_validation_lease_attempt_id'::uuid,
    4, 3, 3, 1
  )::text,
  'the immutable ledger preserves circle, journal, recorder, lease attempt, and decode proof'
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
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000099'::uuid);
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
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000001'::uuid);
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
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000099'::uuid);
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
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000099'::uuid);
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

-- Revoking an identity after it has acquired a valid lease must remove every
-- coordinator capability, including idempotent claim and terminal actions.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000098',
  'revoked-photo-validator@example.test', statement_timestamp(), '{}'
);
insert into private.photo_validator_allowlist (auth_user_id)
values ('10000000-0000-4000-8000-000000000098');

set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000001'::uuid);
select * from public.reserve_photo_intake(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000094'
) \gset revoked_
select * from public.claim_photo_intake_upload(
  :'revoked_intake_id'::uuid,
  'c4000000-0000-4000-8000-000000000094',
  'image/jpeg', 14, repeat('c', 64)
) \gset revoked_upload_
select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd1000000-0000-4000-8000-000000000094', 'our-days-intake',
  :'revoked_object_path', '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":14}'::jsonb,
  jsonb_build_object(
    'intake_id', :'revoked_intake_id',
    'upload_request_key', 'c4000000-0000-4000-8000-000000000094',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 14,
    'expected_sha256', repeat('c', 64)
  )
);
select * from public.acknowledge_photo_intake(:'revoked_intake_id'::uuid)
  \gset revoked_ack_
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000098'::uuid);
select * from public.claim_photo_validation(
  :'revoked_intake_id'::uuid,
  'c5000000-0000-4000-8000-000000000094'
) \gset revoked_validation_

reset role;
update private.photo_validator_allowlist
   set revoked_at = statement_timestamp()
 where auth_user_id = '10000000-0000-4000-8000-000000000098';

set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000098'::uuid);
select throws_ok(
  format(
    'select * from public.claim_photo_validation(%L::uuid,%L::uuid)',
    :'revoked_intake_id', 'c5000000-0000-4000-8000-000000000094'
  ),
  '42501', 'Photo validation could not be claimed',
  'revocation immediately blocks claim retries on a live lease'
);
select throws_ok(
  format(
    'select public.complete_photo_validation('
      || '%L::uuid,%L::uuid,%L::uuid,%L,%L,%s,%L,%s,%s,%s,%s)',
    :'revoked_validation_validation_job_id',
    'c5000000-0000-4000-8000-000000000094',
    'd2000000-0000-4000-8000-000000000094', '',
    'image/jpeg', 14, repeat('c', 64), 7, 2, 3, 1
  ),
  '42501', 'Photo validation could not be completed',
  'revocation blocks completion of a previously acquired live lease'
);
select throws_ok(
  format(
    'select public.reject_photo_validation(%L::uuid,%L::uuid,%L)',
    :'revoked_validation_validation_job_id',
    'c5000000-0000-4000-8000-000000000094', 'decode_failed'
  ),
  '42501', 'Photo validation could not be rejected',
  'revocation blocks rejection of a previously acquired live lease'
);
select throws_ok(
  format(
    'select public.flag_photo_validation_for_review(%L::uuid,%L::uuid,%L)',
    :'revoked_validation_validation_job_id',
    'c5000000-0000-4000-8000-000000000094', 'validator_cleanup_failed'
  ),
  '42501', 'Photo validation could not be flagged',
  'revocation blocks review terminalization of a previously acquired live lease'
);
reset role;

-- A timed-out lease is not renewable by its original validator. A distinct,
-- still-separated validator gets a new attempt identity and canonical path.
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  (
    '10000000-0000-4000-8000-000000000097',
    'stale-photo-validator@example.test', statement_timestamp(), '{}'
  ),
  (
    '10000000-0000-4000-8000-000000000096',
    'takeover-photo-validator@example.test', statement_timestamp(), '{}'
  );
insert into private.photo_validator_allowlist (auth_user_id)
values
  ('10000000-0000-4000-8000-000000000097'),
  ('10000000-0000-4000-8000-000000000096');
select ok(
  private.photo_validator_is_allowed(
    '10000000-0000-4000-8000-000000000096'
  )
  and not exists (
    select 1 from public.circle_memberships
     where user_id = '10000000-0000-4000-8000-000000000096'
  ),
  'the distinct takeover validator is allowlisted and has no family membership'
);

set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000001'::uuid);
select * from public.reserve_photo_intake(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'c1000000-0000-4000-8000-000000000095'
) \gset takeover_
select * from public.claim_photo_intake_upload(
  :'takeover_intake_id'::uuid,
  'c4000000-0000-4000-8000-000000000095',
  'image/jpeg', 15, repeat('d', 64)
) \gset takeover_upload_
select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  'd1000000-0000-4000-8000-000000000095', 'our-days-intake',
  :'takeover_object_path', '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":15}'::jsonb,
  jsonb_build_object(
    'intake_id', :'takeover_intake_id',
    'upload_request_key', 'c4000000-0000-4000-8000-000000000095',
    'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 15,
    'expected_sha256', repeat('d', 64)
  )
);
select * from public.acknowledge_photo_intake(:'takeover_intake_id'::uuid)
  \gset takeover_ack_
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000097'::uuid);
select * from public.claim_photo_validation(
  :'takeover_intake_id'::uuid,
  'c5000000-0000-4000-8000-000000000095'
) \gset stale_validation_
reset role;

set constraints all immediate;
alter table private.photo_validation_jobs
  disable trigger photo_validation_jobs_integrity;
update private.photo_validation_jobs
   set lease_started_at = statement_timestamp() - interval '16 minutes',
       lease_expires_at = statement_timestamp() - interval '1 minute'
 where id = :'stale_validation_validation_job_id'::uuid;
alter table private.photo_validation_jobs
  enable trigger photo_validation_jobs_integrity;
set constraints all deferred;

set local role authenticated;
select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000097'::uuid);
select throws_ok(
  format(
    'select * from public.claim_photo_validation(%L::uuid,%L::uuid)',
    :'takeover_intake_id', 'c5000000-0000-4000-8000-000000000096'
  ),
  '42501', 'Photo validation could not be claimed',
  'the original validator cannot reclaim its own expired lease'
);

select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000096'::uuid);
select * from public.claim_photo_validation(
  :'takeover_intake_id'::uuid,
  'c5000000-0000-4000-8000-000000000097'
) \gset takeover_validation_

select is(
  :'takeover_validation_validation_job_id'::uuid,
  :'stale_validation_validation_job_id'::uuid,
  'a distinct validator takes over the same stable validation job'
);
select isnt(
  :'takeover_validation_lease_attempt_id'::text,
  :'stale_validation_lease_attempt_id'::text,
  'takeover receives a fresh lease-attempt identity'
);
select isnt(
  :'takeover_validation_canonical_object_path'::text,
  :'stale_validation_canonical_object_path'::text,
  'takeover receives a fresh immutable canonical path'
);
select is(
  :'takeover_validation_canonical_object_path'::text,
  format(
    'original/%s/%s',
    split_part(:'stale_validation_canonical_object_path', '/', 2),
    :'takeover_validation_lease_attempt_id'
  ),
  'the takeover path preserves original identity while binding the new attempt'
);
select ok(
  private.photo_validation_source_is_readable(
    :'takeover_validation_source_object_path',
    :'takeover_validation_source_storage_object_id'::uuid,
    :'takeover_validation_source_storage_object_version'
  ),
  'the replacement validator can read the exact source for its active lease'
);
select ok(
  private.photo_original_path_is_uploadable(
    :'takeover_validation_canonical_object_path',
    '10000000-0000-4000-8000-000000000096',
    jsonb_build_object(
      'validation_job_id', :'takeover_validation_validation_job_id',
      'intake_id', :'takeover_intake_id',
      'original_id', split_part(:'takeover_validation_canonical_object_path', '/', 2),
      'lease_attempt_id', :'takeover_validation_lease_attempt_id',
      'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 15,
      'expected_sha256', repeat('d', 64),
      'verification_profile_version', 1
    )
  ),
  'the replacement validator can upload only with exact attempt metadata'
);

select pg_temp.set_photo_test_user('10000000-0000-4000-8000-000000000097'::uuid);
select ok(
  not private.photo_validation_source_is_readable(
    :'stale_validation_source_object_path',
    :'stale_validation_source_storage_object_id'::uuid,
    :'stale_validation_source_storage_object_version'
  ),
  'the stale validator loses quarantine-source helper access after takeover'
);
select ok(
  not private.photo_original_path_is_readable(
    :'stale_validation_canonical_object_path'
  ),
  'the stale validator loses canonical-read helper access after takeover'
);
select ok(
  not private.photo_original_path_is_uploadable(
    :'stale_validation_canonical_object_path',
    '10000000-0000-4000-8000-000000000097',
    jsonb_build_object(
      'validation_job_id', :'stale_validation_validation_job_id',
      'intake_id', :'takeover_intake_id',
      'original_id', split_part(:'stale_validation_canonical_object_path', '/', 2),
      'lease_attempt_id', :'stale_validation_lease_attempt_id',
      'expected_mime_type', 'image/jpeg', 'expected_size_bytes', 15,
      'expected_sha256', repeat('d', 64),
      'verification_profile_version', 1
    )
  ),
  'the stale validator loses canonical-upload helper access after takeover'
);

reset role;
select * from finish();
rollback;
