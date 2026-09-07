-- Edit-audience: the author (or existing can_manage_person / Just Me
-- recorder rules) can change moment_circles and audience without moving
-- moments.circle_id. Personal timelines return linked_circle_ids so the
-- YOU-feed chip can show a count.

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
  source_url text,
  moment_audience text,
  linked_circle_ids uuid[]
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
    moment.audience,
    coalesce((
      select array_agg(link.circle_id order by link.circle_id)
      from public.moment_circles as link
      where link.moment_id = moment.id
    ), '{}'::uuid[])
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

revoke all on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) from public, anon;
grant execute on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) to authenticated;

create function private.set_moment_audience(
  target_moment_id uuid,
  expected_revision bigint,
  requested_audience text,
  requested_circle_ids uuid[] default null
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
  actor_membership_id uuid;
  normalized_audience text;
  normalized_ids uuid[] := '{}'::uuid[];
  requested uuid;
  resulting_revision bigint;
begin
  if current_user_id is null or target_moment_id is null
    or expected_revision is null or expected_revision < 1
    or requested_audience is null
    or requested_audience not in ('family', 'just_me') then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  normalized_audience := requested_audience;

  select moment.circle_id, moment.journal_person_id, moment.kind, moment.revision
    into target_circle_id, target_journal_person_id, target_kind, target_revision
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.trashed_at is null
  for update;

  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';

  if actor_membership_id is null
    or target_journal_person_id is null
    or target_kind = 'insight'
    or not (select private.can_manage_person(
      target_circle_id, target_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      target_circle_id, target_journal_person_id, normalized_audience
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;

  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
  end if;

  if normalized_audience = 'family' then
    if requested_circle_ids is null then
      raise exception using errcode = '22023', message = 'Moment could not be changed';
    end if;
    foreach requested in array requested_circle_ids
    loop
      if requested is null then
        continue;
      end if;
      if requested = any(normalized_ids) then
        continue;
      end if;
      if not (select private.is_active_circle_member(requested)) then
        raise exception using errcode = '42501', message = 'Moment could not be changed';
      end if;
      normalized_ids := array_append(normalized_ids, requested);
    end loop;
    if coalesce(cardinality(normalized_ids), 0) < 1
      or not (target_circle_id = any(normalized_ids)) then
      raise exception using errcode = '22023', message = 'Moment could not be changed';
    end if;
  end if;

  update public.moments
  set audience = normalized_audience
  where id = target_moment_id
  returning revision into resulting_revision;

  if normalized_audience = 'family' then
    delete from public.moment_circles
     where moment_id = target_moment_id
       and not (circle_id = any(normalized_ids));
    insert into public.moment_circles (moment_id, circle_id)
    select target_moment_id, requested_id
      from unnest(normalized_ids) as requested_id
    on conflict do nothing;
  end if;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_updated', 'moment',
    target_moment_id
  );
  return resulting_revision;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
end;
$$;

create function public.set_moment_audience(
  moment_id uuid,
  expected_revision bigint,
  audience text,
  circle_ids uuid[] default null
)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_moment_audience(
    moment_id, expected_revision, audience, circle_ids
  );
$$;

revoke all on function private.set_moment_audience(
  uuid, bigint, text, uuid[]
) from public, anon;
revoke all on function public.set_moment_audience(
  uuid, bigint, text, uuid[]
) from public, anon;
grant execute on function private.set_moment_audience(
  uuid, bigint, text, uuid[]
) to authenticated;
grant execute on function public.set_moment_audience(
  uuid, bigint, text, uuid[]
) to authenticated;
