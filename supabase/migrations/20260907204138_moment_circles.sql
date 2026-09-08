-- Multi-circle post audience: one moment can link to any combination of
-- circles the recorder belongs to. moments.circle_id stays the primary circle
-- (first selected / Home default) for journal, tags, notes, and media paths.
-- Home GROUP feeds read public.moment_circles. Just Me stays recorder-only
-- and never writes junction rows.

create table public.moment_circles (
  moment_id uuid not null references public.moments (id) on delete cascade,
  circle_id uuid not null references public.circles (id) on delete restrict,
  primary key (moment_id, circle_id)
);

create index moment_circles_circle_moment_idx
  on public.moment_circles (circle_id, moment_id);

alter table public.moment_circles enable row level security;

create policy moment_circles_select_active_member
on public.moment_circles for select to authenticated
using ((select private.is_active_circle_member(circle_id)));

revoke all on table public.moment_circles from public, anon;
grant select on table public.moment_circles to authenticated;

alter table private.photo_moment_requests
  add column circle_ids uuid[] not null default '{}';

alter table private.video_upload_requests
  add column circle_ids uuid[] not null default '{}';

create or replace function private.reject_photo_request_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Photo moment requests are immutable';
  end if;
  if to_jsonb(new) - 'circle_ids' is distinct from to_jsonb(old) - 'circle_ids' then
    raise exception using errcode = '42501',
      message = 'Photo moment requests are immutable';
  end if;
  return new;
end;
$$;

create function private.can_read_live_moment(requested_moment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moments as moment
     where moment.id = requested_moment_id
       and moment.trashed_at is null
       and (
         (
           moment.audience = 'just_me'
           and (select private.is_active_circle_member(moment.circle_id))
           and (select private.can_read_moment_audience(
             moment.circle_id,
             moment.audience,
             moment.recorded_by_membership_id
           ))
         )
         or (
           moment.audience = 'family'
           and exists (
             select 1
               from public.moment_circles as link
              where link.moment_id = moment.id
                and (select private.is_active_circle_member(link.circle_id))
           )
         )
       )
  );
$$;

create function private.link_additional_moment_circles(
  requested_moment_id uuid,
  requested_circle_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_audience text;
  requested uuid;
begin
  if requested_moment_id is null or requested_circle_ids is null then
    return;
  end if;
  select moment.audience into target_audience
    from public.moments as moment
   where moment.id = requested_moment_id;
  if target_audience is distinct from 'family' then
    return;
  end if;
  foreach requested in array requested_circle_ids
  loop
    if requested is null then
      continue;
    end if;
    if not (select private.is_active_circle_member(requested)) then
      raise exception using
        errcode = '42501',
        message = 'Moment could not be created';
    end if;
    insert into public.moment_circles (moment_id, circle_id)
    values (requested_moment_id, requested)
    on conflict do nothing;
  end loop;
end;
$$;

create function private.store_media_request_circle_ids(
  requested_kind text,
  requested_request_id uuid,
  requested_circle_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_audience text;
  requester_membership_id uuid;
  requested uuid;
  validated uuid[] := '{}';
begin
  if requested_request_id is null or requested_circle_ids is null then
    return;
  end if;
  if requested_kind = 'photo' then
    select request.audience, request.requested_by_membership_id
      into target_audience, requester_membership_id
      from private.photo_moment_requests as request
     where request.intake_id = requested_request_id;
  elsif requested_kind = 'video' then
    select request.audience, request.requested_by_membership_id
      into target_audience, requester_membership_id
      from private.video_upload_requests as request
     where request.id = requested_request_id;
  else
    return;
  end if;
  if requester_membership_id is null
    or not exists (
      select 1
        from public.circle_memberships as membership
       where membership.id = requester_membership_id
         and membership.user_id = (select auth.uid())
         and membership.status = 'active'
    ) then
    return;
  end if;
  if target_audience is distinct from 'family' then
    validated := '{}';
  else
    foreach requested in array requested_circle_ids
    loop
      if requested is null then
        continue;
      end if;
      if not (select private.is_active_circle_member(requested)) then
        raise exception using
          errcode = '42501',
          message = 'Moment could not be created';
      end if;
      if not (requested = any (validated)) then
        validated := array_append(validated, requested);
      end if;
    end loop;
  end if;
  if requested_kind = 'photo' then
    update private.photo_moment_requests
       set circle_ids = validated
     where intake_id = requested_request_id;
  else
    update private.video_upload_requests
       set circle_ids = validated
     where id = requested_request_id;
  end if;
end;
$$;

create function private.sync_moment_circle_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  extra_ids uuid[];
begin
  if new.audience is distinct from 'family' then
    delete from public.moment_circles where moment_id = new.id;
    return new;
  end if;

  insert into public.moment_circles (moment_id, circle_id)
  values (new.id, new.circle_id)
  on conflict do nothing;

  if tg_op = 'INSERT' and new.kind in ('photo', 'video') then
    if new.kind = 'photo' then
      select request.circle_ids into extra_ids
        from private.photo_moment_requests as request
       where request.moment_id = new.id
         and request.circle_id = new.circle_id
       order by request.requested_at desc
       limit 1;
    else
      select request.circle_ids into extra_ids
        from private.video_upload_requests as request
       where request.moment_id = new.id
         and request.circle_id = new.circle_id
       order by request.requested_at desc
       limit 1;
    end if;
    if extra_ids is not null then
      insert into public.moment_circles (moment_id, circle_id)
      select new.id, extra_id
        from unnest(extra_ids) as extra_id
       where extra_id is not null
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger moments_sync_circle_links
after insert or update of audience, circle_id on public.moments
for each row execute function private.sync_moment_circle_links();

insert into public.moment_circles (moment_id, circle_id)
select moment.id, moment.circle_id
  from public.moments as moment
 where moment.audience = 'family'
on conflict do nothing;

drop policy moments_select_live_active_circle on public.moments;

create policy moments_select_live_active_circle
on public.moments for select to authenticated
using (
  trashed_at is null
  and (select private.can_read_live_moment(id))
);

drop policy moment_photos_select_live_active_circle on public.moment_photos;

create policy moment_photos_select_live_active_circle
on public.moment_photos for select to authenticated
using (
  (select private.current_family_session_is_live())
  and exists (
    select 1
      from public.moments as moment
     where moment.circle_id = moment_photos.circle_id
       and moment.id = moment_photos.moment_id
       and moment.kind = 'photo'
       and moment.trashed_at is null
       and (select private.can_read_live_moment(moment.id))
  )
);

drop policy moment_videos_select_live_active_circle on public.moment_videos;

create policy moment_videos_select_live_active_circle
on public.moment_videos for select to authenticated
using (
  (select private.current_family_session_is_live())
  and exists (
    select 1
      from public.moments as moment
     where moment.circle_id = moment_videos.circle_id
       and moment.id = moment_videos.moment_id
       and moment.kind = 'video'
       and moment.trashed_at is null
       and (select private.can_read_live_moment(moment.id))
  )
);

-- CREATE OR REPLACE cannot change RETURNS TABLE. Drop both argument-name
-- spellings; they share one (uuid) identity. Recreate with the live
-- multi-photo OUT columns and only swap the readability check.
drop function if exists public.get_photo_moment_delivery(moment_id uuid);
drop function if exists public.get_photo_moment_delivery(requested_moment_id uuid);
drop function if exists private.get_photo_moment_delivery(requested_moment_id uuid);
drop function if exists private.get_photo_moment_delivery(moment_id uuid);

create function private.get_photo_moment_delivery(requested_moment_id uuid)
returns table (
  photo_id uuid, sort_order integer,
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select photo.id, photo.sort_order,
    derivative.bucket_id, derivative.object_path,
    derivative.output_mime_type, derivative.output_size_bytes,
    encode(derivative.output_sha256, 'hex'), derivative.output_width,
    derivative.output_height
  from public.moment_photos as photo
  join public.moments as moment
    on moment.circle_id = photo.circle_id and moment.id = photo.moment_id
  join private.photo_display_derivatives as derivative
    on derivative.circle_id = photo.circle_id
   and derivative.id = photo.display_derivative_id
   and derivative.original_id = photo.original_id
  where photo.moment_id = requested_moment_id
    and moment.kind = 'photo' and moment.trashed_at is null
    and (select private.photo_capability_is_enabled(
      'family_derivative_delivery'
    ))
    and (select private.current_family_session_is_live())
    and (select private.can_read_live_moment(moment.id))
  order by photo.sort_order, photo.id;
$$;

create function public.get_photo_moment_delivery(moment_id uuid)
returns table (
  photo_id uuid, sort_order integer,
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_photo_moment_delivery(moment_id);
$$;

create or replace function private.photo_display_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.photo_derivative_jobs as job
    join private.photo_originals as original on original.id = job.original_id
    where job.display_object_path = requested_object_path
      and job.state = 'leased'
      and job.validator_auth_user_id = (select auth.uid())
      and job.lease_expires_at > statement_timestamp()
      and (select private.photo_validator_is_allowed((select auth.uid())))
      and (select private.photo_intake_requester_is_authorized(
        original.intake_id
      ))
  ) or exists (
    select 1 from public.moment_photos as photo
    join public.moments as moment
      on moment.circle_id = photo.circle_id and moment.id = photo.moment_id
    join private.photo_display_derivatives as derivative
      on derivative.circle_id = photo.circle_id
     and derivative.id = photo.display_derivative_id
     and derivative.original_id = photo.original_id
    where derivative.object_path = requested_object_path
      and moment.kind = 'photo' and moment.trashed_at is null
      and (select private.photo_capability_is_enabled(
        'family_derivative_delivery'
      ))
      and (select private.current_family_session_is_live())
      and (select private.can_read_live_moment(moment.id))
  );
$$;

drop function if exists public.get_video_moment_delivery(moment_id uuid);
drop function if exists public.get_video_moment_delivery(requested_moment_id uuid);
drop function if exists private.get_video_moment_delivery(requested_moment_id uuid);
drop function if exists private.get_video_moment_delivery(moment_id uuid);

create function private.get_video_moment_delivery(requested_moment_id uuid)
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
    and moment.kind = 'video' and moment.trashed_at is null
    and (select private.current_family_session_is_live())
    and (select private.can_read_live_moment(moment.id))
    and object.metadata ->> 'mimetype' = video.mime_type
    and object.metadata ->> 'size' = video.size_bytes::text;
$$;

create function public.get_video_moment_delivery(moment_id uuid)
returns table (
  bucket_id text, object_path text, mime_type text, size_bytes bigint,
  duration_ms integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_video_moment_delivery(moment_id);
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
       and moment.kind = 'video' and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.can_read_live_moment(moment.id))
  );
$$;

create or replace function public.list_timeline_moments(
  circle_id uuid,
  journal_person_id uuid default null,
  cursor_occurred_on date default null,
  cursor_has_precise_time boolean default null,
  cursor_occurred_at timestamptz default null,
  cursor_moment_id uuid default null,
  page_size integer default 20,
  snapshot_at timestamptz default null
)
returns table (
  moment_id uuid,
  moment_circle_id uuid,
  moment_journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  journal_person_kind text,
  recorder_person_id uuid,
  recorder_person_name text,
  moment_kind text,
  moment_title text,
  body text,
  place_name text,
  tagged_people jsonb,
  occurred_on date,
  occurred_at timestamptz,
  occurred_timezone text,
  time_precision text,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz,
  can_change boolean,
  feed_snapshot_at timestamptz,
  latitude double precision,
  longitude double precision,
  source_url text,
  moment_audience text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  effective_snapshot_at timestamptz := coalesce(
    list_timeline_moments.snapshot_at, statement_timestamp()
  );
  cursor_is_empty boolean :=
    list_timeline_moments.cursor_occurred_on is null
    and list_timeline_moments.cursor_has_precise_time is null
    and list_timeline_moments.cursor_occurred_at is null
    and list_timeline_moments.cursor_moment_id is null;
  cursor_is_complete boolean :=
    list_timeline_moments.cursor_occurred_on is not null
    and list_timeline_moments.cursor_has_precise_time is not null
    and list_timeline_moments.cursor_moment_id is not null
    and (
      (list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is not null)
      or (not list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is null)
    );
begin
  if list_timeline_moments.circle_id is null
    or list_timeline_moments.page_size is null
    or list_timeline_moments.page_size not between 1 and 50
    or list_timeline_moments.snapshot_at > statement_timestamp()
    or not (cursor_is_empty or cursor_is_complete) then
    raise exception using errcode = '22023', message = 'Timeline could not be listed';
  end if;

  return query
  select
    moment.id,
    moment.circle_id,
    moment.journal_person_id,
    journal_person.display_name,
    journal_person.accent_token,
    journal_person.profile_kind,
    recorder_membership.person_id,
    recorder_person.display_name,
    moment.kind,
    moment.title,
    moment.body,
    moment.place_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tagged_person.id,
        'name', tagged_person.display_name
      ) order by tagged_person.display_name, tagged_person.id)
      from public.moment_people as tag
      join public.people as tagged_person
        on tagged_person.circle_id = tag.circle_id
       and tagged_person.id = tag.person_id
      where tag.circle_id = moment.circle_id and tag.moment_id = moment.id
        and tag.removed_at is null
    ), '[]'::jsonb),
    moment.occurred_on,
    moment.occurred_at,
    moment.occurred_timezone,
    moment.time_precision,
    moment.revision,
    moment.created_at,
    moment.updated_at,
    case
      when moment.kind = 'insight' then
        (select private.is_circle_organizer(moment.circle_id))
      else
        (select private.can_manage_person(moment.circle_id, moment.journal_person_id))
    end,
    effective_snapshot_at,
    moment.latitude,
    moment.longitude,
    moment.source_url,
    moment.audience
  from public.moments as moment
  left join public.people as journal_person
    on journal_person.circle_id = moment.circle_id
   and journal_person.id = moment.journal_person_id
  left join public.circle_memberships as recorder_membership
    on recorder_membership.circle_id = moment.circle_id
   and recorder_membership.id = moment.recorded_by_membership_id
  left join public.people as recorder_person
    on recorder_person.circle_id = recorder_membership.circle_id
   and recorder_person.id = recorder_membership.person_id
  where moment.trashed_at is null
    and moment.created_at <= effective_snapshot_at
    and moment.updated_at <= effective_snapshot_at
    and (
      case
        when list_timeline_moments.journal_person_id is null then
          moment.audience = 'family'
          and exists (
            select 1
              from public.moment_circles as link
             where link.moment_id = moment.id
               and link.circle_id = list_timeline_moments.circle_id
          )
        else
          moment.circle_id = list_timeline_moments.circle_id
          and moment.journal_person_id = list_timeline_moments.journal_person_id
          and (
            moment.audience = 'family'
            or (
              moment.audience = 'just_me'
              and recorder_membership.user_id = (select auth.uid())
            )
          )
      end
    )
    and (
      cursor_is_empty
      or (
        moment.occurred_on,
        moment.occurred_at is not null,
        coalesce(moment.occurred_at, '-infinity'::timestamptz),
        moment.id
      ) < (
        list_timeline_moments.cursor_occurred_on,
        list_timeline_moments.cursor_has_precise_time,
        coalesce(list_timeline_moments.cursor_occurred_at, '-infinity'::timestamptz),
        list_timeline_moments.cursor_moment_id
      )
    )
  order by moment.occurred_on desc, moment.occurred_at desc nulls last,
    moment.id desc
  limit list_timeline_moments.page_size;
end;
$$;

drop function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
);
drop function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text
);
drop function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text
);
drop function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text
);

create function public.create_family_moment(
  circle_id uuid, journal_person_id uuid, moment_kind text,
  moment_title text, moment_body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null, occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null,
  audience text default null, circle_ids uuid[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_family_moment(
    circle_id, journal_person_id, moment_kind, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, audience
  );
  perform private.link_additional_moment_circles(created_id, circle_ids);
  return created_id;
end;
$$;

create function public.create_written_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  audience text default null,
  circle_ids uuid[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_written_moment(
    circle_id,
    journal_person_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    audience
  );
  perform private.link_additional_moment_circles(created_id, circle_ids);
  return created_id;
end;
$$;

create function public.reserve_photo_moment(
  circle_id uuid, journal_person_id uuid, body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null, request_key uuid default null,
  audience text default null, circle_ids uuid[] default null
)
returns table (
  intake_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, expires_at timestamptz
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
    from private.reserve_photo_moment(
      circle_id, journal_person_id, body, place_name, tagged_person_ids,
      occurred_on, occurred_at, occurred_timezone, request_key, audience
    );
  if reserved.intake_id is not null then
    perform private.store_media_request_circle_ids(
      'photo', reserved.intake_id, circle_ids
    );
  end if;
  return query select reserved.intake_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.expires_at;
end;
$$;

create function public.reserve_video_moment(
  circle_id uuid, journal_person_id uuid, body text, place_name text,
  tagged_person_ids uuid[], occurred_on date, expected_mime_type text,
  expected_size_bytes bigint, duration_ms integer,
  occurred_at timestamptz default null, occurred_timezone text default null,
  request_key uuid default null, audience text default null,
  circle_ids uuid[] default null
)
returns table (
  request_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, upload_expires_at timestamptz
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
      circle_id, journal_person_id, body, place_name, tagged_person_ids,
      occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
      occurred_at, occurred_timezone, request_key, audience
    );
  if reserved.request_id is not null then
    perform private.store_media_request_circle_ids(
      'video', reserved.request_id, circle_ids
    );
  end if;
  return query select reserved.request_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.upload_expires_at;
end;
$$;

revoke all on function private.get_photo_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_photo_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_video_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_video_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.get_photo_moment_delivery(uuid)
  to authenticated;
grant execute on function public.get_photo_moment_delivery(uuid)
  to authenticated;
grant execute on function private.get_video_moment_delivery(uuid)
  to authenticated;
grant execute on function public.get_video_moment_delivery(uuid)
  to authenticated;

revoke all on function private.can_read_live_moment(uuid)
  from public, anon;
revoke all on function private.link_additional_moment_circles(uuid, uuid[])
  from public, anon;
revoke all on function private.store_media_request_circle_ids(text, uuid, uuid[])
  from public, anon;
revoke all on function private.sync_moment_circle_links()
  from public, anon, authenticated;
grant execute on function private.can_read_live_moment(uuid)
  to authenticated;
grant execute on function private.link_additional_moment_circles(uuid, uuid[])
  to authenticated;
grant execute on function private.store_media_request_circle_ids(text, uuid, uuid[])
  to authenticated;

revoke all on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[]
) from public, anon;
revoke all on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[]
) from public, anon;
revoke all on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[]
) from public, anon;
revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[]
) from public, anon;
grant execute on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[]
) to authenticated;
grant execute on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[]
) to authenticated;
grant execute on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[]
) to authenticated;
grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[]
) to authenticated;
