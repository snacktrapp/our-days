-- Native iOS push tokens. Applied to production via the Supabase MCP (2026-09-30 PT).
-- Web Push subscriptions, claims, and delivery functions are untouched.
-- Recipients follow the same family rules as list_web_push_deliveries,
-- claim_mention_push_deliveries, and claim_note_reaction_push_deliveries.

create table private.expo_push_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  token text not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint expo_push_tokens_token_key unique (token),
  constraint expo_push_tokens_token_valid check (
    token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{16,200}\]$'
  ),
  constraint expo_push_tokens_timestamp_order_valid check (
    updated_at >= created_at
  )
);

create index expo_push_tokens_user_idx
  on private.expo_push_tokens (user_id);

alter table private.expo_push_tokens enable row level security;
alter table private.expo_push_tokens force row level security;

revoke all on table private.expo_push_tokens
  from public, anon, authenticated;

create function private.save_expo_push_token(requested_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_token text := btrim(requested_token);
  resulting_id uuid;
begin
  if current_user_id is null
    or normalized_token is null
    or normalized_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{16,200}\]$' then
    raise exception using
      errcode = '22023',
      message = 'Notification token could not be saved';
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = current_user_id
       and membership.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Notification token could not be saved';
  end if;

  insert into private.expo_push_tokens (user_id, token)
  values (current_user_id, normalized_token)
  on conflict (token) do update
    set user_id = excluded.user_id,
        updated_at = statement_timestamp()
  returning id into resulting_id;
  return resulting_id;
end;
$$;

create function public.save_expo_push_token(requested_token text)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.save_expo_push_token(requested_token);
$$;

create function private.delete_expo_push_token(requested_token text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_token text := btrim(requested_token);
  removed integer := 0;
begin
  if current_user_id is null or normalized_token is null then
    return false;
  end if;
  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = current_user_id
       and membership.status = 'active'
  ) then
    return false;
  end if;

  delete from private.expo_push_tokens as saved
   where saved.token = normalized_token;
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

create function public.delete_expo_push_token(requested_token text)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_expo_push_token(requested_token);
$$;

create function private.list_expo_push_deliveries(
  requested_activity_kind text,
  requested_activity_id uuid,
  requested_note_id uuid default null
)
returns table (
  token text,
  actor_name text,
  moment_id uuid,
  moment_kind text,
  reaction_type text,
  snippet text,
  note_id uuid
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
  resolved_note_id uuid;
  authorized boolean := false;
begin
  if current_user_id is null
    or requested_activity_id is null
    or requested_activity_kind not in (
      'moment', 'note', 'reaction', 'mention', 'note_reaction'
    ) then
    return;
  end if;
  if (select private.account_closure_is_blocking(current_user_id)) then
    return;
  end if;

  if requested_activity_kind = 'mention' then
    return query
    select distinct on (saved.token)
      saved.token,
      coalesce(actor_person.display_name, 'Family'),
      mention.moment_id,
      null::text,
      null::text,
      left(regexp_replace(
        coalesce(note.body, moment.body, ''),
        '[[:space:]]+',
        ' ',
        'g'
      ), 80),
      mention.note_id
    from public.content_mentions as mention
    join public.moments as moment
      on moment.id = mention.moment_id
    left join public.moment_notes as note
      on note.id = mention.note_id
    join public.circle_memberships as author
      on author.id = mention.author_membership_id
     and author.circle_id = mention.circle_id
    join public.people as actor_person
      on actor_person.circle_id = author.circle_id
     and actor_person.id = author.person_id
    join private.expo_push_tokens as saved
      on saved.user_id = mention.mentioned_user_id
    where mention.moment_id = requested_activity_id
      and mention.note_id is not distinct from requested_note_id
      and mention.removed_at is null
      and mention.notified_at is null
      and mention.mentioned_user_id is distinct from current_user_id
      and moment.trashed_at is null
      and moment.audience = 'family'
      and moment.kind <> 'insight'
      and author.user_id = current_user_id
      and author.status = 'active'
      and (select private.can_read_live_moment(moment.id))
    order by saved.token, saved.updated_at desc, saved.id desc;
    return;
  end if;

  if requested_activity_kind = 'note_reaction' then
    return query
    select distinct on (saved.token)
      saved.token,
      coalesce(actor_person.display_name, 'Family'),
      heart.moment_id,
      moment.kind,
      'held-close'::text,
      null::text,
      heart.note_id
    from public.moment_note_reactions as heart
    join public.moment_notes as note
      on note.id = heart.note_id
     and note.circle_id = heart.circle_id
    join public.moments as moment
      on moment.circle_id = note.circle_id
     and moment.id = note.moment_id
    join public.circle_memberships as author
      on author.id = heart.author_membership_id
    join public.people as actor_person
      on actor_person.circle_id = author.circle_id
     and actor_person.id = author.person_id
    join public.circle_memberships as note_author
      on note_author.id = note.author_membership_id
    join private.expo_push_tokens as saved
      on saved.user_id = note_author.user_id
    where heart.note_id = requested_activity_id
      and heart.removed_at is null
      and heart.notified_at is null
      and heart.author_user_id = current_user_id
      and note.trashed_at is null
      and moment.trashed_at is null
      and moment.kind <> 'insight'
      and moment.audience = 'family'
      and author.user_id = current_user_id
      and author.status = 'active'
      and note_author.user_id is distinct from current_user_id
      and note_author.status = 'active'
      and (select private.can_read_live_moment(moment.id))
      and exists (
        select 1
          from public.moment_circles as link
          join public.circle_memberships as member
            on member.circle_id = link.circle_id
         where link.moment_id = heart.moment_id
           and member.user_id = note_author.user_id
           and member.status = 'active'
      )
    order by saved.token, saved.updated_at desc, saved.id desc;
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
    select distinct on (saved.token)
      saved.token,
      resolved_actor_name,
      resolved_moment_id,
      resolved_moment_kind,
      null::text,
      null::text,
      null::uuid
    from private.expo_push_tokens as saved
    where saved.user_id is distinct from actor_user_id
      and exists (
        select 1
          from public.circle_memberships as audience_membership
         where audience_membership.user_id = saved.user_id
           and audience_membership.status = 'active'
           and exists (
             select 1
               from public.moment_circles as link
              where link.moment_id = resolved_moment_id
                and link.circle_id = audience_membership.circle_id
           )
      )
    order by saved.token, saved.updated_at desc, saved.id desc;
    return;
  end if;

  if requested_activity_kind = 'note' then
    select
      moment.id,
      moment.kind,
      note.id,
      owner.user_id,
      coalesce(person.display_name, 'Family')
      into
        resolved_moment_id,
        resolved_moment_kind,
        resolved_note_id,
        owner_user_id,
        resolved_actor_name
      from public.moment_notes as note
      join public.moments as moment
        on moment.circle_id = note.circle_id
       and moment.id = note.moment_id
      join public.circle_memberships as author
        on author.id = note.author_membership_id
      join public.circle_memberships as owner
        on owner.circle_id = moment.circle_id
       and owner.id = moment.recorded_by_membership_id
      join public.people as person
        on person.circle_id = author.circle_id
       and person.id = author.person_id
     where note.moment_id = requested_activity_id
       and (requested_note_id is null or note.id = requested_note_id)
       and note.trashed_at is null
       and moment.trashed_at is null
       and moment.kind <> 'insight'
       and (select private.can_read_live_moment(moment.id))
       and author.user_id = current_user_id
       and author.status = 'active'
       and owner.user_id is distinct from current_user_id
     order by note.created_at desc
     limit 1;
    if resolved_moment_id is null or owner_user_id is null then
      return;
    end if;

    return query
    select distinct on (saved.token)
      saved.token,
      resolved_actor_name,
      resolved_moment_id,
      resolved_moment_kind,
      null::text,
      null::text,
      resolved_note_id
    from private.expo_push_tokens as saved
    where saved.user_id = owner_user_id
      and exists (
        select 1
          from public.moment_circles as link
          join public.circle_memberships as member
            on member.circle_id = link.circle_id
         where link.moment_id = resolved_moment_id
           and member.user_id = owner_user_id
           and member.status = 'active'
      )
    order by saved.token, saved.updated_at desc, saved.id desc;
    return;
  end if;

  select
    moment.id,
    moment.kind,
    owner.user_id,
    reaction.reaction_type,
    coalesce(person.display_name, 'Family')
    into
      resolved_moment_id,
      resolved_moment_kind,
      owner_user_id,
      resolved_reaction_type,
      resolved_actor_name
    from public.moment_reactions as reaction
    join public.moments as moment
      on moment.circle_id = reaction.circle_id
     and moment.id = reaction.moment_id
    join public.circle_memberships as author
      on author.id = reaction.author_membership_id
    join public.circle_memberships as owner
      on owner.circle_id = moment.circle_id
     and owner.id = moment.recorded_by_membership_id
    join public.people as person
      on person.circle_id = author.circle_id
     and person.id = author.person_id
   where reaction.moment_id = requested_activity_id
     and reaction.removed_at is null
     and moment.trashed_at is null
     and moment.kind <> 'insight'
     and (select private.can_read_live_moment(moment.id))
     and author.user_id = current_user_id
     and author.status = 'active'
     and owner.user_id is distinct from current_user_id;
  if resolved_moment_id is null or owner_user_id is null then
    return;
  end if;

  return query
  select distinct on (saved.token)
    saved.token,
    resolved_actor_name,
    resolved_moment_id,
    resolved_moment_kind,
    resolved_reaction_type,
    null::text,
    null::uuid
  from private.expo_push_tokens as saved
  where saved.user_id = owner_user_id
    and exists (
      select 1
        from public.moment_circles as link
        join public.circle_memberships as member
          on member.circle_id = link.circle_id
       where link.moment_id = resolved_moment_id
         and member.user_id = owner_user_id
         and member.status = 'active'
    )
  order by saved.token, saved.updated_at desc, saved.id desc;
end;
$$;

create function public.list_expo_push_deliveries(
  requested_activity_kind text,
  requested_activity_id uuid,
  requested_note_id uuid default null
)
returns table (
  token text,
  actor_name text,
  moment_id uuid,
  moment_kind text,
  reaction_type text,
  snippet text,
  note_id uuid
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_expo_push_deliveries(
    requested_activity_kind,
    requested_activity_id,
    requested_note_id
  );
$$;

revoke all on function private.save_expo_push_token(text) from public, anon, authenticated;
revoke all on function public.save_expo_push_token(text) from public, anon;
revoke all on function private.delete_expo_push_token(text) from public, anon, authenticated;
revoke all on function public.delete_expo_push_token(text) from public, anon;
revoke all on function private.list_expo_push_deliveries(text, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.list_expo_push_deliveries(text, uuid, uuid)
  from public, anon;

grant execute on function public.save_expo_push_token(text) to authenticated;
grant execute on function public.delete_expo_push_token(text) to authenticated;
grant execute on function public.list_expo_push_deliveries(text, uuid, uuid) to authenticated;
grant execute on function private.save_expo_push_token(text) to authenticated;
grant execute on function private.delete_expo_push_token(text) to authenticated;
grant execute on function private.list_expo_push_deliveries(text, uuid, uuid) to authenticated;
