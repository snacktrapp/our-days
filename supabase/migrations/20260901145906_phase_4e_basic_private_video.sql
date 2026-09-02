-- Phase 4E adds intentionally basic private video moments. Original video
-- bytes are preserved without transcoding. A browser may upload only to an
-- exact, short-lived request path, and a moment is published only after the
-- stored object and the current family authority are checked again.

alter table public.moments
  drop constraint moments_kind_valid,
  add constraint moments_kind_valid check (
    kind in ('thought', 'milestone', 'location', 'photo', 'video')
  );

create or replace function private.family_moment_payload_is_valid(
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
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'milestone' then
      char_length(requested_title) between 1 and 120
      and char_length(requested_body) <= 4000
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'location' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and char_length(requested_place_name) between 1 and 160
    when 'photo' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    when 'video' then
      requested_title is null
      and char_length(requested_body) <= 4000
      and (requested_place_name is null
        or char_length(requested_place_name) between 1 and 160)
    else false
  end;
$$;

create table private.video_upload_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  journal_person_id uuid not null,
  requested_by_membership_id uuid not null,
  request_key uuid not null,
  moment_id uuid not null default extensions.gen_random_uuid(),
  object_path text not null,
  state text not null default 'upload_claimed',
  expected_mime_type text not null,
  expected_size_bytes bigint not null,
  duration_ms integer not null,
  body text not null,
  place_name text,
  occurred_on date not null,
  occurred_at timestamptz,
  occurred_timezone text,
  time_precision text not null,
  request_payload_hash bytea not null,
  requested_at timestamptz not null default statement_timestamp(),
  upload_expires_at timestamptz not null,
  published_at timestamptz,
  constraint video_upload_requests_circle_id_id_key unique (circle_id, id),
  constraint video_upload_requests_request_key_unique unique (
    requested_by_membership_id, request_key
  ),
  constraint video_upload_requests_moment_unique unique (moment_id),
  constraint video_upload_requests_path_unique unique (object_path),
  constraint video_upload_requests_person_fkey foreign key (
    circle_id, journal_person_id
  ) references public.people (circle_id, id) on delete restrict,
  constraint video_upload_requests_requester_fkey foreign key (
    circle_id, requested_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint video_upload_requests_path_valid check (
    object_path = 'video/' || id::text
  ),
  constraint video_upload_requests_state_valid check (
    (state = 'upload_claimed' and published_at is null)
    or (state = 'published' and published_at is not null)
  ),
  constraint video_upload_requests_mime_valid check (
    expected_mime_type in (
      'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'
    )
  ),
  constraint video_upload_requests_size_valid check (
    expected_size_bytes between 1 and 104857600
  ),
  constraint video_upload_requests_duration_valid check (
    duration_ms between 1 and 60500
  ),
  constraint video_upload_requests_body_valid check (
    body = btrim(body) and char_length(body) <= 4000
  ),
  constraint video_upload_requests_place_valid check (
    place_name is null
    or (place_name = btrim(place_name)
      and char_length(place_name) between 1 and 160)
  ),
  constraint video_upload_requests_occurrence_valid check (
    (occurred_at is null and occurred_timezone is null
      and time_precision = 'date')
    or (occurred_at is not null and occurred_timezone is not null
      and time_precision = 'minute')
  ),
  constraint video_upload_requests_hash_valid check (
    octet_length(request_payload_hash) = 32
  ),
  constraint video_upload_requests_expiry_valid check (
    upload_expires_at = requested_at + interval '2 hours'
  )
);

create table private.video_upload_request_people (
  circle_id uuid not null,
  request_id uuid not null,
  person_id uuid not null,
  primary key (circle_id, request_id, person_id),
  constraint video_upload_request_people_request_fkey foreign key (
    circle_id, request_id
  ) references private.video_upload_requests (circle_id, id)
    on delete restrict,
  constraint video_upload_request_people_person_fkey foreign key (
    circle_id, person_id
  ) references public.people (circle_id, id) on delete restrict
);

alter table private.video_upload_requests enable row level security;
alter table private.video_upload_requests force row level security;
alter table private.video_upload_request_people enable row level security;
alter table private.video_upload_request_people force row level security;

create function private.enforce_video_upload_request_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Video upload history cannot be deleted';
  end if;
  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.journal_person_id is distinct from old.journal_person_id
    or new.requested_by_membership_id is distinct from
      old.requested_by_membership_id
    or new.request_key is distinct from old.request_key
    or new.moment_id is distinct from old.moment_id
    or new.object_path is distinct from old.object_path
    or new.expected_mime_type is distinct from old.expected_mime_type
    or new.expected_size_bytes is distinct from old.expected_size_bytes
    or new.duration_ms is distinct from old.duration_ms
    or new.body is distinct from old.body
    or new.place_name is distinct from old.place_name
    or new.occurred_on is distinct from old.occurred_on
    or new.occurred_at is distinct from old.occurred_at
    or new.occurred_timezone is distinct from old.occurred_timezone
    or new.time_precision is distinct from old.time_precision
    or new.request_payload_hash is distinct from old.request_payload_hash
    or new.requested_at is distinct from old.requested_at
    or new.upload_expires_at is distinct from old.upload_expires_at
    or not (
      (new.state = old.state
        and new.published_at is not distinct from old.published_at)
      or (old.state = 'upload_claimed' and new.state = 'published'
        and old.published_at is null and new.published_at is not null)
    ) then
    raise exception using errcode = '42501',
      message = 'Video upload identity is immutable';
  end if;
  return new;
end;
$$;

create trigger video_upload_requests_integrity
before update or delete on private.video_upload_requests
for each row execute function private.enforce_video_upload_request_integrity();

create function private.reject_video_request_people_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Video request tags are immutable';
end;
$$;

create trigger video_upload_request_people_immutable
before update or delete on private.video_upload_request_people
for each row execute function private.reject_video_request_people_mutation();

create table public.moment_videos (
  circle_id uuid not null,
  moment_id uuid not null,
  upload_request_id uuid not null,
  bucket_id text not null default 'our-days-videos',
  object_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  duration_ms integer not null,
  storage_object_id uuid not null,
  storage_object_version text not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (circle_id, moment_id),
  constraint moment_videos_moment_unique unique (moment_id),
  constraint moment_videos_request_unique unique (upload_request_id),
  constraint moment_videos_object_unique unique (bucket_id, object_path),
  constraint moment_videos_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint moment_videos_request_fkey foreign key (
    circle_id, upload_request_id
  ) references private.video_upload_requests (circle_id, id)
    on delete restrict,
  constraint moment_videos_bucket_valid check (bucket_id = 'our-days-videos'),
  constraint moment_videos_path_valid check (
    object_path = 'video/' || upload_request_id::text
  ),
  constraint moment_videos_mime_valid check (
    mime_type in ('video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm')
  ),
  constraint moment_videos_size_valid check (
    size_bytes between 1 and 104857600
  ),
  constraint moment_videos_duration_valid check (
    duration_ms between 1 and 60500
  )
);

alter table public.moment_videos enable row level security;
alter table public.moment_videos force row level security;

create policy moment_videos_select_live_active_circle
on public.moment_videos for select to authenticated
using (
  (select private.current_family_session_is_live())
  and (select private.is_active_circle_member(circle_id))
  and exists (
    select 1 from public.moments as moment
     where moment.circle_id = moment_videos.circle_id
       and moment.id = moment_videos.moment_id
       and moment.kind = 'video'
       and moment.trashed_at is null
  )
);

create function private.enforce_moment_video_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new is distinct from old then
    raise exception using errcode = '42501',
      message = 'Video moment identity is immutable';
  end if;
  return new;
end;
$$;

create trigger moment_videos_integrity
before update or delete on public.moment_videos
for each row execute function private.enforce_moment_video_integrity();

create function private.video_requester_is_authorized(
  requested_request_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.video_upload_requests as request
      join public.circle_memberships as membership
        on membership.circle_id = request.circle_id
       and membership.id = request.requested_by_membership_id
     where request.id = requested_request_id
       and membership.status = 'active'
       and membership.user_id = (select auth.uid())
       and not (select private.account_closure_is_blocking(membership.user_id))
       and (select private.current_family_session_is_live())
       and (select private.can_manage_person(
         request.circle_id, request.journal_person_id
       ))
  );
$$;

create function private.video_upload_path_is_uploadable(
  requested_object_path text,
  requested_owner_id text,
  requested_user_metadata jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target private.video_upload_requests%rowtype;
begin
  if (select auth.uid()) is null
    or requested_owner_id is distinct from (select auth.uid()::text) then
    return false;
  end if;

  select request.* into target
    from private.video_upload_requests as request
   where request.object_path = requested_object_path
   for update;

  return target.id is not null
    and target.state = 'upload_claimed'
    and target.upload_expires_at > statement_timestamp()
    and requested_user_metadata = jsonb_build_object(
      'video_request_id', target.id::text,
      'request_key', target.request_key::text,
      'expected_mime_type', target.expected_mime_type,
      'expected_size_bytes', target.expected_size_bytes,
      'duration_ms', target.duration_ms
    )
    and (select private.video_requester_is_authorized(target.id));
end;
$$;

create function private.reserve_video_moment(
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
  requested_request_key uuid default null
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
  payload_hash bytea;
  existing private.video_upload_requests%rowtype;
  generated_request_id uuid;
  created private.video_upload_requests%rowtype;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_journal_person_id is null or requested_occurred_on is null
    or requested_request_key is null
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
    'duration_ms', requested_duration_ms
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
    upload_expires_at
  ) values (
    generated_request_id, requested_circle_id, requested_journal_person_id,
    actor_membership_id, requested_request_key,
    'video/' || generated_request_id::text, normalized_mime_type,
    requested_expected_size_bytes, requested_duration_ms, normalized_body,
    normalized_place_name, requested_occurred_on, requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    payload_hash, statement_timestamp() + interval '2 hours'
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

create function private.finalize_video_moment(requested_request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target private.video_upload_requests%rowtype;
  stored_object storage.objects%rowtype;
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
  if target.state = 'published' then return target.moment_id; end if;
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

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target.circle_id, target.requested_by_membership_id,
    'moment_created', 'moment', target.moment_id
  );
  return target.moment_id;
exception
  when unique_violation then
    if exists (
      select 1 from public.moment_videos as video
       where video.moment_id = target.moment_id
    ) then return target.moment_id; end if;
    raise;
end;
$$;

create function private.get_video_moment_delivery(requested_moment_id uuid)
returns table (
  bucket_id text, object_path text, mime_type text, size_bytes bigint,
  duration_ms integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select video.bucket_id, video.object_path, video.mime_type,
    video.size_bytes, video.duration_ms
  from public.moment_videos as video
  join public.moments as moment
    on moment.circle_id = video.circle_id and moment.id = video.moment_id
  join storage.objects as object
    on object.bucket_id = video.bucket_id
   and object.name = video.object_path
   and object.id = video.storage_object_id
   and coalesce(object.version, '') = video.storage_object_version
  where video.moment_id = requested_moment_id
    and moment.kind = 'video' and moment.trashed_at is null
    and (select private.current_family_session_is_live())
    and (select private.is_active_circle_member(video.circle_id))
    and object.metadata ->> 'mimetype' = video.mime_type
    and object.metadata ->> 'size' = video.size_bytes::text;
$$;

create function private.video_object_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moment_videos as video
      join public.moments as moment
        on moment.circle_id = video.circle_id
       and moment.id = video.moment_id
     where video.object_path = requested_object_path
       and moment.kind = 'video' and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.is_active_circle_member(video.circle_id))
  );
$$;

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
) values (
  'our-days-videos', 'our-days-videos', false, 104857600,
  array[
    'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy our_days_videos_insert_exact_live_tus_claim
on storage.objects for insert to authenticated
with check (
  bucket_id = 'our-days-videos'
  and (select storage.allow_any_operation(array[
    'storage.tus.upload.create', 'storage.tus.upload.part'
  ]::text[]))
  and owner_id = (select auth.uid()::text)
  and (select private.video_upload_path_is_uploadable(
    name, owner_id, user_metadata
  ))
);

create policy our_days_videos_select_live_family
on storage.objects for select to authenticated
using (
  bucket_id = 'our-days-videos'
  and (select private.video_object_path_is_readable(name))
);

create function public.reserve_video_moment(
  circle_id uuid, journal_person_id uuid, body text, place_name text,
  tagged_person_ids uuid[], occurred_on date, expected_mime_type text,
  expected_size_bytes bigint, duration_ms integer,
  occurred_at timestamptz default null,
  occurred_timezone text default null, request_key uuid default null
)
returns table (
  request_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, upload_expires_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.reserve_video_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
    occurred_at, occurred_timezone, request_key
  );
$$;

create function public.finalize_video_moment(request_id uuid)
returns uuid
language sql volatile security invoker set search_path = '' as $$
  select private.finalize_video_moment(request_id);
$$;

create function public.get_video_moment_delivery(moment_id uuid)
returns table (
  bucket_id text, object_path text, mime_type text, size_bytes bigint,
  duration_ms integer
)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_video_moment_delivery(moment_id);
$$;

revoke all on table private.video_upload_requests,
  private.video_upload_request_people
  from public, anon, authenticated, service_role;
revoke all on table public.moment_videos
  from public, anon, authenticated, service_role;
grant select on table public.moment_videos to authenticated;

revoke all on function private.enforce_video_upload_request_integrity(),
  private.reject_video_request_people_mutation(),
  private.enforce_moment_video_integrity(),
  private.video_requester_is_authorized(uuid),
  private.video_upload_path_is_uploadable(text, text, jsonb),
  private.reserve_video_moment(
    uuid, uuid, text, text, uuid[], date, text, bigint, integer,
    timestamptz, text, uuid
  ),
  private.finalize_video_moment(uuid),
  private.get_video_moment_delivery(uuid),
  private.video_object_path_is_readable(text)
  from public, anon, authenticated, service_role;

grant execute on function private.video_upload_path_is_uploadable(
  text, text, jsonb
), private.video_object_path_is_readable(text),
  private.reserve_video_moment(
    uuid, uuid, text, text, uuid[], date, text, bigint, integer,
    timestamptz, text, uuid
  ), private.finalize_video_moment(uuid),
  private.get_video_moment_delivery(uuid)
  to authenticated;

revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer,
  timestamptz, text, uuid
), public.finalize_video_moment(uuid),
  public.get_video_moment_delivery(uuid)
  from public, anon;
grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer,
  timestamptz, text, uuid
), public.finalize_video_moment(uuid),
  public.get_video_moment_delivery(uuid)
  to authenticated;
