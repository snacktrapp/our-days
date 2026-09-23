-- Allow healthy poster regeneration when an existing stored poster is dark/blank.
-- Insight clips already share the video poster pipeline; this migration enables
-- replacing an existing poster object and refreshing descriptor metadata.

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
  );
end;
$$;

drop policy if exists our_days_videos_update_poster_live_family
  on storage.objects;

create policy our_days_videos_update_poster_live_family
on storage.objects for update to authenticated
using (
  bucket_id = 'our-days-videos'
  and owner_id = (select auth.uid()::text)
  and (select storage.allow_any_operation(array['object.upload']::text[]))
  and (select private.video_poster_path_is_uploadable(name, owner_id))
)
with check (
  bucket_id = 'our-days-videos'
  and owner_id = (select auth.uid()::text)
  and (select storage.allow_any_operation(array['object.upload']::text[]))
  and (select private.video_poster_path_is_uploadable(name, owner_id))
);

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
  on conflict (moment_id) do update
    set size_bytes = excluded.size_bytes,
        width_px = excluded.width_px,
        height_px = excluded.height_px,
        storage_object_id = excluded.storage_object_id,
        storage_object_version = excluded.storage_object_version,
        created_at = statement_timestamp(),
        created_by_membership_id = excluded.created_by_membership_id;

  return true;
exception
  when unique_violation then
    return true;
end;
$$;
