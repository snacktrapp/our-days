begin;

select plan(2);

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
    body := 'A clip of about 94 seconds.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 94360,
    request_key := 'd1200000-0000-4000-8000-000000000001',
    audience := 'family'
  )$$,
  'a clip of about 94 seconds (94360 ms) is accepted'
);

select throws_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A clip of 121 seconds.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 121000,
    request_key := 'd1200000-0000-4000-8000-000000000002',
    audience := 'family'
  )$$,
  '22023',
  'Video moment could not be prepared',
  'a clip of 121 seconds is rejected'
);

select * from finish();

rollback;
