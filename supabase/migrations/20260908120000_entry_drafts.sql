-- Unpublished composer drafts belong to one account. Members save their own
-- unfinished entries through reviewed RPCs. Other circle members never read
-- another person's drafts. Cap is 20 live drafts per account.

create table private.entry_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null,
  kind text not null,
  title text not null default '',
  body text not null default '',
  audience text not null default 'family',
  circle_ids uuid[] not null default '{}',
  journal_person_id uuid,
  tagged_person_ids uuid[] not null default '{}',
  place_name text not null default '',
  latitude double precision,
  longitude double precision,
  occurred_on date,
  occurred_time text,
  occurred_timezone text,
  media jsonb not null default '[]'::jsonb,
  verse jsonb,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint entry_drafts_kind_valid check (
    kind in (
      'thought', 'photo', 'video', 'bible-verse', 'milestone', 'location'
    )
  ),
  constraint entry_drafts_audience_valid check (
    audience in ('family', 'just_me')
  ),
  constraint entry_drafts_title_valid check (char_length(title) <= 120),
  constraint entry_drafts_body_valid check (char_length(body) <= 4000),
  constraint entry_drafts_place_name_valid check (char_length(place_name) <= 200),
  constraint entry_drafts_circle_ids_valid check (
    cardinality(circle_ids) <= 20
  ),
  constraint entry_drafts_tagged_people_valid check (
    cardinality(tagged_person_ids) <= 25
  ),
  constraint entry_drafts_occurred_time_valid check (
    occurred_time is null
    or occurred_time ~ '^[0-2][0-9]:[0-5][0-9]$'
  ),
  constraint entry_drafts_occurred_timezone_valid check (
    occurred_timezone is null
    or char_length(occurred_timezone) between 1 and 64
  ),
  constraint entry_drafts_coordinates_valid check (
    (latitude is null and longitude is null)
    or (
      latitude is not null
      and longitude is not null
      and latitude between -90 and 90
      and longitude between -180 and 180
    )
  ),
  constraint entry_drafts_media_valid check (
    jsonb_typeof(media) = 'array'
    and jsonb_array_length(media) <= 6
  ),
  constraint entry_drafts_timestamp_order_valid check (updated_at >= created_at)
);

create index entry_drafts_user_updated_idx
  on private.entry_drafts (user_id, updated_at desc, id desc);

alter table private.entry_drafts enable row level security;
alter table private.entry_drafts force row level security;

create policy entry_drafts_select_own
on private.entry_drafts for select to authenticated
using (user_id = (select auth.uid()));

revoke all on table private.entry_drafts
  from public, anon, authenticated;

create function private.entry_draft_circles_are_allowed(
  requested_circle_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_circle_ids is null
    or cardinality(requested_circle_ids) = 0
    or not exists (
      select 1
        from unnest(requested_circle_ids) as requested(circle_id)
       where not exists (
         select 1
           from public.circle_memberships as membership
          where membership.circle_id = requested.circle_id
            and membership.user_id = (select auth.uid())
            and membership.status = 'active'
       )
    );
$$;

create function private.save_entry_draft(
  requested_id uuid,
  requested_kind text,
  requested_title text,
  requested_body text,
  requested_audience text,
  requested_circle_ids uuid[],
  requested_journal_person_id uuid,
  requested_tagged_person_ids uuid[],
  requested_place_name text,
  requested_latitude double precision,
  requested_longitude double precision,
  requested_occurred_on date,
  requested_occurred_time text,
  requested_occurred_timezone text,
  requested_media jsonb,
  requested_verse jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  resulting_id uuid;
  existing_id uuid;
  live_count integer;
begin
  if current_user_id is null
    or requested_kind is null
    or requested_audience is null then
    raise exception using
      errcode = '22023',
      message = 'That draft could not be saved.';
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = current_user_id
       and membership.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'That draft could not be saved.';
  end if;

  if not (select private.entry_draft_circles_are_allowed(
    coalesce(requested_circle_ids, '{}')
  )) then
    raise exception using
      errcode = '42501',
      message = 'That draft could not be saved.';
  end if;

  select draft.id
    into existing_id
    from private.entry_drafts as draft
   where draft.id = requested_id
     and draft.user_id = current_user_id;

  if existing_id is null then
    select count(*)::integer
      into live_count
      from private.entry_drafts as draft
     where draft.user_id = current_user_id;
    if live_count >= 20 then
      raise exception using
        errcode = 'P0001',
        message = 'Delete a draft first. You can keep up to 20.';
    end if;

    insert into private.entry_drafts (
      id, user_id, kind, title, body, audience, circle_ids,
      journal_person_id, tagged_person_ids, place_name, latitude, longitude,
      occurred_on, occurred_time, occurred_timezone, media, verse
    ) values (
      coalesce(requested_id, extensions.gen_random_uuid()),
      current_user_id,
      requested_kind,
      coalesce(requested_title, ''),
      coalesce(requested_body, ''),
      requested_audience,
      coalesce(requested_circle_ids, '{}'),
      requested_journal_person_id,
      coalesce(requested_tagged_person_ids, '{}'),
      coalesce(requested_place_name, ''),
      requested_latitude,
      requested_longitude,
      requested_occurred_on,
      requested_occurred_time,
      requested_occurred_timezone,
      coalesce(requested_media, '[]'::jsonb),
      requested_verse
    )
    returning id into resulting_id;
    return resulting_id;
  end if;

  update private.entry_drafts as draft
     set kind = requested_kind,
         title = coalesce(requested_title, ''),
         body = coalesce(requested_body, ''),
         audience = requested_audience,
         circle_ids = coalesce(requested_circle_ids, '{}'),
         journal_person_id = requested_journal_person_id,
         tagged_person_ids = coalesce(requested_tagged_person_ids, '{}'),
         place_name = coalesce(requested_place_name, ''),
         latitude = requested_latitude,
         longitude = requested_longitude,
         occurred_on = requested_occurred_on,
         occurred_time = requested_occurred_time,
         occurred_timezone = requested_occurred_timezone,
         media = coalesce(requested_media, '[]'::jsonb),
         verse = requested_verse,
         updated_at = statement_timestamp()
   where draft.id = existing_id
     and draft.user_id = current_user_id
  returning draft.id into resulting_id;
  return resulting_id;
end;
$$;

create function private.list_entry_drafts()
returns table (
  draft_id uuid,
  kind text,
  preview_text text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    draft.id,
    draft.kind,
    case
      when btrim(draft.title) <> '' then left(btrim(draft.title), 80)
      when btrim(draft.body) <> '' then left(btrim(draft.body), 80)
      when jsonb_array_length(draft.media) > 0 then 'Media attached'
      else ''
    end,
    draft.updated_at
    from private.entry_drafts as draft
   where draft.user_id = (select auth.uid())
   order by draft.updated_at desc, draft.id desc;
$$;

create function private.get_entry_draft(requested_id uuid)
returns table (
  draft_id uuid,
  kind text,
  title text,
  body text,
  audience text,
  circle_ids uuid[],
  journal_person_id uuid,
  tagged_person_ids uuid[],
  place_name text,
  latitude double precision,
  longitude double precision,
  occurred_on date,
  occurred_time text,
  occurred_timezone text,
  media jsonb,
  verse jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    draft.id,
    draft.kind,
    draft.title,
    draft.body,
    draft.audience,
    draft.circle_ids,
    draft.journal_person_id,
    draft.tagged_person_ids,
    draft.place_name,
    draft.latitude,
    draft.longitude,
    draft.occurred_on,
    draft.occurred_time,
    draft.occurred_timezone,
    draft.media,
    draft.verse,
    draft.created_at,
    draft.updated_at
    from private.entry_drafts as draft
   where draft.id = requested_id
     and draft.user_id = (select auth.uid());
$$;

create function private.delete_entry_draft(requested_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  if (select auth.uid()) is null or requested_id is null then
    return false;
  end if;

  delete from private.entry_drafts as draft
   where draft.id = requested_id
     and draft.user_id = (select auth.uid());
  get diagnostics removed = row_count;
  return removed > 0;
end;
$$;

create function private.purge_entry_drafts_on_account_closure()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state = 'prepared' then
    delete from private.entry_drafts
     where user_id = new.auth_user_id;
  end if;
  return new;
end;
$$;

create trigger entry_drafts_purge_on_account_closure
after update of state on private.account_closure_requests
for each row
when (old.state is distinct from new.state and new.state = 'prepared')
execute function private.purge_entry_drafts_on_account_closure();

revoke all on function private.entry_draft_circles_are_allowed(uuid[])
  from public, anon, authenticated;
revoke all on function private.save_entry_draft(
  uuid, text, text, text, text, uuid[], uuid, uuid[], text,
  double precision, double precision, date, text, text, jsonb, jsonb
) from public, anon;
revoke all on function private.list_entry_drafts()
  from public, anon;
revoke all on function private.get_entry_draft(uuid)
  from public, anon;
revoke all on function private.delete_entry_draft(uuid)
  from public, anon;
revoke all on function private.purge_entry_drafts_on_account_closure()
  from public, anon, authenticated;

grant execute on function private.save_entry_draft(
  uuid, text, text, text, text, uuid[], uuid, uuid[], text,
  double precision, double precision, date, text, text, jsonb, jsonb
) to authenticated;
grant execute on function private.list_entry_drafts()
  to authenticated;
grant execute on function private.get_entry_draft(uuid)
  to authenticated;
grant execute on function private.delete_entry_draft(uuid)
  to authenticated;

create function public.save_entry_draft(
  draft_id uuid default null,
  kind text default null,
  title text default '',
  body text default '',
  audience text default 'family',
  circle_ids uuid[] default '{}',
  journal_person_id uuid default null,
  tagged_person_ids uuid[] default '{}',
  place_name text default '',
  latitude double precision default null,
  longitude double precision default null,
  occurred_on date default null,
  occurred_time text default null,
  occurred_timezone text default null,
  media jsonb default '[]'::jsonb,
  verse jsonb default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.save_entry_draft(
    draft_id, kind, title, body, audience, circle_ids, journal_person_id,
    tagged_person_ids, place_name, latitude, longitude, occurred_on,
    occurred_time, occurred_timezone, media, verse
  );
$$;

create function public.list_entry_drafts()
returns table (
  draft_id uuid,
  kind text,
  preview_text text,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_entry_drafts();
$$;

create function public.get_entry_draft(draft_id uuid)
returns table (
  draft_id uuid,
  kind text,
  title text,
  body text,
  audience text,
  circle_ids uuid[],
  journal_person_id uuid,
  tagged_person_ids uuid[],
  place_name text,
  latitude double precision,
  longitude double precision,
  occurred_on date,
  occurred_time text,
  occurred_timezone text,
  media jsonb,
  verse jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.get_entry_draft(draft_id);
$$;

create function public.delete_entry_draft(draft_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.delete_entry_draft(draft_id);
$$;

revoke all on function public.save_entry_draft(
  uuid, text, text, text, text, uuid[], uuid, uuid[], text,
  double precision, double precision, date, text, text, jsonb, jsonb
) from public, anon;
revoke all on function public.list_entry_drafts()
  from public, anon;
revoke all on function public.get_entry_draft(uuid)
  from public, anon;
revoke all on function public.delete_entry_draft(uuid)
  from public, anon;

grant execute on function public.save_entry_draft(
  uuid, text, text, text, text, uuid[], uuid, uuid[], text,
  double precision, double precision, date, text, text, jsonb, jsonb
) to authenticated;
grant execute on function public.list_entry_drafts()
  to authenticated;
grant execute on function public.get_entry_draft(uuid)
  to authenticated;
grant execute on function public.delete_entry_draft(uuid)
  to authenticated;
