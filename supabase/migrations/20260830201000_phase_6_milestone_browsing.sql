create index moments_live_circle_milestone_idx
  on public.moments (
    circle_id,
    occurred_on desc,
    ((occurred_at is not null)) desc,
    occurred_at desc nulls last,
    id desc
  )
  where trashed_at is null and kind = 'milestone';

create function public.list_milestone_memories(
  circle_id uuid,
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
    list_milestone_memories.snapshot_at, statement_timestamp()
  );
  cursor_is_empty boolean :=
    list_milestone_memories.cursor_occurred_on is null
    and list_milestone_memories.cursor_has_precise_time is null
    and list_milestone_memories.cursor_occurred_at is null
    and list_milestone_memories.cursor_moment_id is null;
  cursor_is_complete boolean :=
    list_milestone_memories.cursor_occurred_on is not null
    and list_milestone_memories.cursor_has_precise_time is not null
    and list_milestone_memories.cursor_moment_id is not null
    and (
      (list_milestone_memories.cursor_has_precise_time
        and list_milestone_memories.cursor_occurred_at is not null)
      or (not list_milestone_memories.cursor_has_precise_time
        and list_milestone_memories.cursor_occurred_at is null)
    );
begin
  if not (
    select private.is_active_circle_member(
      list_milestone_memories.circle_id
    )
  ) then
    raise exception using errcode = '42501', message = 'Milestones could not be listed';
  end if;

  if list_milestone_memories.circle_id is null
    or list_milestone_memories.page_size is null
    or list_milestone_memories.page_size not between 1 and 50
    or list_milestone_memories.snapshot_at > statement_timestamp()
    or not (cursor_is_empty or cursor_is_complete)
    or (not cursor_is_empty and list_milestone_memories.snapshot_at is null)
  then
    raise exception using errcode = '22023', message = 'Milestones could not be listed';
  end if;

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
  where moment.circle_id = list_milestone_memories.circle_id
    and moment.kind = 'milestone'
    and moment.trashed_at is null
    and moment.created_at <= effective_snapshot_at
    and moment.updated_at <= effective_snapshot_at
    and (
      cursor_is_empty
      or (
        moment.occurred_on,
        moment.occurred_at is not null,
        coalesce(moment.occurred_at, '-infinity'::timestamptz),
        moment.id
      ) < (
        list_milestone_memories.cursor_occurred_on,
        list_milestone_memories.cursor_has_precise_time,
        coalesce(
          list_milestone_memories.cursor_occurred_at,
          '-infinity'::timestamptz
        ),
        list_milestone_memories.cursor_moment_id
      )
    )
  order by moment.occurred_on desc, moment.occurred_at desc nulls last,
    moment.id desc
  limit list_milestone_memories.page_size;
end;
$$;

revoke all on function public.list_milestone_memories(
  uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) from public, anon;
grant execute on function public.list_milestone_memories(
  uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) to authenticated;
