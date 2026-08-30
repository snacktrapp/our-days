alter table public.circles
  add column time_zone text not null default 'UTC',
  add constraint circles_time_zone_valid check (
    char_length(time_zone) between 1 and 64
  );

create or replace function private.can_manage_person(
  requested_circle_id uuid,
  requested_person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.circle_memberships as membership
      join public.people as person
        on person.circle_id = membership.circle_id
       and person.id = requested_person_id
     where membership.circle_id = requested_circle_id
       and membership.user_id = (select auth.uid())
       and membership.status = 'active'
       and (
         membership.person_id = requested_person_id
         or (
           person.profile_kind = 'managed'
           and membership.role = 'organizer'
         )
         or exists (
           select 1
             from public.person_guardians as guardian
            where guardian.circle_id = requested_circle_id
              and guardian.managed_person_id = requested_person_id
              and guardian.guardian_membership_id = membership.id
              and guardian.revoked_at is null
         )
       )
  );
$$;

create table public.moments (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  journal_person_id uuid not null,
  recorded_by_user_id uuid not null,
  kind text not null default 'thought',
  body text not null,
  occurred_on date not null,
  occurred_at timestamptz,
  occurred_timezone text,
  time_precision text not null default 'date',
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  trashed_at timestamptz,
  trashed_by_user_id uuid,
  constraint moments_circle_id_id_key unique (circle_id, id),
  constraint moments_journal_person_fkey foreign key (circle_id, journal_person_id)
    references public.people (circle_id, id) on delete restrict,
  constraint moments_recorder_fkey foreign key (circle_id, recorded_by_user_id)
    references public.circle_memberships (circle_id, user_id) on delete restrict,
  constraint moments_trashed_by_fkey foreign key (circle_id, trashed_by_user_id)
    references public.circle_memberships (circle_id, user_id) on delete restrict,
  constraint moments_kind_valid check (kind = 'thought'),
  constraint moments_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 4000
    and body ~ '[^[:space:]]'
  ),
  constraint moments_time_precision_valid check (
    (time_precision = 'date' and occurred_at is null and occurred_timezone is null)
    or
    (
      time_precision = 'minute'
      and occurred_at is not null
      and occurred_timezone is not null
      and char_length(occurred_timezone) between 1 and 64
      and pg_catalog.date_trunc('minute', occurred_at) = occurred_at
      and pg_catalog.timezone(occurred_timezone, occurred_at)::date = occurred_on
    )
  ),
  constraint moments_revision_valid check (revision >= 1),
  constraint moments_timestamp_order_valid check (updated_at >= created_at),
  constraint moments_trash_state_valid check (
    (trashed_at is null and trashed_by_user_id is null)
    or
    (trashed_at is not null and trashed_by_user_id is not null)
  )
);

create index moments_live_circle_timeline_idx
  on public.moments (
    circle_id,
    occurred_on desc,
    ((occurred_at is not null)) desc,
    occurred_at desc nulls last,
    id desc
  )
  where trashed_at is null;

create index moments_live_person_timeline_idx
  on public.moments (
    circle_id,
    journal_person_id,
    occurred_on desc,
    ((occurred_at is not null)) desc,
    occurred_at desc nulls last,
    id desc
  )
  where trashed_at is null;

create index moments_recorder_idx
  on public.moments (circle_id, recorded_by_user_id);

create index moments_trashed_by_idx
  on public.moments (circle_id, trashed_by_user_id)
  where trashed_by_user_id is not null;

create index moments_trashed_person_idx
  on public.moments (circle_id, journal_person_id, trashed_at desc, id desc)
  where trashed_at is not null;

create function private.enforce_moment_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Moments must use the reviewed deletion workflow';
  end if;

  if tg_op = 'UPDATE' and (
    new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.journal_person_id <> old.journal_person_id
    or new.recorded_by_user_id <> old.recorded_by_user_id
    or new.kind <> old.kind
    or new.created_at <> old.created_at
  ) then
    raise exception using errcode = '42501', message = 'Moment identity is immutable';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger moments_integrity
before update or delete on public.moments
for each row execute function private.enforce_moment_integrity();

create function private.create_written_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_occurred_on date,
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
  normalized_body text := btrim(requested_body);
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_journal_person_id is null
    or requested_occurred_on is null
    or normalized_body is null
    or char_length(normalized_body) not between 1 and 4000
    or normalized_body !~ '[^[:space:]]'
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null)) then
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
      requested_circle_id,
      requested_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be created';
  end if;

  if requested_occurred_on > pg_catalog.timezone(
      circle_time_zone,
      statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1
          from pg_catalog.pg_timezone_names as zone
         where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  insert into public.moments (
    circle_id,
    journal_person_id,
    recorded_by_user_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    time_precision
  ) values (
    requested_circle_id,
    requested_journal_person_id,
    current_user_id,
    normalized_body,
    requested_occurred_on,
    requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end
  )
  returning id into resulting_moment_id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  ) values (
    requested_circle_id,
    actor_membership_id,
    'moment_created',
    'moment',
    resulting_moment_id
  );

  return resulting_moment_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be created';
end;
$$;

create function private.update_written_moment(
  target_moment_id uuid,
  expected_revision bigint,
  requested_body text,
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null
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
  target_revision bigint;
  circle_time_zone text;
  actor_membership_id uuid;
  normalized_body text := btrim(requested_body);
  resulting_revision bigint;
begin
  if current_user_id is null
    or target_moment_id is null
    or expected_revision is null
    or expected_revision < 1
    or requested_occurred_on is null
    or normalized_body is null
    or char_length(normalized_body) not between 1 and 4000
    or normalized_body !~ '[^[:space:]]'
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null)) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  select moment.circle_id
    into target_circle_id
    from public.moments as moment
   where moment.id = target_moment_id;

  select circle.time_zone
    into circle_time_zone
    from public.circles as circle
   where circle.id = target_circle_id
   for update;

  select moment.journal_person_id, moment.revision
    into target_journal_person_id, target_revision
    from public.moments as moment
   where moment.id = target_moment_id
     and moment.circle_id = target_circle_id
     and moment.trashed_at is null
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = target_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active';

  if actor_membership_id is null
    or circle_time_zone is null
    or target_journal_person_id is null
    or not (select private.can_manage_person(
      target_circle_id,
      target_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;

  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
  end if;

  if requested_occurred_on > pg_catalog.timezone(
      circle_time_zone,
      statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1
          from pg_catalog.pg_timezone_names as zone
         where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  update public.moments
     set body = normalized_body,
         occurred_on = requested_occurred_on,
         occurred_at = requested_occurred_at,
         occurred_timezone = requested_occurred_timezone,
         time_precision = case
           when requested_occurred_at is null then 'date'
           else 'minute'
         end
   where id = target_moment_id
  returning revision into resulting_revision;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  ) values (
    target_circle_id,
    actor_membership_id,
    'moment_updated',
    'moment',
    target_moment_id
  );

  return resulting_revision;
exception
  when check_violation or invalid_parameter_value or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
end;
$$;

create function private.set_written_moment_trashed(
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

  select moment.journal_person_id, moment.trashed_at, moment.revision
    into target_journal_person_id, target_trashed_at, target_revision
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

  if actor_membership_id is null
    or target_journal_person_id is null
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
           trashed_by_user_id = current_user_id
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
           trashed_by_user_id = null
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

alter table private.audit_events
  drop constraint audit_events_event_type_valid,
  add constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created',
      'invitation_accepted',
      'invitation_revoked',
      'membership_revoked',
      'membership_role_changed',
      'managed_person_created',
      'guardian_added',
      'guardian_removed',
      'moment_created',
      'moment_updated',
      'moment_trashed',
      'moment_restored'
    )
  ),
  drop constraint audit_events_subject_type_valid,
  add constraint audit_events_subject_type_valid check (
    subject_type in ('invitation', 'membership', 'person', 'guardian', 'moment')
  );

alter table public.moments enable row level security;

create policy moments_select_live_active_circle
on public.moments for select to authenticated
using (
  trashed_at is null
  and (select private.is_active_circle_member(circle_id))
);

revoke all on table public.moments from public, anon, authenticated;
grant select on table public.moments to authenticated;

revoke all on function private.enforce_moment_integrity() from public, anon, authenticated;
revoke all on function private.create_written_moment(uuid, uuid, text, date, timestamptz, text) from public, anon;
revoke all on function private.update_written_moment(uuid, bigint, text, date, timestamptz, text) from public, anon;
revoke all on function private.set_written_moment_trashed(uuid, bigint, boolean) from public, anon;
grant execute on function private.create_written_moment(uuid, uuid, text, date, timestamptz, text) to authenticated;
grant execute on function private.update_written_moment(uuid, bigint, text, date, timestamptz, text) to authenticated;
grant execute on function private.set_written_moment_trashed(uuid, bigint, boolean) to authenticated;

create function public.create_written_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_written_moment(
    circle_id,
    journal_person_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone
  );
$$;

create function public.update_written_moment(
  moment_id uuid,
  expected_revision bigint,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null
)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_written_moment(
    moment_id,
    expected_revision,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone
  );
$$;

create function public.set_written_moment_trashed(
  moment_id uuid,
  expected_revision bigint,
  trashed boolean
)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_written_moment_trashed(moment_id, expected_revision, trashed);
$$;

revoke all on function public.create_written_moment(uuid, uuid, text, date, timestamptz, text) from public, anon;
revoke all on function public.update_written_moment(uuid, bigint, text, date, timestamptz, text) from public, anon;
revoke all on function public.set_written_moment_trashed(uuid, bigint, boolean) from public, anon;
grant execute on function public.create_written_moment(uuid, uuid, text, date, timestamptz, text) to authenticated;
grant execute on function public.update_written_moment(uuid, bigint, text, date, timestamptz, text) to authenticated;
grant execute on function public.set_written_moment_trashed(uuid, bigint, boolean) to authenticated;

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
  body text,
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
    list_timeline_moments.snapshot_at,
    statement_timestamp()
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
      (
        list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is not null
      )
      or (
        not list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is null
      )
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
    moment.body,
    moment.occurred_on,
    moment.occurred_at,
    moment.occurred_timezone,
    moment.time_precision,
    moment.revision,
    moment.created_at,
    moment.updated_at,
    (select private.can_manage_person(moment.circle_id, moment.journal_person_id)),
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
  order by
    moment.occurred_on desc,
    moment.occurred_at desc nulls last,
    moment.id desc
  limit list_timeline_moments.page_size;
end;
$$;

create function private.list_manageable_trashed_written_moments(
  requested_circle_id uuid
)
returns table (
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  body text,
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
    moment.body,
    moment.occurred_on,
    moment.revision,
    moment.trashed_at
  from public.moments as moment
  join public.people as person
    on person.circle_id = moment.circle_id
   and person.id = moment.journal_person_id
  where moment.circle_id = requested_circle_id
    and moment.trashed_at is not null
    and (select private.is_active_circle_member(requested_circle_id))
    and (select private.can_manage_person(moment.circle_id, moment.journal_person_id))
  order by moment.trashed_at desc, moment.id desc;
$$;

revoke all on function private.list_manageable_trashed_written_moments(uuid) from public, anon;
grant execute on function private.list_manageable_trashed_written_moments(uuid) to authenticated;

create function public.list_manageable_trashed_written_moments(circle_id uuid)
returns table (
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  body text,
  occurred_on date,
  revision bigint,
  trashed_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.list_manageable_trashed_written_moments(circle_id);
$$;

revoke all on function public.list_timeline_moments(uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz) from public, anon;
revoke all on function public.list_manageable_trashed_written_moments(uuid) from public, anon;
grant execute on function public.list_timeline_moments(uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz) to authenticated;
grant execute on function public.list_manageable_trashed_written_moments(uuid) to authenticated;
