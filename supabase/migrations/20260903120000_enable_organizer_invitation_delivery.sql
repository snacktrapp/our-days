-- Enable organizer invitation sending on the existing email-request ledger.
-- Auth users are provisioned in-database so the web app can reuse the
-- existing magic-link vendor. Recipients still cannot open a journal until
-- they sign in and accept the pending request.

update private.invitation_delivery_capabilities
   set enabled = true,
       updated_at = statement_timestamp()
 where capability = 'email_delivery'
   and enabled is distinct from true;

comment on table private.invitation_delivery_capabilities is
  'Database-owner capability boundary for invitation delivery. Organizer sending is enabled; the relation still has no Data API or service-role access.';

create function private.ensure_login_capable_auth_user(
  normalized_email text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing_id uuid;
  created_id uuid;
begin
  if normalized_email is null
    or char_length(normalized_email) not between 3 and 254
    or normalized_email is distinct from lower(btrim(normalized_email)) then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
  end if;

  select auth_user.id into existing_id
    from auth.users as auth_user
   where lower(btrim(auth_user.email)) = normalized_email
     and auth_user.deleted_at is null
   order by auth_user.created_at, auth_user.id
   limit 1
   for update;
  if existing_id is not null then
    return existing_id;
  end if;

  created_id := extensions.gen_random_uuid();
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    invited_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    created_id,
    'authenticated',
    'authenticated',
    normalized_email,
    extensions.crypt(
      encode(extensions.gen_random_bytes(16), 'hex'),
      extensions.gen_salt('bf')
    ),
    statement_timestamp(),
    statement_timestamp(),
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email')
    ),
    '{}'::jsonb,
    statement_timestamp(),
    statement_timestamp()
  );

  insert into auth.identities (
    user_id,
    identity_data,
    provider,
    provider_id,
    last_sign_in_at,
    created_at,
    updated_at
  ) values (
    created_id,
    jsonb_build_object(
      'sub', created_id::text,
      'email', normalized_email,
      'email_verified', true
    ),
    'email',
    created_id::text,
    statement_timestamp(),
    statement_timestamp(),
    statement_timestamp()
  );

  return created_id;
end;
$$;

create or replace function private.request_invitation_email(
  requested_circle_id uuid,
  requested_email text,
  invited_display_name text,
  requested_request_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_email text := lower(btrim(requested_email));
  normalized_display_name text := btrim(invited_display_name);
  actor public.circle_memberships%rowtype;
  existing private.invitation_email_requests%rowtype;
  stale private.invitation_email_requests%rowtype;
  resulting_request_id uuid;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_request_key is null
    or normalized_email is null
    or char_length(normalized_email) not between 3 and 254
    or normalized_email !~
      '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+$'
    or normalized_display_name is null
    or char_length(normalized_display_name) not between 1 and 80 then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
  end if;

  if not coalesce((
    select capability.enabled
      from private.invitation_delivery_capabilities as capability
     where capability.capability = 'email_delivery'
  ), false) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id
     and auth_user.deleted_at is null
   for update;
  if not found or (select private.account_closure_is_blocking(
    current_user_id
  )) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;
  perform 1 from public.circles as circle
   where circle.id = requested_circle_id
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;
  select membership.* into actor
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
   for update;
  if actor.id is null or actor.status <> 'active'
    or actor.role <> 'organizer' then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;

  select request.* into existing
    from private.invitation_email_requests as request
   where request.circle_id = requested_circle_id
     and request.requested_by_membership_id = actor.id
     and request.request_key = requested_request_key
   for update;
  if existing.id is not null then
    if extensions.digest(
      pg_catalog.convert_to(normalized_email, 'UTF8') || existing.email_salt,
      'sha256'
    ) = existing.email_hash
      and existing.invited_display_name = normalized_display_name then
      perform private.ensure_login_capable_auth_user(normalized_email);
      return existing.id;
    end if;
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
  end if;

  for stale in
    select request.* from private.invitation_email_requests as request
     where request.circle_id = requested_circle_id
       and request.state in ('queued', 'provisioned', 'delivered')
       and request.expires_at <= statement_timestamp()
     order by request.id
     for update
  loop
    perform private.invalidate_invitation_email_request(
      stale.id, 'expired', null, null
    );
  end loop;

  if exists (
    select 1 from auth.users as target_user
    join public.circle_memberships as target_membership
      on target_membership.user_id = target_user.id
     and target_membership.circle_id = requested_circle_id
     and target_membership.status = 'active'
    where lower(btrim(target_user.email)) = normalized_email
      and target_user.deleted_at is null
  ) or (
    select count(*) >= 5
      from private.invitation_email_requests as request
     where request.requested_by_membership_id = actor.id
       and request.requested_at > statement_timestamp() - interval '15 minutes'
  ) or (
    select count(*) >= 20
      from private.invitation_email_requests as request
     where request.circle_id = requested_circle_id
       and request.state in ('queued', 'provisioned', 'delivered')
  ) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;

  insert into private.invitation_email_requests (
    circle_id, requested_by_membership_id,
    requester_authorization_version, normalized_email, email_salt, email_hash,
    invited_display_name, request_key
  ) select
    requested_circle_id, actor.id, actor.updated_at, normalized_email,
    generated_salt,
    extensions.digest(
      pg_catalog.convert_to(normalized_email, 'UTF8') || generated_salt,
      'sha256'
    ),
    normalized_display_name, requested_request_key
  from (select extensions.gen_random_bytes(16) as generated_salt) as salt
  returning id into resulting_request_id;

  perform private.ensure_login_capable_auth_user(normalized_email);
  perform private.record_invitation_coordination_audit(
    requested_circle_id, resulting_request_id, null, actor.id, null,
    'email_request_created'
  );
  return resulting_request_id;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
end;
$$;

create function private.accept_pending_invitation_for_current_user()
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  current_confirmed_at timestamptz;
  request_row private.invitation_email_requests%rowtype;
  existing_membership public.circle_memberships%rowtype;
  generated_person_id uuid;
  resulting_membership_id uuid;
begin
  if current_user_id is null then
    return null;
  end if;

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into current_email, current_confirmed_at
    from auth.users as auth_user
   where auth_user.id = current_user_id
     and auth_user.deleted_at is null
   for update;
  if current_email is null
    or current_confirmed_at is null
    or (select private.account_closure_is_blocking(current_user_id)) then
    return null;
  end if;

  select request.* into request_row
    from private.invitation_email_requests as request
   where request.normalized_email = current_email
     and request.state in ('queued', 'provisioned', 'delivered')
     and request.expires_at > statement_timestamp()
   order by request.requested_at desc, request.id desc
   limit 1;
  if request_row.id is null then
    return null;
  end if;

  perform 1 from public.circles
   where id = request_row.circle_id
   for update;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = request_row.id
   for update;
  if request_row.id is null
    or request_row.normalized_email is distinct from current_email
    or request_row.state not in ('queued', 'provisioned', 'delivered')
    or request_row.expires_at <= statement_timestamp() then
    return null;
  end if;

  select membership.* into existing_membership
    from public.circle_memberships as membership
   where membership.circle_id = request_row.circle_id
     and membership.user_id = current_user_id
   for update;
  if existing_membership.id is not null
    and existing_membership.status = 'active' then
    perform private.invalidate_invitation_email_request(
      request_row.id, 'target_became_active', existing_membership.id, null
    );
    return existing_membership.id;
  end if;

  if existing_membership.id is not null
    and existing_membership.status = 'revoked' then
    update public.circle_memberships
       set status = 'active',
           role = 'member',
           revoked_at = null,
           revoked_by_membership_id = null
     where id = existing_membership.id
    returning id into resulting_membership_id;
    perform private.invalidate_invitation_email_request(
      request_row.id, 'target_became_active', resulting_membership_id, null
    );
    return resulting_membership_id;
  end if;

  insert into public.people (
    circle_id, display_name, profile_kind, created_by_membership_id
  ) values (
    request_row.circle_id,
    request_row.invited_display_name,
    'account',
    request_row.requested_by_membership_id
  ) returning id into generated_person_id;

  insert into public.circle_memberships (
    circle_id, user_id, person_id, role, status
  ) values (
    request_row.circle_id,
    current_user_id,
    generated_person_id,
    'member',
    'active'
  ) returning id into resulting_membership_id;

  perform private.invalidate_invitation_email_request(
    request_row.id, 'target_became_active', resulting_membership_id, null
  );
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    request_row.circle_id,
    resulting_membership_id,
    'invitation_accepted',
    'invitation',
    request_row.id
  );
  return resulting_membership_id;
exception
  when unique_violation or check_violation or foreign_key_violation
    or too_many_rows then
    return null;
end;
$$;

create function public.accept_pending_invitation_for_current_user()
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.accept_pending_invitation_for_current_user();
$$;

revoke all on function private.ensure_login_capable_auth_user(text)
  from public, anon, authenticated, service_role;
revoke all on function private.accept_pending_invitation_for_current_user()
  from public, anon, authenticated, service_role;
revoke all on function public.accept_pending_invitation_for_current_user()
  from public, anon, authenticated, service_role;

grant execute on function public.accept_pending_invitation_for_current_user()
  to authenticated;
