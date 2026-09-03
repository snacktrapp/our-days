-- Invitation-only composer places may store an optional WGS84 pin chosen in
-- the MapLibre/MapTiler picker. Labels remain the family-facing field.
-- Coordinates are never inferred from photo EXIF.

alter table public.moments
  add column latitude double precision,
  add column longitude double precision;

alter table public.moments
  add constraint moments_coordinates_valid check (
    (latitude is null) = (longitude is null)
    and (
      latitude is null
      or (
        latitude between -90 and 90
        and longitude between -180 and 180
      )
    )
  );

create or replace function private.coordinates_are_valid(
  requested_latitude double precision,
  requested_longitude double precision
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (requested_latitude is null) = (requested_longitude is null)
    and (
      requested_latitude is null
      or (
        requested_latitude between -90 and 90
        and requested_longitude between -180 and 180
      )
    );
$$;

revoke all on function private.coordinates_are_valid(double precision, double precision)
  from public, anon, authenticated;

drop function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text
);
drop function private.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text
);
drop function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text
);
drop function private.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text
);
drop function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
);

create function private.create_family_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_kind text,
  requested_title text,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_title text := nullif(btrim(requested_title), '');
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[] := coalesce(requested_tagged_person_ids, '{}'::uuid[]);
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_journal_person_id is null
    or requested_occurred_on is null
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.family_moment_payload_is_valid(
      requested_kind, normalized_title, normalized_body, normalized_place_name
    ))
    or not (select private.coordinates_are_valid(
      requested_latitude, requested_longitude
    )) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  select circle.time_zone
    into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active';

  if actor_membership_id is null
    or circle_time_zone is null
    or not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be created';
  end if;

  if not (select private.tags_are_valid(
      requested_circle_id, requested_journal_person_id, normalized_tags
    ))
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  insert into public.moments (
    circle_id, journal_person_id, recorded_by_membership_id, kind, title, body,
    place_name, latitude, longitude, occurred_on, occurred_at, occurred_timezone,
    time_precision
  ) values (
    requested_circle_id, requested_journal_person_id, actor_membership_id,
    requested_kind, normalized_title, normalized_body, normalized_place_name,
    requested_latitude, requested_longitude, requested_occurred_on,
    requested_occurred_at, requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end
  ) returning id into resulting_moment_id;

  insert into public.moment_people (
    circle_id, moment_id, person_id, tagged_by_membership_id
  )
  select requested_circle_id, resulting_moment_id, tagged.person_id,
    actor_membership_id
  from unnest(normalized_tags) as tagged(person_id);

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    requested_circle_id, actor_membership_id, 'moment_created', 'moment',
    resulting_moment_id
  );
  return resulting_moment_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be created';
end;
$$;

create function private.update_family_moment(
  target_moment_id uuid,
  expected_revision bigint,
  requested_title text,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null
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
  target_revision bigint;
  circle_time_zone text;
  actor_membership_id uuid;
  normalized_title text := nullif(btrim(requested_title), '');
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[] := coalesce(requested_tagged_person_ids, '{}'::uuid[]);
  resulting_revision bigint;
begin
  if current_user_id is null or target_moment_id is null
    or expected_revision is null or expected_revision < 1
    or requested_occurred_on is null
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.coordinates_are_valid(
      requested_latitude, requested_longitude
    )) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;

  select circle.time_zone into circle_time_zone
  from public.circles as circle where circle.id = target_circle_id for update;

  select moment.journal_person_id, moment.kind, moment.revision
    into target_journal_person_id, target_kind, target_revision
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.circle_id = target_circle_id
    and moment.trashed_at is null
  for update;

  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';

  if actor_membership_id is null or circle_time_zone is null
    or target_journal_person_id is null
    or not (select private.can_manage_person(
      target_circle_id, target_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
  end if;
  if not (select private.family_moment_payload_is_valid(
      target_kind, normalized_title, normalized_body, normalized_place_name
    ))
    or not (select private.tags_are_valid(
      target_circle_id, target_journal_person_id, normalized_tags
    ))
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  update public.moments
  set title = normalized_title,
      body = normalized_body,
      place_name = normalized_place_name,
      latitude = requested_latitude,
      longitude = requested_longitude,
      occurred_on = requested_occurred_on,
      occurred_at = requested_occurred_at,
      occurred_timezone = requested_occurred_timezone,
      time_precision = case when requested_occurred_at is null then 'date' else 'minute' end
  where id = target_moment_id
  returning revision into resulting_revision;

  update public.moment_people
  set removed_at = statement_timestamp()
  where moment_id = target_moment_id
    and removed_at is null
    and not (person_id = any(normalized_tags));
  insert into public.moment_people (
    circle_id, moment_id, person_id, tagged_by_membership_id
  )
  select target_circle_id, target_moment_id, tagged.person_id,
    actor_membership_id
  from unnest(normalized_tags) as tagged(person_id)
  on conflict (circle_id, moment_id, person_id) do update
    set removed_at = null;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_updated', 'moment',
    target_moment_id
  );
  return resulting_revision;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
end;
$$;

create function public.create_family_moment(
  circle_id uuid, journal_person_id uuid, moment_kind text,
  moment_title text, moment_body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null, occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null
)
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.create_family_moment(
    circle_id, journal_person_id, moment_kind, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude
  );
$$;

create function public.update_family_moment(
  moment_id uuid, expected_revision bigint, moment_title text,
  moment_body text, place_name text, tagged_person_ids uuid[],
  occurred_on date, occurred_at timestamptz default null,
  occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null
)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.update_family_moment(
    moment_id, expected_revision, moment_title, moment_body, place_name,
    tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude
  );
$$;

create function public.list_timeline_moments(
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
  longitude double precision
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
    (select private.can_manage_person(moment.circle_id, moment.journal_person_id)),
    effective_snapshot_at,
    moment.latitude,
    moment.longitude
  from public.moments as moment
  join public.people as journal_person
    on journal_person.circle_id = moment.circle_id
   and journal_person.id = moment.journal_person_id
  join public.circle_memberships as recorder_membership
    on recorder_membership.circle_id = moment.circle_id
   and recorder_membership.id = moment.recorded_by_membership_id
  join public.people as recorder_person
    on recorder_person.circle_id = recorder_membership.circle_id
   and recorder_person.id = recorder_membership.person_id
  where moment.circle_id = list_timeline_moments.circle_id
    and moment.trashed_at is null
    and moment.created_at <= effective_snapshot_at
    and moment.updated_at <= effective_snapshot_at
    and (
      list_timeline_moments.journal_person_id is null
      or moment.journal_person_id = list_timeline_moments.journal_person_id
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

revoke all on function private.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) from public, anon;
revoke all on function private.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) from public, anon;
revoke all on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) from public, anon;
revoke all on function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) from public, anon;
revoke all on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) from public, anon;

grant execute on function private.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) to authenticated;
grant execute on function private.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) to authenticated;
grant execute on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) to authenticated;
grant execute on function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
) to authenticated;
grant execute on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) to authenticated;
