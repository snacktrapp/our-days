-- Restore authenticated EXECUTE on photo storage readability helpers.
-- Without these grants, storage RLS cannot evaluate photo display/original
-- policies, so every private photo fails to open and validation cannot read
-- intake objects after upload.

grant execute on function private.photo_display_path_is_readable(text)
  to authenticated;
grant execute on function private.photo_original_path_is_readable(text)
  to authenticated;
grant execute on function private.photo_validation_source_is_readable(text, uuid, text)
  to authenticated;
grant execute on function private.photo_derivative_source_is_readable(text, uuid, text)
  to authenticated;

-- Allow the same photo worker to reclaim an expired lease with a new lease key.
-- The previous check blocked expired same-validator reclaim forever, which left
-- uploads stuck in uploaded_unverified after a mid-flight worker failure.

create or replace function private.claim_photo_validation(
  requested_intake_id uuid,
  requested_lease_key uuid
)
returns table(
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
security definer
set search_path to ''
as $function$
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
    raise exception using errcode = '42501',
      message = 'Photo validation could not be claimed';
  end if;

  if not (select private.lock_photo_validator_if_allowed(current_user_id)) then
    raise exception using errcode = '42501',
      message = 'Photo validation could not be claimed';
  end if;

  select job.* into target_job
    from private.photo_validation_jobs as job
   where job.intake_id = requested_intake_id;
  if target_job.id is null then
    raise exception using errcode = '22023',
      message = 'Photo validation could not be claimed';
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
    or not (
      select private.photo_intake_requester_is_authorized(target_intake.id)
    ) then
    raise exception using errcode = '42501',
      message = 'Photo validation could not be claimed';
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
    or source_metadata ->> 'mimetype'
      is distinct from target_intake.expected_mime_type
    or source_metadata ->> 'size'
      is distinct from target_intake.expected_size_bytes::text
    or source_user_metadata is distinct from jsonb_build_object(
      'intake_id', target_intake.id::text,
      'upload_request_key', target_intake.upload_request_key::text,
      'expected_mime_type', target_intake.expected_mime_type,
      'expected_size_bytes', target_intake.expected_size_bytes,
      'expected_sha256', encode(target_intake.expected_sha256, 'hex')
    ) then
    raise exception using errcode = '22023',
      message = 'Photo validation could not be claimed';
  end if;

  new_lease_attempt_id := extensions.gen_random_uuid();
  update private.photo_validation_jobs as job
     set state = 'leased',
         validator_auth_user_id = current_user_id,
         lease_key_hash = extensions.digest(
           requested_lease_key::text, 'sha256'
         ),
         lease_attempt_id = new_lease_attempt_id,
         canonical_object_path =
           'original/' || job.original_id::text
           || '/' || new_lease_attempt_id::text,
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
$function$;
