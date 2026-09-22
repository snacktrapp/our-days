-- Preserve post storage/attribution; conversation authors may belong to another audience circle.
alter table public.moment_notes drop constraint moment_notes_author_fkey;
alter table public.moment_notes add constraint moment_notes_author_fkey
  foreign key (author_membership_id) references public.circle_memberships(id) on delete restrict;
alter table public.moment_reactions drop constraint moment_reactions_author_fkey;
alter table public.moment_reactions add constraint moment_reactions_author_fkey
  foreign key (author_membership_id) references public.circle_memberships(id) on delete restrict;

create or replace function private.moment_actor_membership(target_moment_id uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select membership.id
  from public.circle_memberships membership
  join public.moments moment on moment.id = target_moment_id
  where membership.user_id = auth.uid() and membership.status = 'active'
    and private.can_read_live_moment(moment.id)
    and (membership.circle_id = moment.circle_id or exists (
      select 1 from public.moment_circles link
      where link.moment_id = moment.id and link.circle_id = membership.circle_id
    ))
  order by (membership.circle_id = moment.circle_id) desc, membership.id
  limit 1;
$$;
revoke all on function private.moment_actor_membership(uuid) from public, anon, authenticated;


CREATE OR REPLACE FUNCTION private.create_moment_note(target_moment_id uuid, requested_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_audience text;
  target_recorded_by_membership_id uuid;
  actor_membership_id uuid;
  normalized_body text := btrim(requested_body);
  resulting_note_id uuid;
begin
  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select moment.audience, moment.recorded_by_membership_id
    into target_audience, target_recorded_by_membership_id
    from public.moments as moment
   where moment.id = target_moment_id and moment.circle_id = target_circle_id
     and moment.trashed_at is null
   for key share;
  if not found then
    raise exception using errcode = '42501', message = 'Note could not be saved';
  end if;
  actor_membership_id := private.moment_actor_membership(target_moment_id);
  if actor_membership_id is null or normalized_body is null
    or char_length(normalized_body) not between 1 and 1000
    or normalized_body !~ '[^[:space:]]'
    or (
      target_audience = 'just_me'
      and target_recorded_by_membership_id is distinct from actor_membership_id
    ) then
    raise exception using errcode = '42501', message = 'Note could not be saved';
  end if;
  insert into public.moment_notes (
    circle_id, moment_id, author_membership_id, body
  ) values (
    target_circle_id, target_moment_id, actor_membership_id, normalized_body
  ) returning id into resulting_note_id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    (select circle_id from public.circle_memberships where id = actor_membership_id), actor_membership_id, 'moment_note_created', 'moment_note',
    resulting_note_id
  );
  return resulting_note_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value then
    raise exception using errcode = '22023', message = 'Note could not be saved';
end;
$function$
;

CREATE OR REPLACE FUNCTION private.set_moment_reaction(target_moment_id uuid, requested_reaction_type text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_audience text;
  target_recorded_by_membership_id uuid;
  actor_membership_id uuid;
  resulting_revision bigint;
  reaction_subject_id uuid;
  existing_removed_at timestamptz;
begin
  if requested_reaction_type is not null
    and requested_reaction_type not in (
      'held-close', 'made-me-smile', 'remember-this'
    ) then
    raise exception using errcode = '22023', message = 'Response could not be saved';
  end if;
  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select moment.audience, moment.recorded_by_membership_id
    into target_audience, target_recorded_by_membership_id
    from public.moments as moment
   where moment.id = target_moment_id and moment.circle_id = target_circle_id
     and moment.trashed_at is null
   for key share;
  if not found then
    raise exception using errcode = '42501', message = 'Response could not be saved';
  end if;
  actor_membership_id := private.moment_actor_membership(target_moment_id);
  if actor_membership_id is null
    or (
      target_audience = 'just_me'
      and target_recorded_by_membership_id is distinct from actor_membership_id
    ) then
    raise exception using errcode = '42501', message = 'Response could not be saved';
  end if;
  -- Preserve one reaction per account even when its selected membership changes.
  select coalesce((
    select r.author_membership_id from public.moment_reactions r
    join public.circle_memberships m on m.id = r.author_membership_id
    where r.moment_id = target_moment_id and m.user_id = current_user_id
    order by r.created_at, r.id limit 1
  ), actor_membership_id) into actor_membership_id;
  if requested_reaction_type is null then
    select reaction.id, reaction.revision, reaction.removed_at
      into reaction_subject_id, resulting_revision, existing_removed_at
      from public.moment_reactions as reaction
     where reaction.circle_id = target_circle_id
       and reaction.moment_id = target_moment_id
       and reaction.author_membership_id = actor_membership_id
     for update;
    if reaction_subject_id is null or existing_removed_at is not null then
      return coalesce(resulting_revision, 0);
    end if;
    update public.moment_reactions
       set removed_at = statement_timestamp()
     where id = reaction_subject_id
    returning revision into resulting_revision;
  else
    insert into public.moment_reactions (
      circle_id, moment_id, author_membership_id, reaction_type, removed_at
    ) values (
      target_circle_id, target_moment_id, actor_membership_id,
      requested_reaction_type, null
    )
    on conflict (circle_id, moment_id, author_membership_id) do update
    set reaction_type = requested_reaction_type,
        removed_at = null
    returning id, revision into reaction_subject_id, resulting_revision;
  end if;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    (select circle_id from public.circle_memberships where id = actor_membership_id), actor_membership_id,
    case when requested_reaction_type is null
      then 'moment_reaction_removed' else 'moment_reaction_set' end,
    'moment_reaction', reaction_subject_id
  );
  return resulting_revision;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.update_moment_note(target_note_id uuid, expected_revision bigint, requested_body text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_author_membership_id uuid;
  target_revision bigint;
  actor_membership_id uuid;
  normalized_body text := btrim(requested_body);
  resulting_revision bigint;
begin
  if target_note_id is null or expected_revision is null
    or expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Note could not be changed';
  end if;
  select note.circle_id into target_circle_id
  from public.moment_notes as note where note.id = target_note_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select note.circle_id, note.author_membership_id, note.revision
    into target_circle_id, target_author_membership_id, target_revision
  from public.moment_notes as note
  join public.moments as moment
    on moment.circle_id = note.circle_id and moment.id = note.moment_id
  where note.id = target_note_id and note.trashed_at is null
    and moment.trashed_at is null
    and private.can_read_live_moment(moment.id)
  for update of note;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.id = target_author_membership_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or actor_membership_id is distinct from target_author_membership_id then
    raise exception using errcode = '42501', message = 'Note could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Note changed elsewhere';
  end if;
  if normalized_body is null or char_length(normalized_body) not between 1 and 1000
    or normalized_body !~ '[^[:space:]]' then
    raise exception using errcode = '22023', message = 'Note could not be changed';
  end if;
  update public.moment_notes set body = normalized_body where id = target_note_id
  returning revision into resulting_revision;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    (select circle_id from public.circle_memberships where id = actor_membership_id), actor_membership_id, 'moment_note_updated', 'moment_note',
    target_note_id
  );
  return resulting_revision;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.trash_moment_note(target_note_id uuid, expected_revision bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_author_membership_id uuid;
  target_revision bigint;
  actor_membership_id uuid;
  resulting_revision bigint;
begin
  if target_note_id is null or expected_revision is null
    or expected_revision < 1 then
    raise exception using errcode = '22023', message = 'Note could not be changed';
  end if;
  select note.circle_id into target_circle_id
  from public.moment_notes as note where note.id = target_note_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select note.circle_id, note.author_membership_id, note.revision
    into target_circle_id, target_author_membership_id, target_revision
  from public.moment_notes as note
  join public.moments as moment
    on moment.circle_id = note.circle_id and moment.id = note.moment_id
  where note.id = target_note_id and note.trashed_at is null
    and moment.trashed_at is null
    and private.can_read_live_moment(moment.id)
  for update of note;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.id = target_author_membership_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or actor_membership_id is distinct from target_author_membership_id then
    raise exception using errcode = '42501', message = 'Note could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Note changed elsewhere';
  end if;
  update public.moment_notes set trashed_at = statement_timestamp()
  where id = target_note_id returning revision into resulting_revision;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    (select circle_id from public.circle_memberships where id = actor_membership_id), actor_membership_id, 'moment_note_trashed', 'moment_note',
    target_note_id
  );
  return resulting_revision;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.get_moment_conversation(requested_moment_id uuid)
 RETURNS TABLE(notes jsonb, reactions jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        'canChange', note_membership.user_id = auth.uid()
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
$function$
;

CREATE OR REPLACE FUNCTION private.sync_moment_circle_links()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  extra_ids uuid[];
begin
  -- Ordinary edits must not silently restore the storage circle as an audience.
  if tg_op = 'UPDATE' and new.audience = old.audience and new.circle_id = old.circle_id then
    return new;
  end if;
  if new.audience is distinct from 'family' then
    delete from public.moment_circles where moment_id = new.id;
    return new;
  end if;

  insert into public.moment_circles (moment_id, circle_id)
  values (new.id, new.circle_id)
  on conflict do nothing;

  if tg_op = 'INSERT' and new.kind in ('photo', 'video') then
    if new.kind = 'photo' then
      select request.circle_ids into extra_ids
        from private.photo_moment_requests as request
       where request.moment_id = new.id
         and request.circle_id = new.circle_id
       order by request.requested_at desc
       limit 1;
    else
      select request.circle_ids into extra_ids
        from private.video_upload_requests as request
       where request.moment_id = new.id
         and request.circle_id = new.circle_id
       order by request.requested_at desc
       limit 1;
    end if;
    if extra_ids is not null then
      insert into public.moment_circles (moment_id, circle_id)
      select new.id, extra_id
        from unnest(extra_ids) as extra_id
       where extra_id is not null
      on conflict do nothing;
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.list_timeline_moments(circle_id uuid, journal_person_id uuid DEFAULT NULL::uuid, cursor_occurred_on date DEFAULT NULL::date, cursor_has_precise_time boolean DEFAULT NULL::boolean, cursor_occurred_at timestamp with time zone DEFAULT NULL::timestamp with time zone, cursor_moment_id uuid DEFAULT NULL::uuid, page_size integer DEFAULT 20, snapshot_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS TABLE(moment_id uuid, moment_circle_id uuid, moment_journal_person_id uuid, journal_person_name text, journal_person_accent text, journal_person_kind text, recorder_person_id uuid, recorder_person_name text, moment_kind text, moment_title text, body text, place_name text, tagged_people jsonb, occurred_on date, occurred_at timestamp with time zone, occurred_timezone text, time_precision text, revision bigint, created_at timestamp with time zone, updated_at timestamp with time zone, can_change boolean, feed_snapshot_at timestamp with time zone, latitude double precision, longitude double precision, source_url text, moment_audience text, linked_circle_ids uuid[])
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  effective_snapshot_at timestamptz := coalesce(
    list_timeline_moments.snapshot_at, statement_timestamp()
  );
  cursor_is_empty boolean :=
    list_timeline_moments.cursor_occurred_on is null
    and list_timeline_moments.cursor_has_precise_time is null
    and list_timeline_moments.cursor_occurred_at is null
    and list_timeline_moments.cursor_moment_id is null;
  cursor_is_complete boolean :=
    list_timeline_moments.cursor_occurred_on is not null
    and list_timeline_moments.cursor_has_precise_time is not null
    and list_timeline_moments.cursor_moment_id is not null
    and (
      (list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is not null)
      or (not list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is null)
    );
  viewing_own_journal boolean :=
    list_timeline_moments.journal_person_id is not null
    and exists (
      select 1
        from public.circle_memberships as membership
       where membership.circle_id = list_timeline_moments.circle_id
         and membership.person_id = list_timeline_moments.journal_person_id
         and membership.user_id = (select auth.uid())
         and membership.status = 'active'
    );
begin
  if list_timeline_moments.circle_id is null
    or list_timeline_moments.page_size is null
    or list_timeline_moments.page_size not between 1 and 50
    or list_timeline_moments.snapshot_at > statement_timestamp()
    or not (cursor_is_empty or cursor_is_complete) then
    raise exception using errcode = '22023', message = 'Timeline could not be listed';
  end if;

  return query
  select
    moment.id,
    moment.circle_id,
    moment.journal_person_id,
    journal_person.display_name,
    journal_person.accent_token,
    journal_person.profile_kind,
    recorder_membership.person_id,
    recorder_person.display_name,
    moment.kind,
    moment.title,
    moment.body,
    moment.place_name,
    (select private.moment_tagged_people(moment.id)),
    moment.occurred_on,
    moment.occurred_at,
    moment.occurred_timezone,
    moment.time_precision,
    moment.revision,
    moment.created_at,
    moment.updated_at,
    case
      when moment.kind = 'insight' then
        (select private.is_circle_organizer(moment.circle_id))
      else
        (select private.can_manage_person(moment.circle_id, moment.journal_person_id))
    end,
    effective_snapshot_at,
    moment.latitude,
    moment.longitude,
    moment.source_url,
    moment.audience,
    coalesce((
      select array_agg(link.circle_id order by link.circle_id)
      from public.moment_circles as link
      where link.moment_id = moment.id
    ), '{}'::uuid[])
  from public.moments as moment
  left join public.people as journal_person
    on journal_person.circle_id = moment.circle_id
   and journal_person.id = moment.journal_person_id
  left join public.circle_memberships as recorder_membership
    on recorder_membership.circle_id = moment.circle_id
   and recorder_membership.id = moment.recorded_by_membership_id
  left join public.people as recorder_person
    on recorder_person.circle_id = recorder_membership.circle_id
   and recorder_person.id = recorder_membership.person_id
  where moment.trashed_at is null
    and private.can_read_live_moment(moment.id)
    and moment.created_at <= effective_snapshot_at
    and moment.updated_at <= effective_snapshot_at
    and (
      case
        when list_timeline_moments.journal_person_id is null then
          moment.audience = 'family'
          and exists (
            select 1
              from public.moment_circles as link
             where link.moment_id = moment.id
               and link.circle_id = list_timeline_moments.circle_id
          )
        when viewing_own_journal then
          exists (
            select 1
              from public.circle_memberships as mine
             where mine.user_id = (select auth.uid())
               and mine.status = 'active'
               and mine.person_id = moment.journal_person_id
          )
          and (
            moment.audience = 'family'
            or (
              moment.audience = 'just_me'
              and recorder_membership.user_id = (select auth.uid())
            )
          )
        else
          moment.circle_id = list_timeline_moments.circle_id
          and moment.journal_person_id = list_timeline_moments.journal_person_id
          and (
            moment.audience = 'family'
            or (
              moment.audience = 'just_me'
              and recorder_membership.user_id = (select auth.uid())
            )
          )
      end
    )
    and (
      cursor_is_empty
      or (
        moment.occurred_on,
        moment.occurred_at is not null,
        coalesce(moment.occurred_at, '-infinity'::timestamptz),
        moment.id
      ) < (
        list_timeline_moments.cursor_occurred_on,
        list_timeline_moments.cursor_has_precise_time,
        coalesce(list_timeline_moments.cursor_occurred_at, '-infinity'::timestamptz),
        list_timeline_moments.cursor_moment_id
      )
    )
  order by moment.occurred_on desc, moment.occurred_at desc nulls last,
    moment.id desc
  limit list_timeline_moments.page_size;
end;
$function$
;

-- Normalize the local eight-column and live nine-column notification contracts.
-- No data is removed; recreate only these two functions and restore their grants.
drop function public.list_web_push_deliveries(text, uuid);
drop function private.list_web_push_deliveries(text, uuid);
CREATE OR REPLACE FUNCTION private.list_web_push_deliveries(requested_activity_kind text, requested_activity_id uuid)
 RETURNS TABLE(endpoint text, p256dh text, auth text, actor_name text, moment_id uuid, moment_kind text, reaction_type text, visible_circle_id uuid, circle_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      (
        select link.circle_id from public.moment_circles link
        join public.circle_memberships member on member.circle_id = link.circle_id
        where link.moment_id = resolved_moment_id
          and member.user_id = subscriber.user_id and member.status = 'active'
        order by (link.circle_id = subscription.circle_id) desc, link.circle_id limit 1
      ),
      (select c.name from public.moment_circles link
        join public.circles c on c.id = link.circle_id
        join public.circle_memberships member on member.circle_id = link.circle_id
        where link.moment_id = resolved_moment_id
          and member.user_id = subscriber.user_id and member.status = 'active'
        order by (link.circle_id = subscription.circle_id) desc, link.circle_id limit 1)
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
              exists (
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
        on author.id = note.author_membership_id
      join public.circle_memberships as owner
        on owner.circle_id = moment.circle_id
       and owner.id = moment.recorded_by_membership_id
      join public.people as person
        on person.circle_id = author.circle_id
       and person.id = author.person_id
     where note.moment_id = requested_activity_id
       and note.trashed_at is null
       and moment.trashed_at is null
       and moment.kind <> 'insight'
       and private.can_read_live_moment(moment.id)
       and author.user_id = current_user_id
       and author.status = 'active'
     order by note.created_at desc
     limit 1;
    if resolved_moment_id is null
      or actor_membership_id is null
      or owner_user_id is null
      or current_user_id = owner_user_id then
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
      (select link.circle_id from public.moment_circles link
         join public.circle_memberships member on member.circle_id = link.circle_id
         where link.moment_id = resolved_moment_id
           and member.user_id = owner_user_id and member.status = 'active'
         order by link.circle_id limit 1),
      (select c.name from public.moment_circles link
         join public.circles c on c.id = link.circle_id
         join public.circle_memberships member on member.circle_id = link.circle_id
         where link.moment_id = resolved_moment_id
           and member.user_id = owner_user_id and member.status = 'active'
         order by link.circle_id limit 1)
      from private.web_push_subscriptions as subscription
      join public.circle_memberships as owner
        on owner.circle_id = subscription.circle_id
       and owner.id = subscription.membership_id
     where owner.status = 'active'
       and owner.user_id = owner_user_id
       and exists (
         select 1 from public.moment_circles link
         join public.circle_memberships member on member.circle_id = link.circle_id
         where link.moment_id = resolved_moment_id
           and member.user_id = owner_user_id and member.status = 'active'
       )
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
     and private.can_read_live_moment(moment.id)
     and author.user_id = current_user_id
     and author.status = 'active';
  if resolved_moment_id is null
    or actor_membership_id is null
    or owner_user_id is null
    or current_user_id = owner_user_id then
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
    (select link.circle_id from public.moment_circles link
         join public.circle_memberships member on member.circle_id = link.circle_id
         where link.moment_id = resolved_moment_id
           and member.user_id = owner_user_id and member.status = 'active'
         order by link.circle_id limit 1),
      (select c.name from public.moment_circles link
         join public.circles c on c.id = link.circle_id
         join public.circle_memberships member on member.circle_id = link.circle_id
         where link.moment_id = resolved_moment_id
           and member.user_id = owner_user_id and member.status = 'active'
         order by link.circle_id limit 1)
    from private.web_push_subscriptions as subscription
    join public.circle_memberships as owner
      on owner.circle_id = subscription.circle_id
     and owner.id = subscription.membership_id
   where owner.status = 'active'
     and owner.user_id = owner_user_id
     and exists (
       select 1 from public.moment_circles link
       join public.circle_memberships member on member.circle_id = link.circle_id
       where link.moment_id = resolved_moment_id
         and member.user_id = owner_user_id and member.status = 'active'
     )
   order by subscription.endpoint, subscription.updated_at desc, subscription.id desc;
end;
$function$
;

create or replace function public.list_web_push_deliveries(activity_kind text, activity_id uuid)
returns table(endpoint text, p256dh text, auth text, actor_name text, moment_id uuid,
  moment_kind text, reaction_type text, visible_circle_id uuid, circle_name text)
language sql stable security invoker set search_path = '' as $$
  select * from private.list_web_push_deliveries(activity_kind, activity_id);
$$;
revoke all on function private.list_web_push_deliveries(text,uuid) from public, anon;
revoke all on function public.list_web_push_deliveries(text,uuid) from public, anon;
grant execute on function private.list_web_push_deliveries(text,uuid) to authenticated;
grant execute on function public.list_web_push_deliveries(text,uuid) to authenticated;

-- Return display-only attribution for visible posts, without exposing another circle's roster.
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
    );
$$;
create or replace function public.visible_moment_authors(membership_ids uuid[])
returns table(membership_id uuid, person_id uuid, display_name text, accent_token text)
language sql stable security invoker set search_path = '' as $$
  select * from private.visible_moment_authors(membership_ids);
$$;
revoke all on function private.visible_moment_authors(uuid[]) from public, anon;
grant execute on function private.visible_moment_authors(uuid[]) to authenticated;
revoke all on function public.visible_moment_authors(uuid[]) from public, anon;
grant execute on function public.visible_moment_authors(uuid[]) to authenticated;

create or replace function private.share_private_moment(
  moment_id uuid, expected_revision bigint, destination_circle_id uuid,
  moment_title text, moment_body text, place_name text, tagged_person_ids uuid[],
  occurred_on date, occurred_at timestamptz default null, occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null
)
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare
  original_circle_id uuid;
  post public.moments%rowtype;
  destination_membership_id uuid;
  result_revision bigint;
begin
  if auth.uid() is null or destination_circle_id is null then
    raise exception using errcode = '42501', message = 'Moment could not be shared';
  end if;
  select circle_id into original_circle_id from public.moments where id = moment_id;
  -- Match existing circle-before-moment writes, with stable ordering.
  perform 1 from public.circles where id in (original_circle_id, destination_circle_id)
    order by id for update;
  select * into post from public.moments where id = moment_id for update;
  if post.id is null or post.trashed_at is not null or post.audience <> 'just_me'
    or post.kind = 'insight'
    or not exists (select 1 from public.circle_memberships m
      where m.id = post.recorded_by_membership_id and m.user_id = auth.uid() and m.status = 'active')
    then raise exception using errcode = '42501', message = 'Moment could not be shared';
  end if;
  select id into destination_membership_id from public.circle_memberships
    where circle_id = destination_circle_id and user_id = auth.uid() and status = 'active'
    for share;
  if destination_membership_id is null then
    raise exception using errcode = '42501', message = 'Moment could not be shared';
  end if;
  if expected_revision is null or post.revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
  end if;
  if (post.kind = 'photo' and not exists(select 1 from public.moment_photos p where p.moment_id = post.id))
    or (post.kind = 'video' and not exists(select 1 from public.moment_videos v where v.moment_id = post.id)) then
    raise exception using errcode = '22023', message = 'Wait for the media to finish before sharing';
  end if;
  -- Validate and save content while still private. Any later error rolls everything back.
  perform private.update_family_moment(post.id, expected_revision, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, 'just_me');
  update public.moments set audience = 'family' where id = post.id returning revision into result_revision;
  delete from public.moment_circles link where link.moment_id = post.id;
  insert into public.moment_circles(moment_id, circle_id) values(post.id, destination_circle_id);
  return result_revision;
end;
$$;
create or replace function public.share_private_moment(
  moment_id uuid, expected_revision bigint, destination_circle_id uuid,
  moment_title text, moment_body text, place_name text, tagged_person_ids uuid[],
  occurred_on date, occurred_at timestamptz default null, occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null
)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.share_private_moment(moment_id, expected_revision, destination_circle_id,
    moment_title, moment_body, place_name, tagged_person_ids, occurred_on,
    occurred_at, occurred_timezone, latitude, longitude);
$$;
revoke all on function private.share_private_moment(uuid,bigint,uuid,text,text,text,uuid[],date,timestamptz,text,double precision,double precision) from public, anon;
revoke all on function public.share_private_moment(uuid,bigint,uuid,text,text,text,uuid[],date,timestamptz,text,double precision,double precision) from public, anon;
grant execute on function private.share_private_moment(uuid,bigint,uuid,text,text,text,uuid[],date,timestamptz,text,double precision,double precision) to authenticated;
grant execute on function public.share_private_moment(uuid,bigint,uuid,text,text,text,uuid[],date,timestamptz,text,double precision,double precision) to authenticated;
