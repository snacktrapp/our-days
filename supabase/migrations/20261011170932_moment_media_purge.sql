-- Purge storage bytes for moments trashed more than 30 days ago.
--
-- Moment rows stay. Triggers still reject deleting moments, moment_photos,
-- and moment_videos, and the platform trigger on storage.objects still rejects
-- SQL DELETE. Bytes leave only through the Storage API.
--
-- The web deployment has no service-role key (ADR-016). The existing photo
-- validator signs in with the publishable key and is the only identity allowed
-- to delete. Two policies let that identity SELECT and DELETE an object only
-- when every moment that references the exact bucket and path has been trashed
-- for more than 30 days. A live or recently trashed duplicate keeps the file.
-- A private purge log makes a missing object and a deleted object both idempotent.

create table private.moment_media_purges (
  moment_id uuid not null,
  bucket_id text not null,
  object_path text not null,
  purged_at timestamptz not null default statement_timestamp(),
  primary key (moment_id, bucket_id, object_path),
  constraint moment_media_purges_moment_fkey foreign key (moment_id)
    references public.moments (id) on delete restrict,
  constraint moment_media_purges_bucket_valid check (
    bucket_id in (
      'our-days-originals',
      'our-days-display',
      'our-days-videos'
    )
  ),
  constraint moment_media_purges_path_valid check (
    char_length(object_path) between 1 and 1024
    and object_path not like '%..%'
  )
);

alter table private.moment_media_purges enable row level security;
alter table private.moment_media_purges force row level security;

revoke all on table private.moment_media_purges
  from public, anon, authenticated, service_role;

create function private.moment_media_references(
  requested_bucket_id text,
  requested_object_path text
)
returns table (
  moment_id uuid,
  trashed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select photo.moment_id, moment.trashed_at
    from private.photo_originals as original
    join public.moment_photos as photo
      on photo.circle_id = original.circle_id
     and photo.original_id = original.id
    join public.moments as moment
      on moment.circle_id = photo.circle_id
     and moment.id = photo.moment_id
   where original.bucket_id = requested_bucket_id
     and original.object_path = requested_object_path
  union
  select photo.moment_id, moment.trashed_at
    from private.photo_display_derivatives as derivative
    join public.moment_photos as photo
      on photo.circle_id = derivative.circle_id
     and photo.display_derivative_id = derivative.id
     and photo.original_id = derivative.original_id
    join public.moments as moment
      on moment.circle_id = photo.circle_id
     and moment.id = photo.moment_id
   where derivative.bucket_id = requested_bucket_id
     and derivative.object_path = requested_object_path
  union
  select photo.moment_id, moment.trashed_at
    from private.photo_card_renditions as card
    join public.moment_photos as photo
      on photo.circle_id = card.circle_id
     and photo.display_derivative_id = card.display_derivative_id
     and photo.original_id = card.original_id
    join public.moments as moment
      on moment.circle_id = photo.circle_id
     and moment.id = photo.moment_id
   where card.bucket_id = requested_bucket_id
     and card.object_path = requested_object_path
  union
  select video.moment_id, moment.trashed_at
    from public.moment_videos as video
    join public.moments as moment
      on moment.circle_id = video.circle_id
     and moment.id = video.moment_id
   where video.bucket_id = requested_bucket_id
     and video.object_path = requested_object_path
  union
  select poster.moment_id, moment.trashed_at
    from public.moment_video_posters as poster
    join public.moments as moment
      on moment.circle_id = poster.circle_id
     and moment.id = poster.moment_id
   where poster.bucket_id = requested_bucket_id
     and poster.object_path = requested_object_path;
$$;

create function private.moment_media_paths(requested_moment_id uuid)
returns table (
  bucket_id text,
  object_path text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select original.bucket_id, original.object_path
    from public.moment_photos as photo
    join private.photo_originals as original
      on original.circle_id = photo.circle_id
     and original.id = photo.original_id
   where photo.moment_id = requested_moment_id
  union
  select derivative.bucket_id, derivative.object_path
    from public.moment_photos as photo
    join private.photo_display_derivatives as derivative
      on derivative.circle_id = photo.circle_id
     and derivative.id = photo.display_derivative_id
     and derivative.original_id = photo.original_id
   where photo.moment_id = requested_moment_id
  union
  select card.bucket_id, card.object_path
    from public.moment_photos as photo
    join private.photo_card_renditions as card
      on card.circle_id = photo.circle_id
     and card.display_derivative_id = photo.display_derivative_id
     and card.original_id = photo.original_id
   where photo.moment_id = requested_moment_id
  union
  select video.bucket_id, video.object_path
    from public.moment_videos as video
   where video.moment_id = requested_moment_id
  union
  select poster.bucket_id, poster.object_path
    from public.moment_video_posters as poster
   where poster.moment_id = requested_moment_id;
$$;

create function private.moment_media_path_is_purge_safe(
  requested_bucket_id text,
  requested_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    requested_bucket_id in (
      'our-days-originals',
      'our-days-display',
      'our-days-videos'
    )
    and requested_object_path is not null
    and requested_object_path <> ''
    and exists (
      select 1
        from private.moment_media_references(
          requested_bucket_id,
          requested_object_path
        )
    )
    and not exists (
      select 1
        from private.moment_media_references(
          requested_bucket_id,
          requested_object_path
        ) as reference
       where reference.trashed_at is null
          or reference.trashed_at >= statement_timestamp() - interval '30 days'
    ),
    false
  );
$$;

create function private.list_moment_media_purge_candidates(
  requested_limit integer
)
returns table (
  moment_id uuid,
  bucket_id text,
  object_path text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  effective_limit integer;
begin
  if not coalesce((select private.current_user_is_photo_validator()), false) then
    raise exception using errcode = '42501',
      message = 'Moment media purge is unavailable';
  end if;

  effective_limit := least(coalesce(requested_limit, 8), 8);
  if effective_limit < 1 then
    effective_limit := 8;
  end if;

  return query
  with chosen as (
    select moment.id, moment.trashed_at
      from public.moments as moment
     where moment.trashed_at is not null
       and moment.trashed_at < statement_timestamp() - interval '30 days'
       and exists (
         select 1
           from private.moment_media_paths(moment.id) as path
          where not exists (
            select 1
              from private.moment_media_purges as purge
             where purge.moment_id = moment.id
               and purge.bucket_id = path.bucket_id
               and purge.object_path = path.object_path
          )
       )
       and not exists (
         select 1
           from private.moment_media_paths(moment.id) as path
          where not (select private.moment_media_path_is_purge_safe(
            path.bucket_id,
            path.object_path
          ))
       )
     order by moment.trashed_at, moment.id
     limit effective_limit
  )
  select chosen.id, path.bucket_id, path.object_path
    from chosen
    cross join lateral private.moment_media_paths(chosen.id) as path
   where not exists (
     select 1
       from private.moment_media_purges as purge
      where purge.moment_id = chosen.id
        and purge.bucket_id = path.bucket_id
        and purge.object_path = path.object_path
   )
   order by chosen.trashed_at, chosen.id, path.bucket_id, path.object_path;
end;
$$;

create function private.record_moment_media_purge(
  requested_bucket_id text,
  requested_object_path text
)
returns table (
  recorded boolean,
  reason text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inserted_count integer;
begin
  if not coalesce((select private.current_user_is_photo_validator()), false) then
    raise exception using errcode = '42501',
      message = 'Moment media purge is unavailable';
  end if;

  if requested_bucket_id is null
    or requested_object_path is null
    or requested_bucket_id not in (
      'our-days-originals',
      'our-days-display',
      'our-days-videos'
    )
    or char_length(requested_object_path) not between 1 and 1024
    or requested_object_path like '%..%' then
    raise exception using errcode = '22023',
      message = 'Moment media purge is unavailable';
  end if;

  if not (select private.moment_media_path_is_purge_safe(
    requested_bucket_id,
    requested_object_path
  )) then
    return query select false, 'not_safe'::text;
    return;
  end if;

  if exists (
    select 1
      from storage.objects as object
     where object.bucket_id = requested_bucket_id
       and object.name = requested_object_path
  ) then
    return query select false, 'still_present'::text;
    return;
  end if;

  insert into private.moment_media_purges as purge (
    moment_id, bucket_id, object_path
  )
  select distinct reference.moment_id, requested_bucket_id, requested_object_path
    from private.moment_media_references(
      requested_bucket_id,
      requested_object_path
    ) as reference
   where reference.trashed_at is not null
     and reference.trashed_at < statement_timestamp() - interval '30 days'
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  if inserted_count > 0 then
    return query select true, 'purged'::text;
  else
    return query select true, 'already_recorded'::text;
  end if;
end;
$$;

create function public.list_moment_media_purge_candidates(batch_limit integer)
returns table (
  moment_id uuid,
  bucket_id text,
  object_path text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.list_moment_media_purge_candidates(batch_limit);
$$;

create function public.record_moment_media_purge(
  bucket_id text,
  object_path text
)
returns table (
  recorded boolean,
  reason text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select *
    from private.record_moment_media_purge(bucket_id, object_path);
$$;

-- Storage remove() reads the object before deleting it, so the validator needs
-- both SELECT and DELETE, each gated by the same exact-path check.
create policy our_days_moment_media_select_validator_purge
on storage.objects
for select
to authenticated
using (
  bucket_id in (
    'our-days-originals',
    'our-days-display',
    'our-days-videos'
  )
  and (select private.current_user_is_photo_validator())
  and (select private.moment_media_path_is_purge_safe(bucket_id, name))
);

create policy our_days_moment_media_delete_validator_purge
on storage.objects
for delete
to authenticated
using (
  bucket_id in (
    'our-days-originals',
    'our-days-display',
    'our-days-videos'
  )
  and (select private.current_user_is_photo_validator())
  and (select private.moment_media_path_is_purge_safe(bucket_id, name))
);

revoke all on function private.moment_media_references(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.moment_media_paths(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.moment_media_path_is_purge_safe(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.list_moment_media_purge_candidates(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.record_moment_media_purge(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_moment_media_purge_candidates(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.record_moment_media_purge(text, text)
  from public, anon, authenticated, service_role;

grant execute on function private.moment_media_path_is_purge_safe(text, text)
  to authenticated;
grant execute on function private.list_moment_media_purge_candidates(integer)
  to authenticated;
grant execute on function private.record_moment_media_purge(text, text)
  to authenticated;
grant execute on function public.list_moment_media_purge_candidates(integer)
  to authenticated;
grant execute on function public.record_moment_media_purge(text, text)
  to authenticated;

create or replace function private.set_written_moment_trashed(
  target_moment_id uuid,
  expected_revision bigint,
  requested_trashed boolean
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_journal_person_id uuid;
  target_kind text;
  target_trashed_at timestamptz;
  target_revision bigint;
  actor_membership_id uuid;
  resulting_revision bigint;
begin
  if current_user_id is null
    or target_moment_id is null
    or expected_revision is null
    or expected_revision < 1
    or requested_trashed is null then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  select moment.circle_id
    into target_circle_id
    from public.moments as moment
   where moment.id = target_moment_id;

  perform 1 from public.circles where id = target_circle_id for update;

  select moment.journal_person_id, moment.kind, moment.trashed_at, moment.revision
    into target_journal_person_id, target_kind, target_trashed_at, target_revision
    from public.moments as moment
   where moment.id = target_moment_id
     and moment.circle_id = target_circle_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = target_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active';

  if actor_membership_id is null then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;

  if target_kind = 'insight' then
    if not (select private.is_circle_organizer(target_circle_id)) then
      raise exception using errcode = '42501', message = 'Moment could not be changed';
    end if;
  elsif target_journal_person_id is null
    or not (select private.can_manage_person(
      target_circle_id,
      target_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;

  if target_revision <> expected_revision then
    raise exception using errcode = 'PT409', message = 'Moment changed elsewhere';
  end if;

  if requested_trashed and target_trashed_at is null then
    update public.moments
       set trashed_at = statement_timestamp(),
           trashed_by_membership_id = actor_membership_id
     where id = target_moment_id
    returning revision into resulting_revision;

    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      target_circle_id, actor_membership_id, 'moment_trashed', 'moment', target_moment_id
    );
  elsif not requested_trashed and target_trashed_at is not null then
    if exists (
      select 1
        from private.moment_media_purges as purge
       where purge.moment_id = target_moment_id
    ) then
      raise exception using errcode = '42501',
        message = 'Moment media has been removed';
    end if;

    update public.moments
       set trashed_at = null,
           trashed_by_membership_id = null
     where id = target_moment_id
    returning revision into resulting_revision;

    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      target_circle_id, actor_membership_id, 'moment_restored', 'moment', target_moment_id
    );
  else
    resulting_revision := target_revision;
  end if;

  return resulting_revision;
end;
$$;

drop function public.list_manageable_trashed_written_moments(uuid);
drop function private.list_manageable_trashed_written_moments(uuid);

create function private.list_manageable_trashed_written_moments(
  requested_circle_id uuid
)
returns table (
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  moment_kind text,
  moment_title text,
  body text,
  place_name text,
  occurred_on date,
  revision bigint,
  trashed_at timestamptz,
  media_purged boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    moment.id,
    moment.journal_person_id,
    person.display_name,
    person.accent_token,
    moment.kind,
    moment.title,
    moment.body,
    moment.place_name,
    moment.occurred_on,
    moment.revision,
    moment.trashed_at,
    exists (
      select 1
        from private.moment_media_purges as purge
       where purge.moment_id = moment.id
    )
  from public.moments as moment
  left join public.people as person
    on person.circle_id = moment.circle_id
   and person.id = moment.journal_person_id
  where moment.circle_id = requested_circle_id
    and moment.trashed_at is not null
    and (select private.is_active_circle_member(requested_circle_id))
    and (
      moment.audience = 'family'
      or (select private.can_read_moment_audience(
        moment.circle_id, moment.audience, moment.recorded_by_membership_id
      ))
    )
    and (
      (
        moment.kind = 'insight'
        and (select private.is_circle_organizer(requested_circle_id))
      )
      or (
        moment.kind <> 'insight'
        and (select private.can_manage_person(
          moment.circle_id, moment.journal_person_id
        ))
      )
    )
  order by moment.trashed_at desc, moment.id desc;
$$;

create function public.list_manageable_trashed_written_moments(circle_id uuid)
returns table (
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  moment_kind text,
  moment_title text,
  body text,
  place_name text,
  occurred_on date,
  revision bigint,
  trashed_at timestamptz,
  media_purged boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_manageable_trashed_written_moments(circle_id);
$$;

revoke all on function private.list_manageable_trashed_written_moments(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_manageable_trashed_written_moments(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.list_manageable_trashed_written_moments(uuid)
  to authenticated;
grant execute on function public.list_manageable_trashed_written_moments(uuid)
  to authenticated;
