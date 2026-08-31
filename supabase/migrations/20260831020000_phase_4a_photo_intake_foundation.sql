-- Phase 4A quarantined original-photo intake. This phase deliberately stops at
-- an unverified upload acknowledgement: it does not publish a moment, accept
-- an original, expose media reads, or claim that client-supplied metadata
-- describes the uploaded bytes.

create table private.photo_intakes (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  journal_person_id uuid not null,
  requested_by_membership_id uuid not null,
  requester_authorization_version timestamptz not null,
  request_key uuid not null,
  object_path text not null,
  state text not null default 'reserved',
  requested_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  upload_request_key uuid,
  expected_mime_type text,
  expected_size_bytes bigint,
  expected_sha256 bytea,
  upload_claimed_at timestamptz,
  upload_expires_at timestamptz,
  uploaded_at timestamptz,
  observed_mime_type_unverified text,
  observed_size_bytes_unverified bigint,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint photo_intakes_circle_id_id_key unique (circle_id, id),
  constraint photo_intakes_journal_person_fkey foreign key (
    circle_id,
    journal_person_id
  ) references public.people (circle_id, id) on delete restrict,
  constraint photo_intakes_requester_fkey foreign key (
    circle_id,
    requested_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint photo_intakes_request_key_unique unique (
    requested_by_membership_id,
    request_key
  ),
  constraint photo_intakes_object_path_unique unique (object_path),
  constraint photo_intakes_path_valid check (
    object_path = 'intake/' || id::text
  ),
  constraint photo_intakes_expiry_valid check (
    expires_at > requested_at
  ),
  constraint photo_intakes_observed_mime_valid check (
    observed_mime_type_unverified is null
    or char_length(observed_mime_type_unverified) between 1 and 255
  ),
  constraint photo_intakes_observed_size_valid check (
    observed_size_bytes_unverified is null
    or observed_size_bytes_unverified >= 0
  ),
  constraint photo_intakes_expected_mime_valid check (
    expected_mime_type is null
    or expected_mime_type in (
      'image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp'
    )
  ),
  constraint photo_intakes_expected_size_valid check (
    expected_size_bytes is null
    or expected_size_bytes between 1 and 52428800
  ),
  constraint photo_intakes_expected_sha256_valid check (
    expected_sha256 is null or octet_length(expected_sha256) = 32
  ),
  constraint photo_intakes_upload_window_valid check (
    (
      upload_claimed_at is null
      and upload_expires_at is null
    )
    or (
      upload_claimed_at is not null
      and upload_expires_at = upload_claimed_at + interval '2 hours'
    )
  ),
  constraint photo_intakes_state_valid check (
    (
      state = 'reserved'
      and uploaded_at is null
      and upload_request_key is null
      and expected_mime_type is null
      and expected_size_bytes is null
      and expected_sha256 is null
      and upload_claimed_at is null
      and upload_expires_at is null
      and observed_mime_type_unverified is null
      and observed_size_bytes_unverified is null
      and invalidated_at is null
      and invalidation_reason is null
    )
    or
    (
      state = 'upload_claimed'
      and upload_request_key is not null
      and expected_mime_type is not null
      and expected_size_bytes is not null
      and expected_sha256 is not null
      and upload_claimed_at is not null
      and upload_expires_at is not null
      and uploaded_at is null
      and observed_mime_type_unverified is null
      and observed_size_bytes_unverified is null
      and invalidated_at is null
      and invalidation_reason is null
    )
    or
    (
      state = 'uploaded_unverified'
      and upload_request_key is not null
      and expected_mime_type is not null
      and expected_size_bytes is not null
      and expected_sha256 is not null
      and upload_claimed_at is not null
      and upload_expires_at is not null
      and uploaded_at is not null
      and invalidated_at is null
      and invalidation_reason is null
    )
    or
    (
      state = 'invalidated'
      and invalidated_at is not null
      and invalidation_reason in (
        'membership_authority_changed',
        'guardian_authority_revoked'
      )
    )
  )
);

create index photo_intakes_requester_active_idx
  on private.photo_intakes (requested_by_membership_id, state)
  where state in ('reserved', 'upload_claimed', 'uploaded_unverified');

create index photo_intakes_journal_active_idx
  on private.photo_intakes (circle_id, journal_person_id, state)
  where state in ('reserved', 'upload_claimed', 'uploaded_unverified');

create index photo_intakes_upload_expiry_idx
  on private.photo_intakes (upload_expires_at, id)
  where state = 'upload_claimed';

create function private.enforce_photo_intake_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'Photo intake history cannot be deleted';
  end if;

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.journal_person_id is distinct from old.journal_person_id
    or new.requested_by_membership_id is distinct from
      old.requested_by_membership_id
    or new.requester_authorization_version is distinct from
      old.requester_authorization_version
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
        and new.observed_mime_type_unverified is not distinct from
          old.observed_mime_type_unverified
        and new.observed_size_bytes_unverified is not distinct from
          old.observed_size_bytes_unverified
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidation_reason is not distinct from
          old.invalidation_reason
      )
      or (
        old.state = 'reserved'
        and old.upload_request_key is null
        and old.expected_mime_type is null
        and old.expected_size_bytes is null
        and old.expected_sha256 is null
        and old.upload_claimed_at is null
        and old.upload_expires_at is null
        and old.uploaded_at is null
        and old.observed_mime_type_unverified is null
        and old.observed_size_bytes_unverified is null
        and old.invalidated_at is null
        and new.state = 'upload_claimed'
        and new.upload_request_key is not null
        and new.expected_mime_type is not null
        and new.expected_size_bytes is not null
        and new.expected_sha256 is not null
        and new.upload_claimed_at is not null
        and new.upload_expires_at is not null
        and new.uploaded_at is null
        and new.observed_mime_type_unverified is null
        and new.observed_size_bytes_unverified is null
        and new.invalidated_at is null
        and new.invalidation_reason is null
      )
      or (
        old.state = 'upload_claimed'
        and old.upload_request_key is not null
        and old.expected_mime_type is not null
        and old.expected_size_bytes is not null
        and old.expected_sha256 is not null
        and old.upload_claimed_at is not null
        and old.upload_expires_at is not null
        and old.uploaded_at is null
        and old.observed_mime_type_unverified is null
        and old.observed_size_bytes_unverified is null
        and old.invalidated_at is null
        and new.state = 'uploaded_unverified'
        and new.upload_request_key = old.upload_request_key
        and new.expected_mime_type = old.expected_mime_type
        and new.expected_size_bytes = old.expected_size_bytes
        and new.expected_sha256 = old.expected_sha256
        and new.upload_claimed_at = old.upload_claimed_at
        and new.upload_expires_at = old.upload_expires_at
        and new.uploaded_at is not null
        and new.invalidated_at is null
        and new.invalidation_reason is null
      )
      or (
        old.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
        and old.invalidated_at is null
        and new.state = 'invalidated'
        and new.upload_request_key is not distinct from old.upload_request_key
        and new.expected_mime_type is not distinct from old.expected_mime_type
        and new.expected_size_bytes is not distinct from old.expected_size_bytes
        and new.expected_sha256 is not distinct from old.expected_sha256
        and new.upload_claimed_at is not distinct from old.upload_claimed_at
        and new.upload_expires_at is not distinct from old.upload_expires_at
        and new.uploaded_at is not distinct from old.uploaded_at
        and new.observed_mime_type_unverified is not distinct from
          old.observed_mime_type_unverified
        and new.observed_size_bytes_unverified is not distinct from
          old.observed_size_bytes_unverified
        and new.invalidated_at is not null
        and new.invalidation_reason in (
          'membership_authority_changed',
          'guardian_authority_revoked'
        )
      )
    ) then
    raise exception using
      errcode = '42501',
      message = 'Photo intake history is immutable';
  end if;

  return new;
end;
$$;

create trigger photo_intakes_integrity
before update or delete on private.photo_intakes
for each row execute function private.enforce_photo_intake_integrity();

alter table private.photo_intakes enable row level security;
alter table private.photo_intakes force row level security;

create function private.photo_intake_requester_is_authorized(
  requested_intake_id uuid
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.photo_intakes as intake
      join public.circle_memberships as membership
        on membership.circle_id = intake.circle_id
       and membership.id = intake.requested_by_membership_id
      join public.people as journal_person
        on journal_person.circle_id = intake.circle_id
       and journal_person.id = intake.journal_person_id
     where intake.id = requested_intake_id
       and membership.status = 'active'
       and membership.user_id is not null
       and not (select private.account_closure_is_blocking(
         membership.user_id
       ))
       and (
         membership.person_id = intake.journal_person_id
         or (
           journal_person.profile_kind = 'managed'
           and membership.role = 'organizer'
         )
         or exists (
           select 1
             from public.person_guardians as guardian
            where guardian.circle_id = intake.circle_id
              and guardian.managed_person_id = intake.journal_person_id
              and guardian.guardian_membership_id = membership.id
              and guardian.revoked_at is null
         )
       )
  );
$$;

create function private.photo_intake_path_is_uploadable(
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
    or requested_owner_id is distinct from current_user_id::text then
    return false;
  end if;

  select intake.circle_id
    into target_circle_id
    from private.photo_intakes as intake
   where intake.object_path = requested_object_path;

  if target_circle_id is null then
    return false;
  end if;

  -- Hold the same Auth -> circle authority barrier through Storage INSERT.
  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found then
    return false;
  end if;

  perform 1
    from public.circles as circle
   where circle.id = target_circle_id
   for update;

  if not found then
    return false;
  end if;

  select intake.*
    into target
    from private.photo_intakes as intake
   where intake.circle_id = target_circle_id
     and intake.object_path = requested_object_path
   for update;

  if target.id is null then
    return false;
  end if;

  select membership.*
    into actor
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;

  if actor.id is null then
    return false;
  end if;

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

create function private.reserve_photo_intake(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_request_key uuid
)
returns table (
  intake_id uuid,
  bucket_id text,
  object_path text,
  state text,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor public.circle_memberships%rowtype;
  existing private.photo_intakes%rowtype;
  reserved private.photo_intakes%rowtype;
  generated_intake_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_journal_person_id is null
    or requested_request_key is null then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be reserved';
  end if;

  -- All browser reservation paths lock Auth before circle, matching closure.
  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be reserved';
  end if;

  perform 1
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  if not found
    or (select private.account_closure_is_blocking(current_user_id)) then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be reserved';
  end if;

  select membership.*
    into actor
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
   for update;

  if actor.id is null
    or actor.status <> 'active'
    or not (select private.can_manage_person(
      requested_circle_id,
      requested_journal_person_id
    )) then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be reserved';
  end if;

  select intake.*
    into existing
    from private.photo_intakes as intake
   where intake.requested_by_membership_id = actor.id
     and intake.request_key = requested_request_key
   for update;

  if existing.id is not null then
    if existing.circle_id <> requested_circle_id
      or existing.journal_person_id <> requested_journal_person_id then
      raise exception using
        errcode = '22023',
        message = 'Photo intake idempotency key was reused';
    end if;

    return query
    select
      existing.id,
      'our-days-intake'::text,
      existing.object_path,
      existing.state,
      existing.expires_at;
    return;
  end if;

  generated_intake_id := extensions.gen_random_uuid();

  insert into private.photo_intakes (
    id,
    circle_id,
    journal_person_id,
    requested_by_membership_id,
    requester_authorization_version,
    request_key,
    object_path,
    expires_at
  )
  values (
    generated_intake_id,
    requested_circle_id,
    requested_journal_person_id,
    actor.id,
    actor.updated_at,
    requested_request_key,
    'intake/' || generated_intake_id::text,
    statement_timestamp() + interval '30 minutes'
  )
  returning * into reserved;

  return query
  select
    reserved.id,
    'our-days-intake'::text,
    reserved.object_path,
    reserved.state,
    reserved.expires_at;
end;
$$;

create function private.claim_photo_intake_upload(
  requested_intake_id uuid,
  requested_upload_request_key uuid,
  requested_expected_mime_type text,
  requested_expected_size_bytes bigint,
  requested_expected_sha256_hex text
)
returns table (
  intake_id uuid,
  bucket_id text,
  object_path text,
  state text,
  upload_expires_at timestamptz
)
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
    or requested_intake_id is null
    or requested_upload_request_key is null
    or requested_expected_mime_type is null
    or requested_expected_mime_type <> lower(btrim(requested_expected_mime_type))
    or requested_expected_mime_type not in (
      'image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/webp'
    )
    or requested_expected_size_bytes is null
    or requested_expected_size_bytes not between 1 and 52428800
    or requested_expected_sha256_hex is null
    or requested_expected_sha256_hex !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Photo intake upload could not be claimed';
  end if;

  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Photo intake upload could not be claimed';
  end if;

  select intake.circle_id
    into target_circle_id
    from private.photo_intakes as intake
   where intake.id = requested_intake_id;

  if target_circle_id is null then
    raise exception using
      errcode = '22023',
      message = 'Photo intake upload could not be claimed';
  end if;

  perform 1
    from public.circles as circle
   where circle.id = target_circle_id
   for update;

  select intake.*
    into target
    from private.photo_intakes as intake
   where intake.circle_id = target_circle_id
     and intake.id = requested_intake_id
   for update;

  select membership.*
    into actor
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;

  if target.id is null
    or actor.id is null
    or actor.user_id is distinct from current_user_id
    or not (select private.photo_intake_requester_is_authorized(target.id))
    or not (select private.can_manage_person(
      target.circle_id,
      target.journal_person_id
    )) then
    raise exception using
      errcode = '22023',
      message = 'Photo intake upload could not be claimed';
  end if;

  if target.state in ('upload_claimed', 'uploaded_unverified') then
    if target.upload_request_key is distinct from requested_upload_request_key
      or target.expected_mime_type is distinct from requested_expected_mime_type
      or target.expected_size_bytes is distinct from requested_expected_size_bytes
      or encode(target.expected_sha256, 'hex') is distinct from
        requested_expected_sha256_hex then
      raise exception using
        errcode = '22023',
        message = 'Photo intake upload claim was reused';
    end if;

    return query
    select
      target.id,
      'our-days-intake'::text,
      target.object_path,
      target.state,
      target.upload_expires_at;
    return;
  end if;

  if target.state <> 'reserved'
    or target.expires_at <= statement_timestamp() then
    raise exception using
      errcode = '22023',
      message = 'Photo intake upload could not be claimed';
  end if;

  update private.photo_intakes as intake
     set state = 'upload_claimed',
         upload_request_key = requested_upload_request_key,
         expected_mime_type = requested_expected_mime_type,
         expected_size_bytes = requested_expected_size_bytes,
         expected_sha256 = decode(requested_expected_sha256_hex, 'hex'),
         upload_claimed_at = statement_timestamp(),
         upload_expires_at = statement_timestamp() + interval '2 hours'
   where intake.id = target.id
   returning * into target;

  return query
  select
    target.id,
    'our-days-intake'::text,
    target.object_path,
    target.state,
    target.upload_expires_at;
end;
$$;

create function private.acknowledge_photo_intake(
  requested_intake_id uuid
)
returns table (
  intake_id uuid,
  bucket_id text,
  object_path text,
  state text,
  expires_at timestamptz,
  observed_mime_type_unverified text,
  observed_size_bytes_unverified bigint
)
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
  stored_owner_id text;
  stored_metadata jsonb;
  stored_user_metadata jsonb;
  observed_mime text;
  observed_size bigint;
begin
  if current_user_id is null or requested_intake_id is null then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  -- Preserve the same Auth -> circle lock order used by reservation/closure.
  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  select intake.circle_id
    into target_circle_id
    from private.photo_intakes as intake
   where intake.id = requested_intake_id;

  if target_circle_id is null then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  perform 1
    from public.circles as circle
   where circle.id = target_circle_id
   for update;

  select intake.*
    into target
    from private.photo_intakes as intake
   where intake.id = requested_intake_id
   for update;

  select membership.*
    into actor
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;

  if target.id is null
    or actor.id is null
    or target.state = 'invalidated'
    or target.state not in ('upload_claimed', 'uploaded_unverified')
    or (select private.account_closure_is_blocking(current_user_id))
    or actor.user_id is distinct from current_user_id
    or not (select private.photo_intake_requester_is_authorized(target.id))
    or not (select private.can_manage_person(
      target.circle_id,
      target.journal_person_id
    )) then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  select object.owner_id, object.metadata, object.user_metadata
    into stored_owner_id, stored_metadata, stored_user_metadata
    from storage.objects as object
   where object.bucket_id = 'our-days-intake'
     and object.name = target.object_path;

  if stored_owner_id is distinct from current_user_id::text then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  if stored_user_metadata is distinct from jsonb_build_object(
      'intake_id', target.id::text,
      'upload_request_key', target.upload_request_key::text,
      'expected_mime_type', target.expected_mime_type,
      'expected_size_bytes', target.expected_size_bytes,
      'expected_sha256', encode(target.expected_sha256, 'hex')
    ) then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  observed_mime := nullif(btrim(stored_metadata ->> 'mimetype'), '');
  if observed_mime is not null and char_length(observed_mime) > 255 then
    observed_mime := null;
  end if;

  if coalesce(stored_metadata ->> 'size', '') ~ '^[0-9]{1,18}$'
    and (stored_metadata ->> 'size')::numeric <= 9223372036854775807 then
    observed_size := (stored_metadata ->> 'size')::bigint;
  else
    observed_size := null;
  end if;

  if observed_mime is distinct from target.expected_mime_type
    or observed_size is distinct from target.expected_size_bytes then
    raise exception using
      errcode = '22023',
      message = 'Photo intake could not be acknowledged';
  end if;

  if target.state = 'upload_claimed' then
    update private.photo_intakes as intake
       set state = 'uploaded_unverified',
           uploaded_at = statement_timestamp(),
           observed_mime_type_unverified = observed_mime,
           observed_size_bytes_unverified = observed_size
     where intake.id = target.id
     returning * into target;
  end if;

  return query
  select
    target.id,
    'our-days-intake'::text,
    target.object_path,
    target.state,
    target.expires_at,
    target.observed_mime_type_unverified,
    target.observed_size_bytes_unverified;
end;
$$;

create function private.invalidate_photo_intakes_after_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.photo_intakes as intake
     set state = 'invalidated',
         invalidated_at = statement_timestamp(),
         invalidation_reason = 'membership_authority_changed'
   where intake.requested_by_membership_id = new.id
     and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
     and not (select private.photo_intake_requester_is_authorized(intake.id));

  return new;
end;
$$;

create trigger photo_intakes_invalidate_after_membership_change
after update on public.circle_memberships
for each row
when (
  old.status is distinct from new.status
  or old.role is distinct from new.role
  or old.user_id is distinct from new.user_id
  or old.updated_at is distinct from new.updated_at
)
execute function private.invalidate_photo_intakes_after_membership_change();

create function private.invalidate_photo_intakes_after_guardian_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    update private.photo_intakes as intake
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidation_reason = 'guardian_authority_revoked'
     where intake.circle_id = new.circle_id
       and intake.journal_person_id = new.managed_person_id
       and intake.requested_by_membership_id = new.guardian_membership_id
       and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
       and not (select private.photo_intake_requester_is_authorized(intake.id));
  end if;

  return new;
end;
$$;

create trigger photo_intakes_invalidate_after_guardian_revocation
after update on public.person_guardians
for each row execute function
  private.invalidate_photo_intakes_after_guardian_revocation();

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'our-days-intake',
  'our-days-intake',
  false,
  52428800,
  array[
    'image/heic',
    'image/heif',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy our_days_intake_insert_exact_live_tus_claim
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'our-days-intake'
  and (select storage.allow_any_operation(array[
    'storage.tus.upload.create',
    'storage.tus.upload.part'
  ]::text[]))
  and owner_id = (select auth.uid()::text)
  and (select private.photo_intake_path_is_uploadable(
    name,
    owner_id,
    user_metadata
  ))
);

create function public.reserve_photo_intake(
  circle_id uuid,
  journal_person_id uuid,
  request_key uuid
)
returns table (
  intake_id uuid,
  bucket_id text,
  object_path text,
  state text,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select *
    from private.reserve_photo_intake(
      $1,
      $2,
      $3
    );
$$;

create function public.claim_photo_intake_upload(
  intake_id uuid,
  upload_request_key uuid,
  expected_mime_type text,
  expected_size_bytes bigint,
  expected_sha256_hex text
)
returns table (
  intake_id uuid,
  bucket_id text,
  object_path text,
  state text,
  upload_expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select *
    from private.claim_photo_intake_upload($1, $2, $3, $4, $5);
$$;

create function public.acknowledge_photo_intake(intake_id uuid)
returns table (
  intake_id uuid,
  bucket_id text,
  object_path text,
  state text,
  expires_at timestamptz,
  observed_mime_type_unverified text,
  observed_size_bytes_unverified bigint
)
language sql
volatile
security definer
set search_path = ''
as $$
  select *
    from private.acknowledge_photo_intake($1);
$$;

revoke all on table private.photo_intakes
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_photo_intake_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.photo_intake_requester_is_authorized(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.photo_intake_path_is_uploadable(text, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.reserve_photo_intake(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.claim_photo_intake_upload(
  uuid, uuid, text, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function private.acknowledge_photo_intake(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_photo_intakes_after_membership_change()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_photo_intakes_after_guardian_revocation()
  from public, anon, authenticated, service_role;

-- The Storage INSERT policy needs this single boolean helper; it grants no
-- ledger read and reveals no path that the caller did not already possess.
grant execute on function private.photo_intake_path_is_uploadable(
  text, text, jsonb
)
  to authenticated;

revoke all on function public.reserve_photo_intake(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.claim_photo_intake_upload(
  uuid, uuid, text, bigint, text
) from public, anon, authenticated;
revoke all on function public.acknowledge_photo_intake(uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_photo_intake(uuid, uuid, uuid)
  to authenticated;
grant execute on function public.claim_photo_intake_upload(
  uuid, uuid, text, bigint, text
) to authenticated;
grant execute on function public.acknowledge_photo_intake(uuid)
  to authenticated;
