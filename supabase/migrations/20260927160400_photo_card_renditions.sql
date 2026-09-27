-- Private card WebPs generated after a display derivative is committed.
-- Family members never read this table. The existing delivery RPC returns
-- the card descriptor beside the display one, and storage policies only
-- open a card path that descriptor already authorized.

create table private.photo_card_renditions (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  display_derivative_id uuid not null,
  original_id uuid not null,
  width integer not null,
  bucket_id text not null default 'our-days-display',
  object_path text not null,
  storage_object_id uuid not null,
  storage_object_version text not null,
  output_mime_type text not null,
  output_size_bytes bigint not null,
  output_sha256 bytea not null,
  output_width integer not null,
  output_height integer not null,
  generated_at timestamptz not null default statement_timestamp(),
  constraint photo_card_renditions_derivative_width_key
    unique (display_derivative_id, width),
  constraint photo_card_renditions_path_key unique (object_path),
  constraint photo_card_renditions_storage_object_key
    unique (storage_object_id),
  constraint photo_card_renditions_derivative_fkey foreign key (
    circle_id, display_derivative_id, original_id
  ) references private.photo_display_derivatives (
    circle_id, id, original_id
  ) on delete restrict,
  constraint photo_card_renditions_bucket_valid check (
    bucket_id = 'our-days-display'
  ),
  constraint photo_card_renditions_width_valid check (width = 1080),
  constraint photo_card_renditions_mime_valid check (
    output_mime_type = 'image/webp'
  ),
  constraint photo_card_renditions_size_valid check (
    output_size_bytes between 1 and 12582912
  ),
  constraint photo_card_renditions_sha256_valid check (
    octet_length(output_sha256) = 32
  ),
  constraint photo_card_renditions_shape_valid check (
    output_width between 1 and width
    and output_height between 1 and 2560
    and output_width::bigint * output_height::bigint <= 6553600
  )
);

alter table private.photo_card_renditions enable row level security;
alter table private.photo_card_renditions force row level security;

create function private.enforce_photo_card_rendition_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  display_path text;
begin
  select derivative.object_path into display_path
    from private.photo_display_derivatives as derivative
   where derivative.circle_id = new.circle_id
     and derivative.id = new.display_derivative_id
     and derivative.original_id = new.original_id;
  if display_path is null
    or new.object_path is distinct from
      display_path || '.card-' || new.width::text || '.webp' then
    raise exception using errcode = '23514',
      message = 'Photo card rendition evidence is invalid';
  end if;
  return new;
end;
$$;

create trigger photo_card_renditions_evidence
before insert on private.photo_card_renditions
for each row execute function private.enforce_photo_card_rendition_insert();

create function private.enforce_photo_card_rendition_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Photo card renditions are immutable';
end;
$$;

create trigger photo_card_renditions_integrity
before update or delete on private.photo_card_renditions
for each row execute function private.enforce_photo_card_rendition_integrity();

create function private.photo_card_path_is_uploadable(
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
  parsed_size_bytes bigint;
  parsed_width integer;
  parsed_height integer;
  parsed_card_width integer;
begin
  if requested_object_path is null or requested_owner_id is null
    or requested_user_metadata is null
    or requested_user_metadata ->> 'output_sha256' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(requested_user_metadata -> 'output_size_bytes') <> 'number'
    or jsonb_typeof(requested_user_metadata -> 'output_width') <> 'number'
    or jsonb_typeof(requested_user_metadata -> 'output_height') <> 'number'
    or jsonb_typeof(requested_user_metadata -> 'card_width') <> 'number'
    or requested_user_metadata ->> 'output_mime_type' is distinct from 'image/webp'
  then
    return false;
  end if;

  begin
    parsed_size_bytes := (requested_user_metadata ->> 'output_size_bytes')::bigint;
    parsed_width := (requested_user_metadata ->> 'output_width')::integer;
    parsed_height := (requested_user_metadata ->> 'output_height')::integer;
    parsed_card_width := (requested_user_metadata ->> 'card_width')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return false;
  end;

  if parsed_card_width is distinct from 1080
    or parsed_size_bytes not between 1 and 12582912
    or parsed_width not between 1 and parsed_card_width
    or parsed_height not between 1 and 2560
    or parsed_width::bigint * parsed_height::bigint > 6553600
    or requested_owner_id is distinct from (select auth.uid()::text)
    or not (select private.photo_validator_is_allowed((select auth.uid())))
  then
    return false;
  end if;

  return exists (
    select 1
      from private.photo_display_derivatives as derivative
      join private.photo_derivative_jobs as job
        on job.id = derivative.derivative_job_id
     where job.state = 'verified'
       and requested_object_path =
         derivative.object_path || '.card-' || parsed_card_width::text || '.webp'
       and requested_user_metadata = jsonb_build_object(
         'card_width', parsed_card_width,
         'display_derivative_id', derivative.id::text,
         'original_id', derivative.original_id::text,
         'output_height', parsed_height,
         'output_mime_type', 'image/webp',
         'output_sha256', requested_user_metadata ->> 'output_sha256',
         'output_size_bytes', parsed_size_bytes,
         'output_width', parsed_width
       )
  );
end;
$$;

-- Short per-photo lease for reading a display object after its derivative
-- job lease has ended. The live photo_display_path_is_readable body is not
-- changed: a worker still reads a display photo only while that job lease
-- is active, or while this backfill lease covers that exact path.
create table private.photo_card_backfill_leases (
  display_derivative_id uuid primary key,
  validator_auth_user_id uuid not null,
  state text not null,
  lease_started_at timestamptz not null,
  lease_expires_at timestamptz not null,
  constraint photo_card_backfill_leases_derivative_fkey
    foreign key (display_derivative_id)
    references private.photo_display_derivatives (id) on delete restrict,
  constraint photo_card_backfill_leases_validator_fkey
    foreign key (validator_auth_user_id)
    references auth.users (id) on delete restrict,
  constraint photo_card_backfill_leases_state_valid check (
    state in ('leased', 'released')
  ),
  constraint photo_card_backfill_leases_window_valid check (
    lease_expires_at > lease_started_at
    and lease_expires_at = lease_started_at + interval '2 minutes'
  )
);

alter table private.photo_card_backfill_leases enable row level security;
alter table private.photo_card_backfill_leases force row level security;

create function private.photo_card_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select (
    (select storage.allow_any_operation(array[
      'object.get_authenticated', 'object.get_authenticated_info'
    ]::text[]))
    and (select private.photo_validator_is_allowed((select auth.uid())))
    and exists (
      select 1
        from private.photo_display_derivatives as derivative
        join private.photo_derivative_jobs as job
          on job.id = derivative.derivative_job_id
       where requested_object_path =
           derivative.object_path || '.card-1080.webp'
         and not exists (
           select 1
             from private.photo_card_renditions as card
            where card.object_path = requested_object_path
         )
         and (
           (
             job.state = 'leased'
             and job.validator_auth_user_id = (select auth.uid())
             and job.lease_expires_at > statement_timestamp()
           )
           or exists (
             select 1
               from private.photo_card_backfill_leases as lease
              where lease.display_derivative_id = derivative.id
                and lease.state = 'leased'
                and lease.validator_auth_user_id = (select auth.uid())
                and lease.lease_expires_at > statement_timestamp()
           )
         )
    )
  ) or exists (
    select 1
      from private.photo_card_renditions as card
      join public.moment_photos as photo
        on photo.circle_id = card.circle_id
       and photo.display_derivative_id = card.display_derivative_id
       and photo.original_id = card.original_id
      join public.moments as moment
        on moment.circle_id = photo.circle_id
       and moment.id = photo.moment_id
     where card.object_path = requested_object_path
       and moment.kind = 'photo'
       and moment.trashed_at is null
       and (select private.photo_capability_is_enabled(
         'family_derivative_delivery'
       ))
       and (select private.current_family_session_is_live())
       and (select private.can_read_live_moment(moment.id))
  );
$$;

create function private.photo_display_backfill_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.photo_card_backfill_leases as lease
      join private.photo_display_derivatives as derivative
        on derivative.id = lease.display_derivative_id
     where derivative.object_path = requested_object_path
       and lease.state = 'leased'
       and lease.validator_auth_user_id = (select auth.uid())
       and lease.lease_expires_at > statement_timestamp()
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select storage.allow_any_operation(array[
         'object.get_authenticated', 'object.get_authenticated_info'
       ]::text[]))
  );
$$;

create function private.record_photo_card_rendition(
  requested_display_derivative_id uuid,
  requested_card_width integer,
  requested_storage_object_id uuid,
  requested_storage_object_version text,
  requested_output_size_bytes bigint,
  requested_output_sha256_hex text,
  requested_output_width integer,
  requested_output_height integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target private.photo_display_derivatives%rowtype;
  stored storage.objects%rowtype;
  existing private.photo_card_renditions%rowtype;
  expected_path text;
  recorded_id uuid;
begin
  if current_user_id is null
    or requested_display_derivative_id is null
    or requested_card_width is null
    or requested_card_width is distinct from 1080
    or requested_storage_object_id is null
    or requested_storage_object_version is null
    or requested_output_size_bytes is null
    or requested_output_size_bytes not between 1 and 12582912
    or requested_output_sha256_hex is null
    or requested_output_sha256_hex !~ '^[0-9a-f]{64}$'
    or requested_output_width is null
    or requested_output_width not between 1 and requested_card_width
    or requested_output_height is null
    or requested_output_height not between 1 and 2560
    or requested_output_width::bigint * requested_output_height::bigint > 6553600
    or not (select private.photo_validator_is_allowed(current_user_id))
  then
    raise exception using errcode = '42501',
      message = 'Photo card rendition could not be recorded';
  end if;

  select derivative.* into target
    from private.photo_display_derivatives as derivative
    join private.photo_derivative_jobs as job
      on job.id = derivative.derivative_job_id
   where derivative.id = requested_display_derivative_id
     and job.state = 'verified';
  if target.id is null then
    raise exception using errcode = '42501',
      message = 'Photo card rendition could not be recorded';
  end if;

  expected_path :=
    target.object_path || '.card-' || requested_card_width::text || '.webp';

  select card.* into existing
    from private.photo_card_renditions as card
   where card.display_derivative_id = target.id
     and card.width = requested_card_width;
  if existing.id is not null then
    if existing.output_size_bytes = requested_output_size_bytes
      and encode(existing.output_sha256, 'hex') = requested_output_sha256_hex
      and existing.output_width = requested_output_width
      and existing.output_height = requested_output_height
      and existing.storage_object_id = requested_storage_object_id
      and existing.storage_object_version = requested_storage_object_version
    then
      return existing.id;
    end if;
    raise exception using errcode = '42501',
      message = 'Photo card rendition could not be recorded';
  end if;

  select object.* into stored
    from storage.objects as object
   where object.bucket_id = 'our-days-display'
     and object.name = expected_path;
  if stored.id is distinct from requested_storage_object_id
    or coalesce(stored.version, '') is distinct from requested_storage_object_version
    or stored.metadata ->> 'mimetype' is distinct from 'image/webp'
    or stored.metadata ->> 'size' is distinct from requested_output_size_bytes::text
    or stored.owner_id is distinct from current_user_id::text
    or stored.user_metadata is distinct from jsonb_build_object(
      'card_width', requested_card_width,
      'display_derivative_id', target.id::text,
      'original_id', target.original_id::text,
      'output_height', requested_output_height,
      'output_mime_type', 'image/webp',
      'output_sha256', requested_output_sha256_hex,
      'output_size_bytes', requested_output_size_bytes,
      'output_width', requested_output_width
    )
  then
    raise exception using errcode = '22023',
      message = 'Photo card rendition evidence did not match';
  end if;

  begin
    insert into private.photo_card_renditions (
      circle_id, display_derivative_id, original_id, width, bucket_id,
      object_path, storage_object_id, storage_object_version,
      output_mime_type, output_size_bytes, output_sha256,
      output_width, output_height
    ) values (
      target.circle_id, target.id, target.original_id, requested_card_width,
      'our-days-display', expected_path, stored.id,
      coalesce(stored.version, ''), 'image/webp',
      requested_output_size_bytes, decode(requested_output_sha256_hex, 'hex'),
      requested_output_width, requested_output_height
    )
    returning id into recorded_id;
    return recorded_id;
  exception
    when unique_violation then
      select card.id into recorded_id
        from private.photo_card_renditions as card
       where card.display_derivative_id = target.id
         and card.width = requested_card_width
         and card.output_size_bytes = requested_output_size_bytes
         and encode(card.output_sha256, 'hex') = requested_output_sha256_hex
         and card.output_width = requested_output_width
         and card.output_height = requested_output_height
         and card.storage_object_id = requested_storage_object_id
         and card.storage_object_version = requested_storage_object_version;
      if recorded_id is null then
        raise exception using errcode = '42501',
          message = 'Photo card rendition could not be recorded';
      end if;
      return recorded_id;
  end;
end;
$$;

create function public.record_photo_card_rendition(
  display_derivative_id uuid,
  card_width integer,
  storage_object_id uuid,
  storage_object_version text,
  output_size_bytes bigint,
  output_sha256_hex text,
  output_width integer,
  output_height integer
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.record_photo_card_rendition(
    $1, $2, $3, $4, $5, $6, $7, $8
  );
$$;

create function private.claim_photo_card_backfill_lease(
  requested_display_derivative_id uuid
)
returns table (
  bucket_id text,
  display_derivative_id uuid,
  lease_expires_at timestamptz,
  object_path text,
  original_id uuid,
  output_height integer,
  output_mime_type text,
  output_sha256_hex text,
  output_size_bytes bigint,
  output_width integer,
  state text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  current_user_id uuid := (select auth.uid());
  target private.photo_display_derivatives%rowtype;
begin
  if current_user_id is null
    or requested_display_derivative_id is null
    or not (select private.photo_validator_is_allowed(current_user_id))
  then
    raise exception using errcode = '42501',
      message = 'Photo card backfill lease could not be claimed';
  end if;

  select derivative.* into target
    from private.photo_display_derivatives as derivative
    join private.photo_derivative_jobs as job
      on job.id = derivative.derivative_job_id
   where derivative.id = requested_display_derivative_id
     and job.state = 'verified'
   for update;
  if target.id is null then
    raise exception using errcode = '42501',
      message = 'Photo card backfill lease could not be claimed';
  end if;

  if exists (
    select 1
      from private.photo_card_renditions as card
     where card.display_derivative_id = target.id
       and card.width = 1080
  ) then
    raise exception using errcode = '42501',
      message = 'Photo card backfill lease could not be claimed';
  end if;

  if exists (
    select 1
      from private.photo_card_backfill_leases as lease
     where lease.display_derivative_id = target.id
       and lease.state = 'leased'
       and lease.lease_expires_at > statement_timestamp()
       and lease.validator_auth_user_id is distinct from current_user_id
  ) then
    raise exception using errcode = '42501',
      message = 'Photo card backfill lease could not be claimed';
  end if;

  insert into private.photo_card_backfill_leases (
    display_derivative_id, validator_auth_user_id, state,
    lease_started_at, lease_expires_at
  ) values (
    target.id, current_user_id, 'leased',
    statement_timestamp(), statement_timestamp() + interval '2 minutes'
  )
  on conflict (display_derivative_id) do update
    set validator_auth_user_id = excluded.validator_auth_user_id,
        state = 'leased',
        lease_started_at = excluded.lease_started_at,
        lease_expires_at = excluded.lease_expires_at
  where private.photo_card_backfill_leases.state = 'released'
     or private.photo_card_backfill_leases.lease_expires_at
        <= statement_timestamp()
     or private.photo_card_backfill_leases.validator_auth_user_id
        = excluded.validator_auth_user_id;

  return query
  select target.bucket_id, target.id, lease.lease_expires_at,
    target.object_path, target.original_id, target.output_height,
    target.output_mime_type, encode(target.output_sha256, 'hex'),
    target.output_size_bytes, target.output_width, lease.state
    from private.photo_card_backfill_leases as lease
   where lease.display_derivative_id = target.id
     and lease.state = 'leased'
     and lease.validator_auth_user_id = current_user_id
     and lease.lease_expires_at > statement_timestamp();
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo card backfill lease could not be claimed';
  end if;
end;
$$;

create function public.claim_photo_card_backfill_lease(
  display_derivative_id uuid
)
returns table (
  bucket_id text,
  display_derivative_id uuid,
  lease_expires_at timestamptz,
  object_path text,
  original_id uuid,
  output_height integer,
  output_mime_type text,
  output_sha256_hex text,
  output_size_bytes bigint,
  output_width integer,
  state text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.claim_photo_card_backfill_lease($1);
$$;

create function private.list_photo_card_backfill_candidates(
  requested_batch_limit integer,
  requested_after_display_derivative_id uuid
)
returns table (
  bucket_id text,
  display_derivative_id uuid,
  object_path text,
  original_id uuid,
  output_height integer,
  output_mime_type text,
  output_sha256_hex text,
  output_size_bytes bigint,
  output_width integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  effective_limit integer;
begin
  if current_user_id is null
    or not (select private.photo_validator_is_allowed(current_user_id))
  then
    raise exception using errcode = '42501',
      message = 'Photo card backfill candidates could not be listed';
  end if;
  if requested_batch_limit is null or requested_batch_limit < 1 then
    raise exception using errcode = '22023',
      message = 'Photo card backfill candidates could not be listed';
  end if;
  effective_limit := least(requested_batch_limit, 10);

  return query
  select derivative.bucket_id, derivative.id, derivative.object_path,
    derivative.original_id, derivative.output_height,
    derivative.output_mime_type, encode(derivative.output_sha256, 'hex'),
    derivative.output_size_bytes, derivative.output_width
    from private.photo_display_derivatives as derivative
    join private.photo_derivative_jobs as job
      on job.id = derivative.derivative_job_id
   where job.state = 'verified'
     and (
       requested_after_display_derivative_id is null
       or derivative.id > requested_after_display_derivative_id
     )
     and not exists (
       select 1
         from private.photo_card_renditions as card
        where card.display_derivative_id = derivative.id
          and card.width = 1080
     )
   order by derivative.id
   limit effective_limit;
end;
$$;

create function public.list_photo_card_backfill_candidates(
  batch_limit integer,
  after_display_derivative_id uuid
)
returns table (
  bucket_id text,
  display_derivative_id uuid,
  object_path text,
  original_id uuid,
  output_height integer,
  output_mime_type text,
  output_sha256_hex text,
  output_size_bytes bigint,
  output_width integer
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.list_photo_card_backfill_candidates($1, $2);
$$;

create function private.release_photo_card_backfill_lease(
  requested_display_derivative_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null
    or requested_display_derivative_id is null
    or not (select private.photo_validator_is_allowed(current_user_id))
  then
    raise exception using errcode = '42501',
      message = 'Photo card backfill lease could not be released';
  end if;

  update private.photo_card_backfill_leases as lease
     set state = 'released'
   where lease.display_derivative_id = requested_display_derivative_id
     and lease.validator_auth_user_id = current_user_id
     and lease.state = 'leased';
end;
$$;

create function public.release_photo_card_backfill_lease(
  display_derivative_id uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.release_photo_card_backfill_lease($1);
$$;

drop policy our_days_display_insert_exact_active_derivative_lease
  on storage.objects;
drop policy our_days_display_select_exact_active_derivative_lease
  on storage.objects;
drop policy our_days_storage_objects_closed_until_media_phase
  on storage.objects;

create policy our_days_display_insert_exact_active_derivative_lease
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'our-days-display'
  and (select storage.allow_any_operation(array['object.upload']::text[]))
  and (
    (select private.photo_display_path_is_uploadable(
      name, owner_id, user_metadata
    ))
    or (select private.photo_card_path_is_uploadable(
      name, owner_id, user_metadata
    ))
  )
);

create policy our_days_display_select_exact_active_derivative_lease
on storage.objects
for select
to authenticated
using (
  bucket_id = 'our-days-display'
  and (
    (select private.photo_display_path_is_readable(name))
    or (select private.photo_display_backfill_path_is_readable(name))
    or (select private.photo_card_path_is_readable(name))
  )
);

create policy our_days_storage_objects_closed_until_media_phase
on storage.objects
as restrictive
for all
to anon, authenticated
using (
  bucket_id not in ('our-days-originals', 'our-days-display')
  or (
    bucket_id = 'our-days-originals'
    and (select storage.allow_any_operation(array[
      'object.get_authenticated', 'object.get_authenticated_info',
      'object.upload'
    ]::text[]))
    and (
      (select private.photo_original_path_is_readable(name))
      or (select private.photo_derivative_source_is_readable(
        name, id, version
      ))
    )
  )
  or (
    bucket_id = 'our-days-display'
    and (
      (select private.photo_display_path_is_readable(name))
      or (select private.photo_display_backfill_path_is_readable(name))
      or (select private.photo_card_path_is_readable(name))
    )
  )
)
with check (
  bucket_id not in ('our-days-originals', 'our-days-display')
  or (
    bucket_id = 'our-days-originals'
    and (select storage.allow_any_operation(array['object.upload']::text[]))
    and (select private.photo_original_path_is_uploadable(
      name, owner_id, user_metadata
    ))
  )
  or (
    bucket_id = 'our-days-display'
    and (select storage.allow_any_operation(array['object.upload']::text[]))
    and (
      (select private.photo_display_path_is_uploadable(
        name, owner_id, user_metadata
      ))
      or (select private.photo_card_path_is_uploadable(
        name, owner_id, user_metadata
      ))
    )
  )
);

drop function public.get_photo_moments_delivery(uuid[]);
drop function public.get_photo_moment_delivery(uuid);
drop function private.get_photo_moment_delivery(uuid);

create function private.get_photo_moment_delivery(requested_moment_id uuid)
returns table (
  photo_id uuid, sort_order integer,
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer,
  card_renditions jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select photo.id, photo.sort_order,
    derivative.bucket_id, derivative.object_path,
    derivative.output_mime_type, derivative.output_size_bytes,
    encode(derivative.output_sha256, 'hex'), derivative.output_width,
    derivative.output_height,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'width', card.width,
        'bucket_id', card.bucket_id,
        'object_path', card.object_path,
        'mime_type', card.output_mime_type,
        'size_bytes', card.output_size_bytes,
        'sha256_hex', encode(card.output_sha256, 'hex'),
        'output_width', card.output_width,
        'output_height', card.output_height
      ) order by card.width)
      from private.photo_card_renditions as card
      where card.circle_id = derivative.circle_id
        and card.display_derivative_id = derivative.id
        and card.original_id = derivative.original_id
    ), '[]'::jsonb)
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
    and (select private.can_read_live_moment(moment.id))
  order by photo.sort_order, photo.id;
$$;

create function public.get_photo_moment_delivery(moment_id uuid)
returns table (
  photo_id uuid, sort_order integer,
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer,
  card_renditions jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_photo_moment_delivery(moment_id);
$$;

create function public.get_photo_moments_delivery(moment_ids uuid[])
returns table (
  moment_id uuid,
  photo_id uuid,
  sort_order integer,
  bucket_id text,
  object_path text,
  output_mime_type text,
  output_size_bytes bigint,
  output_sha256_hex text,
  output_width integer,
  output_height integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if coalesce(cardinality(moment_ids), 0) > 100 then
    raise exception 'Timeline page is too large' using errcode = '22023';
  end if;

  return query
  select requested.moment_id,
    delivery.photo_id,
    delivery.sort_order,
    delivery.bucket_id,
    delivery.object_path,
    delivery.output_mime_type,
    delivery.output_size_bytes,
    delivery.output_sha256_hex,
    delivery.output_width,
    delivery.output_height
  from (
    select distinct requested_id as moment_id
      from unnest(coalesce(moment_ids, '{}'::uuid[])) as requested_id
  ) as requested
  cross join lateral private.get_photo_moment_delivery(requested.moment_id)
    as delivery;
end;
$$;

revoke all on table private.photo_card_renditions
  from public, anon, authenticated, service_role;
revoke all on table private.photo_card_backfill_leases
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_card_rendition_insert()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_card_rendition_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.photo_card_path_is_uploadable(text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.photo_card_path_is_readable(text)
  from public, anon, authenticated, service_role;
revoke all on function private.photo_display_backfill_path_is_readable(text)
  from public, anon, authenticated, service_role;
revoke all on function private.claim_photo_card_backfill_lease(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_photo_card_backfill_lease(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.list_photo_card_backfill_candidates(integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_photo_card_backfill_candidates(integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.release_photo_card_backfill_lease(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.release_photo_card_backfill_lease(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.record_photo_card_rendition(
  uuid, integer, uuid, text, bigint, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.record_photo_card_rendition(
  uuid, integer, uuid, text, bigint, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_photo_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_photo_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_photo_moments_delivery(uuid[])
  from public, anon, authenticated, service_role;

grant execute on function private.photo_card_path_is_uploadable(text, text, jsonb)
  to authenticated;
grant execute on function private.photo_card_path_is_readable(text)
  to authenticated;
grant execute on function private.photo_display_backfill_path_is_readable(text)
  to authenticated;
grant execute on function public.claim_photo_card_backfill_lease(uuid)
  to authenticated;
grant execute on function public.list_photo_card_backfill_candidates(integer, uuid)
  to authenticated;
grant execute on function public.release_photo_card_backfill_lease(uuid)
  to authenticated;
grant execute on function public.record_photo_card_rendition(
  uuid, integer, uuid, text, bigint, text, integer, integer
) to authenticated;
grant execute on function private.get_photo_moment_delivery(uuid)
  to authenticated;
grant execute on function public.get_photo_moment_delivery(uuid)
  to authenticated;
grant execute on function public.get_photo_moments_delivery(uuid[])
  to authenticated;
