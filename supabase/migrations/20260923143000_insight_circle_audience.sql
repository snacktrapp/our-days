-- Insights can now target Just me or one/more real circles.
-- Keep insights byline-less (journal_person_id remains null) and derive
-- ownership from recorded_by_membership_id for Just me visibility.

alter table public.moments
  drop constraint if exists moments_audience_insight_valid;

drop function if exists private.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text
);
drop function if exists public.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text
);

create function private.create_insight_moment(
  requested_circle_id uuid,
  requested_quote text,
  requested_attribution text,
  requested_source_url text default null,
  requested_occurred_on date default null,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_audience text default null,
  requested_circle_ids uuid[] default null
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
  normalized_audience text := coalesce(requested_audience, 'family');
  normalized_circle_ids uuid[] := '{}'::uuid[];
  requested uuid;
  effective_occurred_on date;
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or normalized_audience not in ('family', 'just_me')
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

  if normalized_audience = 'family' then
    if requested_circle_ids is null then
      normalized_circle_ids := array[requested_circle_id];
    else
      foreach requested in array requested_circle_ids
      loop
        if requested is null or requested = any(normalized_circle_ids) then
          continue;
        end if;
        if not (select private.is_active_circle_member(requested)) then
          raise exception using errcode = '42501', message = 'Insight could not be created';
        end if;
        normalized_circle_ids := array_append(normalized_circle_ids, requested);
      end loop;
    end if;
    if coalesce(cardinality(normalized_circle_ids), 0) < 1 then
      raise exception using errcode = '22023', message = 'Insight could not be created';
    end if;
    if not (requested_circle_id = any(normalized_circle_ids)) then
      normalized_circle_ids := array_prepend(requested_circle_id, normalized_circle_ids);
    end if;
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
    source_url, occurred_on, occurred_at, occurred_timezone, time_precision,
    audience
  ) values (
    requested_circle_id, null, actor_membership_id, 'insight',
    normalized_attribution, normalized_quote, normalized_source_url,
    effective_occurred_on, requested_occurred_at, requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    normalized_audience
  ) returning id into resulting_moment_id;

  if normalized_audience = 'family' then
    perform private.link_additional_moment_circles(
      resulting_moment_id,
      normalized_circle_ids
    );
  end if;

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
  occurred_timezone text default null,
  audience text default null,
  circle_ids uuid[] default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_insight_moment(
    circle_id,
    quote,
    attribution,
    source_url,
    occurred_on,
    occurred_at,
    occurred_timezone,
    audience,
    circle_ids
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
  viewing_own_journal boolean :=
    list_timeline_moments.journal_person_id is not null
    and exists (
      select 1
        from public.circle_memberships as membership
       where membership.circle_id = list_timeline_moments.circle_id
         and membership.person_id = list_timeline_moments.journal_person_id
         and membership.user_id = (select auth.uid())
         and membership.status = 'active'
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
    (select private.moment_tagged_people(moment.id)),
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
    and private.can_read_live_moment(moment.id)
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
        when viewing_own_journal then
          (
            (
              moment.kind <> 'insight'
              and exists (
                select 1
                  from public.circle_memberships as mine
                 where mine.user_id = (select auth.uid())
                   and mine.status = 'active'
                   and mine.person_id = moment.journal_person_id
              )
            )
            or (
              moment.kind = 'insight'
              and moment.audience = 'just_me'
              and recorder_membership.user_id = (select auth.uid())
              and recorder_membership.person_id =
                list_timeline_moments.journal_person_id
            )
          )
          and (
            moment.audience = 'family'
            or (
              moment.audience = 'just_me'
              and recorder_membership.user_id = (select auth.uid())
            )
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

create or replace function public.list_all_timeline_moments(
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
    list_all_timeline_moments.snapshot_at, statement_timestamp()
  );
  cursor_is_empty boolean :=
    list_all_timeline_moments.cursor_occurred_on is null
    and list_all_timeline_moments.cursor_has_precise_time is null
    and list_all_timeline_moments.cursor_occurred_at is null
    and list_all_timeline_moments.cursor_moment_id is null;
  cursor_is_complete boolean :=
    list_all_timeline_moments.cursor_occurred_on is not null
    and list_all_timeline_moments.cursor_has_precise_time is not null
    and list_all_timeline_moments.cursor_moment_id is not null
    and (
      (list_all_timeline_moments.cursor_has_precise_time
        and list_all_timeline_moments.cursor_occurred_at is not null)
      or (not list_all_timeline_moments.cursor_has_precise_time
        and list_all_timeline_moments.cursor_occurred_at is null)
    );
begin
  if list_all_timeline_moments.page_size is null
    or list_all_timeline_moments.page_size not between 1 and 50
    or list_all_timeline_moments.snapshot_at > statement_timestamp()
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
    (select private.moment_tagged_people(moment.id)),
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
      (
        moment.audience = 'family'
        and exists (
          select 1
            from public.moment_circles as link
            join public.circle_memberships as mine
              on mine.circle_id = link.circle_id
             and mine.user_id = (select auth.uid())
             and mine.status = 'active'
           where link.moment_id = moment.id
        )
      )
      or (
        moment.audience = 'just_me'
        and recorder_membership.user_id = (select auth.uid())
        and (
          (
            moment.kind <> 'insight'
            and exists (
              select 1
                from public.circle_memberships as mine
               where mine.user_id = (select auth.uid())
                 and mine.status = 'active'
                 and mine.person_id = moment.journal_person_id
            )
          )
          or (
            moment.kind = 'insight'
            and recorder_membership.status = 'active'
          )
        )
      )
    )
    and (
      cursor_is_empty
      or (
        moment.occurred_on,
        moment.occurred_at is not null,
        coalesce(moment.occurred_at, '-infinity'::timestamptz),
        moment.id
      ) < (
        list_all_timeline_moments.cursor_occurred_on,
        list_all_timeline_moments.cursor_has_precise_time,
        coalesce(list_all_timeline_moments.cursor_occurred_at, '-infinity'::timestamptz),
        list_all_timeline_moments.cursor_moment_id
      )
    )
  order by moment.occurred_on desc, moment.occurred_at desc nulls last,
    moment.id desc
  limit list_all_timeline_moments.page_size;
end;
$$;

insert into public.moment_circles (moment_id, circle_id)
select moment.id, moment.circle_id
  from public.moments as moment
 where moment.kind = 'insight'
   and moment.audience = 'family'
on conflict do nothing;

revoke all on function private.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text, text, uuid[]
) from public, anon;
revoke all on function public.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text, text, uuid[]
) from public, anon;
grant execute on function private.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text, text, uuid[]
) to authenticated;
grant execute on function public.create_insight_moment(
  uuid, text, text, text, date, timestamptz, text, text, uuid[]
) to authenticated;
