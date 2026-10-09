-- Match the production definition of private.ensure_login_capable_auth_user.
-- New invitees stay confirmed, and Auth token columns are empty strings so
-- GoTrue can scan the row.

CREATE OR REPLACE FUNCTION private.ensure_login_capable_auth_user(normalized_email text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    update auth.users as auth_user
       set confirmation_token = coalesce(auth_user.confirmation_token, ''),
           recovery_token = coalesce(auth_user.recovery_token, ''),
           email_change_token_new = coalesce(auth_user.email_change_token_new, ''),
           email_change = coalesce(auth_user.email_change, ''),
           email_change_token_current = coalesce(auth_user.email_change_token_current, ''),
           reauthentication_token = coalesce(auth_user.reauthentication_token, '')
     where auth_user.id = existing_id;
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
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change,
    email_change_token_current,
    reauthentication_token,
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
    '',
    '',
    '',
    '',
    '',
    '',
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
$function$
