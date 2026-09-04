-- Insight moments are circle-level curated cards, not personal journal
-- entries. They have no journal_person_id, no person byline, and are created
-- only by organizers through create_insight_moment.

alter table public.moments
  drop constraint moments_kind_valid,
  drop constraint moments_title_valid,
  drop constraint moments_body_valid,
  add column source_url text,
  alter column journal_person_id drop not null,
  add constraint moments_kind_valid check (
    kind in ('thought', 'milestone', 'location', 'photo', 'video', 'insight')
  ),
  add constraint moments_body_valid check (
    body = btrim(body)
    and char_length(body) <= 4000
    and (
      kind not in ('thought', 'insight')
      or (char_length(body) >= 1 and body ~ '[^[:space:]]')
    )
  ),
  add constraint moments_title_valid check (
    (
      kind = 'milestone'
      and title = btrim(title)
      and char_length(title) between 1 and 120
    )
    or (
      kind = 'insight'
      and title = btrim(title)
      and char_length(title) between 1 and 160
    )
    or (kind not in ('milestone', 'insight') and title is null)
  ),
  add constraint moments_journal_person_kind_valid check (
    (kind = 'insight' and journal_person_id is null)
    or (kind <> 'insight' and journal_person_id is not null)
  ),
  add constraint moments_source_url_valid check (
    (
      kind = 'insight'
      and (
        source_url is null
        or (
          source_url = btrim(source_url)
          and char_length(source_url) between 12 and 2000
          and source_url ~ '^https://[^[:space:]<>"]+$'
        )
      )
    )
    or (kind <> 'insight' and source_url is null)
  );

create or replace function private.insight_source_url_is_valid(
  requested_source_url text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select requested_source_url is null
    or (
      requested_source_url = btrim(requested_source_url)
      and char_length(requested_source_url) between 12 and 2000
      and requested_source_url ~ '^https://[^[:space:]<>"]+$'
    );
$$;

create or replace function private.family_moment_payload_is_valid(
  requested_kind text,
  requested_title text,
  requested_body text,
  requested_place_name text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case requested_kind
    when 'thought' then
      requested_title is null
      and char_length(requested_body) between 1 and 4000
      and requested_body ~ '[^[:space:]]'
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'milestone' then
      char_length(requested_title) between 1 and 120
      and char_length(requested_body) <= 4000
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'location' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and char_length(requested_place_name) between 1 and 160
    when 'photo' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'video' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'insight' then
      char_length(requested_title) between 1 and 160
      and char_length(requested_body) between 1 and 4000
      and requested_body ~ '[^[:space:]]'
      and requested_place_name is null
    else false
  end;
$$;

create or replace function private.create_family_moment(
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
    or requested_kind in ('photo', 'video', 'insight')
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

create function private.create_insight_moment(
  requested_circle_id uuid,
  requested_quote text,
  requested_attribution text,
  requested_source_url text default null,
  requested_occurred_on date default null,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null
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
  normalized_quote text := coalesce(btrim(requested_quote), '');
  normalized_attribution text := nullif(btrim(requested_attribution), '');
  normalized_source_url text := nullif(btrim(requested_source_url), '');
  effective_occurred_on date;
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.family_moment_payload_is_valid(
      'insight', normalized_attribution, normalized_quote, null
    ))
    or not (select private.insight_source_url_is_valid(normalized_source_url)) then
    raise exception using errcode = '22023', message = 'Insight could not be created';
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
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null
    or circle_time_zone is null
    or not (select private.is_circle_organizer(requested_circle_id)) then
    raise exception using errcode = '42501', message = 'Insight could not be created';
  end if;

  effective_occurred_on := coalesce(
    requested_occurred_on,
    pg_catalog.timezone(circle_time_zone, statement_timestamp())::date
  );

  if effective_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Insight could not be created';
  end if;

  insert into public.moments (
    circle_id, journal_person_id, recorded_by_membership_id, kind, title, body,
    source_url, occurred_on, occurred_at, occurred_timezone, time_precision
  ) values (
    requested_circle_id, null, actor_membership_id, 'insight',
    normalized_attribution, normalized_quote, normalized_source_url,
    effective_occurred_on, requested_occurred_at, requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end
  ) returning id into resulting_moment_id;

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
    raise exception using errcode = '22023', message = 'Insight could not be created';
end;
$$;

create function public.create_insight_moment(
  circle_id uuid,
  quote text,
  attribution text,
  source_url text default null,
  occurred_on date default null,
  occurred_at timestamptz default null,
  occurred_timezone text default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_insight_moment(
    circle_id, quote, attribution, source_url, occurred_on, occurred_at,
    occurred_timezone
  );
$$;

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
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
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

create or replace function private.list_manageable_trashed_written_moments(
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
  trashed_at timestamptz
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
    moment.trashed_at
  from public.moments as moment
  left join public.people as person
    on person.circle_id = moment.circle_id
   and person.id = moment.journal_person_id
  where moment.circle_id = requested_circle_id
    and moment.trashed_at is not null
    and (select private.is_active_circle_member(requested_circle_id))
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

drop function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
);

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
  longitude double precision,
  source_url text
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
    moment.source_url
  from public.moments as moment
  left join public.people as journal_person
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

revoke all on function private.insight_source_url_is_valid(text)
  from public, anon, authenticated;
revoke all on function private.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text
) from public, anon;
revoke all on function public.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text
) from public, anon;
revoke all on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) from public, anon;

grant execute on function private.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text
) to authenticated;
grant execute on function public.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text
) to authenticated;
grant execute on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) to authenticated;
