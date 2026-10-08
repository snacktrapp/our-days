begin;

select plan(11);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values (
  '72000000-0000-4000-8000-000000000121',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '1 day'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000121"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);

select lives_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A clip of 40 seconds.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 40000,
    request_key := 'd1200000-0000-4000-8000-000000000001',
    audience := 'family'
  )$$,
  'reserve accepts exactly 40000 ms'
);

select throws_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A clip of 41 seconds.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 41000,
    request_key := 'd1200000-0000-4000-8000-000000000002',
    audience := 'family'
  )$$,
  '22023',
  'Video moment could not be prepared',
  'reserve rejects 40001 ms and above'
);

select throws_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A large clip reserve.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 134217729,
    duration_ms := 30000,
    request_key := 'd1200000-0000-4000-8000-000000000003',
    audience := 'family'
  )$$,
  '22023',
  'Video moment could not be prepared',
  'reserve rejects 128 MiB + 1 byte'
);

select lives_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := '@A Organizer Two joins this short clip.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 2000,
    duration_ms := 30000,
    request_key := 'd1200000-0000-4000-8000-000000000004',
    audience := 'family',
    mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
    mention_starts := array[0]::integer[],
    mention_ends := array[16]::integer[]
  )$$,
  'a short video reserve with mentions succeeds'
);

reset role;

select lives_ok(
  $$update private.video_upload_requests
       set expected_size_bytes = 134217728,
           duration_ms = 40000
     where request_key = 'd1200000-0000-4000-8000-000000000001'::uuid$$,
  'video_upload_requests accepts exact boundary values'
);

select throws_ok(
  $$update private.video_upload_requests
       set expected_size_bytes = 134217729
     where request_key = 'd1200000-0000-4000-8000-000000000001'::uuid$$,
  '23514',
  'new row for relation "video_upload_requests" violates check constraint "video_upload_requests_size_cap_128mb"',
  'video_upload_requests rejects 128 MiB + 1 byte'
);

select throws_ok(
  $$update private.video_upload_requests
       set duration_ms = 40001
     where request_key = 'd1200000-0000-4000-8000-000000000001'::uuid$$,
  '23514',
  'new row for relation "video_upload_requests" violates check constraint "video_upload_requests_duration_cap_40s"',
  'video_upload_requests rejects 40001 ms'
);

select lives_ok(
  $$
  with template as (
    select * from private.video_upload_requests
     where request_key = 'd1200000-0000-4000-8000-000000000001'::uuid
  ),
  created_request as (
    insert into private.video_upload_requests (
      id, circle_id, journal_person_id, requested_by_membership_id,
      request_key, moment_id, object_path, state, expected_mime_type,
      expected_size_bytes, duration_ms, body, place_name, occurred_on,
      occurred_at, occurred_timezone, time_precision, request_payload_hash,
      requested_at, upload_expires_at, published_at, audience
    )
    select
      'd1200000-0000-4000-8000-000000000010'::uuid,
      template.circle_id,
      template.journal_person_id,
      template.requested_by_membership_id,
      'd1200000-0000-4000-8000-000000000010'::uuid,
      'd1200000-0000-4000-8000-000000000011'::uuid,
      'video/d1200000-0000-4000-8000-000000000010',
      'upload_claimed',
      'video/mp4',
      134217728,
      40000,
      template.body,
      template.place_name,
      template.occurred_on,
      template.occurred_at,
      template.occurred_timezone,
      template.time_precision,
      template.request_payload_hash,
      template.requested_at,
      template.requested_at + interval '2 hours',
      null,
      template.audience
    from template
    returning circle_id, journal_person_id, requested_by_membership_id, moment_id, id
  )
  insert into public.moments (
    id, circle_id, journal_person_id, recorded_by_membership_id, kind, title,
    body, place_name, occurred_on, occurred_at, occurred_timezone, time_precision
  )
  select
    request.moment_id,
    request.circle_id,
    request.journal_person_id,
    request.requested_by_membership_id,
    'video',
    null,
    'Boundary moment video',
    null,
    '2026-08-29',
    null,
    null,
    'date'
  from created_request as request;

  insert into public.moment_videos (
    circle_id, moment_id, upload_request_id, bucket_id, object_path, mime_type,
    size_bytes, duration_ms, storage_object_id, storage_object_version
  ) values (
    '20000000-0000-4000-8000-000000000001'::uuid,
    'd1200000-0000-4000-8000-000000000011'::uuid,
    'd1200000-0000-4000-8000-000000000010'::uuid,
    'our-days-videos',
    'video/d1200000-0000-4000-8000-000000000010',
    'video/mp4',
    134217728,
    40000,
    'd1200000-0000-4000-8000-000000000012'::uuid,
    ''
  );
  $$,
  'moment_videos accepts exact boundary values'
);

select throws_ok(
  $$
  with template as (
    select * from private.video_upload_requests
     where request_key = 'd1200000-0000-4000-8000-000000000001'::uuid
  ),
  created_request as (
    insert into private.video_upload_requests (
      id, circle_id, journal_person_id, requested_by_membership_id,
      request_key, moment_id, object_path, state, expected_mime_type,
      expected_size_bytes, duration_ms, body, place_name, occurred_on,
      occurred_at, occurred_timezone, time_precision, request_payload_hash,
      requested_at, upload_expires_at, published_at, audience
    )
    select
      'd1200000-0000-4000-8000-000000000020'::uuid,
      template.circle_id,
      template.journal_person_id,
      template.requested_by_membership_id,
      'd1200000-0000-4000-8000-000000000020'::uuid,
      'd1200000-0000-4000-8000-000000000021'::uuid,
      'video/d1200000-0000-4000-8000-000000000020',
      'upload_claimed',
      'video/mp4',
      1000,
      30000,
      template.body,
      template.place_name,
      template.occurred_on,
      template.occurred_at,
      template.occurred_timezone,
      template.time_precision,
      template.request_payload_hash,
      template.requested_at,
      template.requested_at + interval '2 hours',
      null,
      template.audience
    from template
    returning circle_id, journal_person_id, requested_by_membership_id, moment_id, id
  )
  insert into public.moments (
    id, circle_id, journal_person_id, recorded_by_membership_id, kind, title,
    body, place_name, occurred_on, occurred_at, occurred_timezone, time_precision
  )
  select
    request.moment_id,
    request.circle_id,
    request.journal_person_id,
    request.requested_by_membership_id,
    'video',
    null,
    'Oversize moment video',
    null,
    '2026-08-29',
    null,
    null,
    'date'
  from created_request as request;

  insert into public.moment_videos (
    circle_id, moment_id, upload_request_id, bucket_id, object_path, mime_type,
    size_bytes, duration_ms, storage_object_id, storage_object_version
  ) values (
    '20000000-0000-4000-8000-000000000001'::uuid,
    'd1200000-0000-4000-8000-000000000021'::uuid,
    'd1200000-0000-4000-8000-000000000020'::uuid,
    'our-days-videos',
    'video/d1200000-0000-4000-8000-000000000020',
    'video/mp4',
    134217729,
    30000,
    'd1200000-0000-4000-8000-000000000022'::uuid,
    ''
  );
  $$,
  '23514',
  'new row for relation "moment_videos" violates check constraint "moment_videos_size_cap_128mb"',
  'moment_videos rejects 128 MiB + 1 byte'
);

select throws_ok(
  $$
  with template as (
    select * from private.video_upload_requests
     where request_key = 'd1200000-0000-4000-8000-000000000001'::uuid
  ),
  created_request as (
    insert into private.video_upload_requests (
      id, circle_id, journal_person_id, requested_by_membership_id,
      request_key, moment_id, object_path, state, expected_mime_type,
      expected_size_bytes, duration_ms, body, place_name, occurred_on,
      occurred_at, occurred_timezone, time_precision, request_payload_hash,
      requested_at, upload_expires_at, published_at, audience
    )
    select
      'd1200000-0000-4000-8000-000000000030'::uuid,
      template.circle_id,
      template.journal_person_id,
      template.requested_by_membership_id,
      'd1200000-0000-4000-8000-000000000030'::uuid,
      'd1200000-0000-4000-8000-000000000031'::uuid,
      'video/d1200000-0000-4000-8000-000000000030',
      'upload_claimed',
      'video/mp4',
      1000,
      30000,
      template.body,
      template.place_name,
      template.occurred_on,
      template.occurred_at,
      template.occurred_timezone,
      template.time_precision,
      template.request_payload_hash,
      template.requested_at,
      template.requested_at + interval '2 hours',
      null,
      template.audience
    from template
    returning circle_id, journal_person_id, requested_by_membership_id, moment_id, id
  )
  insert into public.moments (
    id, circle_id, journal_person_id, recorded_by_membership_id, kind, title,
    body, place_name, occurred_on, occurred_at, occurred_timezone, time_precision
  )
  select
    request.moment_id,
    request.circle_id,
    request.journal_person_id,
    request.requested_by_membership_id,
    'video',
    null,
    'Overduration moment video',
    null,
    '2026-08-29',
    null,
    null,
    'date'
  from created_request as request;

  insert into public.moment_videos (
    circle_id, moment_id, upload_request_id, bucket_id, object_path, mime_type,
    size_bytes, duration_ms, storage_object_id, storage_object_version
  ) values (
    '20000000-0000-4000-8000-000000000001'::uuid,
    'd1200000-0000-4000-8000-000000000031'::uuid,
    'd1200000-0000-4000-8000-000000000030'::uuid,
    'our-days-videos',
    'video/d1200000-0000-4000-8000-000000000030',
    'video/mp4',
    1000,
    40001,
    'd1200000-0000-4000-8000-000000000032'::uuid,
    ''
  );
  $$,
  '23514',
  'new row for relation "moment_videos" violates check constraint "moment_videos_duration_cap_40s"',
  'moment_videos rejects 40001 ms'
);

select is(
  (
    select count(*)::bigint
      from pg_catalog.pg_constraint as constraint_row
     where constraint_row.conname in (
       'video_upload_requests_size_valid',
       'video_upload_requests_duration_valid',
       'moment_videos_size_valid',
       'moment_videos_duration_valid'
     )
       and constraint_row.conrelid in (
         'private.video_upload_requests'::regclass,
         'public.moment_videos'::regclass
       )
  ),
  0::bigint,
  'legacy 100 MiB and 120500 ms check constraints are removed'
);

select * from finish();

rollback;
