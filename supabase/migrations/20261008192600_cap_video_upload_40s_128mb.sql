-- Tighten video reserves to fit Supabase Free storage pressure:
-- - duration cap: 40 seconds (40000 ms)
-- - stored size backstop: 128 MiB (134217728 bytes)
--
-- Existing production rows already include a few older videos above these caps.
-- Add NOT VALID constraints so historical rows keep working while new writes
-- are enforced immediately.

alter table private.video_upload_requests
  drop constraint if exists video_upload_requests_size_valid,
  drop constraint if exists video_upload_requests_duration_valid;

alter table public.moment_videos
  drop constraint if exists moment_videos_size_valid,
  drop constraint if exists moment_videos_duration_valid;

alter table private.video_upload_requests
  add constraint video_upload_requests_size_cap_128mb check (
    expected_size_bytes between 1 and 134217728
  ) not valid;

alter table private.video_upload_requests
  add constraint video_upload_requests_duration_cap_40s check (
    duration_ms between 1 and 40000
  ) not valid;

alter table public.moment_videos
  add constraint moment_videos_size_cap_128mb check (
    size_bytes between 1 and 134217728
  ) not valid;

alter table public.moment_videos
  add constraint moment_videos_duration_cap_40s check (
    duration_ms between 1 and 40000
  ) not valid;

update storage.buckets
   set file_size_limit = 134217728
 where id = 'our-days-videos';

create or replace function private.reserve_video_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_expected_mime_type text,
  requested_expected_size_bytes bigint,
  requested_duration_ms integer,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_request_key uuid default null,
  requested_audience text default null,
  requested_existing_moment_id uuid default null
)
returns table (
  request_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, upload_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_mime_type text := lower(btrim(requested_expected_mime_type));
  normalized_tags uuid[] := '{}'::uuid[];
  normalized_audience text := coalesce(requested_audience, 'family');
  payload_hash bytea;
  existing private.video_upload_requests%rowtype;
  generated_request_id uuid;
  created private.video_upload_requests%rowtype;
  attach_to_existing boolean := requested_existing_moment_id is not null;
  target_insight public.moments%rowtype;
  effective_journal_person_id uuid;
  effective_moment_id uuid;
  effective_occurred_on date;
  effective_occurred_at timestamptz;
  effective_occurred_timezone text;
  effective_time_precision text;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_request_key is null
    or normalized_mime_type not in (
      'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'
    )
    or requested_expected_size_bytes is null
    or requested_expected_size_bytes not between 1 and 134217728
    or requested_duration_ms is null
    or requested_duration_ms not between 1 and 40000 then
    raise exception using errcode = '22023',
      message = 'Video moment could not be prepared';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Video moment could not be prepared';
  end if;

  select circle.time_zone into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id for update;
  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active' for update;

  if actor_membership_id is null
    or circle_time_zone is null
    or not (select private.current_family_session_is_live()) then
    raise exception using errcode = '42501',
      message = 'Video moment could not be prepared';
  end if;

  if attach_to_existing then
    if requested_journal_person_id is not null then
      raise exception using errcode = '22023',
        message = 'Video moment could not be prepared';
    end if;

    select moment.* into target_insight
      from public.moments as moment
     where moment.id = requested_existing_moment_id
       and moment.circle_id = requested_circle_id
       and moment.kind = 'insight'
       and moment.trashed_at is null
     for update;

    if target_insight.id is null
      or not (select private.is_circle_organizer(requested_circle_id)) then
      raise exception using errcode = '42501',
        message = 'Video moment could not be prepared';
    end if;

    normalized_body := target_insight.body;
    normalized_place_name := target_insight.place_name;
    normalized_audience := target_insight.audience;
    effective_journal_person_id := null;
    effective_moment_id := target_insight.id;
    effective_occurred_on := target_insight.occurred_on;
    effective_occurred_at := target_insight.occurred_at;
    effective_occurred_timezone := target_insight.occurred_timezone;
    effective_time_precision := target_insight.time_precision;

    payload_hash := extensions.digest(jsonb_build_object(
      'circle_id', requested_circle_id,
      'moment_id', target_insight.id,
      'mime_type', normalized_mime_type,
      'size_bytes', requested_expected_size_bytes,
      'duration_ms', requested_duration_ms
    )::text, 'sha256');
  else
    if requested_journal_person_id is null
      or requested_occurred_on is null
      or normalized_audience not in ('family', 'just_me')
      or ((requested_occurred_at is null) <>
        (requested_occurred_timezone is null)) then
      raise exception using errcode = '22023',
        message = 'Video moment could not be prepared';
    end if;

    select coalesce(array_agg(tagged.person_id order by tagged.person_id),
      '{}'::uuid[])
      into normalized_tags
      from unnest(coalesce(
        requested_tagged_person_ids, '{}'::uuid[]
      )) as tagged(person_id);

    if not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    ))
      or not (select private.just_me_journal_is_recorder(
        requested_circle_id, requested_journal_person_id, normalized_audience
      ))
      or not (select private.tags_are_valid(
        requested_circle_id, requested_journal_person_id, normalized_tags
      ))
      or char_length(normalized_body) > 4000
      or (normalized_place_name is not null
        and char_length(normalized_place_name) not between 1 and 160)
      or requested_occurred_on > pg_catalog.timezone(
        circle_time_zone, statement_timestamp()
      )::date
      or (
        requested_occurred_timezone is not null
        and not (select private.is_valid_time_zone(requested_occurred_timezone))
      ) then
      raise exception using errcode = '42501',
        message = 'Video moment could not be prepared';
    end if;

    effective_journal_person_id := requested_journal_person_id;
    effective_moment_id := extensions.gen_random_uuid();
    effective_occurred_on := requested_occurred_on;
    effective_occurred_at := requested_occurred_at;
    effective_occurred_timezone := requested_occurred_timezone;
    effective_time_precision := case
      when requested_occurred_at is null then 'date'
      else 'minute'
    end;

    payload_hash := extensions.digest(jsonb_build_object(
      'circle_id', requested_circle_id,
      'journal_person_id', requested_journal_person_id,
      'body', normalized_body,
      'place_name', normalized_place_name,
      'tagged_person_ids', to_jsonb(normalized_tags),
      'occurred_on', requested_occurred_on,
      'occurred_at', requested_occurred_at,
      'occurred_timezone', requested_occurred_timezone,
      'mime_type', normalized_mime_type,
      'size_bytes', requested_expected_size_bytes,
      'duration_ms', requested_duration_ms,
      'audience', normalized_audience
    )::text, 'sha256');
  end if;

  select request.* into existing
    from private.video_upload_requests as request
   where request.requested_by_membership_id = actor_membership_id
     and request.request_key = requested_request_key
   for update;
  if existing.id is not null then
    if existing.request_payload_hash <> payload_hash then
      raise exception using errcode = '22023',
        message = 'Video upload request was reused';
    end if;
    return query select existing.id, existing.moment_id,
      'our-days-videos'::text, existing.object_path, existing.state,
      existing.upload_expires_at;
    return;
  end if;

  if attach_to_existing and exists (
    select 1
      from public.moment_videos as video
     where video.moment_id = effective_moment_id
  ) then
    raise exception using errcode = '22023',
      message = 'Video moment could not be prepared';
  end if;

  generated_request_id := extensions.gen_random_uuid();
  insert into private.video_upload_requests (
    id, circle_id, journal_person_id, requested_by_membership_id,
    request_key, moment_id, object_path, expected_mime_type,
    expected_size_bytes, duration_ms, body, place_name, occurred_on,
    occurred_at, occurred_timezone, time_precision, request_payload_hash,
    upload_expires_at, audience
  ) values (
    generated_request_id, requested_circle_id, effective_journal_person_id,
    actor_membership_id, requested_request_key, effective_moment_id,
    'video/' || generated_request_id::text, normalized_mime_type,
    requested_expected_size_bytes, requested_duration_ms, normalized_body,
    normalized_place_name, effective_occurred_on, effective_occurred_at,
    effective_occurred_timezone, effective_time_precision, payload_hash,
    statement_timestamp() + interval '2 hours', normalized_audience
  ) returning * into created;

  if not attach_to_existing then
    insert into private.video_upload_request_people (
      circle_id, request_id, person_id
    )
    select requested_circle_id, created.id, tagged.person_id
      from unnest(normalized_tags) as tagged(person_id);
  end if;

  return query select created.id, created.moment_id,
    'our-days-videos'::text, created.object_path, created.state,
    created.upload_expires_at;
end;
$$;

create or replace function public.reserve_video_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  expected_mime_type text,
  expected_size_bytes bigint,
  duration_ms integer,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  request_key uuid default null,
  audience text default null,
  circle_ids uuid[] default null,
  existing_moment_id uuid default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns table (
  request_id uuid,
  moment_id uuid,
  bucket_id text,
  object_path text,
  state text,
  upload_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  reserved record;
begin
  if duration_ms is null
    or duration_ms not between 1 and 40000
    or expected_size_bytes is null
    or expected_size_bytes not between 1 and 134217728 then
    raise exception using errcode = '22023',
      message = 'Video moment could not be prepared';
  end if;

  select * into reserved
  from private.reserve_video_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
    occurred_at, occurred_timezone, request_key, audience, existing_moment_id
  );
  if reserved.request_id is not null and existing_moment_id is null then
    perform private.store_media_request_circle_ids(
      'video', reserved.request_id, circle_ids
    );
  end if;
  if coalesce(cardinality(mentioned_user_ids), 0) > 0
    and existing_moment_id is null
    and reserved.moment_id is not null then
    perform private.stage_media_mentions(
      'video', reserved.request_id, mentioned_user_ids, mention_starts,
      mention_ends, btrim(body)
    );
  end if;
  return query
  select reserved.request_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.upload_expires_at;
end;
$$;

revoke all on function private.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid
) to authenticated;

revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) from public, anon;

grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) to authenticated;

notify pgrst, 'reload schema';
