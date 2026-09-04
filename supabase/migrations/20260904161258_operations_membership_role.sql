-- Operations is an authenticated circle presence for observe, Insight ingest,
-- and troubleshooting. It is not a family journal person and is not an
-- organizer for invites, role changes, or child-journal care.

alter table public.circle_memberships
  drop constraint circle_memberships_role_valid;

alter table public.circle_memberships
  add constraint circle_memberships_role_valid
  check (role in ('member', 'organizer', 'operations'));

-- Prefer Auth email over display-name matching. Skip a circle when this
-- membership is its last active organizer so the last-organizer invariant
-- stays intact.
update public.circle_memberships as membership
   set role = 'operations'
  from auth.users as users
 where membership.user_id = users.id
   and membership.status = 'active'
   and membership.role = 'organizer'
   and lower(users.email) = 'tars-trapp@agentmail.to'
   and exists (
     select 1
       from public.circle_memberships as other
      where other.circle_id = membership.circle_id
        and other.id <> membership.id
        and other.status = 'active'
        and other.role = 'organizer'
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
       and membership.role <> 'operations'
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

create or replace function private.tags_are_valid(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_tagged_person_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_tagged_person_ids is not null
    and cardinality(requested_tagged_person_ids) <= 25
    and not (requested_journal_person_id = any(requested_tagged_person_ids))
    and not exists (
      select 1 from unnest(requested_tagged_person_ids) as tagged(person_id)
      where tagged.person_id is null
    )
    and (
      select count(*) = cardinality(requested_tagged_person_ids)
      from (
        select distinct tagged.person_id
        from unnest(requested_tagged_person_ids) as tagged(person_id)
        join public.people as person
          on person.circle_id = requested_circle_id
         and person.id = tagged.person_id
        where not exists (
          select 1
            from public.circle_memberships as membership
           where membership.circle_id = requested_circle_id
             and membership.person_id = person.id
             and membership.status = 'active'
             and membership.role = 'operations'
        )
      ) as valid_tags
    );
$$;

create or replace function private.create_insight_moment(
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
  actor_role text;
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

  select membership.id, membership.role
    into actor_membership_id, actor_role
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active'
     and membership.role in ('organizer', 'operations');

  if actor_membership_id is null
    or circle_time_zone is null
    or (
      actor_role = 'organizer'
      and not (select private.is_circle_organizer(requested_circle_id))
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
