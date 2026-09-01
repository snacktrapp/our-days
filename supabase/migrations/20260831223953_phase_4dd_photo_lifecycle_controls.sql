-- Phase 4D-D adds the minimum lifecycle controls required before private photo
-- posting can be activated: bounded outstanding work, requester cancellation
-- before acknowledgement, an authoritative unfinished-work view, and a
-- durable exact-path cleanup ledger. It does not activate photo capabilities
-- or grant a browser any Storage deletion authority.

create table private.photo_object_cleanup_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  intake_id uuid not null unique,
  bucket_id text not null default 'our-days-intake',
  object_path text not null,
  purpose text not null default 'quarantine_reconciliation',
  state text not null default 'queued',
  queued_at timestamptz not null default statement_timestamp(),
  not_before timestamptz not null,
  worker_auth_user_id uuid references auth.users (id) on delete restrict,
  lease_key_hash bytea,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  next_retry_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  constraint photo_object_cleanup_jobs_intake_fkey foreign key (
    circle_id, intake_id
  ) references private.photo_intakes (circle_id, id) on delete restrict,
  constraint photo_object_cleanup_jobs_target_unique unique (
    bucket_id, object_path, purpose
  ),
  constraint photo_object_cleanup_jobs_target_valid check (
    bucket_id = 'our-days-intake'
    and object_path = 'intake/' || intake_id::text
    and purpose = 'quarantine_reconciliation'
  ),
  constraint photo_object_cleanup_jobs_state_valid check (
    state in ('queued', 'leased', 'completed', 'operator_review')
  ),
  constraint photo_object_cleanup_jobs_schedule_valid check (
    not_before >= queued_at
    and (next_retry_at is null or next_retry_at >= queued_at)
  ),
  constraint photo_object_cleanup_jobs_attempt_valid check (
    attempt_count between 0 and 5
  ),
  constraint photo_object_cleanup_jobs_lease_hash_valid check (
    lease_key_hash is null or octet_length(lease_key_hash) = 32
  ),
  constraint photo_object_cleanup_jobs_lease_window_valid check (
    (lease_started_at is null and lease_expires_at is null)
    or (
      lease_started_at is not null
      and lease_expires_at is not null
      and lease_expires_at > lease_started_at
    )
  ),
  constraint photo_object_cleanup_jobs_failure_valid check (
    failure_code is null or failure_code in (
      'absence_unconfirmed', 'delete_failed', 'identity_changed',
      'lease_exhausted'
    )
  ),
  constraint photo_object_cleanup_jobs_shape_valid check (
    (
      state = 'queued'
      and worker_auth_user_id is null and lease_key_hash is null
      and lease_started_at is null and lease_expires_at is null
      and completed_at is null and failure_code is null
    ) or (
      state = 'leased'
      and worker_auth_user_id is not null and lease_key_hash is not null
      and lease_started_at is not null and lease_expires_at is not null
      and attempt_count between 1 and 5 and next_retry_at is null
      and completed_at is null and failure_code is null
    ) or (
      state = 'completed'
      and worker_auth_user_id is not null and lease_key_hash is not null
      and lease_started_at is not null and lease_expires_at is not null
      and attempt_count between 1 and 5 and next_retry_at is null
      and completed_at is not null and completed_at >= lease_started_at
      and failure_code is null
    ) or (
      state = 'operator_review'
      and worker_auth_user_id is not null and lease_key_hash is not null
      and lease_started_at is not null and lease_expires_at is not null
      and attempt_count between 1 and 5 and next_retry_at is null
      and completed_at is null and failure_code is not null
    )
  )
);

alter table private.photo_object_cleanup_jobs enable row level security;
alter table private.photo_object_cleanup_jobs force row level security;

create index photo_object_cleanup_jobs_ready_idx
  on private.photo_object_cleanup_jobs (not_before, id)
  where state = 'queued';
create index photo_object_cleanup_jobs_circle_state_idx
  on private.photo_object_cleanup_jobs (circle_id, state, intake_id);

create function private.reject_photo_cleanup_job_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'queued' or new.attempt_count <> 0 then
      raise exception using errcode = '42501',
        message = 'Photo cleanup jobs must begin queued';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE'
    or new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.intake_id is distinct from old.intake_id
    or new.bucket_id is distinct from old.bucket_id
    or new.object_path is distinct from old.object_path
    or new.purpose is distinct from old.purpose
    or new.queued_at is distinct from old.queued_at
    or new.not_before is distinct from old.not_before then
    raise exception using errcode = '42501',
      message = 'Photo cleanup identity is immutable';
  end if;

  if new is not distinct from old then return new; end if;

  if not (
    (
      old.state = 'queued' and new.state = 'leased'
      and statement_timestamp() >= old.not_before
      and (
        old.next_retry_at is null
        or statement_timestamp() >= old.next_retry_at
      )
      and new.attempt_count = old.attempt_count + 1
      and new.attempt_count <= 5
      and new.worker_auth_user_id is not null
      and new.lease_key_hash is not null
      and new.lease_started_at is not null
      and new.lease_expires_at > new.lease_started_at
      and new.next_retry_at is null
      and new.completed_at is null and new.failure_code is null
    ) or (
      old.state = 'leased' and new.state = 'queued'
      and old.lease_expires_at <= statement_timestamp()
      and new.attempt_count = old.attempt_count
      and new.worker_auth_user_id is null and new.lease_key_hash is null
      and new.lease_started_at is null and new.lease_expires_at is null
      and new.next_retry_at is not null
      and new.next_retry_at >= statement_timestamp()
      and new.completed_at is null and new.failure_code is null
    ) or (
      old.state = 'leased' and new.state = 'completed'
      and old.lease_expires_at > statement_timestamp()
      and new.worker_auth_user_id = old.worker_auth_user_id
      and new.lease_key_hash = old.lease_key_hash
      and new.lease_started_at = old.lease_started_at
      and new.lease_expires_at = old.lease_expires_at
      and new.attempt_count = old.attempt_count
      and new.next_retry_at is null
      and new.completed_at is not null
      and new.failure_code is null
    ) or (
      old.state = 'leased' and new.state = 'operator_review'
      and new.worker_auth_user_id = old.worker_auth_user_id
      and new.lease_key_hash = old.lease_key_hash
      and new.lease_started_at = old.lease_started_at
      and new.lease_expires_at = old.lease_expires_at
      and new.attempt_count = old.attempt_count
      and new.next_retry_at is null
      and new.completed_at is null
      and new.failure_code is not null
    )
  ) then
    raise exception using errcode = '42501',
      message = 'Photo cleanup state transition is invalid';
  end if;
  return new;
end;
$$;

create trigger photo_object_cleanup_jobs_integrity
before insert or update or delete on private.photo_object_cleanup_jobs
for each row execute function private.reject_photo_cleanup_job_mutation();

alter table private.photo_intakes
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
        'account_closure_requested', 'requester_cancelled',
        'reservation_expired', 'upload_expired', 'processing_timeout'
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
    raise exception using errcode = '42501',
      message = 'Photo intake history cannot be deleted';
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
        new.state = 'invalidated'
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
        and new.validation_completed_at is null
        and new.validation_rejection_reason is null
        and (
          (old.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
            and new.invalidation_reason in (
              'membership_authority_changed', 'guardian_authority_revoked',
              'account_closure_requested'
            ))
          or (old.state = 'reserved'
            and new.invalidation_reason = 'reservation_expired'
            and old.expires_at <= statement_timestamp())
          or (old.state = 'upload_claimed'
            and (
              new.invalidation_reason = 'requester_cancelled'
              or (new.invalidation_reason = 'upload_expired'
                and old.upload_expires_at <= statement_timestamp())
            ))
          or (old.state = 'reserved'
            and new.invalidation_reason = 'requester_cancelled')
          or (old.state = 'uploaded_unverified'
            and new.invalidation_reason = 'processing_timeout'
            and old.uploaded_at + interval '24 hours' <= statement_timestamp())
        )
      )
    ) then
    raise exception using errcode = '42501',
      message = 'Photo intake history is immutable';
  end if;
  return new;
end;
$$;

create function private.enqueue_photo_object_cleanup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.state in ('verified', 'rejected', 'invalidated')
    and old.state is distinct from new.state
    and new.upload_claimed_at is not null then
    insert into private.photo_object_cleanup_jobs (
      circle_id, intake_id, object_path, not_before
    ) values (
      new.circle_id, new.id, new.object_path,
      greatest(
        coalesce(new.upload_expires_at, statement_timestamp())
          + interval '25 hours',
        statement_timestamp()
      )
    ) on conflict (intake_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger photo_object_cleanup_after_intake_change
after update on private.photo_intakes
for each row execute function private.enqueue_photo_object_cleanup();

create function private.enforce_photo_intake_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_user_id uuid;
  account_open_count integer;
  circle_open_count integer;
  account_liability_count integer;
  circle_liability_count integer;
begin
  if not (
    tg_op = 'INSERT'
    or (
      tg_op = 'UPDATE'
      and old.state = 'reserved'
      and new.state = 'upload_claimed'
    )
  ) then
    return new;
  end if;

  select membership.user_id into requester_user_id
    from public.circle_memberships as membership
   where membership.circle_id = new.circle_id
     and membership.id = new.requested_by_membership_id;
  if requester_user_id is null then
    raise exception using errcode = '42501',
      message = 'PHOTO_REQUESTER_UNAVAILABLE';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = requester_user_id for update;
  perform 1 from public.circles as circle
   where circle.id = new.circle_id for update;

  if tg_op = 'INSERT' then
    select count(*)::integer into account_open_count
      from private.photo_intakes as intake
      join public.circle_memberships as membership
        on membership.circle_id = intake.circle_id
       and membership.id = intake.requested_by_membership_id
     where membership.user_id = requester_user_id
       and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified');
    if account_open_count >= 3 then
      raise exception using errcode = 'P0001',
        message = 'PHOTO_ACCOUNT_OPEN_QUOTA';
    end if;

    select count(*)::integer into circle_open_count
      from private.photo_intakes as intake
     where intake.circle_id = new.circle_id
       and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified');
    if circle_open_count >= 10 then
      raise exception using errcode = 'P0001',
        message = 'PHOTO_CIRCLE_OPEN_QUOTA';
    end if;
    return new;
  end if;

  select count(*)::integer into account_liability_count
    from private.photo_intakes as intake
    join public.circle_memberships as membership
      on membership.circle_id = intake.circle_id
     and membership.id = intake.requested_by_membership_id
   where membership.user_id = requester_user_id
     and intake.id <> new.id
     and intake.upload_claimed_at is not null
     and not exists (
       select 1 from private.photo_object_cleanup_jobs as cleanup
        where cleanup.intake_id = intake.id
          and cleanup.state = 'completed'
     );
  if account_liability_count >= 3 then
    raise exception using errcode = 'P0001',
      message = 'PHOTO_ACCOUNT_BYTE_QUOTA';
  end if;

  select count(*)::integer into circle_liability_count
    from private.photo_intakes as intake
   where intake.circle_id = new.circle_id
     and intake.id <> new.id
     and intake.upload_claimed_at is not null
     and not exists (
       select 1 from private.photo_object_cleanup_jobs as cleanup
        where cleanup.intake_id = intake.id
          and cleanup.state = 'completed'
     );
  if circle_liability_count >= 10 then
    raise exception using errcode = 'P0001',
      message = 'PHOTO_CIRCLE_BYTE_QUOTA';
  end if;
  return new;
end;
$$;

create trigger photo_intakes_quota
before insert or update on private.photo_intakes
for each row execute function private.enforce_photo_intake_quota();

create function private.cancel_photo_intake(requested_intake_id uuid)
returns table (intake_id uuid, state text, cleanup_state text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target private.photo_intakes%rowtype;
  actor public.circle_memberships%rowtype;
  resulting_cleanup_state text;
begin
  if current_user_id is null
    or requested_intake_id is null
    or not (select private.current_family_session_is_live()) then
    raise exception using errcode = '42501',
      message = 'Photo intake could not be cancelled';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id
     and auth_user.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo intake could not be cancelled';
  end if;

  select intake.circle_id into target_circle_id
    from private.photo_intakes as intake
   where intake.id = requested_intake_id;
  if target_circle_id is null then
    raise exception using errcode = '42501',
      message = 'Photo intake could not be cancelled';
  end if;

  perform 1 from public.circles as circle
   where circle.id = target_circle_id for update;

  select intake.* into target
    from private.photo_intakes as intake
   where intake.circle_id = target_circle_id
     and intake.id = requested_intake_id
   for update;

  select membership.* into actor
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;

  if target.id is null
    or actor.id is null
    or actor.user_id is distinct from current_user_id
    or actor.status <> 'active'
    or not (select private.can_manage_person(
      target.circle_id, target.journal_person_id
    )) then
    raise exception using errcode = '42501',
      message = 'Photo intake could not be cancelled';
  end if;

  if target.state = 'invalidated'
    and target.invalidation_reason = 'requester_cancelled' then
    select cleanup.state into resulting_cleanup_state
      from private.photo_object_cleanup_jobs as cleanup
     where cleanup.intake_id = target.id;
    return query select target.id, target.state,
      coalesce(resulting_cleanup_state, 'not_required');
    return;
  end if;

  if target.state not in ('reserved', 'upload_claimed') then
    raise exception using errcode = 'P0001',
      message = 'PHOTO_CANCELLATION_TOO_LATE';
  end if;

  update private.photo_intakes as intake
     set state = 'invalidated',
         invalidated_at = statement_timestamp(),
         invalidation_reason = 'requester_cancelled'
   where intake.id = target.id
   returning * into target;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target.circle_id, target.requested_by_membership_id,
    'photo_intake_cancelled', 'photo_intake', target.id
  );

  select cleanup.state into resulting_cleanup_state
    from private.photo_object_cleanup_jobs as cleanup
   where cleanup.intake_id = target.id;
  return query select target.id, target.state,
    coalesce(resulting_cleanup_state, 'not_required');
end;
$$;

create function private.list_my_photo_intakes(requested_circle_id uuid)
returns table (
  intake_id uuid,
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  occurred_on date,
  status text,
  can_cancel boolean,
  cleanup_state text,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select intake.id,
    request.moment_id,
    intake.journal_person_id,
    person.display_name,
    request.occurred_on,
    case
      when photo.moment_id is not null then 'published_cleanup_pending'
      when intake.state = 'reserved' then 'reserved'
      when intake.state = 'upload_claimed' then 'uploading'
      when intake.state = 'invalidated'
        and intake.invalidation_reason = 'requester_cancelled'
        then 'cancelled_cleanup_pending'
      when intake.state in ('rejected', 'operator_review', 'invalidated')
        or validation.state in ('rejected', 'operator_review', 'invalidated')
        or derivative.state in ('rejected', 'operator_review', 'invalidated')
        then 'needs_attention'
      else 'processing'
    end,
    intake.state in ('reserved', 'upload_claimed')
      and photo.moment_id is null,
    case
      when cleanup.id is not null then cleanup.state
      when intake.upload_claimed_at is null then 'not_required'
      when intake.state in ('verified', 'rejected', 'invalidated')
        then 'awaiting_cleanup_job'
      else 'not_requested'
    end,
    intake.requested_at
  from private.photo_intakes as intake
  join private.photo_moment_requests as request
    on request.circle_id = intake.circle_id
   and request.intake_id = intake.id
  join public.people as person
    on person.circle_id = intake.circle_id
   and person.id = intake.journal_person_id
  left join private.photo_object_cleanup_jobs as cleanup
    on cleanup.circle_id = intake.circle_id
   and cleanup.intake_id = intake.id
  left join private.photo_validation_jobs as validation
    on validation.circle_id = intake.circle_id
   and validation.intake_id = intake.id
  left join private.photo_originals as original
    on original.circle_id = intake.circle_id
   and original.intake_id = intake.id
  left join private.photo_derivative_jobs as derivative
    on derivative.circle_id = intake.circle_id
   and derivative.original_id = original.id
  left join public.moment_photos as photo
    on photo.circle_id = intake.circle_id
   and photo.moment_id = request.moment_id
  where request.requested_by_membership_id =
      private.current_membership_id(request.circle_id)
    and request.circle_id = requested_circle_id
    and (select private.current_family_session_is_live())
    and (select private.can_manage_person(
      intake.circle_id,
      intake.journal_person_id
    ))
    and (
      intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
      or (
        intake.upload_claimed_at is not null
        and coalesce(cleanup.state, '') <> 'completed'
      )
    )
  order by intake.requested_at desc, intake.id;
$$;

create or replace function private.get_photo_moment_status(
  requested_intake_id uuid
)
returns table (status text, moment_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select case
      when photo.moment_id is not null then 'published'
      when intake.state = 'invalidated'
        and intake.invalidation_reason = 'requester_cancelled'
        then 'cancelled'
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

create function public.cancel_photo_intake(intake_id uuid)
returns table (intake_id uuid, state text, cleanup_state text)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.cancel_photo_intake(intake_id);
$$;

create function public.list_my_photo_intakes(circle_id uuid)
returns table (
  intake_id uuid,
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  occurred_on date,
  status text,
  can_cancel boolean,
  cleanup_state text,
  requested_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_my_photo_intakes(circle_id);
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
      'photo_display_derivative_flagged_for_review',
      'photo_intake_cancelled'
    )
  ),
  drop constraint audit_events_subject_type_valid,
  add constraint audit_events_subject_type_valid check (
    subject_type in (
      'invitation', 'invitation_job', 'membership', 'person', 'guardian',
      'moment', 'moment_note', 'moment_reaction', 'export_job',
      'photo_original', 'photo_validation_job',
      'photo_display_derivative', 'photo_derivative_job', 'photo_intake'
    )
  );

revoke all on table private.photo_object_cleanup_jobs
  from public, anon, authenticated, service_role;

revoke all on function private.reject_photo_cleanup_job_mutation(),
  private.enqueue_photo_object_cleanup(),
  private.enforce_photo_intake_quota(),
  private.cancel_photo_intake(uuid),
  private.list_my_photo_intakes(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.cancel_photo_intake(uuid),
  private.list_my_photo_intakes(uuid)
  to authenticated;

revoke all on function public.cancel_photo_intake(uuid),
  public.list_my_photo_intakes(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.cancel_photo_intake(uuid),
  public.list_my_photo_intakes(uuid)
  to authenticated;
