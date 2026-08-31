-- Phase 4D-B keeps every browser upload boundary behind the same default-off
-- publication capability and live Auth-session check used by staging.

create or replace function private.photo_intake_path_is_uploadable(
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
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target private.photo_intakes%rowtype;
  actor public.circle_memberships%rowtype;
begin
  if current_user_id is null
    or requested_object_path is null
    or requested_owner_id is distinct from current_user_id::text
    or not (select private.photo_capability_is_enabled('photo_publication'))
    or not (select private.current_family_session_is_live()) then
    return false;
  end if;

  select intake.circle_id
    into target_circle_id
    from private.photo_intakes as intake
   where intake.object_path = requested_object_path;
  if target_circle_id is null then return false; end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id for update;
  if not found then return false; end if;

  perform 1 from public.circles as circle
   where circle.id = target_circle_id for update;
  if not found then return false; end if;

  select intake.* into target
    from private.photo_intakes as intake
   where intake.circle_id = target_circle_id
     and intake.object_path = requested_object_path
   for update;
  if target.id is null then return false; end if;

  select membership.* into actor
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;
  if actor.id is null then return false; end if;

  return target.state = 'upload_claimed'
    and target.upload_expires_at > statement_timestamp()
    and actor.user_id = current_user_id
    and requested_user_metadata = jsonb_build_object(
      'intake_id', target.id::text,
      'upload_request_key', target.upload_request_key::text,
      'expected_mime_type', target.expected_mime_type,
      'expected_size_bytes', target.expected_size_bytes,
      'expected_sha256', encode(target.expected_sha256, 'hex')
    )
    and (select private.photo_intake_requester_is_authorized(target.id));
end;
$$;

create function private.require_photo_upload_session(error_message text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if error_message is null
    or not (select private.photo_capability_is_enabled('photo_publication'))
    or not (select private.current_family_session_is_live()) then
    raise exception using errcode = '42501',
      message = coalesce(error_message, 'Photo upload is unavailable');
  end if;
  return true;
end;
$$;

create or replace function public.reserve_photo_intake(
  circle_id uuid,
  journal_person_id uuid,
  request_key uuid
)
returns table (
  intake_id uuid, bucket_id text, object_path text, state text,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select reserved.*
    from private.require_photo_upload_session(
      'Photo intake could not be reserved'
    ) as gate
    cross join lateral private.reserve_photo_intake($1, $2, $3) as reserved
   where gate;
$$;

create or replace function public.claim_photo_intake_upload(
  intake_id uuid,
  upload_request_key uuid,
  expected_mime_type text,
  expected_size_bytes bigint,
  expected_sha256_hex text
)
returns table (
  intake_id uuid, bucket_id text, object_path text, state text,
  upload_expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select claimed.*
    from private.require_photo_upload_session(
      'Photo intake upload could not be claimed'
    ) as gate
    cross join lateral private.claim_photo_intake_upload(
      $1, $2, $3, $4, $5
    ) as claimed
   where gate;
$$;

create or replace function public.acknowledge_photo_intake(intake_id uuid)
returns table (
  intake_id uuid, bucket_id text, object_path text, state text,
  expires_at timestamptz, observed_mime_type_unverified text,
  observed_size_bytes_unverified bigint
)
language sql
volatile
security definer
set search_path = ''
as $$
  select acknowledged.*
    from private.require_photo_upload_session(
      'Photo intake could not be acknowledged'
    ) as gate
    cross join lateral private.acknowledge_photo_intake($1) as acknowledged
   where gate;
$$;

revoke all on function private.require_photo_upload_session(text)
  from public, anon, authenticated, service_role;

revoke all on function public.reserve_photo_intake(uuid, uuid, uuid)
  from public, anon;
revoke all on function public.claim_photo_intake_upload(
  uuid, uuid, text, bigint, text
) from public, anon;
revoke all on function public.acknowledge_photo_intake(uuid)
  from public, anon;
