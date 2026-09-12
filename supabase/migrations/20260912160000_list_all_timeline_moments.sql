-- Merged All feed: every circle the viewer belongs to, plus their Just me
-- posts. One row per moment (moment_circles can name several audiences).
-- Conversations stay gated by private.can_read_live_moment.

create function public.list_all_timeline_moments(
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
        and exists (
          select 1
            from public.circle_memberships as mine
           where mine.user_id = (select auth.uid())
             and mine.status = 'active'
             and mine.person_id = moment.journal_person_id
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

revoke all on function public.list_all_timeline_moments(
  date, boolean, timestamptz, uuid, integer, timestamptz
) from public, anon;
grant execute on function public.list_all_timeline_moments(
  date, boolean, timestamptz, uuid, integer, timestamptz
) to authenticated;
