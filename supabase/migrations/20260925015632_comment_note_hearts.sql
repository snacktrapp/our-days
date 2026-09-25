-- One live heart per person on a comment. Writes go through security-definer
-- RPCs. A heart notifies the comment author at most once per hearter.

create table public.moment_note_reactions (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  note_id uuid not null,
  moment_id uuid not null,
  author_membership_id uuid not null,
  author_user_id uuid not null,
  revision bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  removed_at timestamptz,
  notified_at timestamptz,
  constraint moment_note_reactions_circle_id_id_key unique (circle_id, id),
  constraint moment_note_reactions_note_fkey foreign key (circle_id, note_id)
    references public.moment_notes (circle_id, id) on delete restrict,
  constraint moment_note_reactions_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint moment_note_reactions_author_fkey foreign key (author_membership_id)
    references public.circle_memberships (id) on delete restrict,
  constraint moment_note_reactions_revision_valid check (revision >= 1),
  constraint moment_note_reactions_timestamp_order_valid check (updated_at >= created_at)
);

create unique index moment_note_reactions_one_live_per_person
  on public.moment_note_reactions (note_id, author_user_id)
  where removed_at is null;

create unique index moment_note_reactions_person_note_key
  on public.moment_note_reactions (note_id, author_user_id);

create index moment_note_reactions_live_note_idx
  on public.moment_note_reactions (note_id, created_at, id)
  where removed_at is null;

create function private.enforce_moment_note_reaction_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Comment hearts must use the reviewed removal workflow';
  end if;
  if new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.note_id <> old.note_id
    or new.moment_id <> old.moment_id
    or new.author_membership_id <> old.author_membership_id
    or new.author_user_id <> old.author_user_id
    or new.created_at <> old.created_at then
    raise exception using errcode = '42501', message = 'Comment heart identity is immutable';
  end if;
  if new.notified_at is distinct from old.notified_at
    and old.notified_at is not null then
    raise exception using errcode = '42501', message = 'Comment heart notification is permanent';
  end if;
  new.revision := old.revision + 1;
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

create trigger moment_note_reactions_integrity
before update or delete on public.moment_note_reactions
for each row execute function private.enforce_moment_note_reaction_integrity();

create function private.enforce_moment_note_reaction_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from public.moment_notes as note
     where note.circle_id = new.circle_id
       and note.id = new.note_id
       and note.moment_id = new.moment_id
  ) then
    raise exception using errcode = '23514', message = 'Comment heart must stay on its note';
  end if;
  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.id = new.author_membership_id
       and membership.user_id = new.author_user_id
  ) then
    raise exception using errcode = '23514', message = 'Comment heart author must match the membership';
  end if;
  return new;
end;
$$;

create trigger moment_note_reactions_parent
before insert or update on public.moment_note_reactions
for each row execute function private.enforce_moment_note_reaction_parent();

alter table public.moment_note_reactions enable row level security;

create policy moment_note_reactions_select_live_parent
on public.moment_note_reactions for select to authenticated
using (
  removed_at is null
  and exists (
    select 1
      from public.moment_notes as note
     where note.circle_id = moment_note_reactions.circle_id
       and note.id = moment_note_reactions.note_id
       and note.moment_id = moment_note_reactions.moment_id
       and note.trashed_at is null
  )
  and (select private.can_read_live_moment(moment_id))
);

revoke all on table public.moment_note_reactions from public, anon, authenticated;
grant select on table public.moment_note_reactions to authenticated;

revoke all on function private.enforce_moment_note_reaction_integrity() from public, anon, authenticated;
revoke all on function private.enforce_moment_note_reaction_parent() from public, anon, authenticated;

create function private.set_moment_note_heart(
  target_note_id uuid,
  requested_hearted boolean
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_moment_id uuid;
  target_audience text;
  target_recorded_by_membership_id uuid;
  actor_membership_id uuid;
  actor_user_id uuid;
  reaction_subject_id uuid;
  resulting_revision bigint;
  existing_removed_at timestamptz;
begin
  if target_note_id is null or requested_hearted is null or current_user_id is null then
    raise exception using errcode = '22023', message = 'Comment heart could not be saved';
  end if;
  if (select private.account_closure_is_blocking(current_user_id)) then
    raise exception using errcode = '42501', message = 'Comment heart could not be saved';
  end if;

  select note.circle_id, note.moment_id
    into target_circle_id, target_moment_id
    from public.moment_notes as note
   where note.id = target_note_id;
  perform 1 from public.circles where id = target_circle_id for update;

  select moment.audience, moment.recorded_by_membership_id
    into target_audience, target_recorded_by_membership_id
    from public.moment_notes as note
    join public.moments as moment
      on moment.circle_id = note.circle_id
     and moment.id = note.moment_id
   where note.id = target_note_id
     and note.trashed_at is null
     and moment.trashed_at is null
     and (select private.can_read_live_moment(moment.id))
   for update of note;

  if not found then
    raise exception using errcode = '42501', message = 'Comment heart could not be saved';
  end if;

  actor_membership_id := private.moment_actor_membership(target_moment_id);
  if actor_membership_id is null
    or (
      target_audience = 'just_me'
      and target_recorded_by_membership_id is distinct from actor_membership_id
    ) then
    raise exception using errcode = '42501', message = 'Comment heart could not be saved';
  end if;

  select membership.user_id
    into actor_user_id
    from public.circle_memberships as membership
   where membership.id = actor_membership_id
     and membership.user_id = current_user_id
     and membership.status = 'active';
  if actor_user_id is null then
    raise exception using errcode = '42501', message = 'Comment heart could not be saved';
  end if;

  select reaction.id
    into reaction_subject_id
    from public.moment_note_reactions as reaction
   where reaction.note_id = target_note_id
     and reaction.author_user_id = actor_user_id
   order by reaction.created_at, reaction.id
   limit 1
   for update;

  if requested_hearted then
    if reaction_subject_id is null then
      insert into public.moment_note_reactions (
        circle_id, note_id, moment_id, author_membership_id, author_user_id, removed_at
      ) values (
        target_circle_id, target_note_id, target_moment_id,
        actor_membership_id, actor_user_id, null
      )
      returning id, revision into reaction_subject_id, resulting_revision;
    else
      update public.moment_note_reactions
         set removed_at = null
       where id = reaction_subject_id
         and removed_at is not null
      returning revision into resulting_revision;
      if resulting_revision is null then
        select reaction.revision
          into resulting_revision
          from public.moment_note_reactions as reaction
         where reaction.id = reaction_subject_id;
      end if;
    end if;
  else
    select reaction.revision, reaction.removed_at
      into resulting_revision, existing_removed_at
      from public.moment_note_reactions as reaction
     where reaction.id = reaction_subject_id;
    if reaction_subject_id is null or existing_removed_at is not null then
      return coalesce(resulting_revision, 0);
    end if;
    update public.moment_note_reactions
       set removed_at = statement_timestamp()
     where id = reaction_subject_id
    returning revision into resulting_revision;
  end if;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    (select circle_id from public.circle_memberships where id = actor_membership_id),
    actor_membership_id,
    case when requested_hearted
      then 'moment_note_heart_set' else 'moment_note_heart_removed' end,
    'moment_note',
    reaction_subject_id
  );
  return resulting_revision;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value or unique_violation then
    raise exception using errcode = '22023', message = 'Comment heart could not be saved';
end;
$$;

create function public.set_moment_note_heart(note_id uuid, hearted boolean)
returns bigint
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_moment_note_heart(note_id, hearted);
$$;

revoke all on function private.set_moment_note_heart(uuid, boolean) from public, anon;
revoke all on function public.set_moment_note_heart(uuid, boolean) from public, anon;
grant execute on function private.set_moment_note_heart(uuid, boolean) to authenticated;
grant execute on function public.set_moment_note_heart(uuid, boolean) to authenticated;

-- Preserve the existing event allowlist and add comment-heart actions.
do $$ declare existing_check text; begin
  select pg_get_constraintdef(oid) into existing_check from pg_constraint
    where conrelid = 'private.audit_events'::regclass and conname = 'audit_events_event_type_valid';
  alter table private.audit_events drop constraint audit_events_event_type_valid;
  execute 'alter table private.audit_events add constraint audit_events_event_type_valid check (('
    || substring(existing_check from 7)
    || ') or event_type in (''moment_note_heart_set'', ''moment_note_heart_removed''))';
end $$;

-- Hearts travel with the note payload. Existing guards on the parent moment stay.
create or replace function private.get_moment_conversation(requested_moment_id uuid)
returns table (notes jsonb, reactions jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', note.id,
        'authorPersonId', note_author.id,
        'authorName', note_author.display_name,
        'authorAccent', note_author.accent_token,
        'body', note.body,
        'revision', note.revision,
        'createdAt', note.created_at,
        'canChange', note_membership.user_id = auth.uid(),
        'heartCount', (
          select count(*)::int
            from public.moment_note_reactions as heart
           where heart.note_id = note.id
             and heart.removed_at is null
        ),
        'heartedByViewer', exists (
          select 1
            from public.moment_note_reactions as heart
           where heart.note_id = note.id
             and heart.removed_at is null
             and heart.author_user_id = (select auth.uid())
        ),
        'heartNames', coalesce((
          select jsonb_agg(heart_author.display_name order by heart.created_at, heart.id)
            from public.moment_note_reactions as heart
            join public.circle_memberships as heart_membership
              on heart_membership.id = heart.author_membership_id
            join public.people as heart_author
              on heart_author.circle_id = heart_membership.circle_id
             and heart_author.id = heart_membership.person_id
           where heart.note_id = note.id
             and heart.removed_at is null
        ), '[]'::jsonb)
      ) order by note.created_at, note.id)
      from public.moment_notes as note
      join public.circle_memberships as note_membership
        on note_membership.id = note.author_membership_id
      join public.people as note_author
        on note_author.circle_id = note_membership.circle_id
       and note_author.id = note_membership.person_id
      where note.circle_id = moment.circle_id and note.moment_id = moment.id
        and note.trashed_at is null
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', reaction.id,
        'personId', reaction_author.id,
        'personName', reaction_author.display_name,
        'personAccent', reaction_author.accent_token,
        'reactionId', reaction.reaction_type,
        'revision', reaction.revision,
        'isCurrentMember', reaction_membership.user_id = auth.uid()
      ) order by reaction.created_at, reaction.id)
      from public.moment_reactions as reaction
      join public.circle_memberships as reaction_membership
        on reaction_membership.id = reaction.author_membership_id
      join public.people as reaction_author
        on reaction_author.circle_id = reaction_membership.circle_id
       and reaction_author.id = reaction_membership.person_id
      where reaction.circle_id = moment.circle_id
        and reaction.moment_id = moment.id
        and reaction.removed_at is null
    ), '[]'::jsonb)
  from public.moments as moment
  where moment.id = requested_moment_id
    and moment.trashed_at is null
    and (select private.can_read_live_moment(moment.id));
$$;

create or replace function private.visible_moment_authors(membership_ids uuid[])
returns table(membership_id uuid, person_id uuid, display_name text, accent_token text)
language sql stable security definer set search_path = '' as $$
  select m.id, p.id, p.display_name, p.accent_token
  from public.circle_memberships m
  join public.people p on p.id = m.person_id
  where m.id = any(membership_ids) and cardinality(membership_ids) <= 200
    and auth.uid() is not null
    and (
      exists (select 1 from public.moments post
        where post.recorded_by_membership_id = m.id and private.can_read_live_moment(post.id))
      or exists (select 1 from public.moment_notes note
        where note.author_membership_id = m.id and note.trashed_at is null
          and private.can_read_live_moment(note.moment_id))
      or exists (select 1 from public.moment_reactions reaction
        where reaction.author_membership_id = m.id and reaction.removed_at is null
          and private.can_read_live_moment(reaction.moment_id))
      or exists (select 1 from public.moment_note_reactions heart
        join public.moment_notes note on note.id = heart.note_id
        where heart.author_membership_id = m.id and heart.removed_at is null
          and note.trashed_at is null
          and private.can_read_live_moment(heart.moment_id))
    );
$$;

-- One push per (hearter, comment). Claiming sets notified_at and never clears it.
create function private.claim_note_reaction_push_deliveries(requested_note_id uuid)
returns table (
  endpoint text,
  p256dh text,
  auth text,
  actor_name text,
  moment_id uuid,
  moment_kind text,
  reaction_type text,
  visible_circle_id uuid,
  circle_name text,
  note_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null or requested_note_id is null then
    return;
  end if;
  if (select private.account_closure_is_blocking(current_user_id)) then
    return;
  end if;

  return query
  with pending as (
    update public.moment_note_reactions as heart
       set notified_at = statement_timestamp()
     where heart.note_id = requested_note_id
       and heart.removed_at is null
       and heart.notified_at is null
       and heart.author_user_id = current_user_id
       and exists (
         select 1
           from public.moment_notes as note
           join public.moments as moment
             on moment.circle_id = note.circle_id
            and moment.id = note.moment_id
           join public.circle_memberships as author
             on author.id = heart.author_membership_id
           join public.circle_memberships as note_author
             on note_author.id = note.author_membership_id
          where note.id = heart.note_id
            and note.circle_id = heart.circle_id
            and note.trashed_at is null
            and moment.trashed_at is null
            and moment.kind <> 'insight'
            and moment.audience = 'family'
            and author.user_id = current_user_id
            and author.status = 'active'
            and note_author.user_id is distinct from current_user_id
            and note_author.status = 'active'
            and (select private.can_read_live_moment(moment.id))
       )
    returning
      heart.note_id,
      heart.moment_id,
      heart.author_membership_id,
      heart.circle_id
  )
  select distinct on (subscription.endpoint)
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    coalesce(actor_person.display_name, 'Family'),
    pending.moment_id,
    moment.kind,
    'held-close'::text,
    (
      select link.circle_id
        from public.moment_circles as link
        join public.circle_memberships as member
          on member.circle_id = link.circle_id
       where link.moment_id = pending.moment_id
         and member.user_id = note_author.user_id
         and member.status = 'active'
       order by (link.circle_id = subscription.circle_id) desc, link.circle_id
       limit 1
    ),
    (
      select circle.name
        from public.moment_circles as link
        join public.circles as circle on circle.id = link.circle_id
        join public.circle_memberships as member
          on member.circle_id = link.circle_id
       where link.moment_id = pending.moment_id
         and member.user_id = note_author.user_id
         and member.status = 'active'
       order by (link.circle_id = subscription.circle_id) desc, link.circle_id
       limit 1
    ),
    pending.note_id
    from pending
    join public.moments as moment
      on moment.id = pending.moment_id
    join public.moment_notes as note
      on note.id = pending.note_id
    join public.circle_memberships as author
      on author.id = pending.author_membership_id
    join public.people as actor_person
      on actor_person.circle_id = author.circle_id
     and actor_person.id = author.person_id
    join public.circle_memberships as note_author
      on note_author.id = note.author_membership_id
    join public.circle_memberships as subscriber
      on subscriber.user_id = note_author.user_id
     and subscriber.status = 'active'
    join private.web_push_subscriptions as subscription
      on subscription.circle_id = subscriber.circle_id
     and subscription.membership_id = subscriber.id
   where exists (
     select 1
       from public.moment_circles as link
       join public.circle_memberships as member
         on member.circle_id = link.circle_id
      where link.moment_id = pending.moment_id
        and member.user_id = note_author.user_id
        and member.status = 'active'
   )
   order by subscription.endpoint, subscription.updated_at desc, subscription.id desc;
end;
$$;

create function public.claim_note_reaction_push_deliveries(requested_note_id uuid)
returns table (
  endpoint text,
  p256dh text,
  auth text,
  actor_name text,
  moment_id uuid,
  moment_kind text,
  reaction_type text,
  visible_circle_id uuid,
  circle_name text,
  note_id uuid
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.claim_note_reaction_push_deliveries(requested_note_id);
$$;

revoke all on function private.claim_note_reaction_push_deliveries(uuid) from public, anon;
revoke all on function public.claim_note_reaction_push_deliveries(uuid) from public, anon;
grant execute on function private.claim_note_reaction_push_deliveries(uuid) to authenticated;
grant execute on function public.claim_note_reaction_push_deliveries(uuid) to authenticated;
