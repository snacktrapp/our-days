alter table public.moments
  drop constraint moments_kind_valid,
  drop constraint moments_body_valid,
  add column title text,
  add column place_name text,
  add constraint moments_kind_valid check (
    kind in ('thought', 'milestone', 'location')
  ),
  add constraint moments_body_valid check (
    body = btrim(body)
    and char_length(body) <= 4000
    and (kind <> 'thought' or (char_length(body) >= 1 and body ~ '[^[:space:]]'))
  ),
  add constraint moments_title_valid check (
    (kind = 'milestone' and title = btrim(title) and char_length(title) between 1 and 120)
    or (kind <> 'milestone' and title is null)
  ),
  add constraint moments_place_name_valid check (
    (
      place_name is not null
      and place_name = btrim(place_name)
      and char_length(place_name) between 1 and 160
    )
    or (place_name is null and kind <> 'location')
  );

create table public.moment_people (
  circle_id uuid not null,
  moment_id uuid not null,
  person_id uuid not null,
  tagged_by_membership_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  removed_at timestamptz,
  primary key (circle_id, moment_id, person_id),
  constraint moment_people_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint moment_people_person_fkey foreign key (circle_id, person_id)
    references public.people (circle_id, id) on delete restrict,
  constraint moment_people_tagger_fkey foreign key (circle_id, tagged_by_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict
);

create index moment_people_person_idx
  on public.moment_people (circle_id, person_id, moment_id)
  where removed_at is null;
create index moment_people_tagger_idx
  on public.moment_people (circle_id, tagged_by_membership_id);

create table public.moment_notes (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  moment_id uuid not null,
  author_membership_id uuid not null,
  body text not null,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  trashed_at timestamptz,
  constraint moment_notes_circle_id_id_key unique (circle_id, id),
  constraint moment_notes_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint moment_notes_author_fkey foreign key (circle_id, author_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint moment_notes_body_valid check (
    body = btrim(body)
    and char_length(body) between 1 and 1000
    and body ~ '[^[:space:]]'
  ),
  constraint moment_notes_revision_valid check (revision >= 1),
  constraint moment_notes_timestamp_order_valid check (updated_at >= created_at)
);

create index moment_notes_live_moment_idx
  on public.moment_notes (circle_id, moment_id, created_at, id)
  where trashed_at is null;
create index moment_notes_author_idx
  on public.moment_notes (circle_id, author_membership_id, created_at desc);

create table public.moment_reactions (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  moment_id uuid not null,
  author_membership_id uuid not null,
  reaction_type text not null,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  removed_at timestamptz,
  constraint moment_reactions_circle_id_id_key unique (circle_id, id),
  constraint moment_reactions_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint moment_reactions_author_fkey foreign key (circle_id, author_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint moment_reactions_one_per_member unique (
    circle_id, moment_id, author_membership_id
  ),
  constraint moment_reactions_type_valid check (
    reaction_type in ('held-close', 'made-me-smile', 'remember-this')
  ),
  constraint moment_reactions_revision_valid check (revision >= 1),
  constraint moment_reactions_timestamp_order_valid check (updated_at >= created_at)
);

create index moment_reactions_live_moment_idx
  on public.moment_reactions (circle_id, moment_id, created_at, id)
  where removed_at is null;
create index moment_reactions_author_idx
  on public.moment_reactions (circle_id, author_membership_id, created_at desc);

create function private.enforce_moment_person_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Moment tags must use the reviewed removal workflow';
  end if;
  if new.circle_id <> old.circle_id
    or new.moment_id <> old.moment_id
    or new.person_id <> old.person_id
    or new.tagged_by_membership_id <> old.tagged_by_membership_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'Moment tag identity is immutable';
  end if;
  return new;
end;
$$;

create trigger moment_people_integrity
before update or delete on public.moment_people
for each row execute function private.enforce_moment_person_integrity();

create function private.enforce_moment_note_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Notes must use the reviewed deletion workflow';
  end if;
  if new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.moment_id <> old.moment_id
    or new.author_membership_id <> old.author_membership_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'Note identity is immutable';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger moment_notes_integrity
before update or delete on public.moment_notes
for each row execute function private.enforce_moment_note_integrity();

create function private.enforce_moment_reaction_integrity()
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
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger moment_reactions_integrity
before update or delete on public.moment_reactions
for each row execute function private.enforce_moment_reaction_integrity();

create function private.family_moment_payload_is_valid(
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
      and (requested_place_name is null or char_length(requested_place_name) between 1 and 160)
    when 'milestone' then
      char_length(requested_title) between 1 and 120
      and char_length(requested_body) <= 4000
      and (requested_place_name is null or char_length(requested_place_name) between 1 and 160)
    when 'location' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and char_length(requested_place_name) between 1 and 160
    else false
  end;
$$;

create function private.tags_are_valid(
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
      ) as valid_tags
    );
$$;

create function private.create_family_moment(
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
    circle_id, journal_person_id, recorded_by_user_id, kind, title, body,
    place_name, occurred_on, occurred_at, occurred_timezone, time_precision
  ) values (
    requested_circle_id, requested_journal_person_id, current_user_id,
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

create function private.update_family_moment(
  target_moment_id uuid,
  expected_revision bigint,
  requested_title text,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
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
  target_kind text;
  target_revision bigint;
  circle_time_zone text;
  actor_membership_id uuid;
  normalized_title text := nullif(btrim(requested_title), '');
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[] := coalesce(requested_tagged_person_ids, '{}'::uuid[]);
  resulting_revision bigint;
begin
  if current_user_id is null or target_moment_id is null
    or expected_revision is null or expected_revision < 1
    or requested_occurred_on is null
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null)) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;

  select circle.time_zone into circle_time_zone
  from public.circles as circle where circle.id = target_circle_id for update;

  select moment.journal_person_id, moment.kind, moment.revision
    into target_journal_person_id, target_kind, target_revision
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.circle_id = target_circle_id
    and moment.trashed_at is null
  for update;

  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';

  if actor_membership_id is null or circle_time_zone is null
    or target_journal_person_id is null
    or not (select private.can_manage_person(
      target_circle_id, target_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
  end if;
  if not (select private.family_moment_payload_is_valid(
      target_kind, normalized_title, normalized_body, normalized_place_name
    ))
    or not (select private.tags_are_valid(
      target_circle_id, target_journal_person_id, normalized_tags
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
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  update public.moments
  set title = normalized_title,
      body = normalized_body,
      place_name = normalized_place_name,
      occurred_on = requested_occurred_on,
      occurred_at = requested_occurred_at,
      occurred_timezone = requested_occurred_timezone,
      time_precision = case when requested_occurred_at is null then 'date' else 'minute' end
  where id = target_moment_id
  returning revision into resulting_revision;

  update public.moment_people
  set removed_at = statement_timestamp()
  where moment_id = target_moment_id
    and removed_at is null
    and not (person_id = any(normalized_tags));
  insert into public.moment_people (
    circle_id, moment_id, person_id, tagged_by_membership_id
  )
  select target_circle_id, target_moment_id, tagged.person_id,
    actor_membership_id
  from unnest(normalized_tags) as tagged(person_id)
  on conflict (circle_id, moment_id, person_id) do update
    set removed_at = null;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_updated', 'moment',
    target_moment_id
  );
  return resulting_revision;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
end;
$$;

create function private.create_moment_note(
  target_moment_id uuid,
  requested_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  actor_membership_id uuid;
  normalized_body text := btrim(requested_body);
  resulting_note_id uuid;
begin
  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;
  perform 1 from public.circles where id = target_circle_id for update;
  perform 1 from public.moments as moment
  where moment.id = target_moment_id and moment.circle_id = target_circle_id
    and moment.trashed_at is null
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'Note could not be saved';
  end if;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null or normalized_body is null
    or char_length(normalized_body) not between 1 and 1000
    or normalized_body !~ '[^[:space:]]' then
    raise exception using errcode = '42501', message = 'Note could not be saved';
  end if;
  insert into public.moment_notes (
    circle_id, moment_id, author_membership_id, body
  ) values (
    target_circle_id, target_moment_id, actor_membership_id, normalized_body
  ) returning id into resulting_note_id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_note_created', 'moment_note',
    resulting_note_id
  );
  return resulting_note_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value then
    raise exception using errcode = '22023', message = 'Note could not be saved';
end;
$$;

create function private.update_moment_note(
  target_note_id uuid,
  expected_revision bigint,
  requested_body text
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
  target_author_membership_id uuid;
  target_revision bigint;
  actor_membership_id uuid;
  normalized_body text := btrim(requested_body);
  resulting_revision bigint;
begin
  if target_note_id is null or expected_revision is null
    or expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Note could not be changed';
  end if;
  select note.circle_id into target_circle_id
  from public.moment_notes as note where note.id = target_note_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select note.circle_id, note.author_membership_id, note.revision
    into target_circle_id, target_author_membership_id, target_revision
  from public.moment_notes as note
  join public.moments as moment
    on moment.circle_id = note.circle_id and moment.id = note.moment_id
  where note.id = target_note_id and note.trashed_at is null
    and moment.trashed_at is null
  for update of note;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or actor_membership_id <> target_author_membership_id then
    raise exception using errcode = '42501', message = 'Note could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Note changed elsewhere';
  end if;
  if normalized_body is null or char_length(normalized_body) not between 1 and 1000
    or normalized_body !~ '[^[:space:]]' then
    raise exception using errcode = '22023', message = 'Note could not be changed';
  end if;
  update public.moment_notes set body = normalized_body where id = target_note_id
  returning revision into resulting_revision;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_note_updated', 'moment_note',
    target_note_id
  );
  return resulting_revision;
end;
$$;

create function private.trash_moment_note(
  target_note_id uuid,
  expected_revision bigint
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
  target_author_membership_id uuid;
  target_revision bigint;
  actor_membership_id uuid;
  resulting_revision bigint;
begin
  if target_note_id is null or expected_revision is null
    or expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Note could not be changed';
  end if;
  select note.circle_id into target_circle_id
  from public.moment_notes as note where note.id = target_note_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select note.circle_id, note.author_membership_id, note.revision
    into target_circle_id, target_author_membership_id, target_revision
  from public.moment_notes as note
  join public.moments as moment
    on moment.circle_id = note.circle_id and moment.id = note.moment_id
  where note.id = target_note_id and note.trashed_at is null
    and moment.trashed_at is null
  for update of note;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or actor_membership_id <> target_author_membership_id then
    raise exception using errcode = '42501', message = 'Note could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Note changed elsewhere';
  end if;
  update public.moment_notes set trashed_at = statement_timestamp()
  where id = target_note_id returning revision into resulting_revision;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_note_trashed', 'moment_note',
    target_note_id
  );
  return resulting_revision;
end;
$$;

create function private.set_moment_reaction(
  target_moment_id uuid,
  requested_reaction_type text
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
  actor_membership_id uuid;
  resulting_revision bigint;
  reaction_subject_id uuid;
  existing_removed_at timestamptz;
begin
  if requested_reaction_type is not null
    and requested_reaction_type not in (
      'held-close', 'made-me-smile', 'remember-this'
    ) then
    raise exception using errcode = '22023', message = 'Response could not be saved';
  end if;
  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;
  perform 1 from public.circles where id = target_circle_id for update;
  perform 1 from public.moments as moment
  where moment.id = target_moment_id and moment.circle_id = target_circle_id
    and moment.trashed_at is null
  for key share;
  if not found then
    raise exception using errcode = '42501', message = 'Response could not be saved';
  end if;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null then
    raise exception using errcode = '42501', message = 'Response could not be saved';
  end if;
  if requested_reaction_type is null then
    select reaction.id, reaction.revision, reaction.removed_at
      into reaction_subject_id, resulting_revision, existing_removed_at
      from public.moment_reactions as reaction
     where reaction.circle_id = target_circle_id
       and reaction.moment_id = target_moment_id
       and reaction.author_membership_id = actor_membership_id
     for update;
    if reaction_subject_id is null or existing_removed_at is not null then
      return coalesce(resulting_revision, 0);
    end if;
    update public.moment_reactions
       set removed_at = statement_timestamp()
     where id = reaction_subject_id
    returning revision into resulting_revision;
  else
    insert into public.moment_reactions (
      circle_id, moment_id, author_membership_id, reaction_type, removed_at
    ) values (
      target_circle_id, target_moment_id, actor_membership_id,
      requested_reaction_type, null
    )
    on conflict (circle_id, moment_id, author_membership_id) do update
    set reaction_type = requested_reaction_type,
        removed_at = null
    returning id, revision into reaction_subject_id, resulting_revision;
  end if;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id,
    case when requested_reaction_type is null
      then 'moment_reaction_removed' else 'moment_reaction_set' end,
    'moment_reaction', reaction_subject_id
  );
  return resulting_revision;
end;
$$;

alter table private.audit_events
  drop constraint audit_events_event_type_valid,
  add constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created', 'invitation_accepted', 'invitation_revoked',
      'membership_revoked', 'membership_role_changed',
      'managed_person_created', 'guardian_added', 'guardian_removed',
      'moment_created', 'moment_updated', 'moment_trashed', 'moment_restored',
      'moment_note_created', 'moment_note_updated', 'moment_note_trashed',
      'moment_reaction_set', 'moment_reaction_removed'
    )
  ),
  drop constraint audit_events_subject_type_valid,
  add constraint audit_events_subject_type_valid check (
    subject_type in (
      'invitation', 'membership', 'person', 'guardian', 'moment',
      'moment_note', 'moment_reaction'
    )
  );

alter table public.moment_people enable row level security;
alter table public.moment_notes enable row level security;
alter table public.moment_reactions enable row level security;

create policy moment_people_select_live_parent
on public.moment_people for select to authenticated
using (
  removed_at is null
  and
  (select private.is_active_circle_member(circle_id))
  and exists (
    select 1 from public.moments as moment
    where moment.circle_id = moment_people.circle_id
      and moment.id = moment_people.moment_id
      and moment.trashed_at is null
  )
);

create policy moment_notes_select_live_parent
on public.moment_notes for select to authenticated
using (
  trashed_at is null
  and (select private.is_active_circle_member(circle_id))
  and exists (
    select 1 from public.moments as moment
    where moment.circle_id = moment_notes.circle_id
      and moment.id = moment_notes.moment_id
      and moment.trashed_at is null
  )
);

create policy moment_reactions_select_live_parent
on public.moment_reactions for select to authenticated
using (
  removed_at is null
  and (select private.is_active_circle_member(circle_id))
  and exists (
    select 1 from public.moments as moment
    where moment.circle_id = moment_reactions.circle_id
      and moment.id = moment_reactions.moment_id
      and moment.trashed_at is null
  )
);

revoke all on table public.moment_people, public.moment_notes,
  public.moment_reactions from public, anon, authenticated;
grant select on table public.moment_people, public.moment_notes,
  public.moment_reactions to authenticated;

revoke all on function private.enforce_moment_person_integrity() from public, anon, authenticated;
revoke all on function private.enforce_moment_note_integrity() from public, anon, authenticated;
revoke all on function private.enforce_moment_reaction_integrity() from public, anon, authenticated;
revoke all on function private.family_moment_payload_is_valid(text, text, text, text) from public, anon, authenticated;
revoke all on function private.tags_are_valid(uuid, uuid, uuid[]) from public, anon;
revoke all on function private.create_family_moment(uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text) from public, anon;
revoke all on function private.update_family_moment(uuid, bigint, text, text, text, uuid[], date, timestamptz, text) from public, anon;
revoke all on function private.create_moment_note(uuid, text) from public, anon;
revoke all on function private.update_moment_note(uuid, bigint, text) from public, anon;
revoke all on function private.trash_moment_note(uuid, bigint) from public, anon;
revoke all on function private.set_moment_reaction(uuid, text) from public, anon;
grant execute on function private.create_family_moment(uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text) to authenticated;
grant execute on function private.update_family_moment(uuid, bigint, text, text, text, uuid[], date, timestamptz, text) to authenticated;
grant execute on function private.create_moment_note(uuid, text) to authenticated;
grant execute on function private.update_moment_note(uuid, bigint, text) to authenticated;
grant execute on function private.trash_moment_note(uuid, bigint) to authenticated;
grant execute on function private.set_moment_reaction(uuid, text) to authenticated;

create function public.create_family_moment(
  circle_id uuid, journal_person_id uuid, moment_kind text,
  moment_title text, moment_body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null, occurred_timezone text default null
)
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.create_family_moment(
    circle_id, journal_person_id, moment_kind, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone
  );
$$;

create function public.update_family_moment(
  moment_id uuid, expected_revision bigint, moment_title text,
  moment_body text, place_name text, tagged_person_ids uuid[],
  occurred_on date, occurred_at timestamptz default null,
  occurred_timezone text default null
)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.update_family_moment(
    moment_id, expected_revision, moment_title, moment_body, place_name,
    tagged_person_ids, occurred_on, occurred_at, occurred_timezone
  );
$$;

create function public.create_moment_note(moment_id uuid, body text)
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.create_moment_note(moment_id, body);
$$;

create function public.update_moment_note(
  note_id uuid, expected_revision bigint, body text
)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.update_moment_note(note_id, expected_revision, body);
$$;

create function public.trash_moment_note(note_id uuid, expected_revision bigint)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.trash_moment_note(note_id, expected_revision);
$$;

create function public.set_moment_reaction(moment_id uuid, reaction_type text)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.set_moment_reaction(moment_id, reaction_type);
$$;

revoke all on function public.create_family_moment(uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text) from public, anon;
revoke all on function public.update_family_moment(uuid, bigint, text, text, text, uuid[], date, timestamptz, text) from public, anon;
revoke all on function public.create_moment_note(uuid, text) from public, anon;
revoke all on function public.update_moment_note(uuid, bigint, text) from public, anon;
revoke all on function public.trash_moment_note(uuid, bigint) from public, anon;
revoke all on function public.set_moment_reaction(uuid, text) from public, anon;
grant execute on function public.create_family_moment(uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text) to authenticated;
grant execute on function public.update_family_moment(uuid, bigint, text, text, text, uuid[], date, timestamptz, text) to authenticated;
grant execute on function public.create_moment_note(uuid, text) to authenticated;
grant execute on function public.update_moment_note(uuid, bigint, text) to authenticated;
grant execute on function public.trash_moment_note(uuid, bigint) to authenticated;
grant execute on function public.set_moment_reaction(uuid, text) to authenticated;

create or replace function public.update_written_moment(
  moment_id uuid,
  expected_revision bigint,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  target_circle_id uuid;
  target_journal_person_id uuid;
  target_kind text;
begin
  select moment.circle_id, moment.journal_person_id, moment.kind
    into target_circle_id, target_journal_person_id, target_kind
    from public.moments as moment
   where moment.id = update_written_moment.moment_id;
  if target_kind <> 'thought' then
    if not (select private.can_manage_person(
      target_circle_id, target_journal_person_id
    )) then
      raise exception using errcode = '42501', message = 'Moment could not be changed';
    end if;
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;
  return private.update_written_moment(
    moment_id, expected_revision, body, occurred_on, occurred_at,
    occurred_timezone
  );
end;
$$;

create function public.get_moment_conversation(moment_id uuid)
returns table (notes jsonb, reactions jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'authorPersonId', note_author.id,
        'authorName', note_author.display_name,
        'authorAccent', note_author.accent_token,
        'body', note.body,
        'revision', note.revision,
        'createdAt', note.created_at,
        'canChange', note.author_membership_id = private.current_membership_id(moment.circle_id)
      ) order by note.created_at, note.id)
      from public.moment_notes as note
      join public.circle_memberships as note_membership
        on note_membership.circle_id = note.circle_id
       and note_membership.id = note.author_membership_id
      join public.people as note_author
        on note_author.circle_id = note_membership.circle_id
       and note_author.id = note_membership.person_id
      where note.circle_id = moment.circle_id and note.moment_id = moment.id
        and note.trashed_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reaction.id,
        'personId', reaction_author.id,
        'personName', reaction_author.display_name,
        'personAccent', reaction_author.accent_token,
        'reactionId', reaction.reaction_type,
        'revision', reaction.revision,
        'isCurrentMember', reaction.author_membership_id = private.current_membership_id(moment.circle_id)
      ) order by reaction.created_at, reaction.id)
      from public.moment_reactions as reaction
      join public.circle_memberships as reaction_membership
        on reaction_membership.circle_id = reaction.circle_id
       and reaction_membership.id = reaction.author_membership_id
      join public.people as reaction_author
        on reaction_author.circle_id = reaction_membership.circle_id
       and reaction_author.id = reaction_membership.person_id
      where reaction.circle_id = moment.circle_id
        and reaction.moment_id = moment.id
        and reaction.removed_at is null
    ), '[]'::jsonb)
  from public.moments as moment
  where moment.id = get_moment_conversation.moment_id
    and moment.trashed_at is null;
$$;

revoke all on function public.get_moment_conversation(uuid) from public, anon;
grant execute on function public.get_moment_conversation(uuid) to authenticated;

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
  feed_snapshot_at timestamptz
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

drop function public.list_manageable_trashed_written_moments(uuid);
drop function private.list_manageable_trashed_written_moments(uuid);

create function private.list_manageable_trashed_written_moments(
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
  join public.people as person
    on person.circle_id = moment.circle_id
   and person.id = moment.journal_person_id
  where moment.circle_id = requested_circle_id
    and moment.trashed_at is not null
    and (select private.is_active_circle_member(requested_circle_id))
    and (select private.can_manage_person(moment.circle_id, moment.journal_person_id))
  order by moment.trashed_at desc, moment.id desc;
$$;

revoke all on function private.list_manageable_trashed_written_moments(uuid)
  from public, anon;
grant execute on function private.list_manageable_trashed_written_moments(uuid)
  to authenticated;

create function public.list_manageable_trashed_written_moments(circle_id uuid)
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
security invoker
set search_path = ''
as $$
  select * from private.list_manageable_trashed_written_moments(circle_id);
$$;

revoke all on function public.list_manageable_trashed_written_moments(uuid)
  from public, anon;
grant execute on function public.list_manageable_trashed_written_moments(uuid)
  to authenticated;
