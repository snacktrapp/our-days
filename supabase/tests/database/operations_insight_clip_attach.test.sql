begin;

select plan(20);

select ok(
  not has_function_privilege(
    'anon',
    'private.operations_can_manage_member_insight(uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.operations_can_manage_member_insight(uuid)',
    'execute'
  ),
  'only authenticated callers can execute the Operations insight helper'
);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values (
  '10000000-0000-4000-8000-000000000008',
  'tars-ops@example.test',
  statement_timestamp(),
  '{}'
);

insert into public.people (
  id, circle_id, display_name, profile_kind, accent_token, created_by_membership_id
) values (
  '30000000-0000-4000-8000-000000000010',
  '20000000-0000-4000-8000-000000000001',
  'Circle Operations',
  'account',
  'plum',
  '40000000-0000-4000-8000-000000000001'
);

insert into public.circle_memberships (
  id, circle_id, user_id, person_id, role, directory_kind, status
) values (
  '40000000-0000-4000-8000-000000000008',
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000008',
  '30000000-0000-4000-8000-000000000010',
  'organizer',
  'operations',
  'active'
);

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
values
  (
    '72000000-0000-4000-8000-000000000041',
    '10000000-0000-4000-8000-000000000008',
    statement_timestamp(), statement_timestamp(),
    statement_timestamp() + interval '1 day'
  ),
  (
    '72000000-0000-4000-8000-000000000042',
    '10000000-0000-4000-8000-000000000003',
    statement_timestamp(), statement_timestamp(),
    statement_timestamp() + interval '1 day'
  ),
  (
    '72000000-0000-4000-8000-000000000043',
    '10000000-0000-4000-8000-000000000002',
    statement_timestamp(), statement_timestamp(),
    statement_timestamp() + interval '1 day'
  ),
  (
    '72000000-0000-4000-8000-000000000044',
    '10000000-0000-4000-8000-000000000001',
    statement_timestamp(), statement_timestamp(),
    statement_timestamp() + interval '1 day'
  );

insert into private.operations_just_me_insight_consent (user_id)
values ('10000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000041"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select public.create_just_me_insight_for_member(
  '20000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000003',
  'A clip still belongs to the member.',
  'Member journal',
  null,
  '2026-08-28'
) as ops_insight_id \gset

select ok(
  :'ops_insight_id' is not null,
  'Operations can create the Just me Insight used for the clip'
);

select is(
  (
    select count(*)::bigint
      from public.list_timeline_moments('20000000-0000-4000-8000-000000000001')
     where moment_id = :'ops_insight_id'::uuid
  ),
  0::bigint,
  'poster access does not put the member Insight on the Operations feed'
);

select is(
  private.can_read_live_moment(:'ops_insight_id'::uuid),
  false,
  'the global live-moment read stays closed for Operations'
);

select is(
  private.operations_can_manage_member_insight(:'ops_insight_id'::uuid),
  true,
  'Operations can manage the Just me Insight it created for a consenting member'
);

select * from public.reserve_video_moment(
  circle_id := '20000000-0000-4000-8000-000000000001',
  journal_person_id := null,
  body := '',
  place_name := null,
  tagged_person_ids := '{}'::uuid[],
  occurred_on := '2026-08-28',
  expected_mime_type := 'video/mp4',
  expected_size_bytes := 2233445,
  duration_ms := 17000,
  occurred_at := null,
  occurred_timezone := null,
  request_key := '71000000-0000-4000-8000-000000000081',
  audience := null,
  circle_ids := null,
  existing_moment_id := :'ops_insight_id'
) \gset clip_

select is(
  :'clip_moment_id'::uuid,
  :'ops_insight_id'::uuid,
  'Operations can reserve a clip on the Insight it created'
);

select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  '73000000-0000-4000-8000-000000000081',
  'our-days-videos',
  :'clip_object_path',
  '10000000-0000-4000-8000-000000000008',
  '{"mimetype":"video/mp4","size":"2233445"}'::jsonb,
  jsonb_build_object(
    'video_request_id', :'clip_request_id',
    'request_key', '71000000-0000-4000-8000-000000000081',
    'expected_mime_type', 'video/mp4',
    'expected_size_bytes', 2233445,
    'duration_ms', 17000
  )
);

select is(
  public.finalize_video_moment(:'clip_request_id'::uuid),
  :'ops_insight_id'::uuid,
  'Operations can finalize the clip on the Insight it created'
);

select set_config('storage.operation', 'object.upload', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  '73000000-0000-4000-8000-000000000082',
  'our-days-videos',
  'poster/' || :'ops_insight_id',
  '10000000-0000-4000-8000-000000000008',
  '{"mimetype":"image/jpeg","size":"5549"}'::jsonb,
  '{}'::jsonb
);

select is(
  private.video_poster_path_is_uploadable(
    ('poster/' || :'ops_insight_id')::text,
    '10000000-0000-4000-8000-000000000008'
  ),
  true,
  'Operations can pass the poster upload path check'
);

select ok(
  public.attach_video_moment_poster(:'ops_insight_id'::uuid, 1280, 720),
  'Operations can attach the poster it uploaded'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000002","session_id":"72000000-0000-4000-8000-000000000043"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);

select is(
  private.operations_can_manage_member_insight(:'ops_insight_id'::uuid),
  false,
  'another organizer cannot manage the Operations-created member Insight'
);

select is(
  private.video_poster_path_is_uploadable(
    ('poster/' || :'ops_insight_id')::text,
    '10000000-0000-4000-8000-000000000002'
  ),
  false,
  'another organizer cannot pass the poster upload path check'
);

select throws_ok(
  format(
    'select public.attach_video_moment_poster(%L::uuid, 1280, 720)',
    :'ops_insight_id'
  ),
  '42501',
  'Video poster could not be saved',
  'another organizer cannot attach a poster to the Operations-created member Insight'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000001","session_id":"72000000-0000-4000-8000-000000000044"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select public.create_insight_moment(
  '20000000-0000-4000-8000-000000000001',
  'This Just me Insight was written by the member.',
  'Member authored',
  null,
  '2026-08-28',
  null,
  null,
  'just_me',
  null
) as member_insight_id \gset

select * from public.reserve_video_moment(
  circle_id := '20000000-0000-4000-8000-000000000001',
  journal_person_id := null,
  body := '',
  place_name := null,
  tagged_person_ids := '{}'::uuid[],
  occurred_on := '2026-08-28',
  expected_mime_type := 'video/mp4',
  expected_size_bytes := 2233445,
  duration_ms := 17000,
  occurred_at := null,
  occurred_timezone := null,
  request_key := '71000000-0000-4000-8000-000000000082',
  audience := null,
  circle_ids := null,
  existing_moment_id := :'member_insight_id'
) \gset member_clip_

select set_config('storage.operation', 'storage.tus.upload.create', true);
insert into storage.objects (
  id, bucket_id, name, owner_id, metadata, user_metadata
) values (
  '73000000-0000-4000-8000-000000000083',
  'our-days-videos',
  :'member_clip_object_path',
  '10000000-0000-4000-8000-000000000001',
  '{"mimetype":"video/mp4","size":"2233445"}'::jsonb,
  jsonb_build_object(
    'video_request_id', :'member_clip_request_id',
    'request_key', '71000000-0000-4000-8000-000000000082',
    'expected_mime_type', 'video/mp4',
    'expected_size_bytes', 2233445,
    'duration_ms', 17000
  )
);

select public.finalize_video_moment(:'member_clip_request_id'::uuid);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000041"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select is(
  private.operations_can_manage_member_insight(:'member_insight_id'::uuid),
  false,
  'Operations cannot manage a member-authored Insight it did not create'
);

select is(
  private.video_poster_path_is_uploadable(
    ('poster/' || :'member_insight_id')::text,
    '10000000-0000-4000-8000-000000000008'
  ),
  false,
  'Operations cannot pass the poster path check on a member-authored Insight'
);

select throws_ok(
  format(
    'select public.attach_video_moment_poster(%L::uuid, 1280, 720)',
    :'member_insight_id'
  ),
  '42501',
  'Video poster could not be saved',
  'Operations cannot attach a poster to a member-authored Insight'
);

reset role;

delete from private.operations_just_me_insight_consent
 where user_id = '10000000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000041"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select is(
  private.operations_can_manage_member_insight(:'ops_insight_id'::uuid),
  false,
  'revoked consent closes the Operations insight helper'
);

select is(
  private.video_poster_path_is_uploadable(
    ('poster/' || :'ops_insight_id')::text,
    '10000000-0000-4000-8000-000000000008'
  ),
  false,
  'revoked consent closes the poster upload path'
);

select throws_ok(
  format(
    'select public.attach_video_moment_poster(%L::uuid, 960, 540)',
    :'ops_insight_id'
  ),
  '42501',
  'Video poster could not be saved',
  'revoked consent blocks attaching another poster'
);

reset role;

update public.moments
   set trashed_at = statement_timestamp(),
       trashed_by_membership_id = '40000000-0000-4000-8000-000000000003'
 where id = :'ops_insight_id'::uuid;

insert into private.operations_just_me_insight_consent (user_id)
values ('10000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-4000-8000-000000000008","session_id":"72000000-0000-4000-8000-000000000041"}',
  true
);
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000008', true);

select is(
  private.operations_can_manage_member_insight(:'ops_insight_id'::uuid),
  false,
  'a trashed moment is outside the Operations insight helper'
);

select is(
  private.operations_can_manage_member_insight(
    '60000000-0000-4000-8000-000000000004'::uuid
  ),
  false,
  'a non-insight moment is outside the Operations insight helper'
);

select * from finish();
rollback;
