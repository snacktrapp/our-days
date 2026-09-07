-- Any active member can create an additional circle. The creator becomes
-- that circle's first member and organizer. Existing memberships stay put.

create function private.create_circle(requested_name text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  normalized_name text := btrim(requested_name);
  actor_user_id uuid := (select auth.uid());
  source_membership public.circle_memberships%rowtype;
  source_person public.people%rowtype;
  source_time_zone text;
  new_circle_id uuid := extensions.gen_random_uuid();
  new_person_id uuid := extensions.gen_random_uuid();
  new_membership_id uuid := extensions.gen_random_uuid();
begin
  if actor_user_id is null
    or normalized_name is null
    or char_length(normalized_name) not between 1 and 80 then
    raise exception using
      errcode = '22023',
      message = 'Group could not be created';
  end if;

  select membership.*
    into source_membership
    from public.circle_memberships as membership
   where membership.user_id = actor_user_id
     and membership.status = 'active'
   order by membership.joined_at
   limit 1
   for update;

  if source_membership.id is null then
    raise exception using
      errcode = '42501',
      message = 'Group could not be created';
  end if;

  select person.*
    into source_person
    from public.people as person
   where person.circle_id = source_membership.circle_id
     and person.id = source_membership.person_id;

  select circle.time_zone
    into source_time_zone
    from public.circles as circle
   where circle.id = source_membership.circle_id;

  if source_person.id is null or source_time_zone is null then
    raise exception using
      errcode = '42501',
      message = 'Group could not be created';
  end if;

  insert into public.circles (
    id,
    name,
    time_zone,
    created_by_membership_id
  )
  values (
    new_circle_id,
    normalized_name,
    source_time_zone,
    new_membership_id
  );

  insert into public.people (
    id,
    circle_id,
    display_name,
    profile_kind,
    accent_token,
    created_by_membership_id
  )
  values (
    new_person_id,
    new_circle_id,
    source_person.display_name,
    'account',
    source_person.accent_token,
    new_membership_id
  );

  insert into public.circle_memberships (
    id,
    circle_id,
    user_id,
    person_id,
    role,
    status,
    directory_kind
  )
  values (
    new_membership_id,
    new_circle_id,
    actor_user_id,
    new_person_id,
    'organizer',
    'active',
    'journal'
  );

  return new_circle_id;
end;
$$;

create function public.create_circle(circle_name text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_circle(circle_name);
$$;

revoke all on function private.create_circle(text) from public, anon, authenticated;
revoke all on function public.create_circle(text) from public, anon, authenticated;
grant execute on function private.create_circle(text) to authenticated;
grant execute on function public.create_circle(text) to authenticated;
