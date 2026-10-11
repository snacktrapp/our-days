begin;

select plan(26);

select ok(
  (
    select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = class.relnamespace
     where namespace.nspname = 'private'
       and class.relname = 'moment_media_purges'
  ),
  'the purge log is private and forces row level security'
);

select is(
  (
    select count(*)::bigint
      from information_schema.role_table_grants
     where table_schema = 'private'
       and table_name = 'moment_media_purges'
       and grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role')
  ),
  0::bigint,
  'browser and service roles have no direct purge-log privileges'
);

select ok(
  exists (
    select 1
      from pg_catalog.pg_policy as policy
     where policy.polrelid = 'storage.objects'::regclass
       and policy.polname = 'our_days_moment_media_delete_validator_purge'
       and policy.polcmd = 'd'
  )
  and exists (
    select 1
      from pg_catalog.pg_policy as policy
     where policy.polrelid = 'storage.objects'::regclass
       and policy.polname = 'our_days_moment_media_select_validator_purge'
       and policy.polcmd = 'r'
  ),
  'the validator has select and delete policies for purge-safe media'
);

select ok(
  (
    select bool_and(
      pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like
        '%private.current_user_is_photo_validator()%'
      and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like
        '%private.moment_media_path_is_purge_safe(objects.bucket_id, objects.name)%'
      and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like
        '%our-days-originals%'
      and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like
        '%our-days-display%'
      and pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) like
        '%our-days-videos%'
    )
      from pg_catalog.pg_policy as policy
     where policy.polname in (
       'our_days_moment_media_delete_validator_purge',
       'our_days_moment_media_select_validator_purge'
     )
  ),
  'media delete and select both recheck the validator and the exact path'
);

select ok(
  (
    select bool_and('search_path=""' = any(procedure.proconfig))
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.proname in (
         'moment_media_path_is_purge_safe',
         'list_moment_media_purge_candidates',
         'record_moment_media_purge'
       )
  ),
  'purge helpers pin an empty search path'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.list_moment_media_purge_candidates(integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.record_moment_media_purge(text, text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'public.list_moment_media_purge_candidates(integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.list_moment_media_purge_candidates(integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'authenticated',
    'public.record_moment_media_purge(text, text)',
    'EXECUTE'
  ),
  'only an authenticated caller can reach the purge RPCs'
);

insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_membership_id, kind, body,
  occurred_on, time_precision, trashed_at, trashed_by_membership_id
) values
  (
    'e1100000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'video',
    'An old video waiting for its files to leave.',
    '2026-01-01',
    'date',
    statement_timestamp() - interval '40 days',
    '40000000-0000-4000-8000-000000000001'
  ),
  (
    'e1100000-0000-4000-8000-000000000011',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'video',
    'A recently removed video that can still come back.',
    '2026-01-02',
    'date',
    statement_timestamp() - interval '10 days',
    '40000000-0000-4000-8000-000000000001'
  ),
  (
    'e1100000-0000-4000-8000-000000000021',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'video',
    'An old duplicate that still has a live copy.',
    '2026-01-03',
    'date',
    statement_timestamp() - interval '40 days',
    '40000000-0000-4000-8000-000000000001'
  ),
  (
    'e1100000-0000-4000-8000-000000000022',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'video',
    'The live copy of a shared video path.',
    '2026-01-04',
    'date',
    null,
    null
  );

insert into private.video_upload_requests (
  id, circle_id, journal_person_id, requested_by_membership_id, request_key,
  moment_id, object_path, state, expected_mime_type, expected_size_bytes,
  duration_ms, body, place_name, occurred_on, occurred_at, occurred_timezone,
  time_precision, request_payload_hash, requested_at, upload_expires_at,
  published_at, audience
) values
  (
    'e1100000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000002',
    'e1100000-0000-4000-8000-000000000001',
    'video/e1100000-0000-4000-8000-000000000002',
    'published',
    'video/mp4',
    1000,
    1000,
    'An old video waiting for its files to leave.',
    null,
    '2026-01-01',
    null,
    null,
    'date',
    extensions.digest('moment-media-purge-old', 'sha256'),
    statement_timestamp() - interval '40 days',
    statement_timestamp() - interval '40 days' + interval '2 hours',
    statement_timestamp() - interval '40 days',
    'family'
  ),
  (
    'e1100000-0000-4000-8000-000000000012',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000012',
    'e1100000-0000-4000-8000-000000000011',
    'video/e1100000-0000-4000-8000-000000000012',
    'published',
    'video/mp4',
    1000,
    1000,
    'A recently removed video that can still come back.',
    null,
    '2026-01-02',
    null,
    null,
    'date',
    extensions.digest('moment-media-purge-recent', 'sha256'),
    statement_timestamp() - interval '10 days',
    statement_timestamp() - interval '10 days' + interval '2 hours',
    statement_timestamp() - interval '10 days',
    'family'
  ),
  (
    'e1100000-0000-4000-8000-000000000031',
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000031',
    'e1100000-0000-4000-8000-000000000021',
    'video/e1100000-0000-4000-8000-000000000031',
    'published',
    'video/mp4',
    1000,
    1000,
    'An old duplicate that still has a live copy.',
    null,
    '2026-01-03',
    null,
    null,
    'date',
    extensions.digest('moment-media-purge-shared', 'sha256'),
    statement_timestamp() - interval '40 days',
    statement_timestamp() - interval '40 days' + interval '2 hours',
    statement_timestamp() - interval '40 days',
    'family'
  );

insert into public.moment_videos (
  circle_id, moment_id, upload_request_id, bucket_id, object_path, mime_type,
  size_bytes, duration_ms, storage_object_id, storage_object_version
) values
  (
    '20000000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000002',
    'our-days-videos',
    'video/e1100000-0000-4000-8000-000000000002',
    'video/mp4',
    1000,
    1000,
    'e1100000-0000-4000-8000-0000000000a1',
    ''
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000011',
    'e1100000-0000-4000-8000-000000000012',
    'our-days-videos',
    'video/e1100000-0000-4000-8000-000000000012',
    'video/mp4',
    1000,
    1000,
    'e1100000-0000-4000-8000-0000000000a2',
    ''
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    'e1100000-0000-4000-8000-000000000021',
    'e1100000-0000-4000-8000-000000000031',
    'our-days-videos',
    'video/e1100000-0000-4000-8000-000000000031',
    'video/mp4',
    1000,
    1000,
    'e1100000-0000-4000-8000-0000000000a3',
    ''
  );

alter table public.moment_videos drop constraint moment_videos_object_unique;
alter table public.moment_videos drop constraint moment_videos_request_unique;

insert into public.moment_videos (
  circle_id, moment_id, upload_request_id, bucket_id, object_path, mime_type,
  size_bytes, duration_ms, storage_object_id, storage_object_version
) values (
  '20000000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000022',
  'e1100000-0000-4000-8000-000000000031',
  'our-days-videos',
  'video/e1100000-0000-4000-8000-000000000031',
  'video/mp4',
  1000,
  1000,
  'e1100000-0000-4000-8000-0000000000a3',
  ''
);

insert into public.moment_video_posters (
  circle_id, moment_id, bucket_id, object_path, mime_type, size_bytes,
  width_px, height_px, storage_object_id, storage_object_version,
  created_by_membership_id
) values (
  '20000000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'our-days-videos',
  'poster/e1100000-0000-4000-8000-000000000001',
  'image/jpeg',
  1000,
  100,
  100,
  'e1100000-0000-4000-8000-0000000000aa',
  '',
  '40000000-0000-4000-8000-000000000001'
);

select set_config('storage.operation', 'object.upload', true);
insert into storage.objects (id, bucket_id, name, owner_id, metadata)
values (
  'e1100000-0000-4000-8000-0000000000aa',
  'our-days-videos',
  'poster/e1100000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"image/jpeg","size":1000}'::jsonb
);

select throws_ok(
  $$delete from storage.objects
     where bucket_id = 'our-days-videos'
       and name = 'poster/e1100000-0000-4000-8000-000000000001'$$,
  '42501',
  'Direct deletion from storage tables is not allowed. Use the Storage API instead.',
  'sql delete of a video object stays blocked'
);

select is(
  (select private.moment_media_path_is_purge_safe(
    'our-days-videos',
    'video/does-not-exist'
  )),
  false,
  'a path with no moment reference is not purge-safe'
);

select is(
  (select private.moment_media_path_is_purge_safe(
    'our-days-videos',
    'video/e1100000-0000-4000-8000-000000000031'
  )),
  false,
  'a path shared with a live moment is not purge-safe'
);

select is(
  (select private.moment_media_path_is_purge_safe(
    'our-days-videos',
    'video/e1100000-0000-4000-8000-000000000002'
  )),
  true,
  'a video trashed more than 30 days ago with no live copy is purge-safe'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  'e1000000-0000-4000-8000-000000000099',
  'media-purge-validator@example.test',
  statement_timestamp(),
  '{}'
);
insert into private.photo_validator_allowlist (auth_user_id)
values ('e1000000-0000-4000-8000-000000000099');

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select throws_ok(
  $$select * from public.list_moment_media_purge_candidates(8)$$,
  '42501',
  'Moment media purge is unavailable',
  'a family member cannot list purge candidates'
);

select set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000099',
  true
);

select is(
  (
    select count(*)::bigint
      from public.list_moment_media_purge_candidates(8)
     where object_path = 'video/e1100000-0000-4000-8000-000000000002'
  ),
  1::bigint,
  'the validator lists the old video path'
);

select is(
  (
    select count(*)::bigint
      from public.list_moment_media_purge_candidates(8)
     where object_path = 'poster/e1100000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the validator lists the old poster path'
);

select is(
  (
    select count(*)::bigint
      from public.list_moment_media_purge_candidates(100)
     where object_path in (
       'video/e1100000-0000-4000-8000-000000000031',
       'video/e1100000-0000-4000-8000-000000000012'
     )
  ),
  0::bigint,
  'live duplicates and recently trashed videos stay out of the batch'
);

select is(
  (
    select reason
      from public.record_moment_media_purge(
        'our-days-videos',
        'video/e1100000-0000-4000-8000-000000000002'
      )
  ),
  'purged',
  'a missing video object is recorded as purged'
);

select is(
  (
    select reason
      from public.record_moment_media_purge(
        'our-days-videos',
        'video/e1100000-0000-4000-8000-000000000002'
      )
  ),
  'already_recorded',
  'recording the same missing path again is idempotent'
);

select is(
  (
    select reason
      from public.record_moment_media_purge(
        'our-days-videos',
        'poster/e1100000-0000-4000-8000-000000000001'
      )
  ),
  'still_present',
  'a poster that is still stored is not recorded as purged'
);

select is(
  (
    select reason
      from public.record_moment_media_purge(
        'our-days-videos',
        'video/e1100000-0000-4000-8000-000000000031'
      )
  ),
  'not_safe',
  'a live duplicate blocks the purge record'
);

reset role;

select is(
  (
    select count(*)::bigint
      from private.moment_media_purges
     where moment_id = 'e1100000-0000-4000-8000-000000000001'
       and object_path = 'poster/e1100000-0000-4000-8000-000000000001'
  ),
  0::bigint,
  'a still-present poster writes no purge row'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'e1000000-0000-4000-8000-000000000099',
  true
);

select is(
  (
    select count(*)::bigint
      from public.list_moment_media_purge_candidates(8)
     where moment_id = 'e1100000-0000-4000-8000-000000000001'
       and object_path = 'video/e1100000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'a recorded video path is not listed again'
);

select is(
  (
    select count(*)::bigint
      from public.list_moment_media_purge_candidates(8)
     where object_path = 'poster/e1100000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the remaining poster is still a candidate'
);

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001',
  true
);

select is(
  (
    select media_purged
      from public.list_manageable_trashed_written_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_id = 'e1100000-0000-4000-8000-000000000001'
  ),
  true,
  'recently removed marks a moment once any of its media is purged'
);

select is(
  (
    select media_purged
      from public.list_manageable_trashed_written_moments(
        '20000000-0000-4000-8000-000000000001'
      )
     where moment_id = 'e1100000-0000-4000-8000-000000000011'
  ),
  false,
  'a recently trashed video can still be restored'
);

select throws_ok(
  $$select public.set_written_moment_trashed(
    'e1100000-0000-4000-8000-000000000001',
    1,
    false
  )$$,
  '42501',
  'Moment media has been removed',
  'restore refuses a moment whose media was purged'
);

reset role;

select is(
  (
    select count(*)::bigint
      from public.moments
     where id = 'e1100000-0000-4000-8000-000000000001'
       and trashed_at is not null
  ),
  1::bigint,
  'purging files leaves the moment row in place'
);

select is(
  (
    select count(*)::bigint
      from public.moment_videos
     where moment_id in (
       'e1100000-0000-4000-8000-000000000001',
       'e1100000-0000-4000-8000-000000000022'
     )
  ),
  2::bigint,
  'purging files leaves video ledger rows in place'
);

select * from finish();
rollback;
