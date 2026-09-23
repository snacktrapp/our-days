-- Insights may carry one optional short private clip using the existing
-- reserve -> upload -> finalize video pipeline.

alter table private.video_upload_requests
  alter column journal_person_id drop not null;

create or replace function private.video_requester_is_authorized(
  requested_request_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.video_upload_requests as request
      join public.circle_memberships as membership
        on membership.circle_id = request.circle_id
       and membership.id = request.requested_by_membership_id
     where request.id = requested_request_id
       and membership.status = 'active'
       and membership.user_id = (select auth.uid())
       and not (select private.account_closure_is_blocking(membership.user_id))
       and (select private.current_family_session_is_live())
       and (
         (
           request.journal_person_id is not null
           and (select private.can_manage_person(
             request.circle_id, request.journal_person_id
           ))
         )
         or (
           request.journal_person_id is null
           and (select private.is_circle_organizer(request.circle_id))
         )
       )
  );
$$;

drop function if exists private.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text
);
drop function if exists public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[]
);

create function private.reserve_video_moment(
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
    or requested_expected_size_bytes not between 1 and 104857600
    or requested_duration_ms is null
    or requested_duration_ms not between 1 and 60500 then
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
        and not exists (
          select 1
            from pg_catalog.pg_timezone_names as zone
           where zone.name = requested_occurred_timezone
        )
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

create function public.reserve_video_moment(
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
  existing_moment_id uuid default null
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
  select * into reserved
    from private.reserve_video_moment(
      circle_id,
      journal_person_id,
      body,
      place_name,
      tagged_person_ids,
      occurred_on,
      expected_mime_type,
      expected_size_bytes,
      duration_ms,
      occurred_at,
      occurred_timezone,
      request_key,
      audience,
      existing_moment_id
    );
  if reserved.request_id is not null and existing_moment_id is null then
    perform private.store_media_request_circle_ids(
      'video',
      reserved.request_id,
      circle_ids
    );
  end if;
  return query select
    reserved.request_id,
    reserved.moment_id,
    reserved.bucket_id,
    reserved.object_path,
    reserved.state,
    reserved.upload_expires_at;
end;
$$;

create or replace function private.finalize_video_moment(requested_request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target private.video_upload_requests%rowtype;
  stored_object storage.objects%rowtype;
  existing_moment public.moments%rowtype;
begin
  select request.* into target
    from private.video_upload_requests as request
   where request.id = requested_request_id
   for update;

  if target.id is null
    or not (select private.video_requester_is_authorized(target.id)) then
    raise exception using errcode = '42501',
      message = 'Video moment could not be finished';
  end if;
  if target.state = 'published' then return target.moment_id; end if;
  if target.state <> 'upload_claimed'
    or target.upload_expires_at <= statement_timestamp() then
    raise exception using errcode = '22023',
      message = 'Video moment could not be finished';
  end if;

  select object.* into stored_object
    from storage.objects as object
   where object.bucket_id = 'our-days-videos'
     and object.name = target.object_path;

  if stored_object.id is null
    or stored_object.owner_id is distinct from (select auth.uid()::text)
    or stored_object.user_metadata is distinct from jsonb_build_object(
      'video_request_id', target.id::text,
      'request_key', target.request_key::text,
      'expected_mime_type', target.expected_mime_type,
      'expected_size_bytes', target.expected_size_bytes,
      'duration_ms', target.duration_ms
    )
    or stored_object.metadata ->> 'mimetype' is distinct from
      target.expected_mime_type
    or stored_object.metadata ->> 'size' is distinct from
      target.expected_size_bytes::text then
    raise exception using errcode = '22023',
      message = 'Video moment could not be finished';
  end if;

  if target.journal_person_id is null then
    select moment.* into existing_moment
      from public.moments as moment
     where moment.circle_id = target.circle_id
       and moment.id = target.moment_id
       and moment.kind = 'insight'
       and moment.trashed_at is null
     for update;
    if existing_moment.id is null then
      raise exception using errcode = '42501',
        message = 'Video moment could not be finished';
    end if;
  else
    insert into public.moments (
      id, circle_id, journal_person_id, recorded_by_membership_id, kind,
      title, body, place_name, occurred_on, occurred_at,
      occurred_timezone, time_precision
    ) values (
      target.moment_id, target.circle_id, target.journal_person_id,
      target.requested_by_membership_id, 'video', null, target.body,
      target.place_name, target.occurred_on, target.occurred_at,
      target.occurred_timezone, target.time_precision
    );

    insert into public.moment_people (
      circle_id, moment_id, person_id, tagged_by_membership_id
    )
    select target.circle_id, target.moment_id, tagged.person_id,
      target.requested_by_membership_id
      from private.video_upload_request_people as tagged
     where tagged.circle_id = target.circle_id
       and tagged.request_id = target.id;
  end if;

  insert into public.moment_videos (
    circle_id, moment_id, upload_request_id, object_path, mime_type,
    size_bytes, duration_ms, storage_object_id, storage_object_version
  ) values (
    target.circle_id, target.moment_id, target.id, target.object_path,
    target.expected_mime_type, target.expected_size_bytes,
    target.duration_ms, stored_object.id, coalesce(stored_object.version, '')
  );

  update private.video_upload_requests as request
     set state = 'published', published_at = statement_timestamp()
   where request.id = target.id;

  if target.journal_person_id is not null then
    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      target.circle_id, target.requested_by_membership_id,
      'moment_created', 'moment', target.moment_id
    );
  end if;
  return target.moment_id;
exception
  when unique_violation then
    if exists (
      select 1 from public.moment_videos as video
       where video.moment_id = target.moment_id
    ) then return target.moment_id; end if;
    raise;
end;
$$;

drop policy if exists moment_videos_select_live_active_circle
  on public.moment_videos;

create policy moment_videos_select_live_active_circle
on public.moment_videos for select to authenticated
using (
  (select private.current_family_session_is_live())
  and exists (
    select 1
      from public.moments as moment
     where moment.circle_id = moment_videos.circle_id
       and moment.id = moment_videos.moment_id
       and moment.kind in ('video', 'insight')
       and moment.trashed_at is null
       and (select private.can_read_live_moment(moment.id))
  )
);

create or replace function private.get_video_moment_delivery(requested_moment_id uuid)
returns table (
  bucket_id text, object_path text, mime_type text, size_bytes bigint,
  duration_ms integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select video.bucket_id, video.object_path, video.mime_type,
    video.size_bytes, video.duration_ms
  from public.moment_videos as video
  join public.moments as moment
    on moment.circle_id = video.circle_id and moment.id = video.moment_id
  join storage.objects as object
    on object.bucket_id = video.bucket_id
   and object.name = video.object_path
   and object.id = video.storage_object_id
   and coalesce(object.version, '') = video.storage_object_version
  where video.moment_id = requested_moment_id
    and moment.kind in ('video', 'insight')
    and moment.trashed_at is null
    and (select private.current_family_session_is_live())
    and (select private.can_read_live_moment(moment.id))
    and object.metadata ->> 'mimetype' = video.mime_type
    and object.metadata ->> 'size' = video.size_bytes::text;
$$;

create or replace function private.video_object_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moment_videos as video
      join public.moments as moment
        on moment.circle_id = video.circle_id
       and moment.id = video.moment_id
     where video.object_path = requested_object_path
       and moment.kind in ('video', 'insight')
       and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.can_read_live_moment(moment.id))
  )
  or exists (
    select 1
      from public.moment_video_posters as poster
      join public.moments as moment
        on moment.circle_id = poster.circle_id
       and moment.id = poster.moment_id
     where poster.object_path = requested_object_path
       and moment.kind in ('video', 'insight')
       and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.can_read_live_moment(moment.id))
  );
$$;

drop policy if exists moment_video_posters_select_live_active_circle
  on public.moment_video_posters;

create policy moment_video_posters_select_live_active_circle
on public.moment_video_posters for select to authenticated
using (
  (select private.current_family_session_is_live())
  and exists (
    select 1 from public.moments as moment
     where moment.circle_id = moment_video_posters.circle_id
       and moment.id = moment_video_posters.moment_id
       and moment.kind in ('video', 'insight')
       and moment.trashed_at is null
       and (select private.can_read_live_moment(moment.id))
  )
);

create or replace function private.video_poster_path_is_uploadable(
  requested_object_path text,
  requested_owner_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_moment_id uuid;
begin
  if (select auth.uid()) is null
    or requested_owner_id is distinct from (select auth.uid()::text) then
    return false;
  end if;
  if requested_object_path !~ '^poster/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return false;
  end if;
  target_moment_id := substring(requested_object_path from 8)::uuid;

  return exists (
    select 1
      from public.moment_videos as video
      join public.moments as moment
        on moment.circle_id = video.circle_id
       and moment.id = video.moment_id
      join public.circle_memberships as membership
        on membership.circle_id = video.circle_id
       and membership.user_id = (select auth.uid())
       and membership.status = 'active'
     where video.moment_id = target_moment_id
       and moment.kind in ('video', 'insight')
       and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.can_read_live_moment(moment.id))
       and not (select private.account_closure_is_blocking(membership.user_id))
       and not exists (
         select 1
           from public.moment_video_posters as poster
          where poster.moment_id = target_moment_id
       )
  );
end;
$$;

create or replace function private.attach_video_moment_poster(
  requested_moment_id uuid,
  requested_width_px integer,
  requested_height_px integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_video public.moment_videos%rowtype;
  stored_object storage.objects%rowtype;
  actor_membership_id uuid;
  object_size bigint;
begin
  if (select auth.uid()) is null
    or requested_moment_id is null
    or requested_width_px is null
    or requested_height_px is null
    or requested_width_px < 1
    or requested_height_px < 1
    or requested_width_px > 7680
    or requested_height_px > 7680 then
    raise exception using errcode = '22023',
      message = 'Video poster could not be saved';
  end if;

  if exists (
    select 1
      from public.moment_video_posters as poster
     where poster.moment_id = requested_moment_id
  ) then
    return true;
  end if;

  select video.* into target_video
    from public.moment_videos as video
    join public.moments as moment
      on moment.circle_id = video.circle_id
     and moment.id = video.moment_id
   where video.moment_id = requested_moment_id
     and moment.kind in ('video', 'insight')
     and moment.trashed_at is null
   for update of video;

  if target_video.moment_id is null then
    raise exception using errcode = '42501',
      message = 'Video poster could not be saved';
  end if;

  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = target_video.circle_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
     and (select private.current_family_session_is_live())
     and not (select private.account_closure_is_blocking(membership.user_id));

  if actor_membership_id is null
    or not (select private.can_read_live_moment(target_video.moment_id)) then
    raise exception using errcode = '42501',
      message = 'Video poster could not be saved';
  end if;

  select object.* into stored_object
    from storage.objects as object
   where object.bucket_id = 'our-days-videos'
     and object.name = 'poster/' || requested_moment_id::text;

  if stored_object.id is null
    or stored_object.owner_id is distinct from (select auth.uid()::text) then
    raise exception using errcode = '22023',
      message = 'Video poster could not be saved';
  end if;

  object_size := nullif(stored_object.metadata ->> 'size', '')::bigint;
  if object_size is null
    or object_size < 1
    or object_size > 2097152
    or coalesce(stored_object.metadata ->> 'mimetype', '') is distinct from
      'image/jpeg' then
    raise exception using errcode = '22023',
      message = 'Video poster could not be saved';
  end if;

  insert into public.moment_video_posters (
    circle_id,
    moment_id,
    object_path,
    mime_type,
    size_bytes,
    width_px,
    height_px,
    storage_object_id,
    storage_object_version,
    created_by_membership_id
  ) values (
    target_video.circle_id,
    target_video.moment_id,
    'poster/' || requested_moment_id::text,
    'image/jpeg',
    object_size,
    requested_width_px,
    requested_height_px,
    stored_object.id,
    coalesce(stored_object.version, ''),
    actor_membership_id
  )
  on conflict (moment_id) do nothing;

  return true;
exception
  when unique_violation then
    return true;
end;
$$;

create or replace function private.get_video_moment_poster_delivery(
  requested_moment_id uuid
)
returns table (
  bucket_id text,
  object_path text,
  mime_type text,
  size_bytes bigint,
  width_px integer,
  height_px integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    poster.bucket_id,
    poster.object_path,
    poster.mime_type,
    poster.size_bytes,
    poster.width_px,
    poster.height_px
  from public.moment_video_posters as poster
  join public.moments as moment
    on moment.circle_id = poster.circle_id
   and moment.id = poster.moment_id
  join storage.objects as object
    on object.bucket_id = poster.bucket_id
   and object.name = poster.object_path
   and object.id = poster.storage_object_id
   and coalesce(object.version, '') = poster.storage_object_version
  where poster.moment_id = requested_moment_id
    and moment.kind in ('video', 'insight')
    and moment.trashed_at is null
    and (select private.current_family_session_is_live())
    and (select private.can_read_live_moment(moment.id))
    and object.metadata ->> 'mimetype' = poster.mime_type
    and object.metadata ->> 'size' = poster.size_bytes::text;
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
  text, uuid, text, uuid[], uuid
) from public, anon, authenticated, service_role;
grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid
) to authenticated;
