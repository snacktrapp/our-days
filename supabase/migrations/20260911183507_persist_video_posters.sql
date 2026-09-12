-- Persist first-frame JPEG posters for video moments so every device can
-- show a real preview above the caption (not a blank / black mat).

create table public.moment_video_posters (
  circle_id uuid not null,
  moment_id uuid not null,
  bucket_id text not null default 'our-days-videos',
  object_path text not null,
  mime_type text not null default 'image/jpeg',
  size_bytes bigint not null,
  width_px integer not null,
  height_px integer not null,
  storage_object_id uuid not null,
  storage_object_version text not null,
  created_at timestamptz not null default statement_timestamp(),
  created_by_membership_id uuid not null,
  primary key (circle_id, moment_id),
  constraint moment_video_posters_moment_unique unique (moment_id),
  constraint moment_video_posters_object_unique unique (bucket_id, object_path),
  constraint moment_video_posters_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete cascade,
  constraint moment_video_posters_video_fkey foreign key (circle_id, moment_id)
    references public.moment_videos (circle_id, moment_id) on delete cascade,
  constraint moment_video_posters_membership_fkey foreign key (
    circle_id, created_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint moment_video_posters_bucket_valid check (
    bucket_id = 'our-days-videos'
  ),
  constraint moment_video_posters_path_valid check (
    object_path = 'poster/' || moment_id::text
  ),
  constraint moment_video_posters_mime_valid check (mime_type = 'image/jpeg'),
  constraint moment_video_posters_size_valid check (
    size_bytes between 1 and 2097152
  ),
  constraint moment_video_posters_width_valid check (
    width_px between 1 and 7680
  ),
  constraint moment_video_posters_height_valid check (
    height_px between 1 and 7680
  )
);

alter table public.moment_video_posters enable row level security;
alter table public.moment_video_posters force row level security;

create policy moment_video_posters_select_live_active_circle
on public.moment_video_posters for select to authenticated
using (
  (select private.current_family_session_is_live())
  and exists (
    select 1 from public.moments as moment
     where moment.circle_id = moment_video_posters.circle_id
       and moment.id = moment_video_posters.moment_id
       and moment.kind = 'video'
       and moment.trashed_at is null
       and (select private.can_read_live_moment(moment.id))
  )
);

revoke all on table public.moment_video_posters
  from public, anon, authenticated, service_role;
grant select on table public.moment_video_posters to authenticated;

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
       and moment.kind = 'video'
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
       and moment.kind = 'video'
       and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.can_read_live_moment(moment.id))
  );
$$;

create function private.video_poster_path_is_uploadable(
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
       and moment.kind = 'video'
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

revoke all on function private.video_poster_path_is_uploadable(text, text)
  from public, anon, authenticated, service_role;
grant execute on function private.video_poster_path_is_uploadable(text, text)
  to authenticated;

update storage.buckets
   set allowed_mime_types = array[
     'video/mp4',
     'video/quicktime',
     'video/x-m4v',
     'video/webm',
     'image/jpeg'
   ]::text[]
 where id = 'our-days-videos';

create policy our_days_videos_insert_poster_live_family
on storage.objects for insert to authenticated
with check (
  bucket_id = 'our-days-videos'
  and (select storage.allow_any_operation(array['object.upload']::text[]))
  and owner_id = (select auth.uid()::text)
  and (select private.video_poster_path_is_uploadable(name, owner_id))
);

create function private.attach_video_moment_poster(
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
     and moment.kind = 'video'
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

create function public.attach_video_moment_poster(
  moment_id uuid,
  width_px integer,
  height_px integer
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.attach_video_moment_poster(moment_id, width_px, height_px);
$$;

create function private.get_video_moment_poster_delivery(
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
    and moment.kind = 'video'
    and moment.trashed_at is null
    and (select private.current_family_session_is_live())
    and (select private.can_read_live_moment(moment.id))
    and object.metadata ->> 'mimetype' = poster.mime_type
    and object.metadata ->> 'size' = poster.size_bytes::text;
$$;

create function public.get_video_moment_poster_delivery(moment_id uuid)
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
security invoker
set search_path = ''
as $$
  select * from private.get_video_moment_poster_delivery(moment_id);
$$;

revoke all on function private.attach_video_moment_poster(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.attach_video_moment_poster(uuid, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.get_video_moment_poster_delivery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_video_moment_poster_delivery(uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.attach_video_moment_poster(uuid, integer, integer)
  to authenticated;
grant execute on function public.attach_video_moment_poster(uuid, integer, integer)
  to authenticated;
grant execute on function private.get_video_moment_poster_delivery(uuid)
  to authenticated;
grant execute on function public.get_video_moment_poster_delivery(uuid)
  to authenticated;
