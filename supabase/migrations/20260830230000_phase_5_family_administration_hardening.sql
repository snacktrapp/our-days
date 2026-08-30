alter table private.audit_events
  drop constraint audit_events_event_type_valid,
  add constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created', 'invitation_accepted', 'invitation_revoked',
      'membership_revoked', 'membership_role_changed',
      'membership_promoted', 'membership_demoted',
      'managed_person_created', 'guardian_added', 'guardian_removed',
      'moment_created', 'moment_updated', 'moment_trashed', 'moment_restored',
      'moment_note_created', 'moment_note_updated', 'moment_note_trashed',
      'moment_reaction_set', 'moment_reaction_removed'
    )
  );

create or replace function private.set_membership_role(
  target_membership_id uuid,
  requested_role text
)
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
  if requested_role is null
    or requested_role not in ('member', 'organizer') then
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

  if target.role = requested_role then
    return;
  end if;

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
    case
      when requested_role = 'organizer' then 'membership_promoted'
      else 'membership_demoted'
    end,
    'membership',
    target.id
  );
end;
$$;

create or replace function private.revoke_membership(target_membership_id uuid)
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

  if actor_membership_id is null then
    raise exception using errcode = '22023', message = 'Access could not be changed';
  end if;

  if target.status = 'revoked' then
    return;
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

create or replace function private.set_person_guardian(
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
  end if;

  return guardian_grant_id;
exception
  when unique_violation or check_violation or foreign_key_violation then
    raise exception using errcode = '22023', message = 'Guardian access could not be changed';
end;
$$;
