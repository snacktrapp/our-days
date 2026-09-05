-- Membership-scoped Web Push subscriptions live in private so the public
-- relation catalog stays closed. Members manage only their own rows through
-- reviewed RPCs. Delivery listing reuses the same family-activity rules as
-- the in-app notification center and never returns journal body text.

create table private.web_push_subscriptions (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  membership_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint web_push_subscriptions_membership_fkey foreign key (
    circle_id,
    membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint web_push_subscriptions_endpoint_key unique (endpoint),
  constraint web_push_subscriptions_membership_endpoint_key unique (
    membership_id,
    endpoint
  ),
  constraint web_push_subscriptions_endpoint_valid check (
    endpoint = btrim(endpoint)
    and char_length(endpoint) between 16 and 2048
    and endpoint like 'https://%'
  ),
  constraint web_push_subscriptions_p256dh_valid check (
    p256dh = btrim(p256dh)
    and char_length(p256dh) between 80 and 120
  ),
  constraint web_push_subscriptions_auth_valid check (
    auth = btrim(auth)
    and char_length(auth) between 16 and 40
  ),
  constraint web_push_subscriptions_timestamp_order_valid check (
    updated_at >= created_at
  )
);

create index web_push_subscriptions_membership_idx
  on private.web_push_subscriptions (circle_id, membership_id);

alter table private.web_push_subscriptions enable row level security;
alter table private.web_push_subscriptions force row level security;

create policy web_push_subscriptions_select_own
on private.web_push_subscriptions for select to authenticated
using (
  membership_id = (select private.current_membership_id(circle_id))
);

revoke all on table private.web_push_subscriptions
  from public, anon, authenticated;

create function private.save_web_push_subscription(
  requested_endpoint text,
  requested_p256dh text,
  requested_auth text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_circle_id uuid;
  actor_membership_id uuid;
  resulting_id uuid;
  normalized_endpoint text := btrim(requested_endpoint);
  normalized_p256dh text := btrim(requested_p256dh);
  normalized_auth text := btrim(requested_auth);
begin
  if current_user_id is null
    or normalized_endpoint is null
    or normalized_p256dh is null
    or normalized_auth is null then
    raise exception using
      errcode = '22023',
      message = 'Notification subscription could not be saved';
  end if;

  select membership.circle_id, membership.id
    into actor_circle_id, actor_membership_id
    from public.circle_memberships as membership
   where membership.user_id = current_user_id
     and membership.status = 'active'
   order by membership.joined_at
   limit 1;
  if actor_membership_id is null then
    raise exception using
      errcode = '42501',
      message = 'Notification subscription could not be saved';
  end if;

  insert into private.web_push_subscriptions (
    circle_id, membership_id, endpoint, p256dh, auth
  ) values (
    actor_circle_id,
    actor_membership_id,
    normalized_endpoint,
    normalized_p256dh,
    normalized_auth
  )
  on conflict (endpoint) do update
    set membership_id = excluded.membership_id,
        circle_id = excluded.circle_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = statement_timestamp()
  returning id into resulting_id;
  return resulting_id;
end;
$$;

create function private.delete_web_push_subscription(requested_endpoint text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_endpoint text := btrim(requested_endpoint);
  removed integer := 0;
begin
  if current_user_id is null or normalized_endpoint is null then
    return false;
  end if;

  delete from private.web_push_subscriptions as subscription
   where subscription.endpoint = normalized_endpoint
     and (
       exists (
         select 1
           from public.circle_memberships as membership
          where membership.circle_id = subscription.circle_id
            and membership.user_id = current_user_id
            and membership.status = 'active'
       )
       or (select private.photo_validator_is_allowed(current_user_id))
     );
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

create function private.list_web_push_deliveries(
  requested_activity_kind text,
  requested_activity_id uuid
)
returns table (
  endpoint text,
  p256dh text,
  auth text,
  actor_name text,
  moment_id uuid,
  moment_kind text,
  reaction_type text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  actor_membership_id uuid;
  owner_membership_id uuid;
  resolved_actor_name text;
  resolved_moment_id uuid;
  resolved_moment_kind text;
  resolved_reaction_type text;
  authorized boolean := false;
begin
  if current_user_id is null
    or requested_activity_id is null
    or requested_activity_kind not in ('moment', 'note', 'reaction') then
    return;
  end if;

  if requested_activity_kind = 'moment' then
    select
      moment.circle_id,
      moment.id,
      moment.kind,
      moment.recorded_by_membership_id,
      coalesce(person.display_name, 'Family')
      into
        target_circle_id,
        resolved_moment_id,
        resolved_moment_kind,
        actor_membership_id,
        resolved_actor_name
      from public.moments as moment
      join public.circle_memberships as recorder
        on recorder.circle_id = moment.circle_id
       and recorder.id = moment.recorded_by_membership_id
      join public.people as person
        on person.circle_id = recorder.circle_id
       and person.id = recorder.person_id
     where moment.id = requested_activity_id
       and moment.trashed_at is null
       and moment.kind <> 'insight'
       and moment.audience = 'family';
    if resolved_moment_id is null then
      return;
    end if;
    authorized := exists (
      select 1
        from public.circle_memberships as membership
       where membership.id = actor_membership_id
         and membership.circle_id = target_circle_id
         and membership.user_id = current_user_id
         and membership.status = 'active'
    ) or (select private.photo_validator_is_allowed(current_user_id));
    if not authorized then
      return;
    end if;

    return query
    select
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      resolved_actor_name,
      resolved_moment_id,
      resolved_moment_kind,
      null::text
      from private.web_push_subscriptions as subscription
      join public.circle_memberships as membership
        on membership.circle_id = subscription.circle_id
       and membership.id = subscription.membership_id
     where subscription.circle_id = target_circle_id
       and membership.status = 'active'
       and membership.id <> actor_membership_id;
    return;
  end if;

  if requested_activity_kind = 'note' then
    select
      moment.circle_id,
      moment.id,
      moment.kind,
      moment.recorded_by_membership_id,
      note.author_membership_id,
      coalesce(person.display_name, 'Family')
      into
        target_circle_id,
        resolved_moment_id,
        resolved_moment_kind,
        owner_membership_id,
        actor_membership_id,
        resolved_actor_name
      from public.moment_notes as note
      join public.moments as moment
        on moment.circle_id = note.circle_id
       and moment.id = note.moment_id
      join public.circle_memberships as author
        on author.circle_id = note.circle_id
       and author.id = note.author_membership_id
      join public.people as person
        on person.circle_id = author.circle_id
       and person.id = author.person_id
     where note.moment_id = requested_activity_id
       and note.trashed_at is null
       and moment.trashed_at is null
       and author.user_id = current_user_id
       and author.status = 'active'
     order by note.created_at desc
     limit 1;
    if resolved_moment_id is null
      or actor_membership_id is null
      or actor_membership_id = owner_membership_id then
      return;
    end if;

    return query
    select
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      resolved_actor_name,
      resolved_moment_id,
      resolved_moment_kind,
      null::text
      from private.web_push_subscriptions as subscription
     where subscription.circle_id = target_circle_id
       and subscription.membership_id = owner_membership_id;
    return;
  end if;

  select
    moment.circle_id,
    moment.id,
    moment.kind,
    moment.recorded_by_membership_id,
    reaction.author_membership_id,
    reaction.reaction_type,
    coalesce(person.display_name, 'Family')
    into
      target_circle_id,
      resolved_moment_id,
      resolved_moment_kind,
      owner_membership_id,
      actor_membership_id,
      resolved_reaction_type,
      resolved_actor_name
    from public.moment_reactions as reaction
    join public.moments as moment
      on moment.circle_id = reaction.circle_id
     and moment.id = reaction.moment_id
    join public.circle_memberships as author
      on author.circle_id = reaction.circle_id
     and author.id = reaction.author_membership_id
    join public.people as person
      on person.circle_id = author.circle_id
     and person.id = author.person_id
   where reaction.moment_id = requested_activity_id
     and reaction.removed_at is null
     and moment.trashed_at is null
     and author.user_id = current_user_id
     and author.status = 'active';
  if resolved_moment_id is null
    or actor_membership_id is null
    or actor_membership_id = owner_membership_id then
    return;
  end if;

  return query
  select
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    resolved_actor_name,
    resolved_moment_id,
    resolved_moment_kind,
    resolved_reaction_type
    from private.web_push_subscriptions as subscription
   where subscription.circle_id = target_circle_id
     and subscription.membership_id = owner_membership_id;
end;
$$;

create function private.purge_web_push_subscriptions_after_membership_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'revoked' then
    delete from private.web_push_subscriptions
     where circle_id = new.circle_id
       and membership_id = new.id;
  end if;
  return new;
end;
$$;

create trigger web_push_subscriptions_purge_after_membership_change
after update of status on public.circle_memberships
for each row
when (old.status is distinct from new.status and new.status = 'revoked')
execute function private.purge_web_push_subscriptions_after_membership_change();

revoke all on function private.save_web_push_subscription(text, text, text)
  from public, anon;
revoke all on function private.delete_web_push_subscription(text)
  from public, anon;
revoke all on function private.list_web_push_deliveries(text, uuid)
  from public, anon;
revoke all on function private.purge_web_push_subscriptions_after_membership_change()
  from public, anon, authenticated;
grant execute on function private.save_web_push_subscription(text, text, text)
  to authenticated;
grant execute on function private.delete_web_push_subscription(text)
  to authenticated;
grant execute on function private.list_web_push_deliveries(text, uuid)
  to authenticated;

create function public.save_web_push_subscription(
  endpoint text,
  p256dh text,
  auth text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.save_web_push_subscription(endpoint, p256dh, auth);
$$;

create function public.delete_web_push_subscription(endpoint text)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_web_push_subscription(endpoint);
$$;

create function public.list_web_push_deliveries(
  activity_kind text,
  activity_id uuid
)
returns table (
  endpoint text,
  p256dh text,
  auth text,
  actor_name text,
  moment_id uuid,
  moment_kind text,
  reaction_type text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.list_web_push_deliveries(activity_kind, activity_id);
$$;

revoke all on function public.save_web_push_subscription(text, text, text)
  from public, anon;
revoke all on function public.delete_web_push_subscription(text)
  from public, anon;
revoke all on function public.list_web_push_deliveries(text, uuid)
  from public, anon;
grant execute on function public.save_web_push_subscription(text, text, text)
  to authenticated;
grant execute on function public.delete_web_push_subscription(text)
  to authenticated;
grant execute on function public.list_web_push_deliveries(text, uuid)
  to authenticated;
