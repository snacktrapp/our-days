begin;

select no_plan();

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values (
  '72000000-0000-4000-8000-000000000091',
  '10000000-0000-4000-8000-000000000001',
  statement_timestamp(),
  statement_timestamp(),
  statement_timestamp() + interval '1 day'
);

update private.photo_capabilities
   set enabled = true, updated_at = statement_timestamp()
 where capability = 'photo_publication';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000091"}',
  true
);
select set_config(
  'request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true
);

select lives_ok(
  $$select * from public.reserve_photo_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A photo with no mention argument.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    request_key := 'd9100000-0000-4000-8000-000000000001',
    audience := 'family',
    mentioned_user_ids := null,
    mention_starts := null,
    mention_ends := null
  )$$,
  'family photo reserve accepts null mentions'
);

select lives_ok(
  $$select * from public.reserve_photo_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A photo with an empty mention list.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    request_key := 'd9100000-0000-4000-8000-000000000002',
    audience := 'family',
    mentioned_user_ids := '{}'::uuid[],
    mention_starts := '{}'::integer[],
    mention_ends := '{}'::integer[]
  )$$,
  'family photo reserve accepts empty mentions'
);

select * from public.reserve_photo_moment(
  circle_id := '20000000-0000-4000-8000-000000000001',
  journal_person_id := '30000000-0000-4000-8000-000000000001',
  body := '@A Organizer Two came along',
  place_name := null,
  tagged_person_ids := '{}'::uuid[],
  occurred_on := '2026-08-29',
  request_key := 'd9100000-0000-4000-8000-000000000003',
  audience := 'family',
  mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
  mention_starts := array[0]::integer[],
  mention_ends := array[16]::integer[]
) \gset family_photo_

select ok(
  :'family_photo_moment_id' is not null,
  'family photo reserve with a mention returns the preallocated moment id'
);

select lives_ok(
  $$select * from public.reserve_photo_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Just me, no mentions.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    request_key := 'd9100000-0000-4000-8000-000000000004',
    audience := 'just_me',
    mentioned_user_ids := null
  )$$,
  'just me photo reserve accepts null mentions'
);

select lives_ok(
  $$select * from public.reserve_photo_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Just me, empty mentions.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    request_key := 'd9100000-0000-4000-8000-000000000005',
    audience := 'just_me',
    mentioned_user_ids := '{}'::uuid[],
    mention_starts := '{}'::integer[],
    mention_ends := '{}'::integer[]
  )$$,
  'just me photo reserve accepts empty mentions'
);

select throws_ok(
  $$select * from public.reserve_photo_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := '@A Organizer Two came along',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    request_key := 'd9100000-0000-4000-8000-000000000006',
    audience := 'just_me',
    mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
    mention_starts := array[0]::integer[],
    mention_ends := array[16]::integer[]
  )$$,
  '22023',
  'Mention could not be saved',
  'just me photo reserve rejects a real mention'
);

select lives_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A video with no mention argument.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 1000,
    request_key := 'd9100000-0000-4000-8000-000000000011',
    audience := 'family',
    mentioned_user_ids := null
  )$$,
  'family video reserve accepts null mentions'
);

select lives_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'A video with an empty mention list.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 1000,
    request_key := 'd9100000-0000-4000-8000-000000000012',
    audience := 'family',
    mentioned_user_ids := '{}'::uuid[],
    mention_starts := '{}'::integer[],
    mention_ends := '{}'::integer[]
  )$$,
  'family video reserve accepts empty mentions'
);

select * from public.reserve_video_moment(
  circle_id := '20000000-0000-4000-8000-000000000001',
  journal_person_id := '30000000-0000-4000-8000-000000000001',
  body := '@A Organizer Two came along',
  place_name := null,
  tagged_person_ids := '{}'::uuid[],
  occurred_on := '2026-08-29',
  expected_mime_type := 'video/mp4',
  expected_size_bytes := 1000,
  duration_ms := 1000,
  request_key := 'd9100000-0000-4000-8000-000000000013',
  audience := 'family',
  mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
  mention_starts := array[0]::integer[],
  mention_ends := array[16]::integer[]
) \gset family_video_

select ok(
  :'family_video_moment_id' is not null,
  'family video reserve with a mention returns the preallocated moment id'
);

select lives_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Just me video.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 1000,
    request_key := 'd9100000-0000-4000-8000-000000000014',
    audience := 'just_me',
    mentioned_user_ids := null
  )$$,
  'just me video reserve accepts null mentions'
);

select lives_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Just me video, empty mentions.',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 1000,
    request_key := 'd9100000-0000-4000-8000-000000000015',
    audience := 'just_me',
    mentioned_user_ids := '{}'::uuid[],
    mention_starts := '{}'::integer[],
    mention_ends := '{}'::integer[]
  )$$,
  'just me video reserve accepts empty mentions'
);

select throws_ok(
  $$select * from public.reserve_video_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := '@A Organizer Two came along',
    place_name := null,
    tagged_person_ids := '{}'::uuid[],
    occurred_on := '2026-08-29',
    expected_mime_type := 'video/mp4',
    expected_size_bytes := 1000,
    duration_ms := 1000,
    request_key := 'd9100000-0000-4000-8000-000000000016',
    audience := 'just_me',
    mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
    mention_starts := array[0]::integer[],
    mention_ends := array[16]::integer[]
  )$$,
  '22023',
  'Mention could not be saved',
  'just me video reserve rejects a real mention'
);

select lives_ok(
  $$select public.create_written_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Written, null mentions.',
    occurred_on := '2026-08-29',
    audience := 'family',
    mentioned_user_ids := null
  )$$,
  'family written moment accepts null mentions'
);

select lives_ok(
  $$select public.create_written_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Written, empty mentions.',
    occurred_on := '2026-08-29',
    audience := 'family',
    mentioned_user_ids := '{}'::uuid[],
    mention_starts := '{}'::integer[],
    mention_ends := '{}'::integer[]
  )$$,
  'family written moment accepts empty mentions'
);

select public.create_written_moment(
  circle_id := '20000000-0000-4000-8000-000000000001',
  journal_person_id := '30000000-0000-4000-8000-000000000001',
  body := '@A Organizer Two came along',
  occurred_on := '2026-08-29',
  audience := 'family',
  mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
  mention_starts := array[0]::integer[],
  mention_ends := array[16]::integer[]
) as family_written_id \gset

select ok(
  :'family_written_id' is not null,
  'family written moment accepts a valid mention'
);

select lives_ok(
  $$select public.create_written_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := 'Just me written.',
    occurred_on := '2026-08-29',
    audience := 'just_me',
    mentioned_user_ids := null
  )$$,
  'just me written moment accepts null mentions'
);

select public.create_written_moment(
  circle_id := '20000000-0000-4000-8000-000000000001',
  journal_person_id := '30000000-0000-4000-8000-000000000001',
  body := 'Just me written, empty mentions.',
  occurred_on := '2026-08-29',
  audience := 'just_me',
  mentioned_user_ids := '{}'::uuid[],
  mention_starts := '{}'::integer[],
  mention_ends := '{}'::integer[]
) as just_me_written_id \gset

select ok(
  :'just_me_written_id' is not null,
  'just me written moment accepts empty mentions'
);

select throws_ok(
  $$select public.create_written_moment(
    circle_id := '20000000-0000-4000-8000-000000000001',
    journal_person_id := '30000000-0000-4000-8000-000000000001',
    body := '@A Organizer Two came along',
    occurred_on := '2026-08-29',
    audience := 'just_me',
    mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
    mention_starts := array[0]::integer[],
    mention_ends := array[16]::integer[]
  )$$,
  '22023',
  'Mention could not be saved',
  'just me written moment rejects a real mention'
);

select lives_ok(
  $$select public.create_moment_note(
    moment_id := '60000000-0000-4000-8000-000000000001',
    body := 'A family note with null mentions.',
    mentioned_user_ids := null
  )$$,
  'family note accepts null mentions'
);

select lives_ok(
  $$select public.create_moment_note(
    moment_id := '60000000-0000-4000-8000-000000000001',
    body := 'A family note with empty mentions.',
    mentioned_user_ids := '{}'::uuid[],
    mention_starts := '{}'::integer[],
    mention_ends := '{}'::integer[]
  )$$,
  'family note accepts empty mentions'
);

select public.create_moment_note(
  moment_id := '60000000-0000-4000-8000-000000000001',
  body := '@A Organizer Two came along',
  mentioned_user_ids := array['10000000-0000-4000-8000-000000000002']::uuid[],
  mention_starts := array[0]::integer[],
  mention_ends := array[16]::integer[]
) as family_note_id \gset

select ok(
  :'family_note_id' is not null,
  'family note accepts a valid mention'
);

select lives_ok(
  format(
    'select public.create_moment_note(moment_id := %L, body := %L, mentioned_user_ids := null)',
    :'just_me_written_id',
    'A just me note with null mentions.'
  ),
  'just me note accepts null mentions'
);

select lives_ok(
  format(
    'select public.create_moment_note(moment_id := %L, body := %L, mentioned_user_ids := ''{}''::uuid[], mention_starts := ''{}''::integer[], mention_ends := ''{}''::integer[])',
    :'just_me_written_id',
    'A just me note with empty mentions.'
  ),
  'just me note accepts empty mentions'
);

select throws_ok(
  format(
    'select public.create_moment_note(moment_id := %L, body := %L, mentioned_user_ids := array[%L]::uuid[], mention_starts := array[0]::integer[], mention_ends := array[16]::integer[])',
    :'just_me_written_id',
    '@A Organizer Two came along',
    '10000000-0000-4000-8000-000000000002'
  ),
  '22023',
  'Mention could not be saved',
  'just me note rejects a real mention'
);

reset role;

select is(
  (select count(*)::bigint from public.moments
    where id = :'family_photo_moment_id'::uuid),
  0::bigint,
  'a mentioned photo reserve does not require the moment row yet'
);

select is(
  (select mentioned_user_ids from private.photo_moment_requests
    where request_key = 'd9100000-0000-4000-8000-000000000003'),
  array['10000000-0000-4000-8000-000000000002']::uuid[],
  'a family photo mention is staged on the request'
);

select is(
  (select mentioned_user_ids from private.photo_moment_requests
    where request_key = 'd9100000-0000-4000-8000-000000000002'),
  null,
  'an empty photo mention list is not staged'
);

select is(
  (select mentioned_user_ids from private.video_upload_requests
    where request_key = 'd9100000-0000-4000-8000-000000000013'),
  array['10000000-0000-4000-8000-000000000002']::uuid[],
  'a family video mention is staged on the request'
);

insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_membership_id, kind,
  body, occurred_on, time_precision
)
select request.moment_id, request.circle_id, request.journal_person_id,
  request.requested_by_membership_id, 'photo', request.body, request.occurred_on,
  request.time_precision
from private.photo_moment_requests as request
where request.request_key = 'd9100000-0000-4000-8000-000000000003';

select private.attach_staged_moment_mentions(:'family_photo_moment_id'::uuid);

select is(
  (select count(*)::bigint from public.content_mentions
    where moment_id = :'family_photo_moment_id'::uuid
      and note_id is null
      and removed_at is null
      and mentioned_user_id = '10000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a staged photo mention is written after the moment row exists'
);

insert into public.moments (
  id, circle_id, journal_person_id, recorded_by_membership_id, kind,
  body, occurred_on, time_precision
)
select request.moment_id, request.circle_id, request.journal_person_id,
  request.requested_by_membership_id, 'video', request.body, request.occurred_on,
  request.time_precision
from private.video_upload_requests as request
where request.request_key = 'd9100000-0000-4000-8000-000000000013';

select private.attach_staged_moment_mentions(:'family_video_moment_id'::uuid);

select is(
  (select count(*)::bigint from public.content_mentions
    where moment_id = :'family_video_moment_id'::uuid
      and note_id is null
      and removed_at is null
      and mentioned_user_id = '10000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a staged video mention is written after the moment row exists'
);

select is(
  (select count(*)::bigint from public.content_mentions
    where moment_id = :'family_written_id'::uuid
      and removed_at is null
      and mentioned_user_id = '10000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a family written mention is saved with the moment'
);

select is(
  (select count(*)::bigint from public.content_mentions
    where note_id = :'family_note_id'::uuid
      and removed_at is null
      and mentioned_user_id = '10000000-0000-4000-8000-000000000002'),
  1::bigint,
  'a family note mention is saved with the note'
);

select * from finish();
rollback;
