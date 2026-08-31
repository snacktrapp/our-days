-- Phase 4C establishes local-only, lease-bound display derivative generation.
-- It deliberately creates no browser/family delivery path, photo moment, signed
-- URL, cleanup policy, or choice governed by PD-005/PD-006.

do $display_bucket_profile$
begin
  update storage.buckets
     set file_size_limit = 12582912,
         allowed_mime_types = array['image/webp']::text[]
   where id = 'our-days-display'
     and public is false;
  if not found then
    raise exception using errcode = '55000',
      message = 'Private display bucket is unavailable';
  end if;
end;
$display_bucket_profile$;

create table private.photo_derivative_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  original_id uuid not null unique,
  requested_by_membership_id uuid not null,
  derivative_id uuid not null unique default extensions.gen_random_uuid(),
  lease_attempt_id uuid,
  display_object_path text unique,
  transform_profile_version integer not null default 1,
  state text not null default 'queued',
  queued_at timestamptz not null default statement_timestamp(),
  validator_auth_user_id uuid,
  lease_key_hash bytea,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  source_storage_object_id uuid,
  source_storage_object_version text,
  completed_at timestamptz,
  rejection_reason text,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint photo_derivative_jobs_circle_id_id_key unique (circle_id, id),
  constraint photo_derivative_jobs_completion_identity_key unique (
    circle_id, id, original_id, requested_by_membership_id, derivative_id,
    lease_attempt_id, display_object_path, transform_profile_version,
    source_storage_object_id, source_storage_object_version
  ),
  constraint photo_derivative_jobs_original_fkey foreign key (
    circle_id, original_id
  ) references private.photo_originals (
    circle_id, id
  ) on delete restrict,
  constraint photo_derivative_jobs_requester_fkey foreign key (
    circle_id, requested_by_membership_id
  ) references public.circle_memberships (
    circle_id, id
  ) on delete restrict,
  constraint photo_derivative_jobs_validator_fkey foreign key (
    validator_auth_user_id
  ) references auth.users (id) on delete restrict,
  constraint photo_derivative_jobs_path_valid check (
    (
      lease_attempt_id is null
      and display_object_path is null
    ) or display_object_path =
      'display/' || derivative_id::text || '/' || lease_attempt_id::text || '.webp'
  ),
  constraint photo_derivative_jobs_profile_valid check (
    transform_profile_version = 1
  ),
  constraint photo_derivative_jobs_attempt_valid check (attempt_count >= 0),
  constraint photo_derivative_jobs_lease_hash_valid check (
    lease_key_hash is null or octet_length(lease_key_hash) = 32
  ),
  constraint photo_derivative_jobs_lease_window_valid check (
    (
      lease_started_at is null
      and lease_expires_at is null
    ) or (
      lease_started_at is not null
      and lease_expires_at = lease_started_at + interval '15 minutes'
    )
  ),
  constraint photo_derivative_jobs_state_valid check (
    (
      state = 'queued'
      and validator_auth_user_id is null
      and lease_key_hash is null
      and lease_attempt_id is null
      and display_object_path is null
      and lease_started_at is null
      and lease_expires_at is null
      and attempt_count = 0
      and source_storage_object_id is null
      and source_storage_object_version is null
      and completed_at is null
      and rejection_reason is null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'leased'
      and validator_auth_user_id is not null
      and lease_key_hash is not null
      and lease_attempt_id is not null
      and display_object_path is not null
      and lease_started_at is not null
      and lease_expires_at is not null
      and attempt_count >= 1
      and source_storage_object_id is not null
      and source_storage_object_version is not null
      and completed_at is null
      and rejection_reason is null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'verified'
      and validator_auth_user_id is not null
      and lease_key_hash is not null
      and lease_attempt_id is not null
      and display_object_path is not null
      and lease_started_at is not null
      and lease_expires_at is not null
      and attempt_count >= 1
      and source_storage_object_id is not null
      and source_storage_object_version is not null
      and completed_at is not null
      and rejection_reason is null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'rejected'
      and validator_auth_user_id is not null
      and lease_key_hash is not null
      and lease_attempt_id is not null
      and display_object_path is not null
      and lease_started_at is not null
      and lease_expires_at is not null
      and attempt_count >= 1
      and source_storage_object_id is not null
      and source_storage_object_version is not null
      and completed_at is not null
      and rejection_reason in (
        'decode_failed', 'output_invalid', 'resource_limit',
        'source_changed', 'transform_failed'
      )
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'operator_review'
      and validator_auth_user_id is not null
      and lease_key_hash is not null
      and lease_attempt_id is not null
      and display_object_path is not null
      and lease_started_at is not null
      and lease_expires_at is not null
      and attempt_count >= 1
      and source_storage_object_id is not null
      and source_storage_object_version is not null
      and completed_at is not null
      and rejection_reason in (
        'display_collision', 'display_evidence_mismatch',
        'validator_cleanup_failed'
      )
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'invalidated'
      and completed_at is null
      and rejection_reason is null
      and invalidated_at is not null
      and invalidation_reason = 'requester_authority_lost'
    )
  )
);

create index photo_derivative_jobs_lease_queue_idx
  on private.photo_derivative_jobs (state, lease_expires_at, queued_at, id)
  where state in ('queued', 'leased');
create index photo_derivative_jobs_requester_idx
  on private.photo_derivative_jobs (requested_by_membership_id, state);
create index photo_derivative_jobs_validator_idx
  on private.photo_derivative_jobs (validator_auth_user_id, state)
  where validator_auth_user_id is not null;

create table private.photo_display_derivatives (
  id uuid primary key,
  circle_id uuid not null,
  derivative_job_id uuid not null unique,
  original_id uuid not null unique,
  requested_by_membership_id uuid not null,
  bucket_id text not null default 'our-days-display',
  lease_attempt_id uuid not null,
  object_path text not null unique,
  storage_object_id uuid not null unique,
  storage_object_version text not null,
  output_mime_type text not null,
  output_size_bytes bigint not null,
  output_sha256 bytea not null,
  output_width integer not null,
  output_height integer not null,
  output_channels integer not null,
  output_pages integer not null,
  transform_profile_version integer not null,
  source_storage_object_id uuid not null,
  source_storage_object_version text not null,
  generated_at timestamptz not null default statement_timestamp(),
  constraint photo_display_derivatives_job_identity_fkey foreign key (
    circle_id, derivative_job_id, original_id, requested_by_membership_id, id,
    lease_attempt_id, object_path, transform_profile_version,
    source_storage_object_id, source_storage_object_version
  ) references private.photo_derivative_jobs (
    circle_id, id, original_id, requested_by_membership_id, derivative_id,
    lease_attempt_id, display_object_path, transform_profile_version,
    source_storage_object_id, source_storage_object_version
  ) on delete restrict,
  constraint photo_display_derivatives_original_fkey foreign key (
    circle_id, original_id
  ) references private.photo_originals (
    circle_id, id
  ) on delete restrict,
  constraint photo_display_derivatives_requester_fkey foreign key (
    circle_id, requested_by_membership_id
  ) references public.circle_memberships (
    circle_id, id
  ) on delete restrict,
  constraint photo_display_derivatives_bucket_valid check (
    bucket_id = 'our-days-display'
  ),
  constraint photo_display_derivatives_path_valid check (
    object_path =
      'display/' || id::text || '/' || lease_attempt_id::text || '.webp'
  ),
  constraint photo_display_derivatives_mime_valid check (
    output_mime_type = 'image/webp'
  ),
  constraint photo_display_derivatives_size_valid check (
    output_size_bytes between 1 and 12582912
  ),
  constraint photo_display_derivatives_sha256_valid check (
    octet_length(output_sha256) = 32
  ),
  constraint photo_display_derivatives_shape_valid check (
    output_width between 1 and 2560
    and output_height between 1 and 2560
    and output_width::bigint * output_height::bigint <= 6553600
    and output_channels between 1 and 4
    and output_pages = 1
  ),
  constraint photo_display_derivatives_profile_valid check (
    transform_profile_version = 1
  )
);

create index photo_display_derivatives_circle_original_idx
  on private.photo_display_derivatives (circle_id, original_id, generated_at, id);

alter table private.photo_derivative_jobs enable row level security;
alter table private.photo_derivative_jobs force row level security;
alter table private.photo_display_derivatives enable row level security;
alter table private.photo_display_derivatives force row level security;

create function private.enforce_photo_derivative_job_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Photo derivative history cannot be deleted';
  end if;

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.original_id is distinct from old.original_id
    or new.requested_by_membership_id is distinct from old.requested_by_membership_id
    or new.derivative_id is distinct from old.derivative_id
    or new.transform_profile_version is distinct from old.transform_profile_version
    or new.queued_at is distinct from old.queued_at
    or old.state in ('verified', 'rejected', 'operator_review', 'invalidated')
    or (
      (
        new.lease_attempt_id is distinct from old.lease_attempt_id
        or new.display_object_path is distinct from old.display_object_path
      ) and not (
        old.state in ('queued', 'leased')
        and new.state = 'leased'
        and new.attempt_count = old.attempt_count + 1
        and new.lease_attempt_id is not null
        and new.display_object_path =
          'display/' || new.derivative_id::text || '/' ||
          new.lease_attempt_id::text || '.webp'
        and (old.state = 'queued' or old.lease_expires_at <= statement_timestamp())
      )
    ) then
    raise exception using errcode = '42501',
      message = 'Photo derivative identity is immutable';
  end if;
  return new;
end;
$$;

create trigger photo_derivative_jobs_integrity
before update or delete on private.photo_derivative_jobs
for each row execute function private.enforce_photo_derivative_job_integrity();

create function private.enforce_photo_display_derivative_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Photo display derivatives are immutable';
end;
$$;

create trigger photo_display_derivatives_integrity
before update or delete on private.photo_display_derivatives
for each row execute function private.enforce_photo_display_derivative_integrity();

create function private.enforce_verified_photo_derivative_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_job_id uuid;
  job_state text;
  derivative_count bigint;
begin
  if tg_table_name = 'photo_derivative_jobs' then
    affected_job_id := new.id;
  else
    affected_job_id := new.derivative_job_id;
  end if;

  select job.state into job_state
    from private.photo_derivative_jobs as job
   where job.id = affected_job_id;
  select count(*) into derivative_count
    from private.photo_display_derivatives as derivative
   where derivative.derivative_job_id = affected_job_id;

  if job_state = 'verified' or derivative_count > 0 then
    if job_state is distinct from 'verified' or derivative_count <> 1 then
      raise exception using errcode = '23514',
        message = 'Verified photo derivative must have one matching job and ledger row';
    end if;
  end if;
  return new;
end;
$$;

create constraint trigger photo_derivative_jobs_verified_consistency
after insert or update on private.photo_derivative_jobs
deferrable initially deferred
for each row execute function
  private.enforce_verified_photo_derivative_consistency();

create constraint trigger photo_display_derivatives_verified_consistency
after insert or update on private.photo_display_derivatives
deferrable initially deferred
for each row execute function
  private.enforce_verified_photo_derivative_consistency();

create function private.enqueue_photo_display_derivative()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.photo_derivative_jobs (
    circle_id, original_id, requested_by_membership_id
  ) values (
    new.circle_id, new.id, new.recorded_by_membership_id
  ) on conflict (original_id) do nothing;
  return new;
end;
$$;

create trigger photo_display_derivative_after_original_insert
after insert on private.photo_originals
for each row execute function private.enqueue_photo_display_derivative();

create function private.invalidate_photo_derivatives_after_authority_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.photo_derivative_jobs as job
     set state = 'invalidated',
         invalidated_at = statement_timestamp(),
         invalidation_reason = 'requester_authority_lost'
   where job.state in ('queued', 'leased')
     and not exists (
       select 1
         from private.photo_originals as original
        where original.id = job.original_id
          and (select private.photo_intake_requester_is_authorized(
            original.intake_id
          ))
     );
  return new;
end;
$$;

create trigger photo_derivatives_invalidate_after_membership_change
after update on public.circle_memberships
for each statement execute function
  private.invalidate_photo_derivatives_after_authority_change();

create trigger photo_derivatives_invalidate_after_guardian_change
after update on public.person_guardians
for each statement execute function
  private.invalidate_photo_derivatives_after_authority_change();

create trigger photo_derivatives_invalidate_after_closure_request
after insert on private.account_closure_requests
for each statement execute function
  private.invalidate_photo_derivatives_after_authority_change();

do $backfill$
begin
  insert into private.photo_derivative_jobs (
    circle_id, original_id, requested_by_membership_id
  )
  select original.circle_id, original.id, original.recorded_by_membership_id
    from private.photo_originals as original
  on conflict (original_id) do nothing;
end;
$backfill$;

create function private.claim_photo_display_derivative(
  requested_original_id uuid,
  requested_lease_key uuid
)
returns table (
  derivative_job_id uuid,
  lease_attempt_id uuid,
  original_id uuid,
  source_bucket_id text,
  source_object_path text,
  source_storage_object_id uuid,
  source_storage_object_version text,
  source_mime_type text,
  source_size_bytes bigint,
  source_sha256_hex text,
  source_width integer,
  source_height integer,
  source_channels integer,
  source_pages integer,
  display_bucket_id text,
  display_object_path text,
  transform_profile_version integer,
  lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job private.photo_derivative_jobs%rowtype;
  target_original private.photo_originals%rowtype;
  source_object storage.objects%rowtype;
  new_lease_attempt_id uuid;
begin
  if current_user_id is null or requested_original_id is null
    or requested_lease_key is null then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be claimed';
  end if;
  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be claimed';
  end if;

  select job.* into target_job
    from private.photo_derivative_jobs as job
   where job.original_id = requested_original_id;
  if target_job.id is null then
    raise exception using errcode = '22023',
      message = 'Photo derivative could not be claimed';
  end if;

  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select original.* into target_original
    from private.photo_originals as original
   where original.id = requested_original_id
   for update;
  select job.* into target_job
    from private.photo_derivative_jobs as job
   where job.id = target_job.id
   for update;

  if target_job.state = 'leased'
    and target_job.validator_auth_user_id = current_user_id
    and target_job.lease_key_hash = extensions.digest(
      requested_lease_key::text, 'sha256'
    )
    and target_job.lease_expires_at > statement_timestamp() then
    return query select
      target_job.id, target_job.lease_attempt_id, target_original.id,
      target_original.bucket_id, target_original.object_path,
      target_job.source_storage_object_id,
      target_job.source_storage_object_version,
      target_original.verified_mime_type,
      target_original.verified_size_bytes,
      encode(target_original.verified_sha256, 'hex'),
      target_original.verified_width, target_original.verified_height,
      target_original.verified_channels, target_original.verified_pages,
      'our-days-display'::text, target_job.display_object_path,
      target_job.transform_profile_version, target_job.lease_expires_at;
    return;
  end if;

  if target_original.id is null
    or target_job.state not in ('queued', 'leased')
    or (target_job.state = 'leased'
      and target_job.lease_expires_at > statement_timestamp())
    or (target_job.state = 'leased'
      and target_job.validator_auth_user_id = current_user_id)
    or not (select private.photo_intake_requester_is_authorized(
      target_original.intake_id
    )) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be claimed';
  end if;

  select object.* into source_object
    from storage.objects as object
   where object.bucket_id = target_original.bucket_id
     and object.name = target_original.object_path;

  if source_object.id is distinct from target_original.storage_object_id
    or coalesce(source_object.version, '') is distinct from
      target_original.storage_object_version
    or source_object.metadata ->> 'mimetype' is distinct from
      target_original.verified_mime_type
    or source_object.metadata ->> 'size' is distinct from
      target_original.verified_size_bytes::text
    or source_object.user_metadata is distinct from jsonb_build_object(
      'validation_job_id', target_original.validation_job_id::text,
      'intake_id', target_original.intake_id::text,
      'original_id', target_original.id::text,
      'lease_attempt_id', target_original.lease_attempt_id::text,
      'expected_mime_type', target_original.verified_mime_type,
      'expected_size_bytes', target_original.verified_size_bytes,
      'expected_sha256', encode(target_original.verified_sha256, 'hex'),
      'verification_profile_version',
        target_original.verification_profile_version
    ) then
    raise exception using errcode = '22023',
      message = 'Photo derivative source evidence did not match';
  end if;

  new_lease_attempt_id := extensions.gen_random_uuid();
  update private.photo_derivative_jobs as job
     set state = 'leased',
         validator_auth_user_id = current_user_id,
         lease_key_hash = extensions.digest(requested_lease_key::text, 'sha256'),
         lease_attempt_id = new_lease_attempt_id,
         display_object_path =
           'display/' || job.derivative_id::text || '/' ||
           new_lease_attempt_id::text || '.webp',
         lease_started_at = statement_timestamp(),
         lease_expires_at = statement_timestamp() + interval '15 minutes',
         attempt_count = job.attempt_count + 1,
         source_storage_object_id = target_original.storage_object_id,
         source_storage_object_version = target_original.storage_object_version
   where job.id = target_job.id
   returning * into target_job;

  return query select
    target_job.id, target_job.lease_attempt_id, target_original.id,
    target_original.bucket_id, target_original.object_path,
    target_job.source_storage_object_id,
    target_job.source_storage_object_version,
    target_original.verified_mime_type,
    target_original.verified_size_bytes,
    encode(target_original.verified_sha256, 'hex'),
    target_original.verified_width, target_original.verified_height,
    target_original.verified_channels, target_original.verified_pages,
    'our-days-display'::text, target_job.display_object_path,
    target_job.transform_profile_version, target_job.lease_expires_at;
end;
$$;

create function private.photo_derivative_source_is_readable(
  requested_object_path text,
  requested_storage_object_id uuid,
  requested_storage_object_version text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.photo_derivative_jobs as job
      join private.photo_originals as original on original.id = job.original_id
     where original.object_path = requested_object_path
       and job.source_storage_object_id = requested_storage_object_id
       and job.source_storage_object_version =
         coalesce(requested_storage_object_version, '')
       and job.state = 'leased'
       and job.validator_auth_user_id = (select auth.uid())
       and job.lease_expires_at > statement_timestamp()
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select private.photo_intake_requester_is_authorized(
         original.intake_id
       ))
  );
$$;

create function private.photo_display_path_is_uploadable(
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
  output_size_bytes bigint;
  output_width integer;
  output_height integer;
  output_channels integer;
begin
  if requested_object_path is null or requested_owner_id is null
    or requested_user_metadata is null
    or requested_user_metadata ->> 'output_sha256' !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(requested_user_metadata -> 'output_size_bytes') <> 'number'
    or jsonb_typeof(requested_user_metadata -> 'output_width') <> 'number'
    or jsonb_typeof(requested_user_metadata -> 'output_height') <> 'number'
    or jsonb_typeof(requested_user_metadata -> 'output_channels') <> 'number'
    or requested_user_metadata -> 'output_pages' <> '1'::jsonb then
    return false;
  end if;

  begin
    output_size_bytes :=
      (requested_user_metadata ->> 'output_size_bytes')::bigint;
    output_width := (requested_user_metadata ->> 'output_width')::integer;
    output_height := (requested_user_metadata ->> 'output_height')::integer;
    output_channels := (requested_user_metadata ->> 'output_channels')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      return false;
  end;

  if output_size_bytes not between 1 and 12582912
    or output_width not between 1 and 2560
    or output_height not between 1 and 2560
    or output_width::bigint * output_height::bigint > 6553600
    or output_channels not between 1 and 4 then
    return false;
  end if;

  return exists (
    select 1
      from private.photo_derivative_jobs as job
      join private.photo_originals as original on original.id = job.original_id
     where job.display_object_path = requested_object_path
       and job.state = 'leased'
       and job.validator_auth_user_id = (select auth.uid())
       and job.lease_expires_at > statement_timestamp()
       and requested_owner_id = (select auth.uid()::text)
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select private.photo_intake_requester_is_authorized(
         original.intake_id
       ))
       and requested_user_metadata = jsonb_build_object(
         'derivative_job_id', job.id::text,
         'original_id', job.original_id::text,
         'derivative_id', job.derivative_id::text,
         'lease_attempt_id', job.lease_attempt_id::text,
         'source_storage_object_id', job.source_storage_object_id::text,
         'source_storage_object_version', job.source_storage_object_version,
         'output_mime_type', 'image/webp',
         'output_size_bytes', output_size_bytes,
         'output_sha256', requested_user_metadata ->> 'output_sha256',
         'output_width', output_width,
         'output_height', output_height,
         'output_channels', output_channels,
         'output_pages', 1,
         'maximum_size_bytes', 12582912,
         'transform_profile_version', job.transform_profile_version
       )
  );
end;
$$;

create function private.photo_display_path_is_readable(
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
      from private.photo_derivative_jobs as job
      join private.photo_originals as original on original.id = job.original_id
     where job.display_object_path = requested_object_path
       and job.state = 'leased'
       and job.validator_auth_user_id = (select auth.uid())
       and job.lease_expires_at > statement_timestamp()
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select private.photo_intake_requester_is_authorized(
         original.intake_id
       ))
  );
$$;

drop policy our_days_storage_objects_closed_until_media_phase
  on storage.objects;

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
    and (select storage.allow_any_operation(array[
      'object.get_authenticated', 'object.get_authenticated_info',
      'object.upload'
    ]::text[]))
    and (select private.photo_display_path_is_readable(name))
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
    and (select private.photo_display_path_is_uploadable(
      name, owner_id, user_metadata
    ))
  )
);

create policy our_days_originals_select_exact_derivative_lease
on storage.objects
for select
to authenticated
using (
  bucket_id = 'our-days-originals'
  and (select storage.allow_any_operation(array[
    'object.get_authenticated', 'object.get_authenticated_info'
  ]::text[]))
  and (select private.photo_derivative_source_is_readable(name, id, version))
);

create policy our_days_display_insert_exact_active_derivative_lease
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'our-days-display'
  and (select storage.allow_any_operation(array['object.upload']::text[]))
  and (select private.photo_display_path_is_uploadable(
    name, owner_id, user_metadata
  ))
);

create policy our_days_display_select_exact_active_derivative_lease
on storage.objects
for select
to authenticated
using (
  bucket_id = 'our-days-display'
  and (select storage.allow_any_operation(array[
    'object.get_authenticated', 'object.get_authenticated_info',
    'object.upload'
  ]::text[]))
  and (select private.photo_display_path_is_readable(name))
);

create function private.complete_photo_display_derivative(
  requested_derivative_job_id uuid,
  requested_lease_key uuid,
  requested_storage_object_id uuid,
  requested_storage_object_version text,
  requested_output_size_bytes bigint,
  requested_output_sha256_hex text,
  requested_output_width integer,
  requested_output_height integer,
  requested_output_channels integer,
  requested_output_pages integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job private.photo_derivative_jobs%rowtype;
  target_original private.photo_originals%rowtype;
  display_object storage.objects%rowtype;
  existing_derivative_id uuid;
begin
  if current_user_id is null or requested_derivative_job_id is null
    or requested_lease_key is null or requested_storage_object_id is null
    or requested_storage_object_version is null
    or requested_output_size_bytes is null
    or requested_output_size_bytes not between 1 and 12582912
    or requested_output_sha256_hex is null
    or requested_output_sha256_hex !~ '^[0-9a-f]{64}$'
    or requested_output_width is null
    or requested_output_width not between 1 and 2560
    or requested_output_height is null
    or requested_output_height not between 1 and 2560
    or requested_output_width::bigint * requested_output_height::bigint > 6553600
    or requested_output_channels is null
    or requested_output_channels not between 1 and 4
    or requested_output_pages is null
    or requested_output_pages <> 1 then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be completed';
  end if;
  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be completed';
  end if;

  select job.* into target_job from private.photo_derivative_jobs as job
   where job.id = requested_derivative_job_id;
  if target_job.id is null then
    raise exception using errcode = '22023',
      message = 'Photo derivative could not be completed';
  end if;
  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select original.* into target_original
    from private.photo_originals as original
   where original.id = target_job.original_id
   for update;
  select job.* into target_job from private.photo_derivative_jobs as job
   where job.id = requested_derivative_job_id
   for update;

  if target_job.state = 'verified' then
    select derivative.id into existing_derivative_id
      from private.photo_display_derivatives as derivative
     where derivative.derivative_job_id = target_job.id
       and target_job.validator_auth_user_id = current_user_id
       and target_job.lease_key_hash = extensions.digest(
         requested_lease_key::text, 'sha256'
       )
       and derivative.storage_object_id = requested_storage_object_id
       and derivative.storage_object_version = requested_storage_object_version
       and derivative.output_size_bytes = requested_output_size_bytes
       and encode(derivative.output_sha256, 'hex') =
         requested_output_sha256_hex
       and derivative.output_width = requested_output_width
       and derivative.output_height = requested_output_height
       and derivative.output_channels = requested_output_channels
       and derivative.output_pages = requested_output_pages;
    if existing_derivative_id is null then
      raise exception using errcode = '42501',
        message = 'Photo derivative could not be completed';
    end if;
    return existing_derivative_id;
  end if;

  if target_job.state <> 'leased'
    or target_job.validator_auth_user_id <> current_user_id
    or target_job.lease_key_hash <> extensions.digest(
      requested_lease_key::text, 'sha256'
    )
    or target_job.lease_expires_at <= statement_timestamp()
    or target_original.id is null
    or target_job.source_storage_object_id is distinct from
      target_original.storage_object_id
    or target_job.source_storage_object_version is distinct from
      target_original.storage_object_version
    or not (select private.photo_intake_requester_is_authorized(
      target_original.intake_id
    )) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be completed';
  end if;

  select object.* into display_object
    from storage.objects as object
   where object.bucket_id = 'our-days-display'
     and object.name = target_job.display_object_path;

  if display_object.id is distinct from requested_storage_object_id
    or coalesce(display_object.version, '') is distinct from
      requested_storage_object_version
    or display_object.metadata ->> 'mimetype' is distinct from 'image/webp'
    or display_object.metadata ->> 'size' is distinct from
      requested_output_size_bytes::text
    or display_object.user_metadata is distinct from jsonb_build_object(
      'derivative_job_id', target_job.id::text,
      'original_id', target_job.original_id::text,
      'derivative_id', target_job.derivative_id::text,
      'lease_attempt_id', target_job.lease_attempt_id::text,
      'source_storage_object_id', target_job.source_storage_object_id::text,
      'source_storage_object_version', target_job.source_storage_object_version,
      'output_mime_type', 'image/webp',
      'output_size_bytes', requested_output_size_bytes,
      'output_sha256', requested_output_sha256_hex,
      'output_width', requested_output_width,
      'output_height', requested_output_height,
      'output_channels', requested_output_channels,
      'output_pages', requested_output_pages,
      'maximum_size_bytes', 12582912,
      'transform_profile_version', target_job.transform_profile_version
    ) then
    raise exception using errcode = '22023',
      message = 'Photo derivative display evidence did not match';
  end if;

  insert into private.photo_display_derivatives (
    id, circle_id, derivative_job_id, original_id,
    requested_by_membership_id, lease_attempt_id, object_path,
    storage_object_id, storage_object_version, output_mime_type,
    output_size_bytes, output_sha256, output_width, output_height,
    output_channels, output_pages,
    transform_profile_version, source_storage_object_id,
    source_storage_object_version
  ) values (
    target_job.derivative_id, target_job.circle_id, target_job.id,
    target_job.original_id, target_job.requested_by_membership_id,
    target_job.lease_attempt_id, target_job.display_object_path,
    display_object.id, coalesce(display_object.version, ''), 'image/webp',
    requested_output_size_bytes,
    decode(requested_output_sha256_hex, 'hex'),
    requested_output_width, requested_output_height,
    requested_output_channels, requested_output_pages,
    target_job.transform_profile_version,
    target_job.source_storage_object_id, target_job.source_storage_object_version
  ) returning id into existing_derivative_id;

  update private.photo_derivative_jobs
     set state = 'verified', completed_at = statement_timestamp()
   where id = target_job.id;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_job.circle_id, target_job.requested_by_membership_id,
    'photo_display_derivative_generated', 'photo_display_derivative',
    existing_derivative_id
  );
  return existing_derivative_id;
exception
  when unique_violation or check_violation or foreign_key_violation
    or not_null_violation then
    raise exception using errcode = '22023',
      message = 'Photo derivative could not be completed';
end;
$$;

create function private.reject_photo_display_derivative(
  requested_derivative_job_id uuid,
  requested_lease_key uuid,
  requested_rejection_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job private.photo_derivative_jobs%rowtype;
begin
  if current_user_id is null or requested_derivative_job_id is null
    or requested_lease_key is null or requested_rejection_reason is null
    or requested_rejection_reason not in (
      'decode_failed', 'output_invalid', 'resource_limit',
      'source_changed', 'transform_failed'
    ) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be rejected';
  end if;
  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be rejected';
  end if;
  select job.* into target_job from private.photo_derivative_jobs as job
   where job.id = requested_derivative_job_id;
  if target_job.id is null then
    raise exception using errcode = '22023',
      message = 'Photo derivative could not be rejected';
  end if;
  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select job.* into target_job from private.photo_derivative_jobs as job
   where job.id = requested_derivative_job_id for update;
  if target_job.state = 'rejected'
    and target_job.rejection_reason = requested_rejection_reason
    and target_job.validator_auth_user_id = current_user_id
    and target_job.lease_key_hash = extensions.digest(
      requested_lease_key::text, 'sha256'
    ) then
    return target_job.id;
  end if;
  if target_job.state <> 'leased'
    or target_job.validator_auth_user_id <> current_user_id
    or target_job.lease_key_hash <> extensions.digest(
      requested_lease_key::text, 'sha256'
    )
    or target_job.lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be rejected';
  end if;
  if not exists (
    select 1 from private.photo_originals as original
     where original.id = target_job.original_id
       and (select private.photo_intake_requester_is_authorized(
         original.intake_id
       ))
  ) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be rejected';
  end if;
  update private.photo_derivative_jobs
     set state = 'rejected', completed_at = statement_timestamp(),
         rejection_reason = requested_rejection_reason
   where id = target_job.id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_job.circle_id, target_job.requested_by_membership_id,
    'photo_display_derivative_rejected', 'photo_derivative_job', target_job.id
  );
  return target_job.id;
end;
$$;

create function private.flag_photo_display_derivative_for_review(
  requested_derivative_job_id uuid,
  requested_lease_key uuid,
  requested_review_reason text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job private.photo_derivative_jobs%rowtype;
begin
  if current_user_id is null or requested_derivative_job_id is null
    or requested_lease_key is null or requested_review_reason is null
    or requested_review_reason not in (
      'display_collision', 'display_evidence_mismatch',
      'validator_cleanup_failed'
    ) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be flagged';
  end if;
  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be flagged';
  end if;
  select job.* into target_job from private.photo_derivative_jobs as job
   where job.id = requested_derivative_job_id;
  if target_job.id is null then
    raise exception using errcode = '22023',
      message = 'Photo derivative could not be flagged';
  end if;
  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select job.* into target_job from private.photo_derivative_jobs as job
   where job.id = requested_derivative_job_id for update;
  if target_job.state = 'operator_review'
    and target_job.rejection_reason = requested_review_reason
    and target_job.validator_auth_user_id = current_user_id
    and target_job.lease_key_hash = extensions.digest(
      requested_lease_key::text, 'sha256'
    ) then
    return target_job.id;
  end if;
  if target_job.state <> 'leased'
    or target_job.validator_auth_user_id <> current_user_id
    or target_job.lease_key_hash <> extensions.digest(
      requested_lease_key::text, 'sha256'
    )
    or target_job.lease_expires_at <= statement_timestamp() then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be flagged';
  end if;
  if not exists (
    select 1 from private.photo_originals as original
     where original.id = target_job.original_id
       and (select private.photo_intake_requester_is_authorized(
         original.intake_id
       ))
  ) then
    raise exception using errcode = '42501',
      message = 'Photo derivative could not be flagged';
  end if;
  update private.photo_derivative_jobs
     set state = 'operator_review', completed_at = statement_timestamp(),
         rejection_reason = requested_review_reason
   where id = target_job.id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_job.circle_id, target_job.requested_by_membership_id,
    'photo_display_derivative_flagged_for_review',
    'photo_derivative_job', target_job.id
  );
  return target_job.id;
end;
$$;

alter table private.audit_events
  drop constraint audit_events_event_type_valid,
  add constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created', 'invitation_accepted', 'invitation_revoked',
      'invitation_job_requested', 'invitation_job_invalidated',
      'membership_revoked', 'membership_role_changed',
      'membership_promoted', 'membership_demoted',
      'managed_person_created', 'guardian_added', 'guardian_removed',
      'moment_created', 'moment_updated', 'moment_trashed', 'moment_restored',
      'moment_note_created', 'moment_note_updated', 'moment_note_trashed',
      'moment_reaction_set', 'moment_reaction_removed',
      'export_requested', 'export_invalidated',
      'account_closure_prepared',
      'photo_original_verified', 'photo_validation_rejected',
      'photo_validation_flagged_for_review',
      'photo_display_derivative_generated',
      'photo_display_derivative_rejected',
      'photo_display_derivative_flagged_for_review'
    )
  ),
  drop constraint audit_events_subject_type_valid,
  add constraint audit_events_subject_type_valid check (
    subject_type in (
      'invitation', 'invitation_job', 'membership', 'person', 'guardian',
      'moment', 'moment_note', 'moment_reaction', 'export_job',
      'photo_original', 'photo_validation_job',
      'photo_display_derivative', 'photo_derivative_job'
    )
  );

create function public.claim_photo_display_derivative(
  original_id uuid,
  lease_key uuid
)
returns table (
  derivative_job_id uuid,
  lease_attempt_id uuid,
  original_id uuid,
  source_bucket_id text,
  source_object_path text,
  source_storage_object_id uuid,
  source_storage_object_version text,
  source_mime_type text,
  source_size_bytes bigint,
  source_sha256_hex text,
  source_width integer,
  source_height integer,
  source_channels integer,
  source_pages integer,
  display_bucket_id text,
  display_object_path text,
  transform_profile_version integer,
  lease_expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.claim_photo_display_derivative($1, $2);
$$;

create function public.complete_photo_display_derivative(
  derivative_job_id uuid,
  lease_key uuid,
  storage_object_id uuid,
  storage_object_version text,
  output_size_bytes bigint,
  output_sha256_hex text,
  output_width integer,
  output_height integer,
  output_channels integer,
  output_pages integer
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.complete_photo_display_derivative(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
  );
$$;

create function public.reject_photo_display_derivative(
  derivative_job_id uuid,
  lease_key uuid,
  rejection_reason text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.reject_photo_display_derivative($1, $2, $3);
$$;

create function public.flag_photo_display_derivative_for_review(
  derivative_job_id uuid,
  lease_key uuid,
  review_reason text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.flag_photo_display_derivative_for_review($1, $2, $3);
$$;

revoke all on table private.photo_derivative_jobs
  from public, anon, authenticated, service_role;
revoke all on table private.photo_display_derivatives
  from public, anon, authenticated, service_role;

revoke all on function private.enforce_photo_derivative_job_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_display_derivative_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_verified_photo_derivative_consistency()
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_photo_display_derivative()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_photo_derivatives_after_authority_change()
  from public, anon, authenticated, service_role;
revoke all on function private.claim_photo_display_derivative(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_photo_display_derivative(
  uuid, uuid, uuid, text, bigint, text, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.reject_photo_display_derivative(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.flag_photo_display_derivative_for_review(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

revoke all on function private.photo_derivative_source_is_readable(
  text, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.photo_display_path_is_uploadable(text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.photo_display_path_is_readable(text)
  from public, anon, authenticated, service_role;
grant execute on function private.photo_derivative_source_is_readable(
  text, uuid, text
) to authenticated;
grant execute on function private.photo_display_path_is_uploadable(text, text, jsonb)
  to authenticated;
grant execute on function private.photo_display_path_is_readable(text)
  to authenticated;

revoke all on function public.claim_photo_display_derivative(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_photo_display_derivative(
  uuid, uuid, uuid, text, bigint, text, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.reject_photo_display_derivative(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.flag_photo_display_derivative_for_review(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.claim_photo_display_derivative(uuid, uuid)
  to authenticated;
grant execute on function public.complete_photo_display_derivative(
  uuid, uuid, uuid, text, bigint, text, integer, integer, integer, integer
) to authenticated;
grant execute on function public.reject_photo_display_derivative(uuid, uuid, text)
  to authenticated;
grant execute on function public.flag_photo_display_derivative_for_review(
  uuid, uuid, text
) to authenticated;
