-- Just me catalog: per-account add-on toggles, Insights delivered only to
-- subscribed Just me journals, and a structured Daily prayer thought payload.
-- New group no-byline Insight posts stop here. Organizer ingest writes a
-- source item and fans out to subscribers.

create table private.just_me_catalog_preferences (
  user_id uuid not null,
  item_id text not null,
  enabled boolean not null default false,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  primary key (user_id, item_id),
  constraint just_me_catalog_item_id_valid check (
    item_id in ('insights.huberman_faith', 'journal.daily_prayer')
  ),
  constraint just_me_catalog_timestamp_order_valid check (
    updated_at >= created_at
  )
);

create table private.insight_source_items (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id text not null,
  quote text not null,
  attribution text not null,
  source_url text,
  published_on date not null,
  created_at timestamptz not null default statement_timestamp(),
  constraint insight_source_items_source_id_valid check (
    source_id in ('insights.huberman_faith')
  ),
  constraint insight_source_items_quote_valid check (
    quote = btrim(quote)
    and char_length(quote) between 1 and 4000
    and quote ~ '[^[:space:]]'
  ),
  constraint insight_source_items_attribution_valid check (
    attribution = btrim(attribution)
    and char_length(attribution) between 1 and 160
  ),
  constraint insight_source_items_source_url_valid check (
    source_url is null
    or (
      source_url = btrim(source_url)
      and char_length(source_url) between 12 and 2000
      and source_url ~ '^https://[^[:space:]<>"]+$'
    )
  )
);

create index insight_source_items_source_published_idx
  on private.insight_source_items (source_id, published_on desc, created_at desc);

create table private.insight_source_deliveries (
  source_item_id uuid not null references private.insight_source_items (id)
    on delete cascade,
  user_id uuid not null,
  moment_id uuid not null references public.moments (id) on delete cascade,
  delivered_at timestamptz not null default statement_timestamp(),
  primary key (source_item_id, user_id)
);

create index insight_source_deliveries_user_idx
  on private.insight_source_deliveries (user_id, delivered_at desc);

alter table private.just_me_catalog_preferences enable row level security;
alter table private.just_me_catalog_preferences force row level security;
alter table private.insight_source_items enable row level security;
alter table private.insight_source_items force row level security;
alter table private.insight_source_deliveries enable row level security;
alter table private.insight_source_deliveries force row level security;

create policy just_me_catalog_preferences_select_own
on private.just_me_catalog_preferences for select to authenticated
using (user_id = (select auth.uid()));

revoke all on table private.just_me_catalog_preferences
  from public, anon, authenticated;
revoke all on table private.insight_source_items
  from public, anon, authenticated;
revoke all on table private.insight_source_deliveries
  from public, anon, authenticated;

alter table public.moments
  drop constraint moments_audience_insight_valid,
  drop constraint moments_journal_person_kind_valid,
  add constraint moments_audience_insight_valid check (
    kind <> 'insight'
    or audience in ('family', 'just_me')
  ),
  add constraint moments_journal_person_kind_valid check (
    (
      kind = 'insight'
      and audience = 'family'
      and journal_person_id is null
    )
    or (
      kind = 'insight'
      and audience = 'just_me'
      and journal_person_id is not null
    )
    or (
      kind <> 'insight'
      and journal_person_id is not null
    )
  );

create unique index moments_one_daily_prayer_per_recorder_day
  on public.moments (recorded_by_membership_id, occurred_on)
  where trashed_at is null
    and body like ('OD:daily-prayer' || chr(10) || '%');

alter table private.entry_drafts
  drop constraint entry_drafts_kind_valid,
  add constraint entry_drafts_kind_valid check (
    kind in (
      'thought',
      'photo',
      'video',
      'bible-verse',
      'milestone',
      'location',
      'daily-prayer'
    )
  );

insert into private.insight_source_items (
  id, source_id, quote, attribution, source_url, published_on
) values
  (
    '70000000-0000-4000-8000-000000000001',
    'insights.huberman_faith',
    'Prayer and gratitude are not only spiritual practices. They are also ways of repeatedly placing your mind on what is good, which changes the state of your nervous system.',
    'Huberman Lab — Faith, Gratitude, and the Brain',
    'https://www.youtube.com/watch?v=nm1TxQj9IsQ',
    '2026-09-01'
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    'insights.huberman_faith',
    'A short morning prayer can become a deliberate sunrise ritual: still the body, name what you are thankful for, and set one intention for how you will treat other people.',
    'Huberman Lab — Morning Light and Spiritual Practice',
    null,
    '2026-09-04'
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    'insights.huberman_faith',
    'Love, generosity, and a feeling of being safe with others are not soft extras. They are biological conditions that help the brain recover and stay open.',
    'Huberman Lab — Social Bonding and the Spirit',
    null,
    '2026-09-07'
  );

create function private.daily_prayer_catalog_is_visible()
returns boolean
language sql
stable
set search_path = ''
as $$
  select lower(coalesce((select auth.jwt() ->> 'email'), ''))
    = 'trappbrian@gmail.com';
$$;

create function private.deliver_insight_source_item_to_user(
  requested_source_item_id uuid,
  requested_user_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item record;
  actor_circle_id uuid;
  actor_membership_id uuid;
  actor_person_id uuid;
  resulting_moment_id uuid;
begin
  if requested_source_item_id is null or requested_user_id is null then
    return null;
  end if;

  select
    source.id,
    source.quote,
    source.attribution,
    source.source_url,
    source.published_on
    into item
    from private.insight_source_items as source
   where source.id = requested_source_item_id;
  if item.id is null then
    return null;
  end if;

  select delivery.moment_id
    into resulting_moment_id
    from private.insight_source_deliveries as delivery
   where delivery.source_item_id = requested_source_item_id
     and delivery.user_id = requested_user_id;
  if resulting_moment_id is not null then
    return resulting_moment_id;
  end if;

  select membership.circle_id, membership.id, membership.person_id
    into actor_circle_id, actor_membership_id, actor_person_id
    from public.circle_memberships as membership
   where membership.user_id = requested_user_id
     and membership.status = 'active'
   order by membership.joined_at
   limit 1;
  if actor_membership_id is null then
    return null;
  end if;

  insert into public.moments (
    circle_id, journal_person_id, recorded_by_membership_id, kind, title, body,
    source_url, occurred_on, time_precision, audience
  ) values (
    actor_circle_id,
    actor_person_id,
    actor_membership_id,
    'insight',
    item.attribution,
    item.quote,
    item.source_url,
    item.published_on,
    'date',
    'just_me'
  )
  returning id into resulting_moment_id;

  insert into private.insight_source_deliveries (
    source_item_id, user_id, moment_id
  ) values (
    requested_source_item_id, requested_user_id, resulting_moment_id
  );

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    actor_circle_id, actor_membership_id, 'moment_created', 'moment',
    resulting_moment_id
  );

  return resulting_moment_id;
exception
  when unique_violation then
    select delivery.moment_id
      into resulting_moment_id
      from private.insight_source_deliveries as delivery
     where delivery.source_item_id = requested_source_item_id
       and delivery.user_id = requested_user_id;
    return resulting_moment_id;
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    return null;
end;
$$;

create function private.deliver_insight_source_to_subscribers(
  requested_source_item_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  subscriber record;
  delivered integer := 0;
begin
  for subscriber in
    select preference.user_id
      from private.just_me_catalog_preferences as preference
     where preference.item_id = 'insights.huberman_faith'
       and preference.enabled
  loop
    if (select private.deliver_insight_source_item_to_user(
      requested_source_item_id, subscriber.user_id
    )) is not null then
      delivered := delivered + 1;
    end if;
  end loop;
  return delivered;
end;
$$;

create function private.deliver_pending_insight_sources_to_user(
  requested_user_id uuid,
  requested_source_id text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  item record;
  delivered integer := 0;
begin
  if requested_user_id is null or requested_source_id is null then
    return 0;
  end if;

  for item in
    select source.id
      from private.insight_source_items as source
     where source.source_id = requested_source_id
       and not exists (
         select 1
           from private.insight_source_deliveries as delivery
          where delivery.source_item_id = source.id
            and delivery.user_id = requested_user_id
       )
     order by source.published_on, source.created_at
  loop
    if (select private.deliver_insight_source_item_to_user(
      item.id, requested_user_id
    )) is not null then
      delivered := delivered + 1;
    end if;
  end loop;
  return delivered;
end;
$$;

create function private.list_just_me_catalog_preferences()
returns table (
  item_id text,
  enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    catalog.item_id,
    coalesce(preference.enabled, false)
    from (
      select 'insights.huberman_faith'::text as item_id
      union all
      select 'journal.daily_prayer'::text as item_id
       where (select private.daily_prayer_catalog_is_visible())
    ) as catalog
    left join private.just_me_catalog_preferences as preference
      on preference.user_id = (select auth.uid())
     and preference.item_id = catalog.item_id
   order by catalog.item_id;
$$;

create function private.set_just_me_catalog_preference(
  requested_item_id text,
  requested_enabled boolean
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_item_id text := nullif(btrim(requested_item_id), '');
begin
  if current_user_id is null
    or normalized_item_id is null
    or requested_enabled is null
    or normalized_item_id not in (
      'insights.huberman_faith', 'journal.daily_prayer'
    ) then
    raise exception using
      errcode = '22023',
      message = 'Catalog preference could not be saved';
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = current_user_id
       and membership.status = 'active'
  ) then
    raise exception using
      errcode = '42501',
      message = 'Catalog preference could not be saved';
  end if;

  if normalized_item_id = 'journal.daily_prayer'
    and not (select private.daily_prayer_catalog_is_visible()) then
    raise exception using
      errcode = '42501',
      message = 'Catalog preference could not be saved';
  end if;

  insert into private.just_me_catalog_preferences (
    user_id, item_id, enabled
  ) values (
    current_user_id, normalized_item_id, requested_enabled
  )
  on conflict (user_id, item_id) do update
    set enabled = excluded.enabled,
        updated_at = statement_timestamp();

  if normalized_item_id = 'insights.huberman_faith'
    and requested_enabled then
    perform private.deliver_pending_insight_sources_to_user(
      current_user_id, 'insights.huberman_faith'
    );
  end if;

  return true;
end;
$$;

create function private.find_daily_prayer_moment(requested_occurred_on date)
returns table (
  moment_id uuid,
  revision bigint,
  body text,
  occurred_on date
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    moment.id,
    moment.revision,
    moment.body,
    moment.occurred_on
    from public.moments as moment
    join public.circle_memberships as membership
      on membership.id = moment.recorded_by_membership_id
   where membership.user_id = (select auth.uid())
     and membership.status = 'active'
     and moment.occurred_on = requested_occurred_on
     and moment.trashed_at is null
     and moment.body like ('OD:daily-prayer' || chr(10) || '%')
   order by moment.updated_at desc, moment.id desc
   limit 1;
$$;

create or replace function private.create_insight_moment(
  requested_circle_id uuid,
  requested_quote text,
  requested_attribution text,
  requested_source_url text default null,
  requested_occurred_on date default null,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_quote text := coalesce(btrim(requested_quote), '');
  normalized_attribution text := nullif(btrim(requested_attribution), '');
  normalized_source_url text := nullif(btrim(requested_source_url), '');
  effective_occurred_on date;
  resulting_item_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.family_moment_payload_is_valid(
      'insight', normalized_attribution, normalized_quote, null
    ))
    or not (select private.insight_source_url_is_valid(normalized_source_url)) then
    raise exception using errcode = '22023', message = 'Insight could not be created';
  end if;

  select circle.time_zone
    into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null
    or circle_time_zone is null
    or not (select private.is_circle_organizer(requested_circle_id)) then
    raise exception using errcode = '42501', message = 'Insight could not be created';
  end if;

  effective_occurred_on := coalesce(
    requested_occurred_on,
    pg_catalog.timezone(circle_time_zone, statement_timestamp())::date
  );

  if effective_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Insight could not be created';
  end if;

  insert into private.insight_source_items (
    source_id, quote, attribution, source_url, published_on
  ) values (
    'insights.huberman_faith',
    normalized_quote,
    normalized_attribution,
    normalized_source_url,
    effective_occurred_on
  )
  returning id into resulting_item_id;

  perform private.deliver_insight_source_to_subscribers(resulting_item_id);
  return resulting_item_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Insight could not be created';
end;
$$;

create function public.list_just_me_catalog_preferences()
returns table (
  item_id text,
  enabled boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.list_just_me_catalog_preferences();
$$;

create function public.set_just_me_catalog_preference(
  item_id text,
  enabled boolean
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.set_just_me_catalog_preference(item_id, enabled);
$$;

create function public.find_daily_prayer_moment(occurred_on date)
returns table (
  moment_id uuid,
  revision bigint,
  body text,
  occurred_on date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.find_daily_prayer_moment(occurred_on);
$$;

revoke all on function private.daily_prayer_catalog_is_visible()
  from public, anon, authenticated;
revoke all on function private.deliver_insight_source_item_to_user(uuid, uuid)
  from public, anon, authenticated;
revoke all on function private.deliver_insight_source_to_subscribers(uuid)
  from public, anon, authenticated;
revoke all on function private.deliver_pending_insight_sources_to_user(uuid, text)
  from public, anon, authenticated;
revoke all on function private.list_just_me_catalog_preferences()
  from public, anon, authenticated;
revoke all on function private.set_just_me_catalog_preference(text, boolean)
  from public, anon, authenticated;
revoke all on function private.find_daily_prayer_moment(date)
  from public, anon, authenticated;

grant execute on function private.list_just_me_catalog_preferences()
  to authenticated;
grant execute on function private.set_just_me_catalog_preference(text, boolean)
  to authenticated;
grant execute on function private.find_daily_prayer_moment(date)
  to authenticated;

revoke all on function public.list_just_me_catalog_preferences()
  from public, anon;
revoke all on function public.set_just_me_catalog_preference(text, boolean)
  from public, anon;
revoke all on function public.find_daily_prayer_moment(date)
  from public, anon;

grant execute on function public.list_just_me_catalog_preferences()
  to authenticated;
grant execute on function public.set_just_me_catalog_preference(text, boolean)
  to authenticated;
grant execute on function public.find_daily_prayer_moment(date)
  to authenticated;
