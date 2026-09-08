-- Keep Who-else tags on Just me create/update and media reserve.
-- tags_are_valid still rejects self-tags, blanks, and out-of-circle people.

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
  requested_occurred_timezone text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_audience text default null
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
  normalized_audience text := coalesce(requested_audience, 'family');
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_journal_person_id is null
    or requested_occurred_on is null
    or requested_kind in ('photo', 'video', 'insight')
    or normalized_audience not in ('family', 'just_me')
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.family_moment_payload_is_valid(
      requested_kind, normalized_title, normalized_body, normalized_place_name
    ))
    or not (select private.coordinates_are_valid(
      requested_latitude, requested_longitude
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
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
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
    place_name, latitude, longitude, occurred_on, occurred_at, occurred_timezone,
    time_precision, audience
  ) values (
    requested_circle_id, requested_journal_person_id, actor_membership_id,
    requested_kind, normalized_title, normalized_body, normalized_place_name,
    requested_latitude, requested_longitude, requested_occurred_on,
    requested_occurred_at, requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    normalized_audience
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

create or replace function private.reserve_photo_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_request_key uuid default null,
  requested_audience text default null
)
returns table (
  intake_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[];
  normalized_audience text := coalesce(requested_audience, 'family');
  payload_hash bytea;
  reserved record;
  existing_request private.photo_moment_requests%rowtype;
  resulting_request_id uuid;
  resulting_moment_id uuid;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_journal_person_id is null or requested_occurred_on is null
    or requested_request_key is null
    or normalized_audience not in ('family', 'just_me')
    or not (select private.photo_capability_is_enabled(
      'photo_publication'
    ))
    or ((requested_occurred_at is null) <>
      (requested_occurred_timezone is null)) then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  select coalesce(array_agg(tagged.person_id order by tagged.person_id),
      '{}'::uuid[])
    into normalized_tags
    from unnest(coalesce(
      requested_tagged_person_ids, '{}'::uuid[]
    )) as tagged(person_id);

  select circle.time_zone into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id for update;
  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active' for update;


  if actor_membership_id is null or circle_time_zone is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
    ))
    or not (select private.tags_are_valid(
      requested_circle_id, requested_journal_person_id, normalized_tags
    ))
    or char_length(normalized_body) > 4000
    or (normalized_place_name is not null
      and char_length(normalized_place_name) not between 1 and 160)
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (requested_occurred_timezone is not null and not exists (
      select 1 from pg_catalog.pg_timezone_names as zone
       where zone.name = requested_occurred_timezone
    )) then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  payload_hash := extensions.digest(jsonb_build_object(
    'circle_id', requested_circle_id,
    'journal_person_id', requested_journal_person_id,
    'body', normalized_body,
    'place_name', normalized_place_name,
    'tagged_person_ids', to_jsonb(normalized_tags),
    'occurred_on', requested_occurred_on,
    'occurred_at', requested_occurred_at,
    'occurred_timezone', requested_occurred_timezone,
    'audience', normalized_audience
  )::text, 'sha256');

  select * into reserved from private.reserve_photo_intake(
    requested_circle_id, requested_journal_person_id, requested_request_key
  );

  select request.* into existing_request
    from private.photo_moment_requests as request
   where request.intake_id = reserved.intake_id;
  if existing_request.id is not null then
    if existing_request.request_payload_hash <> payload_hash
      or existing_request.requested_by_membership_id <>
        actor_membership_id then
      raise exception using errcode = '22023',
        message = 'Photo moment could not be reserved';
    end if;
    perform private.publish_photo_moment_if_ready(reserved.intake_id);
    return query select reserved.intake_id, existing_request.moment_id,
      reserved.bucket_id, reserved.object_path, reserved.state,
      reserved.expires_at;
    return;
  end if;

  insert into private.photo_moment_requests (
    circle_id, intake_id, journal_person_id, requested_by_membership_id,
    request_key, body, place_name, occurred_on, occurred_at,
    occurred_timezone, time_precision, request_payload_hash, audience
  ) values (
    requested_circle_id, reserved.intake_id, requested_journal_person_id,
    actor_membership_id, requested_request_key, normalized_body,
    normalized_place_name, requested_occurred_on, requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    payload_hash, normalized_audience
  ) returning id, photo_moment_requests.moment_id
      into resulting_request_id, resulting_moment_id;

  insert into private.photo_moment_request_people (
    circle_id, request_id, person_id
  )
  select requested_circle_id, resulting_request_id, tagged.person_id
    from unnest(normalized_tags) as tagged(person_id);

  perform private.publish_photo_moment_if_ready(reserved.intake_id);
  return query select reserved.intake_id, resulting_moment_id,
    reserved.bucket_id, reserved.object_path, reserved.state,
    reserved.expires_at;
end;
$$;

create or replace function private.reserve_video_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_expected_mime_type text,
  requested_expected_size_bytes bigint,
  requested_duration_ms integer,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_request_key uuid default null,
  requested_audience text default null
)
returns table (
  request_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, upload_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_mime_type text := lower(btrim(requested_expected_mime_type));
  normalized_tags uuid[];
  normalized_audience text := coalesce(requested_audience, 'family');
  payload_hash bytea;
  existing private.video_upload_requests%rowtype;
  generated_request_id uuid;
  created private.video_upload_requests%rowtype;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_journal_person_id is null or requested_occurred_on is null
    or requested_request_key is null
    or normalized_audience not in ('family', 'just_me')
    or normalized_mime_type not in (
      'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'
    )
    or requested_expected_size_bytes is null
    or requested_expected_size_bytes not between 1 and 104857600
    or requested_duration_ms is null
    or requested_duration_ms not between 1 and 60500
    or ((requested_occurred_at is null) <>
      (requested_occurred_timezone is null)) then
    raise exception using errcode = '22023',
      message = 'Video moment could not be prepared';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Video moment could not be prepared';
  end if;

  select coalesce(array_agg(tagged.person_id order by tagged.person_id),
      '{}'::uuid[])
    into normalized_tags
    from unnest(coalesce(
      requested_tagged_person_ids, '{}'::uuid[]
    )) as tagged(person_id);

  select circle.time_zone into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id for update;
  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active' for update;


  if actor_membership_id is null or circle_time_zone is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
    ))
    or not (select private.tags_are_valid(
      requested_circle_id, requested_journal_person_id, normalized_tags
    ))
    or char_length(normalized_body) > 4000
    or (normalized_place_name is not null
      and char_length(normalized_place_name) not between 1 and 160)
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (requested_occurred_timezone is not null and not exists (
      select 1 from pg_catalog.pg_timezone_names as zone
       where zone.name = requested_occurred_timezone
    )) then
    raise exception using errcode = '42501',
      message = 'Video moment could not be prepared';
  end if;

  payload_hash := extensions.digest(jsonb_build_object(
    'circle_id', requested_circle_id,
    'journal_person_id', requested_journal_person_id,
    'body', normalized_body,
    'place_name', normalized_place_name,
    'tagged_person_ids', to_jsonb(normalized_tags),
    'occurred_on', requested_occurred_on,
    'occurred_at', requested_occurred_at,
    'occurred_timezone', requested_occurred_timezone,
    'mime_type', normalized_mime_type,
    'size_bytes', requested_expected_size_bytes,
    'duration_ms', requested_duration_ms,
    'audience', normalized_audience
  )::text, 'sha256');

  select request.* into existing
    from private.video_upload_requests as request
   where request.requested_by_membership_id = actor_membership_id
     and request.request_key = requested_request_key
   for update;
  if existing.id is not null then
    if existing.request_payload_hash <> payload_hash then
      raise exception using errcode = '22023',
        message = 'Video upload request was reused';
    end if;
    return query select existing.id, existing.moment_id,
      'our-days-videos'::text, existing.object_path, existing.state,
      existing.upload_expires_at;
    return;
  end if;

  generated_request_id := extensions.gen_random_uuid();
  insert into private.video_upload_requests (
    id, circle_id, journal_person_id, requested_by_membership_id,
    request_key, object_path, expected_mime_type, expected_size_bytes,
    duration_ms, body, place_name, occurred_on, occurred_at,
    occurred_timezone, time_precision, request_payload_hash,
    upload_expires_at, audience
  ) values (
    generated_request_id, requested_circle_id, requested_journal_person_id,
    actor_membership_id, requested_request_key,
    'video/' || generated_request_id::text, normalized_mime_type,
    requested_expected_size_bytes, requested_duration_ms, normalized_body,
    normalized_place_name, requested_occurred_on, requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    payload_hash, statement_timestamp() + interval '2 hours',
    normalized_audience
  ) returning * into created;

  insert into private.video_upload_request_people (
    circle_id, request_id, person_id
  )
  select requested_circle_id, created.id, tagged.person_id
    from unnest(normalized_tags) as tagged(person_id);

  return query select created.id, created.moment_id,
    'our-days-videos'::text, created.object_path, created.state,
    created.upload_expires_at;
end;
$$;
