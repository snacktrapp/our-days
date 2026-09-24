-- Operations can post a Just me Insight into a consented member's journal.
-- recorded_by_membership_id stays that member so timeline placement, RLS,
-- badge chrome, clips, and organizer trash match an Insight they created.
-- created_by_operations_membership_id is audit-only and is not rendered.

alter table public.moments
  add column created_by_operations_membership_id uuid;

alter table public.moments
  add constraint moments_created_by_operations_membership_fkey
    foreign key (circle_id, created_by_operations_membership_id)
    references public.circle_memberships (circle_id, id)
    on delete restrict,
  add constraint moments_operations_insight_attribution_valid check (
    created_by_operations_membership_id is null
    or (kind = 'insight' and audience = 'just_me')
  );

create or replace function private.enforce_moment_integrity()
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
    or new.recorded_by_membership_id <> old.recorded_by_membership_id
    or new.kind <> old.kind
    or new.created_at <> old.created_at
    or new.created_by_operations_membership_id
      is distinct from old.created_by_operations_membership_id
  ) then
    raise exception using errcode = '42501', message = 'Moment identity is immutable';
  end if;

  new.revision := old.revision + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create table private.operations_just_me_insight_consent (
  user_id uuid primary key references auth.users (id) on delete cascade,
  consented_at timestamptz not null default statement_timestamp()
);

alter table private.operations_just_me_insight_consent enable row level security;
alter table private.operations_just_me_insight_consent force row level security;

revoke all on table private.operations_just_me_insight_consent
  from public, anon, authenticated;

revoke all on function private.is_valid_time_zone(text)
  from public, anon, authenticated;

insert into private.operations_just_me_insight_consent (user_id)
select users.id
  from auth.users as users
 where lower(users.email) = 'trappbrian@gmail.com'
on conflict (user_id) do nothing;

create function private.create_just_me_insight_for_member(
  requested_circle_id uuid,
  requested_member_person_id uuid,
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
  target_membership_id uuid;
  target_user_id uuid;
  circle_time_zone text;
  normalized_quote text := coalesce(btrim(requested_quote), '');
  normalized_attribution text := nullif(btrim(requested_attribution), '');
  normalized_source_url text := nullif(btrim(requested_source_url), '');
  effective_occurred_on date;
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_member_person_id is null
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
     and membership.role = 'organizer'
     and membership.directory_kind = 'operations';

  select membership.id, membership.user_id
    into target_membership_id, target_user_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.person_id = requested_member_person_id
     and membership.status = 'active'
     and membership.directory_kind = 'journal'
     and membership.user_id is not null;

  if actor_membership_id is null
    or target_membership_id is null
    or circle_time_zone is null
    or not (select private.is_circle_organizer(requested_circle_id))
    or not exists (
      select 1
        from private.operations_just_me_insight_consent as consent
       where consent.user_id = target_user_id
    ) then
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
      and not (select private.is_valid_time_zone(requested_occurred_timezone))
    ) then
    raise exception using errcode = '22023', message = 'Insight could not be created';
  end if;

  insert into public.moments (
    circle_id, journal_person_id, recorded_by_membership_id, kind, title, body,
    source_url, occurred_on, occurred_at, occurred_timezone, time_precision,
    audience, created_by_operations_membership_id
  ) values (
    requested_circle_id, null, target_membership_id, 'insight',
    normalized_attribution, normalized_quote, normalized_source_url,
    effective_occurred_on, requested_occurred_at, requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    'just_me', actor_membership_id
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

create function public.create_just_me_insight_for_member(
  circle_id uuid,
  member_person_id uuid,
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
  select private.create_just_me_insight_for_member(
    circle_id,
    member_person_id,
    quote,
    attribution,
    source_url,
    occurred_on,
    occurred_at,
    occurred_timezone
  );
$$;

revoke all on function private.create_just_me_insight_for_member(
  uuid, uuid, text, text, text, date, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.create_just_me_insight_for_member(
  uuid, uuid, text, text, text, date, timestamptz, text
) from public, anon, authenticated;
grant execute on function private.create_just_me_insight_for_member(
  uuid, uuid, text, text, text, date, timestamptz, text
) to authenticated;
grant execute on function public.create_just_me_insight_for_member(
  uuid, uuid, text, text, text, date, timestamptz, text
) to authenticated;
