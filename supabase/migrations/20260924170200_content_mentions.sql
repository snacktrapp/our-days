-- Structured @mentions for captions and comments.
-- Additive and live-safe: new table, new reads, and write RPCs gained optional
-- arguments that default to null so existing callers leave mentions untouched.

create table public.content_mentions (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  moment_id uuid not null,
  note_id uuid,
  mentioned_user_id uuid not null,
  author_membership_id uuid not null,
  start_offset integer not null,
  end_offset integer not null,
  created_at timestamptz not null default statement_timestamp(),
  removed_at timestamptz,
  notified_at timestamptz,
  constraint content_mentions_offsets_valid check (
    start_offset >= 0 and end_offset > start_offset
  ),
  constraint content_mentions_moment_fkey foreign key (circle_id, moment_id)
    references public.moments (circle_id, id) on delete restrict,
  constraint content_mentions_note_fkey foreign key (circle_id, note_id)
    references public.moment_notes (circle_id, id) on delete restrict,
  constraint content_mentions_author_fkey foreign key (circle_id, author_membership_id)
    references public.circle_memberships (circle_id, id) on delete restrict
);

create unique index content_mentions_caption_user_idx
  on public.content_mentions (moment_id, mentioned_user_id)
  where note_id is null;
create unique index content_mentions_note_user_idx
  on public.content_mentions (note_id, mentioned_user_id)
  where note_id is not null;
create index content_mentions_recipient_idx
  on public.content_mentions (mentioned_user_id, created_at desc)
  where removed_at is null;

alter table public.content_mentions enable row level security;

create policy content_mentions_select_visible_moment
on public.content_mentions for select to authenticated
using (
  removed_at is null
  and (select private.can_read_live_moment(moment_id))
);

revoke all on table public.content_mentions from public, anon;
grant select on table public.content_mentions to authenticated;

create function private.mention_user_is_in_moment_circle(
  target_moment_id uuid,
  target_circle_id uuid,
  requested_user_id uuid,
  span_text text
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
    join public.people as person
      on person.circle_id = membership.circle_id
     and person.id = membership.person_id
    where membership.user_id = requested_user_id
      and membership.status = 'active'
      and span_text = '@' || person.display_name
      and (
        membership.circle_id = target_circle_id
        or exists (
          select 1
          from public.moment_circles as link
          where link.moment_id = target_moment_id
            and link.circle_id = membership.circle_id
        )
      )
  );
$$;

create function private.apply_content_mentions(
  target_moment_id uuid,
  target_note_id uuid,
  requested_user_ids uuid[],
  requested_starts integer[],
  requested_ends integer[],
  requested_body text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_audience text;
  target_kind text;
  target_journal_person_id uuid;
  actor_membership_id uuid;
  normalized_body text := coalesce(requested_body, '');
  mention_count integer := coalesce(cardinality(requested_user_ids), 0);
  idx integer;
  requested_user uuid;
  span_start integer;
  span_end integer;
  span_text text;
begin
  if current_user_id is null or target_moment_id is null or requested_user_ids is null then
    raise exception using errcode = '42501', message = 'Mention could not be saved';
  end if;
  if mention_count > 20
    or coalesce(cardinality(requested_starts), 0) is distinct from mention_count
    or coalesce(cardinality(requested_ends), 0) is distinct from mention_count
    or (
      mention_count > 0
      and (
        select count(distinct user_id)
        from unnest(requested_user_ids) as user_id
      ) is distinct from mention_count
    ) then
    raise exception using errcode = '22023', message = 'Mention could not be saved';
  end if;

  select moment.circle_id, moment.audience, moment.kind, moment.journal_person_id
    into target_circle_id, target_audience, target_kind, target_journal_person_id
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.trashed_at is null;

  if target_circle_id is null or target_kind = 'insight' then
    raise exception using errcode = '42501', message = 'Mention could not be saved';
  end if;

  if target_note_id is null then
    select membership.id into actor_membership_id
    from public.circle_memberships as membership
    where membership.circle_id = target_circle_id
      and membership.user_id = current_user_id
      and membership.status = 'active';
    if actor_membership_id is null
      or not (select private.can_manage_person(
        target_circle_id, target_journal_person_id
      )) then
      raise exception using errcode = '42501', message = 'Mention could not be saved';
    end if;
  else
    select note.author_membership_id into actor_membership_id
    from public.moment_notes as note
    join public.circle_memberships as author
      on author.circle_id = note.circle_id
     and author.id = note.author_membership_id
    where note.id = target_note_id
      and note.moment_id = target_moment_id
      and note.circle_id = target_circle_id
      and note.trashed_at is null
      and author.user_id = current_user_id
      and author.status = 'active';
    if actor_membership_id is null then
      raise exception using errcode = '42501', message = 'Mention could not be saved';
    end if;
  end if;

  if coalesce(target_audience, 'family') = 'just_me' and mention_count > 0 then
    raise exception using errcode = '22023', message = 'Mention could not be saved';
  end if;

  for idx in 1..mention_count loop
    requested_user := requested_user_ids[idx];
    span_start := requested_starts[idx];
    span_end := requested_ends[idx];
    if requested_user is null
      or span_start is null
      or span_end is null
      or span_start < 0
      or span_end <= span_start
      or span_end > char_length(normalized_body) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
    if exists (
      select 1
      from generate_series(1, idx - 1) as prior(i)
      where requested_starts[prior.i] < span_end
        and span_start < requested_ends[prior.i]
    ) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
    span_text := substring(
      normalized_body from span_start + 1 for span_end - span_start
    );
    if not (select private.mention_user_is_in_moment_circle(
      target_moment_id, target_circle_id, requested_user, span_text
    )) then
      raise exception using errcode = '22023', message = 'Mention could not be saved';
    end if;
  end loop;

  if target_note_id is null then
    update public.content_mentions as mention
    set removed_at = statement_timestamp()
    where mention.moment_id = target_moment_id
      and mention.note_id is null
      and mention.removed_at is null
      and not (mention.mentioned_user_id = any (requested_user_ids));
  else
    update public.content_mentions as mention
    set removed_at = statement_timestamp()
    where mention.note_id = target_note_id
      and mention.removed_at is null
      and not (mention.mentioned_user_id = any (requested_user_ids));
  end if;

  for idx in 1..mention_count loop
    requested_user := requested_user_ids[idx];
    span_start := requested_starts[idx];
    span_end := requested_ends[idx];
    if target_note_id is null then
      update public.content_mentions
      set start_offset = span_start,
          end_offset = span_end,
          removed_at = null
      where moment_id = target_moment_id
        and note_id is null
        and mentioned_user_id = requested_user;
      if not found then
        insert into public.content_mentions (
          circle_id, moment_id, note_id, mentioned_user_id,
          author_membership_id, start_offset, end_offset, notified_at
        ) values (
          target_circle_id, target_moment_id, null, requested_user,
          actor_membership_id, span_start, span_end,
          case
            when requested_user = current_user_id then statement_timestamp()
            else null
          end
        );
      end if;
    else
      update public.content_mentions
      set start_offset = span_start,
          end_offset = span_end,
          removed_at = null
      where note_id = target_note_id
        and mentioned_user_id = requested_user;
      if not found then
        insert into public.content_mentions (
          circle_id, moment_id, note_id, mentioned_user_id,
          author_membership_id, start_offset, end_offset, notified_at
        ) values (
          target_circle_id, target_moment_id, target_note_id, requested_user,
          actor_membership_id, span_start, span_end,
          case
            when requested_user = current_user_id then statement_timestamp()
            else null
          end
        );
      end if;
    end if;
  end loop;
end;
$$;

revoke all on function private.mention_user_is_in_moment_circle(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.apply_content_mentions(uuid, uuid, uuid[], integer[], integer[], text)
  from public, anon;
grant execute on function private.apply_content_mentions(uuid, uuid, uuid[], integer[], integer[], text)
  to authenticated;

create function private.list_visible_content_mentions(moment_ids uuid[])
returns table (
  moment_id uuid,
  note_id uuid,
  mentioned_user_id uuid,
  start_offset integer,
  end_offset integer,
  display_name text,
  active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    mention.moment_id,
    mention.note_id,
    mention.mentioned_user_id,
    mention.start_offset,
    mention.end_offset,
    case when member_name.display_name is null then null else member_name.display_name end,
    member_name.display_name is not null
  from public.content_mentions as mention
  left join lateral (
    select person.display_name
    from public.circle_memberships as membership
    join public.people as person
      on person.circle_id = membership.circle_id
     and person.id = membership.person_id
    where membership.user_id = mention.mentioned_user_id
      and membership.status = 'active'
      and (
        membership.circle_id = mention.circle_id
        or exists (
          select 1
          from public.moment_circles as link
          where link.moment_id = mention.moment_id
            and link.circle_id = membership.circle_id
        )
      )
    order by (membership.circle_id = mention.circle_id) desc, person.display_name
    limit 1
  ) as member_name on true
  where auth.uid() is not null
    and coalesce(cardinality(moment_ids), 0) between 1 and 100
    and mention.moment_id = any (moment_ids)
    and mention.removed_at is null
    and (select private.can_read_live_moment(mention.moment_id));
$$;

create function public.list_visible_content_mentions(moment_ids uuid[])
returns table (
  moment_id uuid,
  note_id uuid,
  mentioned_user_id uuid,
  start_offset integer,
  end_offset integer,
  display_name text,
  active boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_visible_content_mentions(moment_ids);
$$;

revoke all on function private.list_visible_content_mentions(uuid[]) from public, anon;
revoke all on function public.list_visible_content_mentions(uuid[]) from public, anon;
grant execute on function private.list_visible_content_mentions(uuid[]) to authenticated;
grant execute on function public.list_visible_content_mentions(uuid[]) to authenticated;

create function private.list_my_mention_notifications()
returns table (
  mention_id uuid,
  moment_id uuid,
  note_id uuid,
  actor_membership_id uuid,
  actor_name text,
  snippet text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    mention.id,
    mention.moment_id,
    mention.note_id,
    mention.author_membership_id,
    coalesce(person.display_name, 'Family'),
    left(regexp_replace(
      coalesce(note.body, moment.body, ''),
      '[[:space:]]+',
      ' ',
      'g'
    ), 80),
    mention.created_at
  from public.content_mentions as mention
  join public.moments as moment
    on moment.id = mention.moment_id
   and moment.circle_id = mention.circle_id
  join public.circle_memberships as author
    on author.circle_id = mention.circle_id
   and author.id = mention.author_membership_id
  join public.people as person
    on person.circle_id = author.circle_id
   and person.id = author.person_id
  left join public.moment_notes as note
    on note.id = mention.note_id
   and note.trashed_at is null
  where auth.uid() is not null
    and mention.mentioned_user_id = auth.uid()
    and mention.mentioned_user_id is distinct from author.user_id
    and mention.removed_at is null
    and moment.trashed_at is null
    and moment.audience = 'family'
    and moment.kind <> 'insight'
    and (mention.note_id is null or note.id is not null)
    and (select private.can_read_live_moment(moment.id))
  order by mention.created_at desc
  limit 40;
$$;

create function public.list_my_mention_notifications()
returns table (
  mention_id uuid,
  moment_id uuid,
  note_id uuid,
  actor_membership_id uuid,
  actor_name text,
  snippet text,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_my_mention_notifications();
$$;

revoke all on function private.list_my_mention_notifications() from public, anon;
revoke all on function public.list_my_mention_notifications() from public, anon;
grant execute on function private.list_my_mention_notifications() to authenticated;
grant execute on function public.list_my_mention_notifications() to authenticated;

create function private.claim_mention_push_deliveries(
  requested_moment_id uuid,
  requested_note_id uuid
)
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
  snippet text,
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
  if current_user_id is null or requested_moment_id is null then
    return;
  end if;

  return query
  with pending as (
    update public.content_mentions as mention
    set notified_at = statement_timestamp()
    where mention.moment_id = requested_moment_id
      and mention.note_id is not distinct from requested_note_id
      and mention.removed_at is null
      and mention.notified_at is null
      and mention.mentioned_user_id is distinct from current_user_id
      and exists (
        select 1
        from public.moments as moment
        join public.circle_memberships as author
          on author.circle_id = moment.circle_id
         and author.id = mention.author_membership_id
        where moment.id = mention.moment_id
          and moment.trashed_at is null
          and moment.audience = 'family'
          and moment.kind <> 'insight'
          and author.user_id = current_user_id
          and author.status = 'active'
          and (select private.can_read_live_moment(moment.id))
      )
    returning
      mention.mentioned_user_id,
      mention.moment_id,
      mention.note_id,
      mention.author_membership_id,
      mention.circle_id
  )
  select distinct on (subscription.endpoint)
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    coalesce(actor_person.display_name, 'Family'),
    pending.moment_id,
    null::text,
    null::text,
    (
      select link.circle_id
      from public.moment_circles as link
      join public.circle_memberships as member
        on member.circle_id = link.circle_id
      where link.moment_id = pending.moment_id
        and member.user_id = pending.mentioned_user_id
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
        and member.user_id = pending.mentioned_user_id
        and member.status = 'active'
      order by (link.circle_id = subscription.circle_id) desc, link.circle_id
      limit 1
    ),
    left(regexp_replace(
      coalesce(note.body, moment.body, ''),
      '[[:space:]]+',
      ' ',
      'g'
    ), 80),
    pending.note_id
  from pending
  join public.moments as moment
    on moment.id = pending.moment_id
  left join public.moment_notes as note
    on note.id = pending.note_id
  join public.circle_memberships as author
    on author.id = pending.author_membership_id
   and author.circle_id = pending.circle_id
  join public.people as actor_person
    on actor_person.circle_id = author.circle_id
   and actor_person.id = author.person_id
  join public.circle_memberships as subscriber
    on subscriber.user_id = pending.mentioned_user_id
   and subscriber.status = 'active'
  join private.web_push_subscriptions as subscription
    on subscription.circle_id = subscriber.circle_id
   and subscription.membership_id = subscriber.id
  order by subscription.endpoint, subscription.updated_at desc, subscription.id desc;
end;
$$;

create function public.claim_mention_push_deliveries(
  requested_moment_id uuid,
  requested_note_id uuid default null
)
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
  snippet text,
  note_id uuid
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.claim_mention_push_deliveries(
    requested_moment_id, requested_note_id
  );
$$;

revoke all on function private.claim_mention_push_deliveries(uuid, uuid) from public, anon;
revoke all on function public.claim_mention_push_deliveries(uuid, uuid) from public, anon;
grant execute on function private.claim_mention_push_deliveries(uuid, uuid) to authenticated;
grant execute on function public.claim_mention_push_deliveries(uuid, uuid) to authenticated;

-- Optional mention arguments. Null leaves existing mentions alone.

drop function public.create_moment_note(uuid, text);
create function public.create_moment_note(
  moment_id uuid,
  body text,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_moment_note(moment_id, body);
  if mentioned_user_ids is not null then
    perform private.apply_content_mentions(
      moment_id,
      created_id,
      mentioned_user_ids,
      mention_starts,
      mention_ends,
      btrim(body)
    );
  end if;
  return created_id;
end;
$$;

drop function public.update_moment_note(uuid, bigint, text);
create function public.update_moment_note(
  note_id uuid,
  expected_revision bigint,
  body text,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  resulting_revision bigint;
  target_moment_id uuid;
begin
  resulting_revision := private.update_moment_note(note_id, expected_revision, body);
  if mentioned_user_ids is not null then
    select note.moment_id into target_moment_id
    from public.moment_notes as note
    where note.id = note_id;
    perform private.apply_content_mentions(
      target_moment_id,
      note_id,
      mentioned_user_ids,
      mention_starts,
      mention_ends,
      btrim(body)
    );
  end if;
  return resulting_revision;
end;
$$;

drop function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[]
);
create function public.create_written_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  audience text default null,
  circle_ids uuid[] default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_written_moment(
    circle_id,
    journal_person_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    audience
  );
  perform private.link_additional_moment_circles(created_id, circle_ids);
  if mentioned_user_ids is not null then
    perform private.apply_content_mentions(
      created_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(body)
    );
  end if;
  return created_id;
end;
$$;

drop function public.update_written_moment(uuid, bigint, text, date, timestamptz, text);
create function public.update_written_moment(
  moment_id uuid,
  expected_revision bigint,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  resulting_revision bigint;
begin
  resulting_revision := private.update_written_moment(
    moment_id, expected_revision, body, occurred_on, occurred_at, occurred_timezone
  );
  if mentioned_user_ids is not null then
    perform private.apply_content_mentions(
      moment_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(body)
    );
  end if;
  return resulting_revision;
end;
$$;

drop function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
);
create function public.update_family_moment(
  moment_id uuid,
  expected_revision bigint,
  moment_title text,
  moment_body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  latitude double precision default null,
  longitude double precision default null,
  audience text default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns bigint
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  resulting_revision bigint;
begin
  resulting_revision := private.update_family_moment(
    moment_id, expected_revision, moment_title, moment_body, place_name,
    tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, audience
  );
  if mentioned_user_ids is not null then
    perform private.apply_content_mentions(
      moment_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(moment_body)
    );
  end if;
  return resulting_revision;
end;
$$;

drop function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[]
);
create function public.create_family_moment(
  circle_id uuid,
  journal_person_id uuid,
  moment_kind text,
  moment_title text,
  moment_body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  latitude double precision default null,
  longitude double precision default null,
  audience text default null,
  circle_ids uuid[] default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  created_id uuid;
begin
  created_id := private.create_family_moment(
    circle_id, journal_person_id, moment_kind, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, audience
  );
  perform private.link_additional_moment_circles(created_id, circle_ids);
  if mentioned_user_ids is not null then
    perform private.apply_content_mentions(
      created_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(moment_body)
    );
  end if;
  return created_id;
end;
$$;

drop function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[]
);
create function public.reserve_photo_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  request_key uuid default null,
  audience text default null,
  circle_ids uuid[] default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns table (
  intake_id uuid,
  moment_id uuid,
  bucket_id text,
  object_path text,
  state text,
  expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  reserved record;
begin
  select * into reserved
  from private.reserve_photo_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, occurred_at, occurred_timezone, request_key, audience
  );
  if reserved.intake_id is not null then
    perform private.store_media_request_circle_ids(
      'photo', reserved.intake_id, circle_ids
    );
  end if;
  if mentioned_user_ids is not null and reserved.moment_id is not null then
    perform private.apply_content_mentions(
      reserved.moment_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(body)
    );
  end if;
  return query
  select reserved.intake_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.expires_at;
end;
$$;

drop function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid
);
create function public.reserve_video_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  place_name text,
  tagged_person_ids uuid[],
  occurred_on date,
  expected_mime_type text,
  expected_size_bytes bigint,
  duration_ms integer,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  request_key uuid default null,
  audience text default null,
  circle_ids uuid[] default null,
  existing_moment_id uuid default null,
  mentioned_user_ids uuid[] default null,
  mention_starts integer[] default null,
  mention_ends integer[] default null
)
returns table (
  request_id uuid,
  moment_id uuid,
  bucket_id text,
  object_path text,
  state text,
  upload_expires_at timestamptz
)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  reserved record;
begin
  select * into reserved
  from private.reserve_video_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
    occurred_at, occurred_timezone, request_key, audience, existing_moment_id
  );
  if reserved.request_id is not null and existing_moment_id is null then
    perform private.store_media_request_circle_ids(
      'video', reserved.request_id, circle_ids
    );
  end if;
  if mentioned_user_ids is not null
    and existing_moment_id is null
    and reserved.moment_id is not null then
    perform private.apply_content_mentions(
      reserved.moment_id, null, mentioned_user_ids, mention_starts, mention_ends, btrim(body)
    );
  end if;
  return query
  select reserved.request_id, reserved.moment_id, reserved.bucket_id,
    reserved.object_path, reserved.state, reserved.upload_expires_at;
end;
$$;

revoke all on function public.create_moment_note(uuid, text, uuid[], integer[], integer[]) from public, anon;
revoke all on function public.update_moment_note(uuid, bigint, text, uuid[], integer[], integer[]) from public, anon;
revoke all on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[], uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.update_written_moment(
  uuid, bigint, text, date, timestamptz, text, uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[], uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[],
  uuid[], integer[], integer[]
) from public, anon;
revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) from public, anon;

grant execute on function public.create_moment_note(uuid, text, uuid[], integer[], integer[]) to authenticated;
grant execute on function public.update_moment_note(uuid, bigint, text, uuid[], integer[], integer[]) to authenticated;
grant execute on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text, uuid[], uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.update_written_moment(
  uuid, bigint, text, date, timestamptz, text, uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text, uuid[], uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text, uuid[],
  uuid[], integer[], integer[]
) to authenticated;
grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text, uuid[], uuid, uuid[], integer[], integer[]
) to authenticated;

notify pgrst, 'reload schema';
