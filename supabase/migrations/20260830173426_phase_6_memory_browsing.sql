alter table public.moments
  add constraint moments_occurrence_supported check (
    pg_catalog.isfinite(occurred_on)
    and occurred_on >= date '0001-01-01'
    and occurred_on <= date '9999-12-31'
    and (occurred_at is null or pg_catalog.isfinite(occurred_at))
  );

create index moments_live_circle_anniversary_idx
  on public.moments (
    circle_id,
    (pg_catalog.date_part('month', occurred_on)),
    (pg_catalog.date_part('day', occurred_on)),
    occurred_on desc,
    ((occurred_at is not null)) desc,
    occurred_at desc nulls last,
    id desc
  )
  where trashed_at is null;

create function public.list_memory_years(
  circle_id uuid,
  before_year integer default null,
  page_size integer default 200
)
returns table (memory_year integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if list_memory_years.circle_id is null
    or list_memory_years.page_size is null
    or list_memory_years.page_size not between 1 and 200
    or (
      list_memory_years.before_year is not null
      and list_memory_years.before_year not between 1 and 10000
    ) then
    raise exception using errcode = '22023', message = 'Memory years could not be listed';
  end if;
  if not (select private.is_active_circle_member(list_memory_years.circle_id)) then
    raise exception using errcode = '42501', message = 'Memories could not be listed';
  end if;

  return query
  select distinct pg_catalog.date_part('year', moment.occurred_on)::integer
  from public.moments as moment
  where moment.circle_id = list_memory_years.circle_id
    and moment.trashed_at is null
    and (
      list_memory_years.before_year is null
      or pg_catalog.date_part('year', moment.occurred_on)::integer <
        list_memory_years.before_year
    )
  order by 1 desc
  limit list_memory_years.page_size;
end;
$$;

revoke all on function public.list_memory_years(uuid, integer, integer)
  from public, anon;
grant execute on function public.list_memory_years(uuid, integer, integer)
  to authenticated;

create function public.list_memory_moments(
  circle_id uuid,
  memory_year integer default null,
  anniversary_month integer default null,
  anniversary_day integer default null,
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
  feed_snapshot_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  effective_snapshot_at timestamptz := coalesce(
    list_memory_moments.snapshot_at, statement_timestamp()
  );
  year_mode boolean := list_memory_moments.memory_year is not null
    and list_memory_moments.anniversary_month is null
    and list_memory_moments.anniversary_day is null;
  anniversary_mode boolean := list_memory_moments.memory_year is null
    and list_memory_moments.anniversary_month is not null
    and list_memory_moments.anniversary_day is not null;
  cursor_is_empty boolean :=
    list_memory_moments.cursor_occurred_on is null
    and list_memory_moments.cursor_has_precise_time is null
    and list_memory_moments.cursor_occurred_at is null
    and list_memory_moments.cursor_moment_id is null;
  cursor_is_complete boolean :=
    list_memory_moments.cursor_occurred_on is not null
    and list_memory_moments.cursor_has_precise_time is not null
    and list_memory_moments.cursor_moment_id is not null
    and (
      (list_memory_moments.cursor_has_precise_time
        and list_memory_moments.cursor_occurred_at is not null)
      or (not list_memory_moments.cursor_has_precise_time
        and list_memory_moments.cursor_occurred_at is null)
    );
begin
  if not (select private.is_active_circle_member(list_memory_moments.circle_id)) then
    raise exception using errcode = '42501', message = 'Memories could not be listed';
  end if;

  if list_memory_moments.circle_id is null
    or not (year_mode or anniversary_mode)
    or (year_mode and list_memory_moments.memory_year not between 1 and 9999)
    or (
      anniversary_mode and (
        list_memory_moments.anniversary_month not between 1 and 12
        or list_memory_moments.anniversary_day < 1
        or list_memory_moments.anniversary_day > case
          when list_memory_moments.anniversary_month in (1, 3, 5, 7, 8, 10, 12)
            then 31
          when list_memory_moments.anniversary_month in (4, 6, 9, 11)
            then 30
          when list_memory_moments.anniversary_month = 2 then 29
          else 0
        end
      )
    )
    or list_memory_moments.page_size is null
    or list_memory_moments.page_size not between 1 and 50
    or list_memory_moments.snapshot_at > statement_timestamp()
    or not (cursor_is_empty or cursor_is_complete)
    or (not cursor_is_empty and list_memory_moments.snapshot_at is null)
    or (
      cursor_is_complete and year_mode
      and pg_catalog.date_part(
        'year', list_memory_moments.cursor_occurred_on
      )::integer <> list_memory_moments.memory_year
    )
    or (
      cursor_is_complete and anniversary_mode
      and (
        pg_catalog.date_part(
          'month', list_memory_moments.cursor_occurred_on
        )::integer <> list_memory_moments.anniversary_month
        or pg_catalog.date_part(
          'day', list_memory_moments.cursor_occurred_on
        )::integer <> list_memory_moments.anniversary_day
      )
    ) then
    raise exception using errcode = '22023', message = 'Memories could not be listed';
  end if;

  if year_mode then
    return query
    select
      moment.id, moment.circle_id, moment.journal_person_id,
      journal_person.display_name, journal_person.accent_token,
      journal_person.profile_kind, recorder_membership.person_id,
      recorder_person.display_name, moment.kind, moment.title, moment.body,
      moment.place_name,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', tagged_person.id, 'name', tagged_person.display_name
        ) order by tagged_person.display_name, tagged_person.id)
        from public.moment_people as tag
        join public.people as tagged_person
          on tagged_person.circle_id = tag.circle_id
         and tagged_person.id = tag.person_id
        where tag.circle_id = moment.circle_id and tag.moment_id = moment.id
          and tag.removed_at is null
      ), '[]'::jsonb),
      moment.occurred_on, moment.occurred_at, moment.occurred_timezone,
      moment.time_precision, moment.revision, moment.created_at,
      moment.updated_at,
      (select private.can_manage_person(
        moment.circle_id, moment.journal_person_id
      )),
      effective_snapshot_at
    from public.moments as moment
    join public.people as journal_person
      on journal_person.circle_id = moment.circle_id
     and journal_person.id = moment.journal_person_id
    join public.circle_memberships as recorder_membership
      on recorder_membership.circle_id = moment.circle_id
     and recorder_membership.user_id = moment.recorded_by_user_id
    join public.people as recorder_person
      on recorder_person.circle_id = recorder_membership.circle_id
     and recorder_person.id = recorder_membership.person_id
    where moment.circle_id = list_memory_moments.circle_id
      and moment.trashed_at is null
      and moment.created_at <= effective_snapshot_at
      and moment.updated_at <= effective_snapshot_at
      and moment.occurred_on >= pg_catalog.make_date(
        list_memory_moments.memory_year, 1, 1
      )
      and moment.occurred_on <= pg_catalog.make_date(
        list_memory_moments.memory_year, 12, 31
      )
      and (
        cursor_is_empty
        or (
          moment.occurred_on,
          moment.occurred_at is not null,
          coalesce(moment.occurred_at, '-infinity'::timestamptz),
          moment.id
        ) < (
          list_memory_moments.cursor_occurred_on,
          list_memory_moments.cursor_has_precise_time,
          coalesce(
            list_memory_moments.cursor_occurred_at,
            '-infinity'::timestamptz
          ),
          list_memory_moments.cursor_moment_id
        )
      )
    order by moment.occurred_on desc, moment.occurred_at desc nulls last,
      moment.id desc
    limit list_memory_moments.page_size;
  else
    return query
    select
      moment.id, moment.circle_id, moment.journal_person_id,
      journal_person.display_name, journal_person.accent_token,
      journal_person.profile_kind, recorder_membership.person_id,
      recorder_person.display_name, moment.kind, moment.title, moment.body,
      moment.place_name,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', tagged_person.id, 'name', tagged_person.display_name
        ) order by tagged_person.display_name, tagged_person.id)
        from public.moment_people as tag
        join public.people as tagged_person
          on tagged_person.circle_id = tag.circle_id
         and tagged_person.id = tag.person_id
        where tag.circle_id = moment.circle_id and tag.moment_id = moment.id
          and tag.removed_at is null
      ), '[]'::jsonb),
      moment.occurred_on, moment.occurred_at, moment.occurred_timezone,
      moment.time_precision, moment.revision, moment.created_at,
      moment.updated_at,
      (select private.can_manage_person(
        moment.circle_id, moment.journal_person_id
      )),
      effective_snapshot_at
    from public.moments as moment
    join public.people as journal_person
      on journal_person.circle_id = moment.circle_id
     and journal_person.id = moment.journal_person_id
    join public.circle_memberships as recorder_membership
      on recorder_membership.circle_id = moment.circle_id
     and recorder_membership.user_id = moment.recorded_by_user_id
    join public.people as recorder_person
      on recorder_person.circle_id = recorder_membership.circle_id
     and recorder_person.id = recorder_membership.person_id
    where moment.circle_id = list_memory_moments.circle_id
      and moment.trashed_at is null
      and moment.created_at <= effective_snapshot_at
      and moment.updated_at <= effective_snapshot_at
      and pg_catalog.date_part('month', moment.occurred_on) =
        list_memory_moments.anniversary_month
      and pg_catalog.date_part('day', moment.occurred_on) =
        list_memory_moments.anniversary_day
      and (
        cursor_is_empty
        or (
          moment.occurred_on,
          moment.occurred_at is not null,
          coalesce(moment.occurred_at, '-infinity'::timestamptz),
          moment.id
        ) < (
          list_memory_moments.cursor_occurred_on,
          list_memory_moments.cursor_has_precise_time,
          coalesce(
            list_memory_moments.cursor_occurred_at,
            '-infinity'::timestamptz
          ),
          list_memory_moments.cursor_moment_id
        )
      )
    order by moment.occurred_on desc, moment.occurred_at desc nulls last,
      moment.id desc
    limit list_memory_moments.page_size;
  end if;
end;
$$;

revoke all on function public.list_memory_moments(
  uuid, integer, integer, integer, date, boolean, timestamptz, uuid, integer,
  timestamptz
) from public, anon;
grant execute on function public.list_memory_moments(
  uuid, integer, integer, integer, date, boolean, timestamptz, uuid, integer,
  timestamptz
) to authenticated;

-- A reaction upsert can wait behind another transaction that creates the row.
-- statement_timestamp() would still describe the waiting statement's start and
-- can therefore predate the winning row. Clamp lifecycle timestamps at trigger
-- execution time so the reversible reaction record remains monotonic.
create or replace function private.enforce_moment_reaction_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Reactions must use the reviewed removal workflow';
  end if;
  if new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.moment_id <> old.moment_id
    or new.author_membership_id <> old.author_membership_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'Reaction identity is immutable';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := greatest(
    pg_catalog.clock_timestamp(), old.updated_at, old.created_at
  );
  if new.removed_at is not null then
    new.removed_at := greatest(new.removed_at, new.updated_at, old.created_at);
  end if;
  return new;
end;
$$;
