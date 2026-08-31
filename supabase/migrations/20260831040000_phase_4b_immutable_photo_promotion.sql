-- Phase 4B establishes an isolated, lease-bound validator and an immutable
-- canonical-original ledger. It deliberately creates no photo moment, media
-- reader, signed URL, derivative, or browser-facing media table.

alter table private.photo_intakes
  add constraint photo_intakes_promotion_identity_key unique (
    circle_id,
    id,
    journal_person_id,
    requested_by_membership_id
  );

alter table private.photo_intakes
  add column validation_completed_at timestamptz,
  add column validation_rejection_reason text,
  drop constraint photo_intakes_state_valid,
  add constraint photo_intakes_state_valid check (
    (
      state = 'reserved'
      and uploaded_at is null and upload_request_key is null
      and expected_mime_type is null and expected_size_bytes is null
      and expected_sha256 is null and upload_claimed_at is null
      and upload_expires_at is null
      and observed_mime_type_unverified is null
      and observed_size_bytes_unverified is null
      and invalidated_at is null and invalidation_reason is null
      and validation_completed_at is null
      and validation_rejection_reason is null
    ) or (
      state = 'upload_claimed'
      and upload_request_key is not null
      and expected_mime_type is not null and expected_size_bytes is not null
      and expected_sha256 is not null and upload_claimed_at is not null
      and upload_expires_at is not null and uploaded_at is null
      and observed_mime_type_unverified is null
      and observed_size_bytes_unverified is null
      and invalidated_at is null and invalidation_reason is null
      and validation_completed_at is null
      and validation_rejection_reason is null
    ) or (
      state = 'uploaded_unverified'
      and upload_request_key is not null
      and expected_mime_type is not null and expected_size_bytes is not null
      and expected_sha256 is not null and upload_claimed_at is not null
      and upload_expires_at is not null and uploaded_at is not null
      and invalidated_at is null and invalidation_reason is null
      and validation_completed_at is null
      and validation_rejection_reason is null
    ) or (
      state = 'verified'
      and upload_request_key is not null
      and expected_mime_type is not null and expected_size_bytes is not null
      and expected_sha256 is not null and upload_claimed_at is not null
      and upload_expires_at is not null and uploaded_at is not null
      and invalidated_at is null and invalidation_reason is null
      and validation_completed_at is not null
      and validation_rejection_reason is null
    ) or (
      state = 'rejected'
      and upload_request_key is not null
      and expected_mime_type is not null and expected_size_bytes is not null
      and expected_sha256 is not null and upload_claimed_at is not null
      and upload_expires_at is not null and uploaded_at is not null
      and invalidated_at is null and invalidation_reason is null
      and validation_completed_at is not null
      and validation_rejection_reason in (
        'decode_failed', 'hash_mismatch', 'mime_mismatch',
        'resource_limit', 'size_mismatch', 'source_changed',
        'unsupported_format'
      )
    ) or (
      state = 'operator_review'
      and upload_request_key is not null
      and expected_mime_type is not null and expected_size_bytes is not null
      and expected_sha256 is not null and upload_claimed_at is not null
      and upload_expires_at is not null and uploaded_at is not null
      and invalidated_at is null and invalidation_reason is null
      and validation_completed_at is not null
      and validation_rejection_reason in (
        'canonical_collision', 'canonical_evidence_mismatch',
        'validator_cleanup_failed'
      )
    ) or (
      state = 'invalidated'
      and invalidated_at is not null
      and invalidation_reason in (
        'membership_authority_changed', 'guardian_authority_revoked',
        'account_closure_requested'
      )
      and validation_completed_at is null
      and validation_rejection_reason is null
    )
  );

create or replace function private.enforce_photo_intake_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Photo intake history cannot be deleted';
  end if;

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.journal_person_id is distinct from old.journal_person_id
    or new.requested_by_membership_id is distinct from old.requested_by_membership_id
    or new.requester_authorization_version is distinct from old.requester_authorization_version
    or new.request_key is distinct from old.request_key
    or new.object_path is distinct from old.object_path
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or not (
      (
        new.state = old.state
        and new.upload_request_key is not distinct from old.upload_request_key
        and new.expected_mime_type is not distinct from old.expected_mime_type
        and new.expected_size_bytes is not distinct from old.expected_size_bytes
        and new.expected_sha256 is not distinct from old.expected_sha256
        and new.upload_claimed_at is not distinct from old.upload_claimed_at
        and new.upload_expires_at is not distinct from old.upload_expires_at
        and new.uploaded_at is not distinct from old.uploaded_at
        and new.observed_mime_type_unverified is not distinct from old.observed_mime_type_unverified
        and new.observed_size_bytes_unverified is not distinct from old.observed_size_bytes_unverified
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidation_reason is not distinct from old.invalidation_reason
        and new.validation_completed_at is not distinct from old.validation_completed_at
        and new.validation_rejection_reason is not distinct from old.validation_rejection_reason
      ) or (
        old.state = 'reserved' and new.state = 'upload_claimed'
        and old.upload_request_key is null and new.upload_request_key is not null
        and old.expected_mime_type is null and new.expected_mime_type is not null
        and old.expected_size_bytes is null and new.expected_size_bytes is not null
        and old.expected_sha256 is null and new.expected_sha256 is not null
        and old.upload_claimed_at is null and new.upload_claimed_at is not null
        and old.upload_expires_at is null and new.upload_expires_at is not null
        and new.uploaded_at is null
        and new.observed_mime_type_unverified is null
        and new.observed_size_bytes_unverified is null
        and new.invalidated_at is null and new.invalidation_reason is null
        and new.validation_completed_at is null
        and new.validation_rejection_reason is null
      ) or (
        old.state = 'upload_claimed' and new.state = 'uploaded_unverified'
        and new.upload_request_key = old.upload_request_key
        and new.expected_mime_type = old.expected_mime_type
        and new.expected_size_bytes = old.expected_size_bytes
        and new.expected_sha256 = old.expected_sha256
        and new.upload_claimed_at = old.upload_claimed_at
        and new.upload_expires_at = old.upload_expires_at
        and old.uploaded_at is null and new.uploaded_at is not null
        and new.invalidated_at is null and new.invalidation_reason is null
        and new.validation_completed_at is null
        and new.validation_rejection_reason is null
      ) or (
        old.state = 'uploaded_unverified'
        and new.state in ('verified', 'rejected', 'operator_review')
        and new.upload_request_key = old.upload_request_key
        and new.expected_mime_type = old.expected_mime_type
        and new.expected_size_bytes = old.expected_size_bytes
        and new.expected_sha256 = old.expected_sha256
        and new.upload_claimed_at = old.upload_claimed_at
        and new.upload_expires_at = old.upload_expires_at
        and new.uploaded_at = old.uploaded_at
        and new.observed_mime_type_unverified is not distinct from old.observed_mime_type_unverified
        and new.observed_size_bytes_unverified is not distinct from old.observed_size_bytes_unverified
        and new.invalidated_at is null and new.invalidation_reason is null
        and old.validation_completed_at is null
        and new.validation_completed_at is not null
        and (
          (new.state = 'verified' and new.validation_rejection_reason is null)
          or (new.state = 'rejected' and new.validation_rejection_reason in (
            'decode_failed', 'hash_mismatch', 'mime_mismatch',
            'resource_limit', 'size_mismatch', 'source_changed',
            'unsupported_format'
          ))
          or (new.state = 'operator_review'
            and new.validation_rejection_reason in (
              'canonical_collision', 'canonical_evidence_mismatch',
              'validator_cleanup_failed'
            ))
        )
      ) or (
        old.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
        and new.state = 'invalidated'
        and new.upload_request_key is not distinct from old.upload_request_key
        and new.expected_mime_type is not distinct from old.expected_mime_type
        and new.expected_size_bytes is not distinct from old.expected_size_bytes
        and new.expected_sha256 is not distinct from old.expected_sha256
        and new.upload_claimed_at is not distinct from old.upload_claimed_at
        and new.upload_expires_at is not distinct from old.upload_expires_at
        and new.uploaded_at is not distinct from old.uploaded_at
        and new.observed_mime_type_unverified is not distinct from old.observed_mime_type_unverified
        and new.observed_size_bytes_unverified is not distinct from old.observed_size_bytes_unverified
        and new.invalidated_at is not null
        and new.invalidation_reason in (
          'membership_authority_changed', 'guardian_authority_revoked',
          'account_closure_requested'
        )
        and new.validation_completed_at is null
        and new.validation_rejection_reason is null
      )
    ) then
    raise exception using errcode = '42501', message = 'Photo intake history is immutable';
  end if;
  return new;
end;
$$;

create table private.photo_validator_allowlist (
  auth_user_id uuid primary key references auth.users (id) on delete restrict,
  verification_profile_version integer not null default 1,
  allowed_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  constraint photo_validator_profile_valid check (
    verification_profile_version = 1
  ),
  constraint photo_validator_revocation_valid check (
    revoked_at is null or revoked_at >= allowed_at
  )
);

create table private.photo_validation_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  intake_id uuid not null unique,
  journal_person_id uuid not null,
  requested_by_membership_id uuid not null,
  original_id uuid not null unique default extensions.gen_random_uuid(),
  lease_attempt_id uuid,
  canonical_object_path text unique,
  verification_profile_version integer not null default 1,
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
  constraint photo_validation_jobs_circle_id_id_key unique (circle_id, id),
  constraint photo_validation_jobs_promotion_identity_key unique (
    circle_id,
    id,
    original_id,
    lease_attempt_id,
    canonical_object_path,
    intake_id,
    journal_person_id,
    requested_by_membership_id
  ),
  constraint photo_validation_jobs_intake_fkey foreign key (
    circle_id,
    intake_id,
    journal_person_id,
    requested_by_membership_id
  ) references private.photo_intakes (
    circle_id,
    id,
    journal_person_id,
    requested_by_membership_id
  ) on delete restrict,
  constraint photo_validation_jobs_validator_fkey foreign key (
    validator_auth_user_id
  ) references auth.users (id) on delete restrict,
  constraint photo_validation_jobs_path_valid check (
    (
      lease_attempt_id is null
      and canonical_object_path is null
    ) or canonical_object_path =
      'original/' || original_id::text || '/' || lease_attempt_id::text
  ),
  constraint photo_validation_jobs_profile_valid check (
    verification_profile_version = 1
  ),
  constraint photo_validation_jobs_attempt_valid check (attempt_count >= 0),
  constraint photo_validation_jobs_lease_hash_valid check (
    lease_key_hash is null or octet_length(lease_key_hash) = 32
  ),
  constraint photo_validation_jobs_lease_window_valid check (
    (
      lease_started_at is null
      and lease_expires_at is null
    ) or (
      lease_started_at is not null
      and lease_expires_at = lease_started_at + interval '15 minutes'
    )
  ),
  constraint photo_validation_jobs_state_valid check (
    (
      state = 'queued'
      and validator_auth_user_id is null
      and lease_key_hash is null
      and lease_attempt_id is null
      and canonical_object_path is null
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
      and canonical_object_path is not null
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
      and canonical_object_path is not null
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
      and canonical_object_path is not null
      and lease_started_at is not null
      and lease_expires_at is not null
      and attempt_count >= 1
      and source_storage_object_id is not null
      and source_storage_object_version is not null
      and completed_at is not null
      and rejection_reason in (
        'decode_failed', 'hash_mismatch', 'mime_mismatch',
        'resource_limit', 'size_mismatch', 'source_changed',
        'unsupported_format'
      )
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'invalidated'
      and completed_at is null
      and rejection_reason is null
      and invalidated_at is not null
      and invalidation_reason = 'requester_authority_lost'
    ) or (
      state = 'operator_review'
      and validator_auth_user_id is not null
      and lease_key_hash is not null
      and lease_attempt_id is not null
      and canonical_object_path is not null
      and lease_started_at is not null
      and lease_expires_at is not null
      and attempt_count >= 1
      and source_storage_object_id is not null
      and source_storage_object_version is not null
      and completed_at is not null
      and rejection_reason in (
        'canonical_collision', 'canonical_evidence_mismatch',
        'validator_cleanup_failed'
      )
      and invalidated_at is null
      and invalidation_reason is null
    )
  )
);

create index photo_validation_jobs_lease_queue_idx
  on private.photo_validation_jobs (state, lease_expires_at, queued_at, id)
  where state in ('queued', 'leased');
create index photo_validation_jobs_requester_idx
  on private.photo_validation_jobs (requested_by_membership_id, state);
create index photo_validation_jobs_validator_idx
  on private.photo_validation_jobs (validator_auth_user_id, state)
  where validator_auth_user_id is not null;

create table private.photo_originals (
  id uuid primary key,
  circle_id uuid not null,
  validation_job_id uuid not null unique,
  intake_id uuid not null unique,
  journal_person_id uuid not null,
  recorded_by_membership_id uuid not null,
  bucket_id text not null default 'our-days-originals',
  lease_attempt_id uuid not null,
  object_path text not null unique,
  storage_object_id uuid not null unique,
  storage_object_version text not null,
  verified_mime_type text not null,
  verified_size_bytes bigint not null,
  verified_sha256 bytea not null,
  verified_width integer not null,
  verified_height integer not null,
  verified_channels integer not null,
  verified_pages integer not null,
  verification_profile_version integer not null,
  verified_at timestamptz not null default statement_timestamp(),
  constraint photo_originals_circle_id_id_key unique (circle_id, id),
  constraint photo_originals_job_identity_fkey foreign key (
    circle_id,
    validation_job_id,
    id,
    lease_attempt_id,
    object_path,
    intake_id,
    journal_person_id,
    recorded_by_membership_id
  ) references private.photo_validation_jobs (
    circle_id,
    id,
    original_id,
    lease_attempt_id,
    canonical_object_path,
    intake_id,
    journal_person_id,
    requested_by_membership_id
  ) on delete restrict,
  constraint photo_originals_intake_identity_fkey foreign key (
    circle_id,
    intake_id,
    journal_person_id,
    recorded_by_membership_id
  ) references private.photo_intakes (
    circle_id,
    id,
    journal_person_id,
    requested_by_membership_id
  ) on delete restrict,
  constraint photo_originals_journal_person_fkey foreign key (
    circle_id,
    journal_person_id
  ) references public.people (circle_id, id) on delete restrict,
  constraint photo_originals_recorder_fkey foreign key (
    circle_id,
    recorded_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint photo_originals_bucket_valid check (
    bucket_id = 'our-days-originals'
  ),
  constraint photo_originals_path_valid check (
    object_path =
      'original/' || id::text || '/' || lease_attempt_id::text
  ),
  constraint photo_originals_mime_valid check (
    verified_mime_type in (
      'image/jpeg', 'image/png', 'image/webp'
    )
  ),
  constraint photo_originals_size_valid check (
    verified_size_bytes between 1 and 52428800
  ),
  constraint photo_originals_sha256_valid check (
    octet_length(verified_sha256) = 32
  ),
  constraint photo_originals_decode_shape_valid check (
    verified_width between 1 and 100000
    and verified_height between 1 and 100000
    and verified_width::bigint * verified_height::bigint <= 50000000
    and verified_channels between 1 and 4
    and verified_pages = 1
  ),
  constraint photo_originals_profile_valid check (
    verification_profile_version = 1
  )
);

create index photo_originals_circle_journal_idx
  on private.photo_originals (circle_id, journal_person_id, verified_at, id);
create index photo_originals_recorder_idx
  on private.photo_originals (circle_id, recorded_by_membership_id);

alter table private.photo_validator_allowlist enable row level security;
alter table private.photo_validator_allowlist force row level security;
alter table private.photo_validation_jobs enable row level security;
alter table private.photo_validation_jobs force row level security;
alter table private.photo_originals enable row level security;
alter table private.photo_originals force row level security;

create function private.enforce_photo_validator_allowlist_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Photo validator history cannot be deleted';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id
    or new.verification_profile_version is distinct from old.verification_profile_version
    or new.allowed_at is distinct from old.allowed_at
    or old.revoked_at is not null
    or new.revoked_at is null then
    raise exception using errcode = '42501', message = 'Photo validator history is immutable';
  end if;
  return new;
end;
$$;

create trigger photo_validator_allowlist_integrity
before update or delete on private.photo_validator_allowlist
for each row execute function private.enforce_photo_validator_allowlist_integrity();

create function private.enforce_photo_validator_family_separation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_auth_user_id uuid;
begin
  if tg_table_schema = 'private'
    and tg_table_name = 'photo_validator_allowlist' then
    if tg_op = 'UPDATE' and new.revoked_at is not null then
      return new;
    end if;
    target_auth_user_id := new.auth_user_id;
  else
    target_auth_user_id := new.user_id;
  end if;

  if target_auth_user_id is null then
    return new;
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = target_auth_user_id
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo validator identity separation failed';
  end if;

  if tg_table_schema = 'private'
    and tg_table_name = 'photo_validator_allowlist' then
    if exists (
      select 1 from public.circle_memberships as membership
       where membership.user_id = target_auth_user_id
    ) then
      raise exception using errcode = '42501',
        message = 'Photo validator identity separation failed';
    end if;
  elsif exists (
    select 1 from private.photo_validator_allowlist as validator
     where validator.auth_user_id = target_auth_user_id
       and validator.revoked_at is null
  ) then
    raise exception using errcode = '42501',
      message = 'Photo validator identity separation failed';
  end if;
  return new;
end;
$$;

create trigger photo_validator_family_identity_separation
before insert or update on private.photo_validator_allowlist
for each row execute function private.enforce_photo_validator_family_separation();

create trigger circle_membership_photo_validator_identity_separation
before insert or update of user_id on public.circle_memberships
for each row execute function private.enforce_photo_validator_family_separation();

create function private.enforce_photo_validation_job_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Photo validation history cannot be deleted';
  end if;
  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.intake_id is distinct from old.intake_id
    or new.journal_person_id is distinct from old.journal_person_id
    or new.requested_by_membership_id is distinct from old.requested_by_membership_id
    or new.original_id is distinct from old.original_id
    or (
      (
        new.lease_attempt_id is distinct from old.lease_attempt_id
        or new.canonical_object_path is distinct from old.canonical_object_path
      ) and not (
        old.state in ('queued', 'leased')
        and new.state = 'leased'
        and new.attempt_count = old.attempt_count + 1
        and new.lease_attempt_id is not null
        and new.canonical_object_path =
          'original/' || new.original_id::text || '/' || new.lease_attempt_id::text
        and (
          old.state = 'queued'
          or old.lease_expires_at <= statement_timestamp()
        )
      )
    )
    or new.verification_profile_version is distinct from old.verification_profile_version
    or new.queued_at is distinct from old.queued_at
    or old.state in ('verified', 'rejected', 'invalidated', 'operator_review') then
    raise exception using errcode = '42501', message = 'Photo validation identity is immutable';
  end if;
  return new;
end;
$$;

create trigger photo_validation_jobs_integrity
before update or delete on private.photo_validation_jobs
for each row execute function private.enforce_photo_validation_job_integrity();

create function private.enforce_photo_original_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Verified photo originals are immutable';
end;
$$;

create trigger photo_originals_integrity
before update or delete on private.photo_originals
for each row execute function private.enforce_photo_original_integrity();

create function private.enforce_verified_photo_promotion_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_intake_id uuid;
  intake_state text;
  job_state text;
  original_count bigint;
begin
  if tg_table_name = 'photo_intakes' then
    affected_intake_id := new.id;
  else
    affected_intake_id := new.intake_id;
  end if;

  select intake.state
    into intake_state
    from private.photo_intakes as intake
   where intake.id = affected_intake_id;

  select job.state
    into job_state
    from private.photo_validation_jobs as job
   where job.intake_id = affected_intake_id;

  select count(*)
    into original_count
    from private.photo_originals as original
   where original.intake_id = affected_intake_id;

  if intake_state = 'verified' or job_state = 'verified' or original_count > 0 then
    if intake_state is distinct from 'verified'
      or job_state is distinct from 'verified'
      or original_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'Verified photo promotion must have one matching intake, job, and original';
    end if;
  end if;

  return new;
end;
$$;

create constraint trigger photo_intakes_verified_promotion_consistency
after insert or update on private.photo_intakes
deferrable initially deferred
for each row execute function
  private.enforce_verified_photo_promotion_consistency();

create constraint trigger photo_validation_jobs_verified_promotion_consistency
after insert or update on private.photo_validation_jobs
deferrable initially deferred
for each row execute function
  private.enforce_verified_photo_promotion_consistency();

create constraint trigger photo_originals_verified_promotion_consistency
after insert or update on private.photo_originals
deferrable initially deferred
for each row execute function
  private.enforce_verified_photo_promotion_consistency();

create function private.photo_validator_is_allowed(requested_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_auth_user_id is not null and exists (
    select 1
      from private.photo_validator_allowlist as validator
      join auth.users as auth_user on auth_user.id = validator.auth_user_id
     where validator.auth_user_id = requested_auth_user_id
       and validator.revoked_at is null
       and validator.verification_profile_version = 1
       and auth_user.deleted_at is null
       and not exists (
         select 1 from public.circle_memberships as membership
          where membership.user_id = validator.auth_user_id
       )
  );
$$;

create function private.lock_photo_validator_if_allowed(
  requested_auth_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if requested_auth_user_id is null then
    return false;
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = requested_auth_user_id
     and auth_user.deleted_at is null
   for update;
  if not found then
    return false;
  end if;

  perform 1 from private.photo_validator_allowlist as validator
   where validator.auth_user_id = requested_auth_user_id
     and validator.revoked_at is null
     and validator.verification_profile_version = 1
   for update;
  if not found then
    return false;
  end if;

  return not exists (
    select 1 from public.circle_memberships as membership
     where membership.user_id = requested_auth_user_id
  );
end;
$$;

create function private.enqueue_photo_validation_job()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_original_id uuid;
begin
  if new.state = 'uploaded_unverified'
    and old.state is distinct from new.state then
    generated_original_id := extensions.gen_random_uuid();
    insert into private.photo_validation_jobs (
      circle_id, intake_id, journal_person_id, requested_by_membership_id,
      original_id
    ) values (
      new.circle_id, new.id, new.journal_person_id,
      new.requested_by_membership_id, generated_original_id
    ) on conflict (intake_id) do nothing;
  elsif new.state = 'invalidated' and old.state is distinct from new.state then
    update private.photo_validation_jobs as job
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidation_reason = 'requester_authority_lost'
     where job.intake_id = new.id
       and job.state in ('queued', 'leased');
  end if;
  return new;
end;
$$;

create trigger photo_validation_job_after_intake_change
after update on private.photo_intakes
for each row execute function private.enqueue_photo_validation_job();

create function private.invalidate_photo_work_after_closure_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.photo_intakes as intake
     set state = 'invalidated',
         invalidated_at = statement_timestamp(),
         invalidation_reason = 'account_closure_requested'
    from public.circle_memberships as membership
   where membership.user_id = new.auth_user_id
     and membership.circle_id = intake.circle_id
     and membership.id = intake.requested_by_membership_id
     and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified');
  return new;
end;
$$;

create trigger photo_work_invalidate_after_closure_request
after insert on private.account_closure_requests
for each row execute function
  private.invalidate_photo_work_after_closure_request();

do $backfill$
declare
  intake private.photo_intakes%rowtype;
  generated_original_id uuid;
begin
  for intake in
    select * from private.photo_intakes
     where state = 'uploaded_unverified'
     order by id
  loop
    generated_original_id := extensions.gen_random_uuid();
    insert into private.photo_validation_jobs (
      circle_id, intake_id, journal_person_id, requested_by_membership_id,
      original_id
    ) values (
      intake.circle_id, intake.id, intake.journal_person_id,
      intake.requested_by_membership_id, generated_original_id
    ) on conflict (intake_id) do nothing;
  end loop;
end;
$backfill$;

create function private.claim_photo_validation(
  requested_intake_id uuid,
  requested_lease_key uuid
)
returns table (
  validation_job_id uuid,
  lease_attempt_id uuid,
  intake_id uuid,
  source_bucket_id text,
  source_object_path text,
  source_storage_object_id uuid,
  source_storage_object_version text,
  canonical_bucket_id text,
  canonical_object_path text,
  expected_mime_type text,
  expected_size_bytes bigint,
  expected_sha256_hex text,
  verification_profile_version integer,
  lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job private.photo_validation_jobs%rowtype;
  target_intake private.photo_intakes%rowtype;
  source_object_id uuid;
  source_object_version text;
  source_owner_id text;
  source_metadata jsonb;
  source_user_metadata jsonb;
  new_lease_attempt_id uuid;
begin
  if current_user_id is null or requested_intake_id is null
    or requested_lease_key is null then
    raise exception using errcode = '42501', message = 'Photo validation could not be claimed';
  end if;

  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501', message = 'Photo validation could not be claimed';
  end if;

  select job.* into target_job
    from private.photo_validation_jobs as job
   where job.intake_id = requested_intake_id;
  if target_job.id is null then
    raise exception using errcode = '22023', message = 'Photo validation could not be claimed';
  end if;

  perform 1 from public.circles where id = target_job.circle_id for update;

  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;

  select intake.* into target_intake
    from private.photo_intakes as intake
   where intake.id = target_job.intake_id
   for update;

  select job.* into target_job
    from private.photo_validation_jobs as job
   where job.id = target_job.id
   for update;

  if target_job.state = 'leased'
    and target_job.validator_auth_user_id = current_user_id
    and target_job.lease_key_hash = extensions.digest(
      requested_lease_key::text, 'sha256'
    )
    and target_job.lease_expires_at > statement_timestamp() then
    return query select
      target_job.id, target_job.lease_attempt_id, target_intake.id,
      'our-days-intake'::text,
      target_intake.object_path, target_job.source_storage_object_id,
      target_job.source_storage_object_version, 'our-days-originals'::text,
      target_job.canonical_object_path, target_intake.expected_mime_type,
      target_intake.expected_size_bytes,
      encode(target_intake.expected_sha256, 'hex'),
      target_job.verification_profile_version, target_job.lease_expires_at;
    return;
  end if;

  if target_intake.id is null
    or target_intake.state <> 'uploaded_unverified'
    or target_job.state not in ('queued', 'leased')
    or (target_job.state = 'leased'
      and target_job.lease_expires_at > statement_timestamp())
    or (target_job.state = 'leased'
      and target_job.validator_auth_user_id = current_user_id)
    or not (select private.photo_intake_requester_is_authorized(target_intake.id)) then
    raise exception using errcode = '42501', message = 'Photo validation could not be claimed';
  end if;

  select object.id, coalesce(object.version, ''), object.owner_id,
         object.metadata, object.user_metadata
    into source_object_id, source_object_version, source_owner_id,
         source_metadata, source_user_metadata
    from storage.objects as object
   where object.bucket_id = 'our-days-intake'
     and object.name = target_intake.object_path;

  if source_object_id is null
    or source_owner_id is distinct from (
      select membership.user_id::text
        from public.circle_memberships as membership
       where membership.id = target_intake.requested_by_membership_id
         and membership.circle_id = target_intake.circle_id
    )
    or source_metadata ->> 'mimetype' is distinct from target_intake.expected_mime_type
    or source_metadata ->> 'size' is distinct from target_intake.expected_size_bytes::text
    or source_user_metadata is distinct from jsonb_build_object(
      'intake_id', target_intake.id::text,
      'upload_request_key', target_intake.upload_request_key::text,
      'expected_mime_type', target_intake.expected_mime_type,
      'expected_size_bytes', target_intake.expected_size_bytes,
      'expected_sha256', encode(target_intake.expected_sha256, 'hex')
    ) then
    raise exception using errcode = '22023', message = 'Photo validation could not be claimed';
  end if;

  new_lease_attempt_id := extensions.gen_random_uuid();
  update private.photo_validation_jobs as job
     set state = 'leased',
         validator_auth_user_id = current_user_id,
         lease_key_hash = extensions.digest(requested_lease_key::text, 'sha256'),
         lease_attempt_id = new_lease_attempt_id,
         canonical_object_path =
           'original/' || job.original_id::text || '/' || new_lease_attempt_id::text,
         lease_started_at = statement_timestamp(),
         lease_expires_at = statement_timestamp() + interval '15 minutes',
         attempt_count = job.attempt_count + 1,
         source_storage_object_id = source_object_id,
         source_storage_object_version = source_object_version
   where job.id = target_job.id
   returning * into target_job;

  return query select
    target_job.id, target_job.lease_attempt_id, target_intake.id,
    'our-days-intake'::text,
    target_intake.object_path, target_job.source_storage_object_id,
    target_job.source_storage_object_version, 'our-days-originals'::text,
    target_job.canonical_object_path, target_intake.expected_mime_type,
    target_intake.expected_size_bytes,
    encode(target_intake.expected_sha256, 'hex'),
    target_job.verification_profile_version, target_job.lease_expires_at;
end;
$$;

create function private.photo_original_path_is_uploadable(
  requested_object_path text,
  requested_owner_id text,
  requested_user_metadata jsonb
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.photo_validation_jobs as job
      join private.photo_intakes as intake on intake.id = job.intake_id
     where job.canonical_object_path = requested_object_path
       and job.state = 'leased'
       and job.validator_auth_user_id = (select auth.uid())
       and job.lease_expires_at > statement_timestamp()
       and requested_owner_id = (select auth.uid()::text)
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select private.photo_intake_requester_is_authorized(job.intake_id))
       and intake.expected_mime_type in (
         'image/jpeg', 'image/png', 'image/webp'
       )
       and requested_user_metadata = jsonb_build_object(
         'validation_job_id', job.id::text,
         'intake_id', job.intake_id::text,
         'original_id', job.original_id::text,
         'lease_attempt_id', job.lease_attempt_id::text,
         'expected_mime_type', intake.expected_mime_type,
         'expected_size_bytes', intake.expected_size_bytes,
         'expected_sha256', encode(intake.expected_sha256, 'hex'),
         'verification_profile_version', job.verification_profile_version
       )
  );
$$;

create function private.photo_original_path_is_readable(
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
      from private.photo_validation_jobs as job
     where job.canonical_object_path = requested_object_path
       and job.state = 'leased'
       and job.validator_auth_user_id = (select auth.uid())
       and job.lease_expires_at > statement_timestamp()
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select private.photo_intake_requester_is_authorized(job.intake_id))
  );
$$;

create function private.photo_validation_source_is_readable(
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
      from private.photo_validation_jobs as job
      join private.photo_intakes as intake on intake.id = job.intake_id
     where intake.object_path = requested_object_path
       and job.source_storage_object_id = requested_storage_object_id
       and job.source_storage_object_version =
         coalesce(requested_storage_object_version, '')
       and job.state = 'leased'
       and job.validator_auth_user_id = (select auth.uid())
       and job.lease_expires_at > statement_timestamp()
       and (select private.photo_validator_is_allowed((select auth.uid())))
       and (select private.photo_intake_requester_is_authorized(job.intake_id))
  );
$$;

drop policy if exists our_days_storage_objects_closed_until_media_phase
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
    and (select private.photo_original_path_is_readable(name))
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
);

create policy our_days_originals_insert_exact_active_validator_lease
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'our-days-originals'
  and (select storage.allow_any_operation(array['object.upload']::text[]))
  and (select private.photo_original_path_is_uploadable(
    name, owner_id, user_metadata
  ))
);

create policy our_days_originals_select_exact_active_validator_lease
on storage.objects
for select
to authenticated
using (
  bucket_id = 'our-days-originals'
  and (select storage.allow_any_operation(array[
    'object.get_authenticated', 'object.get_authenticated_info',
    'object.upload'
  ]::text[]))
  and (select private.photo_original_path_is_readable(name))
);

create policy our_days_intake_select_exact_active_validator_lease
on storage.objects
for select
to authenticated
using (
  bucket_id = 'our-days-intake'
  and (select storage.allow_any_operation(array[
    'object.get_authenticated', 'object.get_authenticated_info'
  ]::text[]))
  and (select private.photo_validation_source_is_readable(
    name, id, version
  ))
);

create function private.complete_photo_validation(
  requested_validation_job_id uuid,
  requested_lease_key uuid,
  requested_storage_object_id uuid,
  requested_storage_object_version text,
  requested_verified_mime_type text,
  requested_verified_size_bytes bigint,
  requested_verified_sha256_hex text,
  requested_verified_width integer,
  requested_verified_height integer,
  requested_verified_channels integer,
  requested_verified_pages integer
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_job private.photo_validation_jobs%rowtype;
  target_intake private.photo_intakes%rowtype;
  canonical_object storage.objects%rowtype;
  existing_original_id uuid;
begin
  if current_user_id is null or requested_validation_job_id is null
    or requested_lease_key is null or requested_storage_object_id is null
    or requested_storage_object_version is null
    or requested_verified_mime_type is null
    or requested_verified_size_bytes is null
    or requested_verified_sha256_hex is null
    or requested_verified_width is null
    or requested_verified_height is null
    or requested_verified_channels is null
    or requested_verified_pages is null
    or requested_verified_sha256_hex !~ '^[0-9a-f]{64}$'
    or requested_verified_mime_type not in (
      'image/jpeg', 'image/png', 'image/webp'
    )
    or requested_verified_width not between 1 and 100000
    or requested_verified_height not between 1 and 100000
    or requested_verified_width::bigint * requested_verified_height::bigint > 50000000
    or requested_verified_channels not between 1 and 4
    or requested_verified_pages <> 1 then
    raise exception using errcode = '42501', message = 'Photo validation could not be completed';
  end if;

  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501', message = 'Photo validation could not be completed';
  end if;
  select job.* into target_job from private.photo_validation_jobs as job
   where job.id = requested_validation_job_id;
  if target_job.id is null then
    raise exception using errcode = '22023', message = 'Photo validation could not be completed';
  end if;
  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select intake.* into target_intake from private.photo_intakes as intake
   where intake.id = target_job.intake_id for update;
  select job.* into target_job from private.photo_validation_jobs as job
   where job.id = requested_validation_job_id for update;

  if target_job.state = 'verified' then
    select original.id into existing_original_id
      from private.photo_originals as original
     where original.validation_job_id = target_job.id
       and target_job.validator_auth_user_id = current_user_id
       and target_job.lease_key_hash = extensions.digest(
         requested_lease_key::text, 'sha256'
       )
       and original.storage_object_id = requested_storage_object_id
       and original.storage_object_version = requested_storage_object_version
       and original.verified_mime_type = requested_verified_mime_type
       and original.verified_size_bytes = requested_verified_size_bytes
       and encode(original.verified_sha256, 'hex') =
         requested_verified_sha256_hex
       and original.verified_width = requested_verified_width
       and original.verified_height = requested_verified_height
       and original.verified_channels = requested_verified_channels
       and original.verified_pages = requested_verified_pages;
    if existing_original_id is null then
      raise exception using errcode = '42501', message = 'Photo validation could not be completed';
    end if;
    return existing_original_id;
  end if;

  if target_job.state <> 'leased'
    or target_job.validator_auth_user_id <> current_user_id
    or target_job.lease_key_hash <> extensions.digest(
      requested_lease_key::text, 'sha256'
    )
    or target_job.lease_expires_at <= statement_timestamp()
    or target_intake.state <> 'uploaded_unverified'
    or not (select private.photo_intake_requester_is_authorized(target_intake.id))
    or requested_verified_mime_type is distinct from target_intake.expected_mime_type
    or requested_verified_size_bytes is distinct from target_intake.expected_size_bytes
    or requested_verified_sha256_hex is distinct from
      encode(target_intake.expected_sha256, 'hex') then
    raise exception using errcode = '42501', message = 'Photo validation could not be completed';
  end if;

  select object.* into canonical_object
    from storage.objects as object
   where object.bucket_id = 'our-days-originals'
     and object.name = target_job.canonical_object_path;

  if canonical_object.id is distinct from requested_storage_object_id
    or coalesce(canonical_object.version, '') is distinct from requested_storage_object_version
    or canonical_object.metadata ->> 'mimetype' is distinct from requested_verified_mime_type
    or canonical_object.metadata ->> 'size' is distinct from requested_verified_size_bytes::text
    or canonical_object.user_metadata is distinct from jsonb_build_object(
      'validation_job_id', target_job.id::text,
      'intake_id', target_job.intake_id::text,
      'original_id', target_job.original_id::text,
      'lease_attempt_id', target_job.lease_attempt_id::text,
      'expected_mime_type', target_intake.expected_mime_type,
      'expected_size_bytes', target_intake.expected_size_bytes,
      'expected_sha256', encode(target_intake.expected_sha256, 'hex'),
      'verification_profile_version', target_job.verification_profile_version
    ) then
    raise exception using errcode = '22023', message = 'Photo validation canonical evidence did not match';
  end if;

  insert into private.photo_originals (
    id, circle_id, validation_job_id, intake_id, journal_person_id,
    recorded_by_membership_id, lease_attempt_id, object_path, storage_object_id,
    storage_object_version, verified_mime_type, verified_size_bytes,
    verified_sha256, verified_width, verified_height, verified_channels,
    verified_pages, verification_profile_version
  ) values (
    target_job.original_id, target_job.circle_id, target_job.id,
    target_job.intake_id, target_job.journal_person_id,
    target_job.requested_by_membership_id, target_job.lease_attempt_id,
    target_job.canonical_object_path,
    canonical_object.id, coalesce(canonical_object.version, ''),
    requested_verified_mime_type, requested_verified_size_bytes,
    decode(requested_verified_sha256_hex, 'hex'),
    requested_verified_width, requested_verified_height,
    requested_verified_channels, requested_verified_pages,
    target_job.verification_profile_version
  ) returning id into existing_original_id;

  update private.photo_intakes
     set state = 'verified',
         validation_completed_at = statement_timestamp(),
         validation_rejection_reason = null
   where id = target_intake.id;

  update private.photo_validation_jobs
     set state = 'verified', completed_at = statement_timestamp()
   where id = target_job.id;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_job.circle_id, target_job.requested_by_membership_id,
    'photo_original_verified', 'photo_original', existing_original_id
  );

  return existing_original_id;
exception
  when unique_violation or check_violation or foreign_key_violation
    or not_null_violation then
    raise exception using errcode = '22023', message = 'Photo validation could not be completed';
end;
$$;

create function private.reject_photo_validation(
  requested_validation_job_id uuid,
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
  target_job private.photo_validation_jobs%rowtype;
  target_intake private.photo_intakes%rowtype;
begin
  if current_user_id is null or requested_validation_job_id is null
    or requested_lease_key is null
    or requested_rejection_reason is null
    or requested_rejection_reason not in (
      'decode_failed', 'hash_mismatch', 'mime_mismatch',
      'resource_limit', 'size_mismatch', 'source_changed',
      'unsupported_format'
    ) then
    raise exception using errcode = '42501', message = 'Photo validation could not be rejected';
  end if;
  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501', message = 'Photo validation could not be rejected';
  end if;
  select job.* into target_job from private.photo_validation_jobs as job
   where job.id = requested_validation_job_id;
  if target_job.id is null then
    raise exception using errcode = '22023', message = 'Photo validation could not be rejected';
  end if;
  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select intake.* into target_intake from private.photo_intakes as intake
   where intake.id = target_job.intake_id for update;
  select job.* into target_job from private.photo_validation_jobs as job
   where job.id = requested_validation_job_id for update;
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
    raise exception using errcode = '42501', message = 'Photo validation could not be rejected';
  end if;
  update private.photo_intakes
     set state = 'rejected',
         validation_completed_at = statement_timestamp(),
         validation_rejection_reason = requested_rejection_reason
   where id = target_intake.id
     and state = 'uploaded_unverified';
  if not found then
    raise exception using errcode = '42501', message = 'Photo validation could not be rejected';
  end if;
  update private.photo_validation_jobs
     set state = 'rejected', completed_at = statement_timestamp(),
         rejection_reason = requested_rejection_reason
   where id = target_job.id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_job.circle_id, target_job.requested_by_membership_id,
    'photo_validation_rejected', 'photo_validation_job', target_job.id
  );
  return target_job.id;
end;
$$;

create function private.flag_photo_validation_for_review(
  requested_validation_job_id uuid,
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
  target_job private.photo_validation_jobs%rowtype;
  target_intake private.photo_intakes%rowtype;
begin
  if current_user_id is null or requested_validation_job_id is null
    or requested_lease_key is null
    or requested_review_reason is null
    or requested_review_reason not in (
      'canonical_collision', 'canonical_evidence_mismatch',
      'validator_cleanup_failed'
    ) then
    raise exception using errcode = '42501', message = 'Photo validation could not be flagged';
  end if;
  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501', message = 'Photo validation could not be flagged';
  end if;
  select job.* into target_job from private.photo_validation_jobs as job
   where job.id = requested_validation_job_id;
  if target_job.id is null then
    raise exception using errcode = '22023', message = 'Photo validation could not be flagged';
  end if;
  perform 1 from public.circles where id = target_job.circle_id for update;
  perform 1 from public.circle_memberships as membership
   where membership.circle_id = target_job.circle_id
     and membership.id = target_job.requested_by_membership_id
   for update;
  select intake.* into target_intake from private.photo_intakes as intake
   where intake.id = target_job.intake_id for update;
  select job.* into target_job from private.photo_validation_jobs as job
   where job.id = requested_validation_job_id for update;
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
    or target_job.lease_expires_at <= statement_timestamp()
    or target_intake.state <> 'uploaded_unverified' then
    raise exception using errcode = '42501', message = 'Photo validation could not be flagged';
  end if;
  update private.photo_intakes
     set state = 'operator_review',
         validation_completed_at = statement_timestamp(),
         validation_rejection_reason = requested_review_reason
   where id = target_intake.id;
  update private.photo_validation_jobs
     set state = 'operator_review', completed_at = statement_timestamp(),
         rejection_reason = requested_review_reason
   where id = target_job.id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_job.circle_id, target_job.requested_by_membership_id,
    'photo_validation_flagged_for_review', 'photo_validation_job', target_job.id
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
      'photo_validation_flagged_for_review'
    )
  ),
  drop constraint audit_events_subject_type_valid,
  add constraint audit_events_subject_type_valid check (
    subject_type in (
      'invitation', 'invitation_job', 'membership', 'person', 'guardian',
      'moment', 'moment_note', 'moment_reaction', 'export_job',
      'photo_original', 'photo_validation_job'
    )
  );

create function public.claim_photo_validation(
  intake_id uuid,
  lease_key uuid
)
returns table (
  validation_job_id uuid,
  lease_attempt_id uuid,
  intake_id uuid,
  source_bucket_id text,
  source_object_path text,
  source_storage_object_id uuid,
  source_storage_object_version text,
  canonical_bucket_id text,
  canonical_object_path text,
  expected_mime_type text,
  expected_size_bytes bigint,
  expected_sha256_hex text,
  verification_profile_version integer,
  lease_expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.claim_photo_validation($1, $2);
$$;

create function public.complete_photo_validation(
  validation_job_id uuid,
  lease_key uuid,
  storage_object_id uuid,
  storage_object_version text,
  verified_mime_type text,
  verified_size_bytes bigint,
  verified_sha256_hex text,
  verified_width integer,
  verified_height integer,
  verified_channels integer,
  verified_pages integer
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.complete_photo_validation(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
  );
$$;

create function public.reject_photo_validation(
  validation_job_id uuid,
  lease_key uuid,
  rejection_reason text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.reject_photo_validation($1, $2, $3);
$$;

create function public.flag_photo_validation_for_review(
  validation_job_id uuid,
  lease_key uuid,
  review_reason text
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.flag_photo_validation_for_review($1, $2, $3);
$$;

revoke all on table private.photo_validator_allowlist
  from public, anon, authenticated, service_role;
revoke all on table private.photo_validation_jobs
  from public, anon, authenticated, service_role;
revoke all on table private.photo_originals
  from public, anon, authenticated, service_role;

revoke all on function private.enforce_photo_validator_allowlist_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_validator_family_separation()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_validation_job_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_original_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_verified_photo_promotion_consistency()
  from public, anon, authenticated, service_role;
revoke all on function private.photo_validator_is_allowed(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_photo_validator_if_allowed(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enqueue_photo_validation_job()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_photo_work_after_closure_request()
  from public, anon, authenticated, service_role;
revoke all on function private.claim_photo_validation(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_photo_validation(
  uuid, uuid, uuid, text, text, bigint, text, integer, integer, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.reject_photo_validation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.flag_photo_validation_for_review(uuid, uuid, text)
  from public, anon, authenticated, service_role;

-- These three boolean helpers are the only private functions executable by the
-- authenticated Storage role. They reveal no ledger row or new object path.
revoke all on function private.photo_original_path_is_uploadable(text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.photo_original_path_is_readable(text)
  from public, anon, authenticated, service_role;
revoke all on function private.photo_validation_source_is_readable(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.photo_original_path_is_uploadable(text, text, jsonb)
  to authenticated;
grant execute on function private.photo_original_path_is_readable(text)
  to authenticated;
grant execute on function private.photo_validation_source_is_readable(text, uuid, text)
  to authenticated;

revoke all on function public.claim_photo_validation(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.complete_photo_validation(
  uuid, uuid, uuid, text, text, bigint, text, integer, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.reject_photo_validation(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.flag_photo_validation_for_review(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_photo_validation(uuid, uuid)
  to authenticated;
grant execute on function public.complete_photo_validation(
  uuid, uuid, uuid, text, text, bigint, text, integer, integer, integer, integer
) to authenticated;
grant execute on function public.reject_photo_validation(uuid, uuid, text)
  to authenticated;
grant execute on function public.flag_photo_validation_for_review(uuid, uuid, text)
  to authenticated;
