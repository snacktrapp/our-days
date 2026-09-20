-- Add existing accounts without changing Auth, invitations, or post audiences.
create function private.list_existing_circle_members(source_circle_id uuid, target_circle_id uuid)
returns table(membership_id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select m.id, p.display_name
  from public.circle_memberships m
  join public.people p on p.id = m.person_id and p.circle_id = m.circle_id
  join auth.users u on u.id = m.user_id
  where auth.uid() is not null
    and source_circle_id <> target_circle_id
    and private.is_circle_organizer(source_circle_id)
    and private.is_circle_organizer(target_circle_id)
    and not private.account_closure_is_blocking(auth.uid())
    and m.circle_id = source_circle_id and m.status = 'active'
    and m.directory_kind = 'journal' and m.role <> 'operations'
    and p.profile_kind = 'account' and u.deleted_at is null
    and u.email_confirmed_at is not null
    and not private.account_closure_is_blocking(m.user_id)
    and not exists(select 1 from public.circle_memberships t
      where t.circle_id = target_circle_id and t.user_id = m.user_id)
  order by p.display_name, m.id;
$$;

create function private.add_existing_circle_member(source_membership_id uuid, target_circle_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  source public.circle_memberships%rowtype;
  person public.people%rowtype;
  existing public.circle_memberships%rowtype;
  actor_id uuid;
  new_person uuid;
  new_membership uuid;
  request_id uuid;
begin
  select * into source from public.circle_memberships where id = source_membership_id;
  if auth.uid() is null or source.id is null or target_circle_id is null
    or source.circle_id = target_circle_id then
    raise exception using errcode = '42501', message = 'Member could not be added';
  end if;
  -- Match account closure's Auth-before-circle locking; order shared locks
  -- consistently for organizers adding in opposite directions.
  perform 1 from auth.users where id in (auth.uid(), source.user_id) order by id for update;
  perform 1 from public.circles where id in (source.circle_id, target_circle_id) order by id for update;
  select * into source from public.circle_memberships where id = source_membership_id for update;
  if not private.is_circle_organizer(source.circle_id)
    or not private.is_circle_organizer(target_circle_id)
    or private.account_closure_is_blocking(auth.uid())
    or private.account_closure_is_blocking(source.user_id)
    or source.status <> 'active' or source.directory_kind <> 'journal'
    or source.role = 'operations'
    or not exists(select 1 from auth.users where id = source.user_id
      and deleted_at is null and email_confirmed_at is not null) then
    raise exception using errcode = '42501', message = 'Member could not be added';
  end if;
  select * into person from public.people where id = source.person_id and profile_kind = 'account';
  if person.id is null then
    raise exception using errcode = '42501', message = 'Member could not be added';
  end if;
  select * into existing from public.circle_memberships
    where circle_id = target_circle_id and user_id = source.user_id for update;
  if existing.status = 'active' then return existing.id; end if;
  -- A previous removal is deliberate: use the existing re-invitation flow.
  if existing.id is not null then
    raise exception using errcode = '42501', message = 'Member could not be added';
  end if;
  actor_id := private.current_membership_id(target_circle_id);
  insert into public.people(circle_id, display_name, profile_kind, accent_token, created_by_membership_id)
    values(target_circle_id, person.display_name, 'account', person.accent_token, actor_id)
    returning id into new_person;
  insert into public.circle_memberships(circle_id,user_id,person_id,role,status,directory_kind)
    values(target_circle_id,source.user_id,new_person,'member','active','journal')
    returning id into new_membership;
  insert into private.audit_events(circle_id,actor_membership_id,event_type,subject_type,subject_id)
    values(target_circle_id,actor_id,'membership_added','membership',new_membership);
  -- Do not leave an old email invitation displayed beside the active member.
  for request_id in select r.id from private.invitation_email_requests r
    join auth.users u on lower(btrim(u.email)) = r.normalized_email
    where u.id = source.user_id and r.circle_id = target_circle_id
      and r.state in ('queued','provisioned','delivered')
  loop
    perform private.invalidate_invitation_email_request(request_id, 'target_became_active', new_membership, null);
  end loop;
  return new_membership;
end;
$$;

-- Preserve the existing event allowlist and add this one explicit action.
do $$ declare existing_check text; begin
  select pg_get_constraintdef(oid) into existing_check from pg_constraint
    where conrelid = 'private.audit_events'::regclass and conname = 'audit_events_event_type_valid';
  alter table private.audit_events drop constraint audit_events_event_type_valid;
  execute 'alter table private.audit_events add constraint audit_events_event_type_valid check (('
    || substring(existing_check from 7) || ') or event_type = ''membership_added'')';
end $$;

create function public.list_existing_circle_members(source_circle_id uuid, target_circle_id uuid)
returns table(membership_id uuid, display_name text)
language sql stable security invoker set search_path = '' as $$
  select * from private.list_existing_circle_members(source_circle_id, target_circle_id);
$$;
create function public.add_existing_circle_member(source_membership_id uuid, target_circle_id uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select private.add_existing_circle_member(source_membership_id, target_circle_id);
$$;
revoke all on function private.list_existing_circle_members(uuid,uuid), public.list_existing_circle_members(uuid,uuid),
  private.add_existing_circle_member(uuid,uuid), public.add_existing_circle_member(uuid,uuid) from public, anon;
grant execute on function private.list_existing_circle_members(uuid,uuid), public.list_existing_circle_members(uuid,uuid),
  private.add_existing_circle_member(uuid,uuid), public.add_existing_circle_member(uuid,uuid) to authenticated;
