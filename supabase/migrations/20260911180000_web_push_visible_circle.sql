-- Push taps must open a circle where the moment is actually visible.
-- Recipients often keep Home active while Calvin posts to Home + GParents;
-- /family#moment-… then looks empty even though the push was correct.

drop function if exists public.list_web_push_deliveries(text, uuid);
drop function if exists private.list_web_push_deliveries(text, uuid);

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
  reaction_type text,
  visible_circle_id uuid
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
  actor_user_id uuid;
  owner_membership_id uuid;
  owner_user_id uuid;
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
      recorder.user_id,
      coalesce(person.display_name, 'Family')
      into
        target_circle_id,
        resolved_moment_id,
        resolved_moment_kind,
        actor_membership_id,
        actor_user_id,
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
    select distinct on (subscription.endpoint)
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      resolved_actor_name,
      resolved_moment_id,
      resolved_moment_kind,
      null::text,
      coalesce(
        (
          select link.circle_id
            from public.moment_circles as link
           where link.moment_id = resolved_moment_id
             and link.circle_id = subscription.circle_id
           limit 1
        ),
        target_circle_id
      )
      from private.web_push_subscriptions as subscription
      join public.circle_memberships as subscriber
        on subscriber.circle_id = subscription.circle_id
       and subscriber.id = subscription.membership_id
     where subscriber.status = 'active'
       and subscriber.user_id is distinct from actor_user_id
       and exists (
         select 1
           from public.circle_memberships as audience_membership
          where audience_membership.user_id = subscriber.user_id
            and audience_membership.status = 'active'
            and (
              audience_membership.circle_id = target_circle_id
              or exists (
                select 1
                  from public.moment_circles as link
                 where link.moment_id = resolved_moment_id
                   and link.circle_id = audience_membership.circle_id
              )
            )
       )
     order by subscription.endpoint, subscription.updated_at desc, subscription.id desc;
    return;
  end if;

  if requested_activity_kind = 'note' then
    select
      moment.circle_id,
      moment.id,
      moment.kind,
      moment.recorded_by_membership_id,
      owner.user_id,
      note.author_membership_id,
      coalesce(person.display_name, 'Family')
      into
        target_circle_id,
        resolved_moment_id,
        resolved_moment_kind,
        owner_membership_id,
        owner_user_id,
        actor_membership_id,
        resolved_actor_name
      from public.moment_notes as note
      join public.moments as moment
        on moment.circle_id = note.circle_id
       and moment.id = note.moment_id
      join public.circle_memberships as author
        on author.circle_id = note.circle_id
       and author.id = note.author_membership_id
      join public.circle_memberships as owner
        on owner.circle_id = moment.circle_id
       and owner.id = moment.recorded_by_membership_id
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
      or owner_user_id is null
      or actor_membership_id = owner_membership_id then
      return;
    end if;

    return query
    select distinct on (subscription.endpoint)
      subscription.endpoint,
      subscription.p256dh,
      subscription.auth,
      resolved_actor_name,
      resolved_moment_id,
      resolved_moment_kind,
      null::text,
      target_circle_id
      from private.web_push_subscriptions as subscription
      join public.circle_memberships as owner
        on owner.circle_id = subscription.circle_id
       and owner.id = subscription.membership_id
     where owner.status = 'active'
       and owner.user_id = owner_user_id
     order by subscription.endpoint, subscription.updated_at desc, subscription.id desc;
    return;
  end if;

  select
    moment.circle_id,
    moment.id,
    moment.kind,
    moment.recorded_by_membership_id,
    owner.user_id,
    reaction.author_membership_id,
    reaction.reaction_type,
    coalesce(person.display_name, 'Family')
    into
      target_circle_id,
      resolved_moment_id,
      resolved_moment_kind,
      owner_membership_id,
      owner_user_id,
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
    join public.circle_memberships as owner
      on owner.circle_id = moment.circle_id
     and owner.id = moment.recorded_by_membership_id
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
    or owner_user_id is null
    or actor_membership_id = owner_membership_id then
    return;
  end if;

  return query
  select distinct on (subscription.endpoint)
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    resolved_actor_name,
    resolved_moment_id,
    resolved_moment_kind,
    resolved_reaction_type,
    target_circle_id
    from private.web_push_subscriptions as subscription
    join public.circle_memberships as owner
      on owner.circle_id = subscription.circle_id
     and owner.id = subscription.membership_id
   where owner.status = 'active'
     and owner.user_id = owner_user_id
   order by subscription.endpoint, subscription.updated_at desc, subscription.id desc;
end;
$$;

revoke all on function private.list_web_push_deliveries(text, uuid)
  from public, anon, authenticated;
grant execute on function private.list_web_push_deliveries(text, uuid)
  to service_role;

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
  reaction_type text,
  visible_circle_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
    from private.list_web_push_deliveries(activity_kind, activity_id);
$$;

revoke all on function public.list_web_push_deliveries(text, uuid)
  from public, anon;
grant execute on function public.list_web_push_deliveries(text, uuid)
  to authenticated;
