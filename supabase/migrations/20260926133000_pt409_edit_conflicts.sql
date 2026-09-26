-- Optimistic edit conflicts must not use serialization_failure.
-- PostgREST 14 treats that SQLSTATE as transient and retries the RPC forever.
-- PT409 is the PostgREST conflict code: HTTP 409, and it is not retried.
-- Bodies match the latest installed definitions; only the conflict errcode changes.

create or replace function private.set_moment_audience(
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
    raise exception using errcode = 'PT409', message = 'Moment changed elsewhere';
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
  target_kind text;
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

  select moment.journal_person_id, moment.kind, moment.trashed_at, moment.revision
    into target_journal_person_id, target_kind, target_trashed_at, target_revision
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

  if actor_membership_id is null then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;

  if target_kind = 'insight' then
    if not (select private.is_circle_organizer(target_circle_id)) then
      raise exception using errcode = '42501', message = 'Moment could not be changed';
    end if;
  elsif target_journal_person_id is null
    or not (select private.can_manage_person(
      target_circle_id,
      target_journal_person_id
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;

  if target_revision <> expected_revision then
    raise exception using errcode = 'PT409', message = 'Moment changed elsewhere';
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

create or replace function private.share_private_moment(
  moment_id uuid, expected_revision bigint, destination_circle_id uuid,
  moment_title text, moment_body text, place_name text, tagged_person_ids uuid[],
  occurred_on date, occurred_at timestamptz default null, occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null
)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  original_circle_id uuid;
  post public.moments%rowtype;
  destination_membership_id uuid;
  result_revision bigint;
begin
  if auth.uid() is null or destination_circle_id is null then
    raise exception using errcode = '42501', message = 'Moment could not be shared';
  end if;
  select circle_id into original_circle_id from public.moments where id = moment_id;
  -- Match existing circle-before-moment writes, with stable ordering.
  perform 1 from public.circles where id in (original_circle_id, destination_circle_id)
    order by id for update;
  select * into post from public.moments where id = moment_id for update;
  if post.id is null or post.trashed_at is not null or post.audience <> 'just_me'
    or post.kind = 'insight'
    or not exists (select 1 from public.circle_memberships m
      where m.id = post.recorded_by_membership_id and m.user_id = auth.uid() and m.status = 'active')
    then raise exception using errcode = '42501', message = 'Moment could not be shared';
  end if;
  select id into destination_membership_id from public.circle_memberships
    where circle_id = destination_circle_id and user_id = auth.uid() and status = 'active'
    for share;
  if destination_membership_id is null then
    raise exception using errcode = '42501', message = 'Moment could not be shared';
  end if;
  if expected_revision is null or post.revision <> expected_revision then
    raise exception using errcode = 'PT409', message = 'Moment changed elsewhere';
  end if;
  if (post.kind = 'photo' and not exists(select 1 from public.moment_photos p where p.moment_id = post.id))
    or (post.kind = 'video' and not exists(select 1 from public.moment_videos v where v.moment_id = post.id)) then
    raise exception using errcode = '22023', message = 'Wait for the media to finish before sharing';
  end if;
  -- Validate and save content while still private. Any later error rolls everything back.
  perform private.update_family_moment(post.id, expected_revision, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, 'just_me');
  update public.moments set audience = 'family' where id = post.id returning revision into result_revision;
  delete from public.moment_circles link where link.moment_id = post.id;
  insert into public.moment_circles(moment_id, circle_id) values(post.id, destination_circle_id);
  return result_revision;
end;
$$;

CREATE OR REPLACE FUNCTION private.trash_moment_note(target_note_id uuid, expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.can_read_live_moment(moment.id)
  for update of note;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.id = target_author_membership_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or actor_membership_id is distinct from target_author_membership_id then
    raise exception using errcode = '42501', message = 'Note could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = 'PT409', message = 'Note changed elsewhere';
  end if;
  update public.moment_notes set trashed_at = statement_timestamp()
  where id = target_note_id returning revision into resulting_revision;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    (select circle_id from public.circle_memberships where id = actor_membership_id), actor_membership_id, 'moment_note_trashed', 'moment_note',
    target_note_id
  );
  return resulting_revision;
end;
$function$
;

create or replace function private.update_family_moment(
  target_moment_id uuid,
  expected_revision bigint,
  requested_title text,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_audience text default null
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
  target_audience text;
  circle_time_zone text;
  actor_membership_id uuid;
  normalized_title text := nullif(btrim(requested_title), '');
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[] := coalesce(requested_tagged_person_ids, '{}'::uuid[]);
  normalized_audience text;
  resulting_revision bigint;
begin
  if current_user_id is null or target_moment_id is null
    or expected_revision is null or expected_revision < 1
    or requested_occurred_on is null
    or (
      requested_audience is not null
      and requested_audience not in ('family', 'just_me')
    )
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.coordinates_are_valid(
      requested_latitude, requested_longitude
    )) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;

  select circle.time_zone into circle_time_zone
  from public.circles as circle where circle.id = target_circle_id for update;

  select moment.journal_person_id, moment.kind, moment.revision, moment.audience
    into target_journal_person_id, target_kind, target_revision, target_audience
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.circle_id = target_circle_id
    and moment.trashed_at is null
  for update;

  normalized_audience := coalesce(requested_audience, target_audience, 'family');

  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';

  if actor_membership_id is null or circle_time_zone is null
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
    raise exception using errcode = 'PT409', message = 'Moment changed elsewhere';
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
      and not (select private.is_valid_time_zone(requested_occurred_timezone))
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  update public.moments
  set title = normalized_title,
      body = normalized_body,
      place_name = normalized_place_name,
      latitude = requested_latitude,
      longitude = requested_longitude,
      occurred_on = requested_occurred_on,
      occurred_at = requested_occurred_at,
      occurred_timezone = requested_occurred_timezone,
      time_precision = case when requested_occurred_at is null then 'date' else 'minute' end,
      audience = normalized_audience
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

CREATE OR REPLACE FUNCTION private.update_moment_note(target_note_id uuid, expected_revision bigint, requested_body text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    and private.can_read_live_moment(moment.id)
  for update of note;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.id = target_author_membership_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or actor_membership_id is distinct from target_author_membership_id then
    raise exception using errcode = '42501', message = 'Note could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = 'PT409', message = 'Note changed elsewhere';
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
    (select circle_id from public.circle_memberships where id = actor_membership_id), actor_membership_id, 'moment_note_updated', 'moment_note',
    target_note_id
  );
  return resulting_revision;
end;
$function$
;

create or replace function private.update_written_moment(
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
    raise exception using errcode = 'PT409', message = 'Moment changed elsewhere';
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
