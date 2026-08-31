-- Phase 4D-A stages the complete photo-moment draft before upload, then
-- publishes exactly one chronological moment when its verified display
-- derivative exists. Both staging/publication and family delivery fail closed
-- until their database-owned capabilities are explicitly enabled.

create table private.photo_capabilities (
  capability text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp(),
  constraint photo_capabilities_name_valid check (
    capability in ('photo_publication', 'family_derivative_delivery')
  )
);

insert into private.photo_capabilities (capability, enabled)
values ('photo_publication', false), ('family_derivative_delivery', false);

alter table private.photo_capabilities enable row level security;
alter table private.photo_capabilities force row level security;

create function private.photo_capability_is_enabled(
  requested_capability text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select capability.enabled
      from private.photo_capabilities as capability
     where capability.capability = requested_capability
  ), false);
$$;

create function private.current_family_session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions as session
     where session.id::text = (select auth.jwt() ->> 'session_id')
       and session.user_id = (select auth.uid())
       and (session.not_after is null
         or session.not_after > statement_timestamp())
  ) and not (select private.account_closure_is_blocking((select auth.uid())));
$$;

create table private.photo_moment_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  intake_id uuid not null unique,
  moment_id uuid not null unique default extensions.gen_random_uuid(),
  journal_person_id uuid not null,
  requested_by_membership_id uuid not null,
  request_key uuid not null,
  body text not null,
  place_name text,
  occurred_on date not null,
  occurred_at timestamptz,
  occurred_timezone text,
  time_precision text not null,
  request_payload_hash bytea not null,
  requested_at timestamptz not null default statement_timestamp(),
  constraint photo_moment_requests_circle_id_id_key unique (circle_id, id),
  constraint photo_moment_requests_circle_moment_key unique (
    circle_id, moment_id
  ),
  constraint photo_moment_requests_request_key_unique unique (
    requested_by_membership_id, request_key
  ),
  constraint photo_moment_requests_intake_fkey foreign key (
    circle_id, intake_id, journal_person_id, requested_by_membership_id
  ) references private.photo_intakes (
    circle_id, id, journal_person_id, requested_by_membership_id
  ) on delete restrict,
  constraint photo_moment_requests_journal_person_fkey foreign key (
    circle_id, journal_person_id
  ) references public.people (circle_id, id) on delete restrict,
  constraint photo_moment_requests_requester_fkey foreign key (
    circle_id, requested_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint photo_moment_requests_body_valid check (
    body = btrim(body) and char_length(body) <= 4000
  ),
  constraint photo_moment_requests_place_valid check (
    place_name is null or (
      place_name = btrim(place_name)
      and char_length(place_name) between 1 and 160
    )
  ),
  constraint photo_moment_requests_time_valid check (
    (time_precision = 'date'
      and occurred_at is null and occurred_timezone is null)
    or (time_precision = 'minute'
      and occurred_at is not null and occurred_timezone is not null
      and char_length(occurred_timezone) between 1 and 64
      and pg_catalog.date_trunc('minute', occurred_at) = occurred_at
      and pg_catalog.timezone(occurred_timezone, occurred_at)::date = occurred_on)
  ),
  constraint photo_moment_requests_payload_hash_valid check (
    octet_length(request_payload_hash) = 32
  )
);

create table private.photo_moment_request_people (
  circle_id uuid not null,
  request_id uuid not null,
  person_id uuid not null,
  primary key (circle_id, request_id, person_id),
  constraint photo_moment_request_people_request_fkey foreign key (
    circle_id, request_id
  ) references private.photo_moment_requests (circle_id, id)
    on delete restrict,
  constraint photo_moment_request_people_person_fkey foreign key (
    circle_id, person_id
  ) references public.people (circle_id, id) on delete restrict
);

alter table private.photo_moment_requests enable row level security;
alter table private.photo_moment_requests force row level security;
alter table private.photo_moment_request_people enable row level security;
alter table private.photo_moment_request_people force row level security;

create index photo_moment_requests_journal_person_idx
  on private.photo_moment_requests (circle_id, journal_person_id);
create index photo_moment_requests_requester_idx
  on private.photo_moment_requests (circle_id, requested_by_membership_id);
create index photo_moment_request_people_person_idx
  on private.photo_moment_request_people (circle_id, person_id);

create function private.reject_photo_request_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Photo moment requests are immutable';
end;
$$;

create trigger photo_moment_requests_immutable
before update or delete on private.photo_moment_requests
for each row execute function private.reject_photo_request_mutation();

create trigger photo_moment_request_people_immutable
before update or delete on private.photo_moment_request_people
for each row execute function private.reject_photo_request_mutation();

alter table public.moments
  drop constraint moments_kind_valid,
  add constraint moments_kind_valid check (
    kind in ('thought', 'milestone', 'location', 'photo')
  );

alter table private.photo_display_derivatives
  add constraint photo_display_derivatives_circle_id_id_original_key unique (
    circle_id, id, original_id
  );

create table public.moment_photos (
  circle_id uuid not null,
  moment_id uuid not null,
  original_id uuid not null,
  display_derivative_id uuid not null,
  display_width integer not null,
  display_height integer not null,
  created_at timestamptz not null default statement_timestamp(),
  primary key (circle_id, moment_id),
  constraint moment_photos_moment_unique unique (moment_id),
  constraint moment_photos_original_unique unique (original_id),
  constraint moment_photos_derivative_unique unique (display_derivative_id),
  constraint moment_photos_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint moment_photos_original_fkey foreign key (circle_id, original_id)
    references private.photo_originals (circle_id, id) on delete restrict,
  constraint moment_photos_derivative_fkey foreign key (
    circle_id, display_derivative_id, original_id
  ) references private.photo_display_derivatives (
    circle_id, id, original_id
  ) on delete restrict,
  constraint moment_photos_shape_valid check (
    display_width between 1 and 2560
    and display_height between 1 and 2560
    and display_width::bigint * display_height::bigint <= 6553600
  )
);

alter table public.moment_photos enable row level security;
alter table public.moment_photos force row level security;

create policy moment_photos_select_live_active_circle
on public.moment_photos for select to authenticated
using (
  (select private.current_family_session_is_live())
  and (select private.is_active_circle_member(circle_id))
  and exists (
    select 1
      from public.moments as moment
     where moment.circle_id = moment_photos.circle_id
       and moment.id = moment_photos.moment_id
       and moment.kind = 'photo'
       and moment.trashed_at is null
  )
);

create function private.enforce_moment_photo_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new is distinct from old then
    raise exception using errcode = '42501',
      message = 'Photo moment identity is immutable';
  end if;
  return new;
end;
$$;

create trigger moment_photos_integrity
before update or delete on public.moment_photos
for each row execute function private.enforce_moment_photo_integrity();

create function private.publish_photo_moment_if_ready(
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

  -- Every photo coordinator takes the circle authority barrier before a
  -- request row. This matches intake reservation and prevents a
  -- reserve-versus-deferred-publication lock inversion.
  perform 1 from public.circles as circle
   where circle.id = target_request.circle_id for update;

  select request.* into target_request
    from private.photo_moment_requests as request
   where request.intake_id = requested_intake_id
     and request.circle_id = target_request.circle_id
   for update;
  if target_request.id is null then return null; end if;

  select photo.moment_id into existing_moment_id
    from public.moment_photos as photo
   where photo.moment_id = target_request.moment_id;
  if existing_moment_id is not null then return existing_moment_id; end if;

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

  insert into public.moment_photos (
    circle_id, moment_id, original_id, display_derivative_id,
    display_width, display_height
  ) values (
    target_request.circle_id, target_request.moment_id, target_original.id,
    target_derivative.id, target_derivative.output_width,
    target_derivative.output_height
  );

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_request.circle_id, target_request.requested_by_membership_id,
    'moment_created', 'moment', target_request.moment_id
  );
  return target_request.moment_id;
exception
  when unique_violation then
    select photo.moment_id into existing_moment_id
      from public.moment_photos as photo
     where photo.moment_id = target_request.moment_id;
    if existing_moment_id is not null then return existing_moment_id; end if;
    raise;
end;
$$;

create function private.publish_photo_moment_after_derivative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_intake_id uuid;
begin
  select original.intake_id into target_intake_id
    from private.photo_originals as original
   where original.id = new.original_id;
  perform private.publish_photo_moment_if_ready(target_intake_id);
  return new;
end;
$$;

create constraint trigger photo_moment_publish_after_derivative
after insert on private.photo_display_derivatives
deferrable initially deferred
for each row execute function private.publish_photo_moment_after_derivative();

create function private.reserve_photo_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_request_key uuid default null
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
  payload_hash bytea;
  reserved record;
  existing_request private.photo_moment_requests%rowtype;
  resulting_request_id uuid;
  resulting_moment_id uuid;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_journal_person_id is null or requested_occurred_on is null
    or requested_request_key is null
    or not (select private.photo_capability_is_enabled(
      'photo_publication'
    ))
    or ((requested_occurred_at is null) <>
      (requested_occurred_timezone is null)) then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  -- Match account closure and the underlying intake reservation exactly:
  -- Auth user -> circle -> membership. Taking the circle first would allow
  -- closure and photo staging to wait on one another in opposite order.
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
    'occurred_timezone', requested_occurred_timezone
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
    occurred_timezone, time_precision, request_payload_hash
  ) values (
    requested_circle_id, reserved.intake_id, requested_journal_person_id,
    actor_membership_id, requested_request_key, normalized_body,
    normalized_place_name, requested_occurred_on, requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    payload_hash
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

create function private.get_photo_moment_status(requested_intake_id uuid)
returns table (status text, moment_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select case
      when photo.moment_id is not null then 'published'
      when intake.state in ('rejected', 'operator_review', 'invalidated')
        or validation.state in ('rejected', 'operator_review', 'invalidated')
        or job.state in ('rejected', 'operator_review', 'invalidated')
        then 'needs_attention'
      when intake.state in ('reserved', 'upload_claimed') then 'uploading'
      else 'processing'
    end,
    photo.moment_id
  from private.photo_moment_requests as request
  join private.photo_intakes as intake on intake.id = request.intake_id
  left join private.photo_validation_jobs as validation
    on validation.intake_id = intake.id
  left join private.photo_originals as original on original.intake_id = intake.id
  left join private.photo_derivative_jobs as job
    on job.original_id = original.id
  left join public.moment_photos as photo
    on photo.moment_id = request.moment_id
  where request.intake_id = requested_intake_id
    and request.requested_by_membership_id =
      private.current_membership_id(request.circle_id)
    and (select private.current_family_session_is_live());
$$;

create function private.get_photo_moment_delivery(requested_moment_id uuid)
returns table (
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select derivative.bucket_id, derivative.object_path,
    derivative.output_mime_type, derivative.output_size_bytes,
    encode(derivative.output_sha256, 'hex'), derivative.output_width,
    derivative.output_height
  from public.moment_photos as photo
  join public.moments as moment
    on moment.circle_id = photo.circle_id and moment.id = photo.moment_id
  join private.photo_display_derivatives as derivative
    on derivative.circle_id = photo.circle_id
   and derivative.id = photo.display_derivative_id
   and derivative.original_id = photo.original_id
  where photo.moment_id = requested_moment_id
    and moment.kind = 'photo' and moment.trashed_at is null
    and (select private.photo_capability_is_enabled(
      'family_derivative_delivery'
    ))
    and (select private.current_family_session_is_live())
    and (select private.is_active_circle_member(photo.circle_id));
$$;

create or replace function private.photo_display_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.photo_derivative_jobs as job
    join private.photo_originals as original on original.id = job.original_id
    where job.display_object_path = requested_object_path
      and job.state = 'leased'
      and job.validator_auth_user_id = (select auth.uid())
      and job.lease_expires_at > statement_timestamp()
      and (select private.photo_validator_is_allowed((select auth.uid())))
      and (select private.photo_intake_requester_is_authorized(
        original.intake_id
      ))
  ) or exists (
    select 1 from public.moment_photos as photo
    join public.moments as moment
      on moment.circle_id = photo.circle_id and moment.id = photo.moment_id
    join private.photo_display_derivatives as derivative
      on derivative.circle_id = photo.circle_id
     and derivative.id = photo.display_derivative_id
     and derivative.original_id = photo.original_id
    where derivative.object_path = requested_object_path
      and moment.kind = 'photo' and moment.trashed_at is null
      and (select private.photo_capability_is_enabled(
        'family_derivative_delivery'
      ))
      and (select private.current_family_session_is_live())
      and (select private.is_active_circle_member(photo.circle_id))
  );
$$;

create function public.reserve_photo_moment(
  circle_id uuid, journal_person_id uuid, body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null, request_key uuid default null
)
returns table (
  intake_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, expires_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.reserve_photo_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, occurred_at, occurred_timezone, request_key
  );
$$;

create function public.get_photo_moment_status(intake_id uuid)
returns table (status text, moment_id uuid)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_photo_moment_status(intake_id);
$$;

create function public.get_photo_moment_delivery(moment_id uuid)
returns table (
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_photo_moment_delivery(moment_id);
$$;

revoke all on table private.photo_capabilities,
  private.photo_moment_requests, private.photo_moment_request_people
  from public, anon, authenticated, service_role;
revoke all on table public.moment_photos
  from public, anon, authenticated, service_role;
grant select on table public.moment_photos to authenticated;

revoke all on function private.photo_capability_is_enabled(text),
  private.current_family_session_is_live(),
  private.reject_photo_request_mutation(),
  private.enforce_moment_photo_integrity(),
  private.publish_photo_moment_if_ready(uuid),
  private.publish_photo_moment_after_derivative(),
  private.reserve_photo_moment(
    uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid
  ),
  private.get_photo_moment_status(uuid),
  private.get_photo_moment_delivery(uuid),
  private.photo_display_path_is_readable(text)
  from public, anon, authenticated, service_role;

grant execute on function private.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid
) to authenticated;
grant execute on function private.get_photo_moment_status(uuid),
  private.get_photo_moment_delivery(uuid),
  private.current_family_session_is_live(),
  private.photo_display_path_is_readable(text)
  to authenticated;

revoke all on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid
), public.get_photo_moment_status(uuid),
  public.get_photo_moment_delivery(uuid)
  from public, anon;
grant execute on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid
), public.get_photo_moment_status(uuid),
  public.get_photo_moment_delivery(uuid)
  to authenticated;
