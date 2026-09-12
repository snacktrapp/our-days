-- Notes and reactions follow can_read_live_moment, matching moments after
-- moment_circles. Linked-circle readers must see the same conversation the
-- primary circle sees, including author names from the author's roster circle.

drop policy moment_notes_select_live_parent on public.moment_notes;

create policy moment_notes_select_live_parent
on public.moment_notes for select to authenticated
using (
  trashed_at is null
  and (select private.can_read_live_moment(moment_id))
);

drop policy moment_reactions_select_live_parent on public.moment_reactions;

create policy moment_reactions_select_live_parent
on public.moment_reactions for select to authenticated
using (
  removed_at is null
  and (select private.can_read_live_moment(moment_id))
);

create function private.get_moment_conversation(requested_moment_id uuid)
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
        'canChange', note.author_membership_id = private.current_membership_id(moment.circle_id)
      ) order by note.created_at, note.id)
      from public.moment_notes as note
      join public.circle_memberships as note_membership
        on note_membership.circle_id = note.circle_id
       and note_membership.id = note.author_membership_id
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
        'isCurrentMember', reaction.author_membership_id = private.current_membership_id(moment.circle_id)
      ) order by reaction.created_at, reaction.id)
      from public.moment_reactions as reaction
      join public.circle_memberships as reaction_membership
        on reaction_membership.circle_id = reaction.circle_id
       and reaction_membership.id = reaction.author_membership_id
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

create or replace function public.get_moment_conversation(moment_id uuid)
returns table (notes jsonb, reactions jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select conversation.notes, conversation.reactions
    from private.get_moment_conversation(get_moment_conversation.moment_id)
      as conversation;
$$;

revoke all on function private.get_moment_conversation(uuid)
  from public, anon, authenticated;
grant execute on function private.get_moment_conversation(uuid)
  to authenticated;
