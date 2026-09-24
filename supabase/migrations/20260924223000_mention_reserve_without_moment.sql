-- Photo and video reserves preallocate a moment id before the moments row
-- exists. Applying mentions at reserve time raised 42501 ("Mention could not
-- be saved") for every upload that sent mention arrays, including empty
-- arrays from posts with no @mentions. Null and empty arrays are no mentions
-- on create. Real mentions are staged on the media request and written only
-- after the moment row exists.

alter table private.photo_moment_requests
  add column mentioned_user_ids uuid[],
  add column mention_starts integer[],
  add column mention_ends integer[];

alter table private.video_upload_requests
  add column mentioned_user_ids uuid[],
  add column mention_starts integer[],
  add column mention_ends integer[];

create or replace function private.reject_photo_request_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Photo moment requests are immutable';
  end if;
  if to_jsonb(new)
      - 'circle_ids'
      - 'mentioned_user_ids'
      - 'mention_starts'
      - 'mention_ends'
    is distinct from to_jsonb(old)
      - 'circle_ids'
      - 'mentioned_user_ids'
      - 'mention_starts'
      - 'mention_ends' then
    raise exception using errcode = '42501',
      message = 'Photo moment requests are immutable';
  end if;
  return new;
end;
$$;

create or replace function private.apply_content_mentions(
  target_moment_id uuid,
  target_note_id uuid,
  requested_user_ids uuid[],
  requested_starts integer[],
  requested_ends integer[],
  requested_body text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_audience text;
  target_kind text;
  target_journal_person_id uuid;
  actor_membership_id uuid;
  normalized_body text := coalesce(requested_body, '');
  mention_count integer := coalesce(cardinality(requested_user_ids), 0);
  idx integer;
  requested_user uuid;
  span_start integer;
  span_end integer;
  span_text text;
begin
  -- Null means the caller is not changing mentions.
  if requested_user_ids is null then
    return;
  end if;
  if current_user_id is null or target_moment_id is null then
    raise exception using errcode = '42501', message = 'Mention could not be saved';
  end if;
  if mention_count > 20
    or coalesce(cardinality(requested_starts), 0) is distinct from mention_count
    or coalesce(cardinality(requested_ends), 0) is distinct from mention_count
    or (
      mention_count > 0
      and (
        select count(distinct user_id)
        from unnest(requested_user_ids) as user_id
      ) is distinct from mention_count
    ) then
    raise exception using errcode = '22023', message = 'Mention could not be saved';
  end if;

  select moment.circle_id, moment.audience, moment.kind, moment.journal_person_id
    into target_circle_id, target_audience, target_kind, target_journal_person_id
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.trashed_at is null;

  -- A preallocated photo/video id is not a moment yet. Empty mentions must
  -- not fail that reserve. An edit of a live moment still clears on empty.
  if target_circle_id is null or target_kind = 'insight' then
    if mention_count = 0 then
      return;
    end if;
    raise exception using errcode = '42501', message = 'Mention could not be saved';
  end if;

  if target_note_id is null then
    select membership.id into actor_membership_id
    from public.circle_memberships as membership
    where membership.circle_id = target_circle_id
      and membership.user_id = current_user_id
      and membership.status = 'active';
    if actor_membership_id is null
      or not (select private.can_manage_person(
        target_circle_id, target_journal_person_id
      )) then
      raise exception using errcode = '42501', message = 'Mention could not be saved';
    end if;
  else
    select note.author_membership_id into actor_membership_id
    from public.moment_notes as note
    join public.circle_memberships as author
      on author.circle_id = note.circle_id
     and author.id = note.author_membership_id
    where note.id = target_note_id
      and note.moment_id = target_moment_id
      and note.circle_id = target_circle_id
      and note.trashed_at is null
      and author.user_id = current_user_id
      and author.status = 'active';
    if actor_membership_id is null then
      raise exception using errcode = '42501', message = 'Mention could not be saved';
    end if;
  end if;

  if coalesce(target_audience, 'family') = 'just_me' and mention_count > 0 then
    raise exception using errcode = '22023', message = 'Mention could not be saved';
  end if;

  for idx in 1..mention_count loop
    requested_user := requested_user_ids[idx];
    span_start := requested_starts[idx];
    span_end := requested_ends[idx];
    if requested_user is null
      or span_start is null
      or span_end is null
      or span_start < 0
      or span_end <= span_start
      or span_end > char_length(normalized_body) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
    if exists (
      select 1
      from generate_series(1, idx - 1) as prior(i)
      where requested_starts[prior.i] < span_end
        and span_start < requested_ends[prior.i]
    ) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
    span_text := substring(
      normalized_body from span_start + 1 for span_end - span_start
    );
    if not (select private.mention_user_is_in_moment_circle(
      target_moment_id, target_circle_id, requested_user, span_text
    )) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
  end loop;

  if target_note_id is null then
    update public.content_mentions as mention
    set removed_at = statement_timestamp()
    where mention.moment_id = target_moment_id
      and mention.note_id is null
      and mention.removed_at is null
      and not (mention.mentioned_user_id = any (requested_user_ids));
  else
    update public.content_mentions as mention
    set removed_at = statement_timestamp()
    where mention.note_id = target_note_id
      and mention.removed_at is null
      and not (mention.mentioned_user_id = any (requested_user_ids));
  end if;

  for idx in 1..mention_count loop
    requested_user := requested_user_ids[idx];
    span_start := requested_starts[idx];
    span_end := requested_ends[idx];
    if target_note_id is null then
      update public.content_mentions
      set start_offset = span_start,
          end_offset = span_end,
          removed_at = null
      where moment_id = target_moment_id
        and note_id is null
        and mentioned_user_id = requested_user;
      if not found then
        insert into public.content_mentions (
          circle_id, moment_id, note_id, mentioned_user_id,
          author_membership_id, start_offset, end_offset, notified_at
        ) values (
          target_circle_id, target_moment_id, null, requested_user,
          actor_membership_id, span_start, span_end,
          case
            when requested_user = current_user_id then statement_timestamp()
            else null
          end
        );
      end if;
    else
      update public.content_mentions
      set start_offset = span_start,
          end_offset = span_end,
          removed_at = null
      where note_id = target_note_id
        and mentioned_user_id = requested_user;
      if not found then
        insert into public.content_mentions (
          circle_id, moment_id, note_id, mentioned_user_id,
          author_membership_id, start_offset, end_offset, notified_at
        ) values (
          target_circle_id, target_moment_id, target_note_id, requested_user,
          actor_membership_id, span_start, span_end,
          case
            when requested_user = current_user_id then statement_timestamp()
            else null
          end
        );
      end if;
    end if;
  end loop;
end;
$$;

-- Validates and stores mentions on a media request. The moments row does not
-- exist yet. Empty input is a no-op. Invalid mentions fail the reserve.
create function private.stage_media_mentions(
  requested_kind text,
  requested_request_id uuid,
  requested_user_ids uuid[],
  requested_starts integer[],
  requested_ends integer[],
  requested_body text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  mention_count integer := coalesce(cardinality(requested_user_ids), 0);
  target_circle_id uuid;
  target_audience text;
  target_circle_ids uuid[];
  requester_membership_id uuid;
  normalized_body text := coalesce(requested_body, '');
  idx integer;
  requested_user uuid;
  span_start integer;
  span_end integer;
  span_text text;
begin
  if requested_user_ids is null or mention_count = 0 then
    return;
  end if;
  if current_user_id is null
    or requested_request_id is null
    or requested_kind not in ('photo', 'video') then
    raise exception using errcode = '42501', message = 'Mention could not be saved';
  end if;
  if mention_count > 20
    or coalesce(cardinality(requested_starts), 0) is distinct from mention_count
    or coalesce(cardinality(requested_ends), 0) is distinct from mention_count
    or (
      select count(distinct user_id)
      from unnest(requested_user_ids) as user_id
    ) is distinct from mention_count then
    raise exception using errcode = '22023', message = 'Mention could not be saved';
  end if;

  if requested_kind = 'photo' then
    select request.circle_id, request.audience, request.circle_ids,
      request.requested_by_membership_id
      into target_circle_id, target_audience, target_circle_ids,
        requester_membership_id
    from private.photo_moment_requests as request
    where request.intake_id = requested_request_id;
  else
    select request.circle_id, request.audience, request.circle_ids,
      request.requested_by_membership_id
      into target_circle_id, target_audience, target_circle_ids,
        requester_membership_id
    from private.video_upload_requests as request
    where request.id = requested_request_id
      and request.journal_person_id is not null;
  end if;

  if target_circle_id is null
    or not exists (
      select 1
      from public.circle_memberships as membership
      where membership.id = requester_membership_id
        and membership.user_id = current_user_id
        and membership.status = 'active'
    ) then
    raise exception using errcode = '42501', message = 'Mention could not be saved';
  end if;
  if coalesce(target_audience, 'family') = 'just_me' then
    raise exception using errcode = '22023', message = 'Mention could not be saved';
  end if;

  for idx in 1..mention_count loop
    requested_user := requested_user_ids[idx];
    span_start := requested_starts[idx];
    span_end := requested_ends[idx];
    if requested_user is null
      or span_start is null
      or span_end is null
      or span_start < 0
      or span_end <= span_start
      or span_end > char_length(normalized_body) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
    if exists (
      select 1
      from generate_series(1, idx - 1) as prior(i)
      where requested_starts[prior.i] < span_end
        and span_start < requested_ends[prior.i]
    ) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
    span_text := substring(
      normalized_body from span_start + 1 for span_end - span_start
    );
    if not exists (
      select 1
      from public.circle_memberships as membership
      join public.people as person
        on person.circle_id = membership.circle_id
       and person.id = membership.person_id
      where membership.user_id = requested_user
        and membership.status = 'active'
        and span_text = '@' || person.display_name
        and (
          membership.circle_id = target_circle_id
          or membership.circle_id = any (coalesce(target_circle_ids, '{}'::uuid[]))
        )
    ) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
  end loop;

  if requested_kind = 'photo' then
    update private.photo_moment_requests as request
       set mentioned_user_ids = requested_user_ids,
           mention_starts = requested_starts,
           mention_ends = requested_ends
     where request.intake_id = requested_request_id;
  else
    update private.video_upload_requests as request
       set mentioned_user_ids = requested_user_ids,
           mention_starts = requested_starts,
           mention_ends = requested_ends
     where request.id = requested_request_id;
  end if;
end;
$$;

-- Writes staged mentions after the moments row (and its circle links) exist.
-- Failures are swallowed so a caption mention cannot block publication.
create function private.attach_staged_moment_mentions(target_moment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  user_ids uuid[];
  starts integer[];
  ends integer[];
  caption text;
  author_membership_id uuid;
  author_user_id uuid;
  target_circle_id uuid;
  mention_count integer;
  idx integer;
  requested_user uuid;
  span_start integer;
  span_end integer;
  span_text text;
begin
  if target_moment_id is null then
    return;
  end if;

  select request.mentioned_user_ids, request.mention_starts, request.mention_ends,
    request.body, request.requested_by_membership_id, request.circle_id
    into user_ids, starts, ends, caption, author_membership_id, target_circle_id
  from private.photo_moment_requests as request
  where request.moment_id = target_moment_id
    and coalesce(cardinality(request.mentioned_user_ids), 0) > 0
  order by request.requested_at
  limit 1;

  if user_ids is null then
    select request.mentioned_user_ids, request.mention_starts, request.mention_ends,
      request.body, request.requested_by_membership_id, request.circle_id
      into user_ids, starts, ends, caption, author_membership_id, target_circle_id
    from private.video_upload_requests as request
    where request.moment_id = target_moment_id
      and request.journal_person_id is not null
      and coalesce(cardinality(request.mentioned_user_ids), 0) > 0
    limit 1;
  end if;

  mention_count := coalesce(cardinality(user_ids), 0);
  if mention_count = 0 or target_circle_id is null then
    return;
  end if;

  select membership.user_id into author_user_id
  from public.circle_memberships as membership
  where membership.id = author_membership_id
    and membership.circle_id = target_circle_id
    and membership.status = 'active';
  if author_user_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.moments as moment
    where moment.id = target_moment_id
      and moment.circle_id = target_circle_id
      and moment.trashed_at is null
      and moment.kind in ('photo', 'video')
      and coalesce(moment.audience, 'family') = 'family'
  ) then
    return;
  end if;

  for idx in 1..mention_count loop
    requested_user := user_ids[idx];
    span_start := starts[idx];
    span_end := ends[idx];
    if requested_user is null
      or span_start is null
      or span_end is null
      or span_end > char_length(coalesce(caption, '')) then
      return;
    end if;
    span_text := substring(coalesce(caption, '') from span_start + 1 for span_end - span_start);
    if not (select private.mention_user_is_in_moment_circle(
      target_moment_id, target_circle_id, requested_user, span_text
    )) then
      return;
    end if;
  end loop;

  for idx in 1..mention_count loop
    requested_user := user_ids[idx];
    span_start := starts[idx];
    span_end := ends[idx];
    update public.content_mentions
    set start_offset = span_start,
        end_offset = span_end,
        removed_at = null
    where moment_id = target_moment_id
      and note_id is null
      and mentioned_user_id = requested_user;
    if not found then
      insert into public.content_mentions (
        circle_id, moment_id, note_id, mentioned_user_id,
        author_membership_id, start_offset, end_offset, notified_at
      ) values (
        target_circle_id, target_moment_id, null, requested_user,
        author_membership_id, span_start, span_end,
        case
          when requested_user = author_user_id then statement_timestamp()
          else null
        end
      );
    end if;
  end loop;
exception
  when others then
    return;
end;
$$;

revoke all on function private.stage_media_mentions(text, uuid, uuid[], integer[], integer[], text)
  from public, anon;
revoke all on function private.attach_staged_moment_mentions(uuid)
  from public, anon, authenticated;
grant execute on function private.stage_media_mentions(text, uuid, uuid[], integer[], integer[], text)
  to authenticated;

create or replace function public.create_moment_note(
  moment_id uuid,
  body text,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_moment_note(moment_id, body);
  if coalesce(cardinality(mentioned_user_ids), 0) > 0 then
    perform private.apply_content_mentions(
      moment_id,
      created_id,
      mentioned_user_ids,
      mention_starts,
      mention_ends,
      btrim(body)
    );
  end if;
  return created_id;
end;
$$;

create or replace function public.create_written_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  audience text default null,
  circle_ids uuid[] default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_written_moment(
    circle_id,
    journal_person_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    audience
  );
  perform private.link_additional_moment_circles(created_id, circle_ids);
  if coalesce(cardinality(mentioned_user_ids), 0) > 0 then
    perform private.apply_content_mentions(
      created_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(body)
    );
  end if;
  return created_id;
end;
$$;

create or replace function public.create_family_moment(
  circle_id uuid,
  journal_person_id uuid,
  moment_kind text,
  moment_title text,
  moment_body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  latitude double precision default null,
  longitude double precision default null,
  audience text default null,
  circle_ids uuid[] default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_family_moment(
    circle_id, journal_person_id, moment_kind, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, audience
  );
  perform private.link_additional_moment_circles(created_id, circle_ids);
  if coalesce(cardinality(mentioned_user_ids), 0) > 0 then
    perform private.apply_content_mentions(
      created_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(moment_body)
    );
  end if;
  return created_id;
end;
$$;

create or replace function public.reserve_photo_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  request_key uuid default null,
  audience text default null,
  circle_ids uuid[] default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns table (
  intake_id uuid,
  moment_id uuid,
  bucket_id text,
  object_path text,
  state text,
  expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  reserved record;
begin
  select * into reserved
  from private.reserve_photo_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, occurred_at, occurred_timezone, request_key, audience
  );
  if reserved.intake_id is not null then
    perform private.store_media_request_circle_ids(
      'photo', reserved.intake_id, circle_ids
    );
  end if;
  if coalesce(cardinality(mentioned_user_ids), 0) > 0
    and reserved.moment_id is not null then
    perform private.stage_media_mentions(
      'photo', reserved.intake_id, mentioned_user_ids, mention_starts,
      mention_ends, btrim(body)
    );
  end if;
  return query
  select reserved.intake_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.expires_at;
end;
$$;

create or replace function public.reserve_video_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  expected_mime_type text,
  expected_size_bytes bigint,
  duration_ms integer,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  request_key uuid default null,
  audience text default null,
  circle_ids uuid[] default null,
  existing_moment_id uuid default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns table (
  request_id uuid,
  moment_id uuid,
  bucket_id text,
  object_path text,
  state text,
  upload_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  reserved record;
begin
  select * into reserved
  from private.reserve_video_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
    occurred_at, occurred_timezone, request_key, audience, existing_moment_id
  );
  if reserved.request_id is not null and existing_moment_id is null then
    perform private.store_media_request_circle_ids(
      'video', reserved.request_id, circle_ids
    );
  end if;
  if coalesce(cardinality(mentioned_user_ids), 0) > 0
    and existing_moment_id is null
    and reserved.moment_id is not null then
    perform private.stage_media_mentions(
      'video', reserved.request_id, mentioned_user_ids, mention_starts,
      mention_ends, btrim(body)
    );
  end if;
  return query
  select reserved.request_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.upload_expires_at;
end;
$$;

create or replace function private.publish_photo_moment_if_ready(
  requested_intake_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_request private.photo_moment_requests%rowtype;
  target_original private.photo_originals%rowtype;
  target_derivative private.photo_display_derivatives%rowtype;
  requester_user_id uuid;
  existing_photo_id uuid;
  existing_moment_id uuid;
begin
  if requested_intake_id is null
    or not (select private.photo_capability_is_enabled(
      'photo_publication'
    )) then
    return null;
  end if;

  select request.* into target_request
    from private.photo_moment_requests as request
   where request.intake_id = requested_intake_id;
  if target_request.id is null then return null; end if;

  perform 1 from public.circles as circle
   where circle.id = target_request.circle_id for update;

  select request.* into target_request
    from private.photo_moment_requests as request
   where request.intake_id = requested_intake_id
     and request.circle_id = target_request.circle_id
   for update;
  if target_request.id is null then return null; end if;

  select photo.id into existing_photo_id
    from public.moment_photos as photo
    join private.photo_originals as original
      on original.id = photo.original_id
   where original.intake_id = requested_intake_id;
  if existing_photo_id is not null then
    perform private.attach_staged_moment_mentions(target_request.moment_id);
    return target_request.moment_id;
  end if;

  select membership.user_id into requester_user_id
    from public.circle_memberships as membership
   where membership.circle_id = target_request.circle_id
     and membership.id = target_request.requested_by_membership_id
     and membership.status = 'active'
   for update;

  select original.* into target_original
    from private.photo_originals as original
   where original.intake_id = requested_intake_id
   for update;
  if target_original.id is null then return null; end if;

  select derivative.* into target_derivative
    from private.photo_display_derivatives as derivative
    join private.photo_derivative_jobs as job
      on job.circle_id = derivative.circle_id
     and job.id = derivative.derivative_job_id
     and job.state = 'verified'
   where derivative.original_id = target_original.id
   for update of derivative;
  if target_derivative.id is null then return null; end if;

  if requester_user_id is null
    or target_original.circle_id <> target_request.circle_id
    or target_original.journal_person_id <>
      target_request.journal_person_id
    or target_original.recorded_by_membership_id <>
      target_request.requested_by_membership_id
    or not (select private.photo_intake_requester_is_authorized(
      requested_intake_id
    ))
    or not exists (
      select 1 from storage.objects as object
       where object.bucket_id = target_derivative.bucket_id
         and object.name = target_derivative.object_path
         and object.id = target_derivative.storage_object_id
         and coalesce(object.version, '') =
           target_derivative.storage_object_version
         and object.metadata ->> 'mimetype' =
           target_derivative.output_mime_type
         and object.metadata ->> 'size' =
           target_derivative.output_size_bytes::text
    ) then
    return null;
  end if;

  select moment.id into existing_moment_id
    from public.moments as moment
   where moment.id = target_request.moment_id
     and moment.circle_id = target_request.circle_id
   for update;

  if existing_moment_id is null then
    insert into public.moments (
      id, circle_id, journal_person_id, recorded_by_membership_id, kind, title,
      body, place_name, occurred_on, occurred_at, occurred_timezone,
      time_precision
    ) values (
      target_request.moment_id, target_request.circle_id,
      target_request.journal_person_id,
      target_request.requested_by_membership_id, 'photo', null,
      target_request.body, target_request.place_name,
      target_request.occurred_on, target_request.occurred_at,
      target_request.occurred_timezone, target_request.time_precision
    );

    insert into public.moment_people (
      circle_id, moment_id, person_id, tagged_by_membership_id
    )
    select target_request.circle_id, target_request.moment_id,
      tagged.person_id, target_request.requested_by_membership_id
      from private.photo_moment_request_people as tagged
     where tagged.circle_id = target_request.circle_id
       and tagged.request_id = target_request.id;

    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      target_request.circle_id, target_request.requested_by_membership_id,
      'moment_created', 'moment', target_request.moment_id
    );
  end if;

  insert into public.moment_photos (
    circle_id, moment_id, original_id, display_derivative_id,
    display_width, display_height, sort_order
  ) values (
    target_request.circle_id, target_request.moment_id, target_original.id,
    target_derivative.id, target_derivative.output_width,
    target_derivative.output_height, target_request.sort_order
  );

  perform private.attach_staged_moment_mentions(target_request.moment_id);
  return target_request.moment_id;
exception
  when unique_violation then
    select photo.id into existing_photo_id
      from public.moment_photos as photo
      join private.photo_originals as original
        on original.id = photo.original_id
     where original.intake_id = requested_intake_id;
    if existing_photo_id is not null then
      perform private.attach_staged_moment_mentions(target_request.moment_id);
      return target_request.moment_id;
    end if;
    select moment.id into existing_moment_id
      from public.moments as moment
     where moment.id = target_request.moment_id;
    if existing_moment_id is not null then
      perform private.attach_staged_moment_mentions(existing_moment_id);
      return existing_moment_id;
    end if;
    raise;
end;
$$;

create or replace function private.finalize_video_moment(requested_request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target private.video_upload_requests%rowtype;
  stored_object storage.objects%rowtype;
  existing_moment public.moments%rowtype;
begin
  select request.* into target
    from private.video_upload_requests as request
   where request.id = requested_request_id
   for update;

  if target.id is null
    or not (select private.video_requester_is_authorized(target.id)) then
    raise exception using errcode = '42501',
      message = 'Video moment could not be finished';
  end if;
  if target.state = 'published' then
    perform private.attach_staged_moment_mentions(target.moment_id);
    return target.moment_id;
  end if;
  if target.state <> 'upload_claimed'
    or target.upload_expires_at <= statement_timestamp() then
    raise exception using errcode = '22023',
      message = 'Video moment could not be finished';
  end if;

  select object.* into stored_object
    from storage.objects as object
   where object.bucket_id = 'our-days-videos'
     and object.name = target.object_path;

  if stored_object.id is null
    or stored_object.owner_id is distinct from (select auth.uid()::text)
    or stored_object.user_metadata is distinct from jsonb_build_object(
      'video_request_id', target.id::text,
      'request_key', target.request_key::text,
      'expected_mime_type', target.expected_mime_type,
      'expected_size_bytes', target.expected_size_bytes,
      'duration_ms', target.duration_ms
    )
    or stored_object.metadata ->> 'mimetype' is distinct from
      target.expected_mime_type
    or stored_object.metadata ->> 'size' is distinct from
      target.expected_size_bytes::text then
    raise exception using errcode = '22023',
      message = 'Video moment could not be finished';
  end if;

  if target.journal_person_id is null then
    select moment.* into existing_moment
      from public.moments as moment
     where moment.circle_id = target.circle_id
       and moment.id = target.moment_id
       and moment.kind = 'insight'
       and moment.trashed_at is null
     for update;
    if existing_moment.id is null then
      raise exception using errcode = '42501',
        message = 'Video moment could not be finished';
    end if;
  else
    insert into public.moments (
      id, circle_id, journal_person_id, recorded_by_membership_id, kind,
      title, body, place_name, occurred_on, occurred_at,
      occurred_timezone, time_precision
    ) values (
      target.moment_id, target.circle_id, target.journal_person_id,
      target.requested_by_membership_id, 'video', null, target.body,
      target.place_name, target.occurred_on, target.occurred_at,
      target.occurred_timezone, target.time_precision
    );

    insert into public.moment_people (
      circle_id, moment_id, person_id, tagged_by_membership_id
    )
    select target.circle_id, target.moment_id, tagged.person_id,
      target.requested_by_membership_id
      from private.video_upload_request_people as tagged
     where tagged.circle_id = target.circle_id
       and tagged.request_id = target.id;
  end if;

  insert into public.moment_videos (
    circle_id, moment_id, upload_request_id, object_path, mime_type,
    size_bytes, duration_ms, storage_object_id, storage_object_version
  ) values (
    target.circle_id, target.moment_id, target.id, target.object_path,
    target.expected_mime_type, target.expected_size_bytes,
    target.duration_ms, stored_object.id, coalesce(stored_object.version, '')
  );

  update private.video_upload_requests as request
     set state = 'published', published_at = statement_timestamp()
   where request.id = target.id;

  if target.journal_person_id is not null then
    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      target.circle_id, target.requested_by_membership_id,
      'moment_created', 'moment', target.moment_id
    );
  end if;
  perform private.attach_staged_moment_mentions(target.moment_id);
  return target.moment_id;
exception
  when unique_violation then
    if exists (
      select 1 from public.moment_videos as video
       where video.moment_id = target.moment_id
    ) then
      perform private.attach_staged_moment_mentions(target.moment_id);
      return target.moment_id;
    end if;
    raise;
end;
$$;

revoke all on function public.create_moment_note(uuid, text, uuid[], integer[], integer[]) from public, anon;
revoke all on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[], uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[], uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[],
  uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) from public, anon;

grant execute on function public.create_moment_note(uuid, text, uuid[], integer[], integer[]) to authenticated;
grant execute on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[], uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[], uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[],
  uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) to authenticated;

notify pgrst, 'reload schema';
