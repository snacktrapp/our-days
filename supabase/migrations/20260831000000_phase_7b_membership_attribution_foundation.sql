-- A person's journal and the membership that recorded a moment are durable
-- family-history identities. Auth user IDs are access attachments and must not
-- be copied into moment history. The existing composite recorder foreign key
-- guarantees that each legacy value maps to exactly one same-circle membership,
-- so this cutover can be completed atomically without a dual-source interval.

alter table public.moments
  drop constraint moments_recorder_fkey,
  drop constraint moments_trashed_by_fkey;

drop trigger moments_integrity on public.moments;

alter table public.moments
  rename column recorded_by_user_id to recorded_by_membership_id;

alter table public.moments
  rename column trashed_by_user_id to trashed_by_membership_id;

update public.moments as moment
   set recorded_by_membership_id = membership.id
  from public.circle_memberships as membership
 where membership.circle_id = moment.circle_id
   and membership.user_id = moment.recorded_by_membership_id;

update public.moments as moment
   set trashed_by_membership_id = membership.id
  from public.circle_memberships as membership
 where membership.circle_id = moment.circle_id
   and membership.user_id = moment.trashed_by_membership_id
   and moment.trashed_by_membership_id is not null;

alter table public.moments
  add constraint moments_recorded_by_membership_fkey foreign key (
    circle_id,
    recorded_by_membership_id
  ) references public.circle_memberships (circle_id, id)
    on delete restrict
    not valid,
  add constraint moments_trashed_by_membership_fkey foreign key (
    circle_id,
    trashed_by_membership_id
  ) references public.circle_memberships (circle_id, id)
    on delete restrict
    not valid;

alter table public.moments
  validate constraint moments_recorded_by_membership_fkey;

alter table public.moments
  validate constraint moments_trashed_by_membership_fkey;

alter index public.moments_recorder_idx
  rename to moments_recorded_by_membership_idx;

alter index public.moments_trashed_by_idx
  rename to moments_trashed_by_membership_idx;

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

create or replace function private.create_written_moment(
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
    recorded_by_membership_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    time_precision
  ) values (
    requested_circle_id,
    requested_journal_person_id,
    actor_membership_id,
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
    place_name, occurred_on, occurred_at, occurred_timezone, time_precision
  ) values (
    requested_circle_id, requested_journal_person_id, actor_membership_id,
    requested_kind, normalized_title, normalized_body, normalized_place_name,
    requested_occurred_on, requested_occurred_at, requested_occurred_timezone,
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

-- These three reader functions have deliberately stable public table-return
-- contracts. Rebuild their existing definitions with only the recorder join
-- changed, so column order, names, types, volatility, security mode, search
-- path, ownership, and EXECUTE ACLs cannot drift during this internal cutover.
do $migration$
declare
  target_function regprocedure;
  target_name name;
  existing_definition text;
  updated_definition text;
  legacy_join constant text :=
    'recorder_membership.user_id = moment.recorded_by_user_id';
  membership_join constant text :=
    'recorder_membership.id = moment.recorded_by_membership_id';
  expected_occurrences integer;
  legacy_occurrences integer;
  membership_occurrences integer;
begin
  foreach target_function in array array[
    'public.list_timeline_moments(uuid,uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure,
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure,
    'public.list_milestone_memories(uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(target_function::oid)
      into existing_definition;

    select procedure.proname
      into target_name
      from pg_catalog.pg_proc as procedure
     where procedure.oid = target_function::oid;

    expected_occurrences := case target_name
      when 'list_timeline_moments' then 1
      when 'list_memory_moments' then 2
      when 'list_milestone_memories' then 1
      else 0
    end;

    legacy_occurrences := (
      pg_catalog.char_length(existing_definition)
      - pg_catalog.char_length(
        pg_catalog.replace(existing_definition, legacy_join, '')
      )
    ) / pg_catalog.char_length(legacy_join);

    if legacy_occurrences <> expected_occurrences then
      raise exception using
        errcode = '55000',
        message = 'Recorder attribution reader occurrence count drifted';
    end if;

    updated_definition := pg_catalog.replace(
      existing_definition,
      legacy_join,
      membership_join
    );

    membership_occurrences := (
      pg_catalog.char_length(updated_definition)
      - pg_catalog.char_length(
        pg_catalog.replace(updated_definition, membership_join, '')
      )
    ) / pg_catalog.char_length(membership_join);

    if pg_catalog.strpos(updated_definition, legacy_join) <> 0
      or membership_occurrences <> expected_occurrences then
      raise exception using
        errcode = '55000',
        message = 'Recorder attribution reader could not be migrated';
    end if;

    execute updated_definition;
  end loop;
end;
$migration$;
