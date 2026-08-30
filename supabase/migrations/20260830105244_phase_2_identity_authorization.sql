create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

revoke create on schema public from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to anon, authenticated;

alter default privileges in schema public revoke all on tables from public, anon, authenticated;
alter default privileges in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private revoke all on tables from public, anon, authenticated;
alter default privileges in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;

create table public.circles (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint circles_name_valid check (
    name = btrim(name)
    and char_length(name) between 1 and 80
  )
);

create table public.people (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  display_name text not null,
  profile_kind text not null,
  accent_token text not null default 'clay',
  created_by_membership_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint people_circle_id_id_key unique (circle_id, id),
  constraint people_display_name_valid check (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
  ),
  constraint people_profile_kind_valid check (
    profile_kind in ('account', 'managed')
  ),
  constraint people_accent_token_valid check (
    accent_token in ('clay', 'sage', 'gold', 'sky', 'plum', 'rose')
  )
);

create table public.circle_memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  person_id uuid not null,
  role text not null default 'member',
  status text not null default 'active',
  joined_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_by_membership_id uuid,
  constraint circle_memberships_circle_id_id_key unique (circle_id, id),
  constraint circle_memberships_circle_id_user_id_key unique (circle_id, user_id),
  constraint circle_memberships_circle_id_person_id_key unique (circle_id, person_id),
  constraint circle_memberships_person_fkey foreign key (circle_id, person_id)
    references public.people (circle_id, id) on delete restrict,
  constraint circle_memberships_role_valid check (role in ('member', 'organizer')),
  constraint circle_memberships_status_valid check (status in ('active', 'revoked')),
  constraint circle_memberships_revocation_state_valid check (
    (status = 'active' and revoked_at is null and revoked_by_membership_id is null)
    or
    (status = 'revoked' and revoked_at is not null and revoked_by_membership_id is not null)
  )
);

alter table public.circle_memberships
  add constraint circle_memberships_revoked_by_fkey
  foreign key (circle_id, revoked_by_membership_id)
  references public.circle_memberships (circle_id, id)
  on delete restrict;

alter table public.circles
  add constraint circles_created_by_fkey
  foreign key (id, created_by_membership_id)
  references public.circle_memberships (circle_id, id)
  on delete restrict
  deferrable initially deferred;

alter table public.people
  add constraint people_created_by_fkey
  foreign key (circle_id, created_by_membership_id)
  references public.circle_memberships (circle_id, id)
  on delete restrict
  deferrable initially deferred;

create table public.person_guardians (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  managed_person_id uuid not null,
  guardian_membership_id uuid not null,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  revoked_by_membership_id uuid,
  constraint person_guardians_circle_id_id_key unique (circle_id, id),
  constraint person_guardians_person_fkey foreign key (circle_id, managed_person_id)
    references public.people (circle_id, id) on delete restrict,
  constraint person_guardians_guardian_fkey foreign key (circle_id, guardian_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint person_guardians_creator_fkey foreign key (circle_id, created_by_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint person_guardians_revoked_by_fkey foreign key (circle_id, revoked_by_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint person_guardians_revocation_state_valid check (
    (revoked_at is null and revoked_by_membership_id is null)
    or
    (revoked_at is not null and revoked_by_membership_id is not null)
  )
);

create table private.invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  person_id uuid not null,
  created_by_membership_id uuid not null,
  token_hash bytea not null unique,
  email_salt bytea not null,
  email_hash bytea not null,
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_membership_id uuid,
  revoked_at timestamptz,
  revoked_by_membership_id uuid,
  constraint invitations_circle_id_id_key unique (circle_id, id),
  constraint invitations_person_fkey foreign key (circle_id, person_id)
    references public.people (circle_id, id) on delete restrict,
  constraint invitations_creator_fkey foreign key (circle_id, created_by_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitations_accepted_membership_fkey foreign key (circle_id, accepted_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitations_revoked_by_fkey foreign key (circle_id, revoked_by_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitations_token_hash_length check (octet_length(token_hash) = 32),
  constraint invitations_email_salt_length check (octet_length(email_salt) >= 16),
  constraint invitations_email_hash_length check (octet_length(email_hash) = 32),
  constraint invitations_expiry_valid check (expires_at > created_at),
  constraint invitations_terminal_state_valid check (
    (accepted_at is null and accepted_membership_id is null and revoked_at is null and revoked_by_membership_id is null)
    or
    (accepted_at is not null and accepted_membership_id is not null and revoked_at is null and revoked_by_membership_id is null)
    or
    (accepted_at is null and accepted_membership_id is null and revoked_at is not null and revoked_by_membership_id is not null)
  )
);

create table private.audit_events (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.circles (id) on delete restrict,
  actor_membership_id uuid not null,
  event_type text not null,
  subject_type text not null,
  subject_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint audit_events_actor_fkey foreign key (circle_id, actor_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict,
  constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created',
      'invitation_accepted',
      'invitation_revoked',
      'membership_revoked',
      'membership_role_changed',
      'managed_person_created',
      'guardian_added',
      'guardian_removed'
    )
  ),
  constraint audit_events_subject_type_valid check (
    subject_type in ('invitation', 'membership', 'person', 'guardian')
  )
);

create index circle_memberships_user_id_idx
  on public.circle_memberships (user_id);
create index people_creator_idx
  on public.people (circle_id, created_by_membership_id);
create index circle_memberships_active_user_circle_idx
  on public.circle_memberships (user_id, circle_id)
  where status = 'active';
create index circle_memberships_active_organizer_circle_idx
  on public.circle_memberships (circle_id)
  where status = 'active' and role = 'organizer';
create index circle_memberships_revoked_by_idx
  on public.circle_memberships (circle_id, revoked_by_membership_id)
  where revoked_by_membership_id is not null;
create index person_guardians_guardian_idx
  on public.person_guardians (circle_id, guardian_membership_id);
create index person_guardians_person_idx
  on public.person_guardians (circle_id, managed_person_id);
create index person_guardians_creator_idx
  on public.person_guardians (circle_id, created_by_membership_id);
create index person_guardians_revoked_by_idx
  on public.person_guardians (circle_id, revoked_by_membership_id)
  where revoked_by_membership_id is not null;
create unique index person_guardians_active_grant_idx
  on public.person_guardians (circle_id, managed_person_id, guardian_membership_id)
  where revoked_at is null;
create unique index invitations_pending_person_idx
  on private.invitations (circle_id, person_id)
  where accepted_at is null and revoked_at is null;
create index invitations_pending_circle_created_idx
  on private.invitations (circle_id, created_at desc)
  where accepted_at is null and revoked_at is null;
create index invitations_creator_idx
  on private.invitations (circle_id, created_by_membership_id);
create index invitations_person_idx
  on private.invitations (circle_id, person_id);
create index invitations_accepted_membership_idx
  on private.invitations (circle_id, accepted_membership_id)
  where accepted_membership_id is not null;
create index invitations_revoked_by_idx
  on private.invitations (circle_id, revoked_by_membership_id)
  where revoked_by_membership_id is not null;
create index audit_events_circle_created_idx
  on private.audit_events (circle_id, created_at desc, id desc);
create index audit_events_actor_idx
  on private.audit_events (circle_id, actor_membership_id);

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger circles_touch_updated_at
before update on public.circles
for each row execute function private.touch_updated_at();

create trigger people_touch_updated_at
before update on public.people
for each row execute function private.touch_updated_at();

create function private.enforce_circle_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.created_by_membership_id <> old.created_by_membership_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'Circle identity is immutable';
  end if;
  return new;
end;
$$;

create trigger circles_identity
before update on public.circles
for each row execute function private.enforce_circle_identity();

create function private.enforce_person_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.profile_kind <> old.profile_kind
    or new.created_by_membership_id <> old.created_by_membership_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'Person identity is immutable';
  end if;
  return new;
end;
$$;

create trigger people_identity
before update on public.people
for each row execute function private.enforce_person_identity();

create function private.enforce_membership_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_kind text;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Memberships are retained as history';
  end if;

  select person.profile_kind
    into linked_kind
    from public.people as person
   where person.circle_id = new.circle_id
     and person.id = new.person_id;

  if linked_kind is distinct from 'account' then
    raise exception using errcode = '23514', message = 'Memberships require an account profile';
  end if;

  if tg_op = 'UPDATE' then
    if new.circle_id <> old.circle_id
      or new.user_id <> old.user_id
      or new.person_id <> old.person_id
      or new.joined_at <> old.joined_at then
      raise exception using errcode = '42501', message = 'Membership identity is immutable';
    end if;

    if old.status = 'active'
      and old.role = 'organizer'
      and not (new.status = 'active' and new.role = 'organizer') then
      perform 1 from public.circles where id = old.circle_id for update;

      if not exists (
        select 1
          from public.circle_memberships as other_membership
         where other_membership.circle_id = old.circle_id
           and other_membership.id <> old.id
           and other_membership.status = 'active'
           and other_membership.role = 'organizer'
      ) then
        raise exception using errcode = '23514', message = 'A circle must retain an active organizer';
      end if;
    end if;
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger circle_memberships_integrity
before insert or update or delete on public.circle_memberships
for each row execute function private.enforce_membership_integrity();

create function private.enforce_guardian_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.circle_id <> old.circle_id
    or new.managed_person_id <> old.managed_person_id
    or new.guardian_membership_id <> old.guardian_membership_id
    or new.created_by_membership_id <> old.created_by_membership_id
    or new.created_at <> old.created_at
  ) then
    raise exception using errcode = '42501', message = 'Guardian identity is immutable';
  end if;

  if not exists (
    select 1
      from public.people as person
     where person.circle_id = new.circle_id
       and person.id = new.managed_person_id
       and person.profile_kind = 'managed'
  ) then
    raise exception using errcode = '23514', message = 'Guardians require a managed profile';
  end if;

  return new;
end;
$$;

create trigger person_guardians_integrity
before insert or update on public.person_guardians
for each row execute function private.enforce_guardian_integrity();

create function private.is_active_circle_member(requested_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.circle_memberships as membership
     where membership.circle_id = requested_circle_id
       and membership.user_id = (select auth.uid())
       and membership.status = 'active'
  );
$$;

create function private.is_circle_organizer(requested_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.circle_memberships as membership
     where membership.circle_id = requested_circle_id
       and membership.user_id = (select auth.uid())
       and membership.status = 'active'
       and membership.role = 'organizer'
  );
$$;

create function private.current_membership_id(requested_circle_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active';
$$;

create function private.can_view_person(
  requested_circle_id uuid,
  requested_person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_active_circle_member(requested_circle_id))
    and exists (
      select 1
        from public.people as person
       where person.circle_id = requested_circle_id
         and person.id = requested_person_id
         and (
           person.profile_kind = 'managed'
           or exists (
             select 1
               from public.circle_memberships as membership
              where membership.circle_id = requested_circle_id
                and membership.person_id = requested_person_id
           )
         )
    );
$$;

create function private.can_manage_person(
  requested_circle_id uuid,
  requested_person_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.circle_memberships as membership
     where membership.circle_id = requested_circle_id
       and membership.user_id = (select auth.uid())
       and membership.status = 'active'
       and (
         membership.person_id = requested_person_id
         or exists (
           select 1
             from public.person_guardians as guardian
            where guardian.circle_id = requested_circle_id
              and guardian.managed_person_id = requested_person_id
              and guardian.guardian_membership_id = membership.id
              and guardian.revoked_at is null
         )
       )
  );
$$;

revoke all on function private.touch_updated_at() from public, anon, authenticated;
revoke all on function private.enforce_circle_identity() from public, anon, authenticated;
revoke all on function private.enforce_person_identity() from public, anon, authenticated;
revoke all on function private.enforce_membership_integrity() from public, anon, authenticated;
revoke all on function private.enforce_guardian_integrity() from public, anon, authenticated;
revoke all on function private.is_active_circle_member(uuid) from public, anon;
revoke all on function private.is_circle_organizer(uuid) from public, anon;
revoke all on function private.current_membership_id(uuid) from public, anon;
revoke all on function private.can_view_person(uuid, uuid) from public, anon;
revoke all on function private.can_manage_person(uuid, uuid) from public, anon;
grant execute on function private.is_active_circle_member(uuid) to authenticated;
grant execute on function private.is_circle_organizer(uuid) to authenticated;
grant execute on function private.current_membership_id(uuid) to authenticated;
grant execute on function private.can_view_person(uuid, uuid) to authenticated;
grant execute on function private.can_manage_person(uuid, uuid) to authenticated;

alter table public.circles enable row level security;
alter table public.people enable row level security;
alter table public.circle_memberships enable row level security;
alter table public.person_guardians enable row level security;

create policy circles_select_active_member
on public.circles for select to authenticated
using ((select private.is_active_circle_member(id)));

create policy people_select_active_member
on public.people for select to authenticated
using ((select private.can_view_person(circle_id, id)));

create policy memberships_select_active_circle
on public.circle_memberships for select to authenticated
using ((select private.is_active_circle_member(circle_id)));

create policy guardians_select_active_member
on public.person_guardians for select to authenticated
using (
  revoked_at is null
  and (select private.is_active_circle_member(circle_id))
);

revoke all on table public.circles from public, anon, authenticated;
revoke all on table public.people from public, anon, authenticated;
revoke all on table public.circle_memberships from public, anon, authenticated;
revoke all on table public.person_guardians from public, anon, authenticated;
revoke all on table private.invitations from public, anon, authenticated;
revoke all on table private.audit_events from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;

grant select on table public.circles to authenticated;
grant select on table public.people to authenticated;
grant select on table public.circle_memberships to authenticated;
grant select on table public.person_guardians to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('our-days-originals', 'our-days-originals', false, 52428800),
  ('our-days-display', 'our-days-display', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy our_days_storage_objects_closed_until_media_phase
on storage.objects
as restrictive
for all
to anon, authenticated
using (bucket_id not in ('our-days-originals', 'our-days-display'))
with check (bucket_id not in ('our-days-originals', 'our-days-display'));

create function private.create_invitation(
  requested_circle_id uuid,
  invited_display_name text,
  invited_email text,
  reinvite_membership_id uuid default null
)
returns table (invitation_id uuid, raw_token text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_email text := lower(btrim(invited_email));
  normalized_display_name text := btrim(invited_display_name);
  actor_membership_id uuid;
  person_id uuid;
  reinvite_membership public.circle_memberships%rowtype;
  reinvite_email text;
  invitation_token text;
  invitation_salt bytea;
  invitation_expires_at timestamptz := statement_timestamp() + interval '48 hours';
begin
  if (select auth.uid()) is null
    or normalized_email is null
    or char_length(normalized_email) not between 3 and 254
    or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or normalized_display_name is null
    or char_length(normalized_display_name) not between 1 and 80 then
    raise exception using errcode = '22023', message = 'Invitation could not be created';
  end if;

  perform 1 from public.circles where id = requested_circle_id for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null then
    raise exception using errcode = '42501', message = 'Invitation could not be created';
  end if;

  with expired as (
    update private.invitations as invitation
       set revoked_at = statement_timestamp(),
           revoked_by_membership_id = actor_membership_id
     where invitation.circle_id = requested_circle_id
       and invitation.accepted_at is null
       and invitation.revoked_at is null
       and invitation.expires_at <= statement_timestamp()
    returning invitation.id
  )
  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  select
    requested_circle_id,
    actor_membership_id,
    'invitation_revoked',
    'invitation',
    expired.id
  from expired;

  if exists (
    select 1
      from private.invitations as pending
     where pending.circle_id = requested_circle_id
       and pending.accepted_at is null
       and pending.revoked_at is null
       and extensions.digest(
         pg_catalog.convert_to(normalized_email, 'UTF8') || pending.email_salt,
         'sha256'
       ) = pending.email_hash
  ) then
    raise exception using errcode = '23505', message = 'Invitation could not be created';
  end if;

  if reinvite_membership_id is null then
    insert into public.people (
      circle_id,
      display_name,
      profile_kind,
      created_by_membership_id
    )
    values (
      requested_circle_id,
      normalized_display_name,
      'account',
      actor_membership_id
    )
    returning id into person_id;
  else
    select membership.*
      into reinvite_membership
      from public.circle_memberships as membership
      join auth.users as auth_user on auth_user.id = membership.user_id
     where membership.id = reinvite_membership_id
       and membership.circle_id = requested_circle_id
       and membership.status = 'revoked'
       and auth_user.email_confirmed_at is not null
     for update of membership;

    select lower(btrim(auth_user.email))
      into reinvite_email
      from auth.users as auth_user
     where auth_user.id = reinvite_membership.user_id
       and auth_user.email_confirmed_at is not null;

    if reinvite_membership.id is null or reinvite_email <> normalized_email then
      raise exception using errcode = '22023', message = 'Invitation could not be created';
    end if;

    person_id := reinvite_membership.person_id;
  end if;

  invitation_token := translate(
    trim(trailing '=' from encode(extensions.gen_random_bytes(32), 'base64')),
    '+/',
    '-_'
  );
  invitation_salt := extensions.gen_random_bytes(16);

  insert into private.invitations (
    circle_id,
    person_id,
    created_by_membership_id,
    token_hash,
    email_salt,
    email_hash,
    expires_at
  )
  values (
    requested_circle_id,
    person_id,
    actor_membership_id,
    extensions.digest(invitation_token, 'sha256'),
    invitation_salt,
    extensions.digest(
      pg_catalog.convert_to(normalized_email, 'UTF8') || invitation_salt,
      'sha256'
    ),
    invitation_expires_at
  )
  returning id into invitation_id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    requested_circle_id,
    actor_membership_id,
    'invitation_created',
    'invitation',
    invitation_id
  );

  raw_token := invitation_token;
  expires_at := invitation_expires_at;
  return next;
exception
  when unique_violation then
    raise exception using errcode = '23505', message = 'Invitation could not be created';
end;
$$;

create function private.accept_invitation(invitation_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  current_email_confirmed_at timestamptz;
  requested_token_hash bytea;
  invitation_row private.invitations%rowtype;
  resulting_membership_id uuid;
  existing_membership public.circle_memberships%rowtype;
begin
  if current_user_id is null
    or invitation_token is null
    or char_length(invitation_token) not between 40 and 64 then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  requested_token_hash := extensions.digest(invitation_token, 'sha256');

  select candidate.*
    into invitation_row
    from private.invitations as candidate
   where candidate.token_hash = requested_token_hash;

  if invitation_row.id is null then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  perform 1 from public.circles where id = invitation_row.circle_id for update;

  select candidate.*
    into invitation_row
    from private.invitations as candidate
   where candidate.id = invitation_row.id
   for update;

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into current_email, current_email_confirmed_at
    from auth.users as auth_user
   where auth_user.id = current_user_id;

  if invitation_row.accepted_at is not null
    or invitation_row.revoked_at is not null
    or invitation_row.expires_at <= statement_timestamp()
    or current_email is null
    or current_email_confirmed_at is null
    or extensions.digest(
      pg_catalog.convert_to(current_email, 'UTF8') || invitation_row.email_salt,
      'sha256'
    ) <> invitation_row.email_hash then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  select membership.*
    into existing_membership
    from public.circle_memberships as membership
   where membership.circle_id = invitation_row.circle_id
     and membership.user_id = current_user_id
   for update;

  if existing_membership.id is null then
    select membership.*
      into existing_membership
      from public.circle_memberships as membership
     where membership.circle_id = invitation_row.circle_id
       and membership.person_id = invitation_row.person_id
     for update;
  end if;

  if existing_membership.id is null then
    insert into public.circle_memberships (
      circle_id,
      user_id,
      person_id,
      role,
      status
    )
    values (
      invitation_row.circle_id,
      current_user_id,
      invitation_row.person_id,
      'member',
      'active'
    )
    returning id into resulting_membership_id;
  elsif existing_membership.user_id = current_user_id
    and existing_membership.person_id = invitation_row.person_id
    and existing_membership.status = 'revoked' then
    update public.circle_memberships
       set status = 'active',
           role = 'member',
           revoked_at = null,
           revoked_by_membership_id = null
     where id = existing_membership.id
    returning id into resulting_membership_id;
  else
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  update private.invitations
     set accepted_at = statement_timestamp(),
         accepted_membership_id = resulting_membership_id
   where id = invitation_row.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    invitation_row.circle_id,
    resulting_membership_id,
    'invitation_accepted',
    'invitation',
    invitation_row.id
  );

  return resulting_membership_id;
exception
  when unique_violation or check_violation or foreign_key_violation or too_many_rows then
    raise exception using errcode = '22023', message = 'Invitation is not available';
end;
$$;

create function private.preflight_invitation(
  invitation_token text,
  invited_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when invitation_token is null
      or char_length(invitation_token) not between 40 and 64
      or invited_email is null
      or char_length(lower(btrim(invited_email))) not between 3 and 254
      or lower(btrim(invited_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    then false
    else exists (
        select 1
          from private.invitations as invitation
         where invitation.token_hash = extensions.digest(invitation_token, 'sha256')
           and invitation.accepted_at is null
           and invitation.revoked_at is null
           and invitation.expires_at > statement_timestamp()
           and extensions.digest(
             pg_catalog.convert_to(lower(btrim(invited_email)), 'UTF8') || invitation.email_salt,
             'sha256'
           ) = invitation.email_hash
      )
  end;
$$;

create function private.revoke_invitation(target_invitation_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target private.invitations%rowtype;
  actor_membership_id uuid;
begin
  select invitation.circle_id
    into target.circle_id
    from private.invitations as invitation
   where invitation.id = target_invitation_id;

  if target.circle_id is null then
    raise exception using errcode = '22023', message = 'Invitation could not be changed';
  end if;

  perform 1 from public.circles where id = target.circle_id for update;

  select invitation.*
    into target
    from private.invitations as invitation
   where invitation.id = target_invitation_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null
    or target.accepted_at is not null
    or target.revoked_at is not null then
    raise exception using errcode = '22023', message = 'Invitation could not be changed';
  end if;

  update private.invitations
     set revoked_at = statement_timestamp(),
         revoked_by_membership_id = actor_membership_id
   where id = target.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    target.circle_id,
    actor_membership_id,
    'invitation_revoked',
    'invitation',
    target.id
  );
end;
$$;

create function private.list_pending_invitations(requested_circle_id uuid)
returns table (
  invitation_id uuid,
  display_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    invitation.id,
    person.display_name,
    invitation.created_at,
    invitation.expires_at
  from private.invitations as invitation
  join public.people as person
    on person.circle_id = invitation.circle_id
   and person.id = invitation.person_id
  where invitation.circle_id = requested_circle_id
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at > statement_timestamp()
    and (select private.is_circle_organizer(requested_circle_id))
  order by invitation.created_at desc, invitation.id desc;
$$;

create function private.revoke_membership(target_membership_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.circle_memberships%rowtype;
  actor_membership_id uuid;
begin
  select membership.circle_id
    into target.circle_id
    from public.circle_memberships as membership
   where membership.id = target_membership_id;

  if target.circle_id is null then
    raise exception using errcode = '22023', message = 'Access could not be changed';
  end if;

  perform 1 from public.circles where id = target.circle_id for update;

  select membership.*
    into target
    from public.circle_memberships as membership
   where membership.id = target_membership_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null or target.status <> 'active' then
    raise exception using errcode = '22023', message = 'Access could not be changed';
  end if;

  update public.person_guardians
     set revoked_at = statement_timestamp(),
         revoked_by_membership_id = actor_membership_id
   where circle_id = target.circle_id
     and guardian_membership_id = target.id
     and revoked_at is null;

  update public.circle_memberships
     set status = 'revoked',
         revoked_at = statement_timestamp(),
         revoked_by_membership_id = actor_membership_id
   where id = target.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    target.circle_id,
    actor_membership_id,
    'membership_revoked',
    'membership',
    target.id
  );
end;
$$;

create function private.set_membership_role(target_membership_id uuid, requested_role text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.circle_memberships%rowtype;
  actor_membership_id uuid;
begin
  if requested_role not in ('member', 'organizer') then
    raise exception using errcode = '22023', message = 'Role could not be changed';
  end if;

  select membership.circle_id
    into target.circle_id
    from public.circle_memberships as membership
   where membership.id = target_membership_id;

  if target.circle_id is null then
    raise exception using errcode = '22023', message = 'Role could not be changed';
  end if;

  perform 1 from public.circles where id = target.circle_id for update;

  select membership.*
    into target
    from public.circle_memberships as membership
   where membership.id = target_membership_id
   for update;

  if not (select private.is_circle_organizer(target.circle_id))
    or target.status <> 'active' then
    raise exception using errcode = '22023', message = 'Role could not be changed';
  end if;

  actor_membership_id := private.current_membership_id(target.circle_id);

  update public.circle_memberships
     set role = requested_role
   where id = target.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    target.circle_id,
    actor_membership_id,
    'membership_role_changed',
    'membership',
    target.id
  );
end;
$$;

create function private.create_managed_person(
  requested_circle_id uuid,
  requested_display_name text,
  requested_accent_token text default 'clay'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  created_person_id uuid;
  normalized_display_name text := btrim(requested_display_name);
begin
  if normalized_display_name is null
    or char_length(normalized_display_name) not between 1 and 80
    or requested_accent_token is null
    or requested_accent_token not in ('clay', 'sage', 'gold', 'sky', 'plum', 'rose') then
    raise exception using errcode = '22023', message = 'Managed profile could not be created';
  end if;

  perform 1 from public.circles where id = requested_circle_id for update;
  actor_membership_id := private.current_membership_id(requested_circle_id);

  if actor_membership_id is null
    or not (select private.is_circle_organizer(requested_circle_id)) then
    raise exception using errcode = '22023', message = 'Managed profile could not be created';
  end if;

  insert into public.people (
    circle_id,
    display_name,
    profile_kind,
    accent_token,
    created_by_membership_id
  )
  values (
    requested_circle_id,
    normalized_display_name,
    'managed',
    requested_accent_token,
    actor_membership_id
  )
  returning id into created_person_id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    requested_circle_id,
    actor_membership_id,
    'managed_person_created',
    'person',
    created_person_id
  );

  return created_person_id;
end;
$$;

create function private.set_person_guardian(
  requested_managed_person_id uuid,
  requested_guardian_membership_id uuid,
  grant_access boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  requested_circle_id uuid;
  actor_membership_id uuid;
  guardian_grant_id uuid;
begin
  select person.circle_id
    into requested_circle_id
    from public.people as person
   where person.id = requested_managed_person_id;

  if requested_circle_id is null or grant_access is null then
    raise exception using errcode = '22023', message = 'Guardian access could not be changed';
  end if;

  perform 1 from public.circles where id = requested_circle_id for update;
  actor_membership_id := private.current_membership_id(requested_circle_id);

  if actor_membership_id is null
    or not (select private.is_circle_organizer(requested_circle_id))
    or not exists (
      select 1
        from public.people as person
       where person.circle_id = requested_circle_id
         and person.id = requested_managed_person_id
         and person.profile_kind = 'managed'
    )
    or not exists (
      select 1
        from public.circle_memberships as membership
       where membership.circle_id = requested_circle_id
         and membership.id = requested_guardian_membership_id
         and membership.status = 'active'
    ) then
    raise exception using errcode = '22023', message = 'Guardian access could not be changed';
  end if;

  select guardian.id
    into guardian_grant_id
    from public.person_guardians as guardian
   where guardian.circle_id = requested_circle_id
     and guardian.managed_person_id = requested_managed_person_id
     and guardian.guardian_membership_id = requested_guardian_membership_id
     and guardian.revoked_at is null
   for update;

  if grant_access and guardian_grant_id is null then
    insert into public.person_guardians (
      circle_id,
      managed_person_id,
      guardian_membership_id,
      created_by_membership_id
    )
    values (
      requested_circle_id,
      requested_managed_person_id,
      requested_guardian_membership_id,
      actor_membership_id
    )
    returning id into guardian_grant_id;

    insert into private.audit_events (
      circle_id,
      actor_membership_id,
      event_type,
      subject_type,
      subject_id
    )
    values (
      requested_circle_id,
      actor_membership_id,
      'guardian_added',
      'guardian',
      guardian_grant_id
    );
  elsif not grant_access and guardian_grant_id is not null then
    update public.person_guardians
       set revoked_at = statement_timestamp(),
           revoked_by_membership_id = actor_membership_id
     where id = guardian_grant_id;

    insert into private.audit_events (
      circle_id,
      actor_membership_id,
      event_type,
      subject_type,
      subject_id
    )
    values (
      requested_circle_id,
      actor_membership_id,
      'guardian_removed',
      'guardian',
      guardian_grant_id
    );
  elsif not grant_access then
    raise exception using errcode = '22023', message = 'Guardian access could not be changed';
  end if;

  return guardian_grant_id;
exception
  when unique_violation or check_violation or foreign_key_violation then
    raise exception using errcode = '22023', message = 'Guardian access could not be changed';
end;
$$;

create function public.create_invitation(
  circle_id uuid,
  display_name text,
  email text,
  reinvite_membership_id uuid default null
)
returns table (invitation_id uuid, raw_token text, expires_at timestamptz)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.create_invitation(
    circle_id,
    display_name,
    email,
    reinvite_membership_id
  );
$$;

create function public.accept_invitation(token text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.accept_invitation(token);
$$;

create function public.preflight_invitation(token text, email text)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.preflight_invitation(token, email);
$$;

create function public.revoke_membership(membership_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_membership(membership_id);
$$;

create function public.revoke_invitation(invitation_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.revoke_invitation(invitation_id);
$$;

create function public.list_pending_invitations(circle_id uuid)
returns table (
  invitation_id uuid,
  display_name text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_pending_invitations(circle_id);
$$;

create function public.set_membership_role(membership_id uuid, role text)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_membership_role(membership_id, role);
$$;

create function public.create_managed_person(
  circle_id uuid,
  display_name text,
  accent_token text default 'clay'
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_managed_person(circle_id, display_name, accent_token);
$$;

create function public.set_person_guardian(
  managed_person_id uuid,
  guardian_membership_id uuid,
  grant_access boolean
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_person_guardian(
    managed_person_id,
    guardian_membership_id,
    grant_access
  );
$$;

revoke all on function private.create_invitation(uuid, text, text, uuid) from public, anon;
revoke all on function private.accept_invitation(text) from public, anon;
revoke all on function private.preflight_invitation(text, text) from public, anon, authenticated;
revoke all on function private.revoke_membership(uuid) from public, anon;
revoke all on function private.revoke_invitation(uuid) from public, anon;
revoke all on function private.list_pending_invitations(uuid) from public, anon;
revoke all on function private.set_membership_role(uuid, text) from public, anon;
revoke all on function private.create_managed_person(uuid, text, text) from public, anon;
revoke all on function private.set_person_guardian(uuid, uuid, boolean) from public, anon;
grant execute on function private.create_invitation(uuid, text, text, uuid) to authenticated;
grant execute on function private.accept_invitation(text) to authenticated;
grant execute on function private.preflight_invitation(text, text) to anon, authenticated;
grant execute on function private.revoke_membership(uuid) to authenticated;
grant execute on function private.revoke_invitation(uuid) to authenticated;
grant execute on function private.list_pending_invitations(uuid) to authenticated;
grant execute on function private.set_membership_role(uuid, text) to authenticated;
grant execute on function private.create_managed_person(uuid, text, text) to authenticated;
grant execute on function private.set_person_guardian(uuid, uuid, boolean) to authenticated;

revoke all on function public.create_invitation(uuid, text, text, uuid) from public, anon;
revoke all on function public.accept_invitation(text) from public, anon;
revoke all on function public.preflight_invitation(text, text) from public, anon, authenticated;
revoke all on function public.revoke_membership(uuid) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.list_pending_invitations(uuid) from public, anon;
revoke all on function public.set_membership_role(uuid, text) from public, anon;
revoke all on function public.create_managed_person(uuid, text, text) from public, anon;
revoke all on function public.set_person_guardian(uuid, uuid, boolean) from public, anon;
grant execute on function public.create_invitation(uuid, text, text, uuid) to authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
grant execute on function public.preflight_invitation(text, text) to anon, authenticated;
grant execute on function public.revoke_membership(uuid) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.list_pending_invitations(uuid) to authenticated;
grant execute on function public.set_membership_role(uuid, text) to authenticated;
grant execute on function public.create_managed_person(uuid, text, text) to authenticated;
grant execute on function public.set_person_guardian(uuid, uuid, boolean) to authenticated;
