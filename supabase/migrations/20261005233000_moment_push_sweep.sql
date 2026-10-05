-- Recover photo/video post pushes that the in-request poller abandoned.
-- The applied claim function stored row_count in a boolean, so a successful
-- claim errored (`boolean > integer`) instead of returning true. Replace it
-- in place. A secret-gated sweeper then claims the same way for moments the
-- poller never finished, without a service-role credential in the web app.

create or replace function private.claim_moment_push_delivery(requested_moment_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  actor_membership_id uuid;
  scheduled_at timestamptz;
  fallback_interval interval := interval '4 minutes';
  ready boolean;
  claimed_rows integer := 0;
begin
  if current_user_id is null or requested_moment_id is null then
    return false;
  end if;

  select
    moment.circle_id,
    moment.recorded_by_membership_id,
    moment.moment_push_scheduled_at
    into target_circle_id, actor_membership_id, scheduled_at
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.trashed_at is null
     and moment.kind <> 'insight'
     and moment.audience = 'family'
     and moment.moment_push_notified_at is null;

  if target_circle_id is null then
    return false;
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.id = actor_membership_id
       and membership.circle_id = target_circle_id
       and membership.user_id = current_user_id
       and membership.status = 'active'
  ) and not (select private.photo_validator_is_allowed(current_user_id)) then
    return false;
  end if;

  if scheduled_at is null then
    update public.moments as moment
       set moment_push_scheduled_at = statement_timestamp()
     where moment.id = requested_moment_id
       and moment.moment_push_scheduled_at is null
    returning moment.moment_push_scheduled_at into scheduled_at;
  end if;

  ready := (select private.moment_media_push_is_ready(requested_moment_id));

  if not ready
    and statement_timestamp()
      < coalesce(scheduled_at, statement_timestamp()) + fallback_interval then
    return false;
  end if;

  update public.moments as moment
     set moment_push_notified_at = statement_timestamp()
   where moment.id = requested_moment_id
     and moment.moment_push_notified_at is null;

  get diagnostics claimed_rows = row_count;
  return claimed_rows > 0;
end;
$$;

create index moments_unnotified_push_sweep_idx
  on public.moments (moment_push_scheduled_at, id)
  where moment_push_notified_at is null
    and moment_push_scheduled_at is not null
    and trashed_at is null;

create table private.moment_push_sweep_credential (
  id boolean primary key default true check (id),
  secret_hash bytea not null,
  presented_secret text not null,
  target_url text,
  updated_at timestamptz not null default statement_timestamp(),
  constraint moment_push_sweep_credential_target_url_valid check (
    target_url is null
    or target_url ~ '^https://[A-Za-z0-9.-]+/api/cron/moment-push$'
  )
);

alter table private.moment_push_sweep_credential enable row level security;
alter table private.moment_push_sweep_credential force row level security;

revoke all on table private.moment_push_sweep_credential
  from public, anon, authenticated, service_role;

create function private.replace_moment_push_sweep_secret(
  new_secret text,
  new_target_url text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new_secret is null
    or char_length(new_secret) < 16
    or octet_length(new_secret) > 256 then
    raise exception using
      errcode = '22023',
      message = 'Moment push sweep secret is invalid';
  end if;

  if new_target_url is not null
    and new_target_url !~ '^https://[A-Za-z0-9.-]+/api/cron/moment-push$' then
    raise exception using
      errcode = '22023',
      message = 'Moment push sweep target is invalid';
  end if;

  insert into private.moment_push_sweep_credential as credential (
    id, secret_hash, presented_secret, target_url
  )
  values (
    true,
    extensions.digest(pg_catalog.convert_to(new_secret, 'UTF8'), 'sha256'),
    new_secret,
    new_target_url
  )
  on conflict (id) do update
    set secret_hash = excluded.secret_hash,
        presented_secret = excluded.presented_secret,
        target_url = excluded.target_url,
        updated_at = statement_timestamp();
end;
$$;

-- Public so the cron route can call it with the publishable key. Security
-- definer so that call does not need execute on private helpers. Authorization
-- is the shared CRON_SECRET hash, not the caller role. Until an operator runs
-- private.replace_moment_push_sweep_secret, every call fails closed.
create function public.sweep_due_moment_pushes(
  presented_secret text,
  requested_not_before timestamptz default null,
  requested_limit integer default 10
)
returns table (
  moment_id uuid,
  channel text,
  kind text,
  destination text,
  p256dh text,
  auth text,
  actor_name text,
  moment_kind text,
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
  stored_hash bytea;
  sweep_not_before timestamptz;
  batch_limit integer;
  candidate record;
  claimed boolean;
begin
  if presented_secret is null
    or char_length(presented_secret) < 16
    or octet_length(presented_secret) > 256 then
    raise exception using
      errcode = '42501',
      message = 'Moment push sweep is unavailable';
  end if;

  select credential.secret_hash
    into stored_hash
    from private.moment_push_sweep_credential as credential
   where credential.id;

  if stored_hash is null
    or stored_hash is distinct from extensions.digest(
      pg_catalog.convert_to(presented_secret, 'UTF8'),
      'sha256'
    ) then
    raise exception using
      errcode = '42501',
      message = 'Moment push sweep is unavailable';
  end if;

  -- Floor: nothing scheduled before 2026-10-06 07:00 UTC (midnight Pacific
  -- on 6 Oct 2026) and nothing older than 24 hours. The Oct 5 9:49 AM PT
  -- stuck post is before this floor and must not be sent on deploy.
  sweep_not_before := greatest(
    coalesce(
      requested_not_before,
      timestamptz '2026-10-06 07:00:00+00'
    ),
    timestamptz '2026-10-06 07:00:00+00',
    statement_timestamp() - interval '24 hours'
  );
  batch_limit := least(greatest(coalesce(requested_limit, 10), 1), 20);

  for candidate in
    select
      moment.id as moment_id,
      recorder.user_id as recorder_user_id
      from public.moments as moment
      join public.circle_memberships as recorder
        on recorder.circle_id = moment.circle_id
       and recorder.id = moment.recorded_by_membership_id
     where moment.moment_push_scheduled_at is not null
       and moment.moment_push_notified_at is null
       and moment.moment_push_scheduled_at >= sweep_not_before
       and moment.trashed_at is null
       and moment.kind <> 'insight'
       and moment.audience = 'family'
       and recorder.status = 'active'
       and (
         (select private.moment_media_push_is_ready(moment.id))
         or statement_timestamp()
           >= moment.moment_push_scheduled_at + interval '4 minutes'
       )
     order by moment.moment_push_scheduled_at, moment.id
     limit batch_limit
     for update of moment skip locked
  loop
    perform pg_catalog.set_config(
      'request.jwt.claim.sub',
      candidate.recorder_user_id::text,
      true
    );
    perform pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.json_build_object(
        'sub', candidate.recorder_user_id,
        'role', 'authenticated'
      )::text,
      true
    );

    claimed := private.claim_moment_push_delivery(candidate.moment_id);
    if not claimed then
      continue;
    end if;

    return query
    select
      candidate.moment_id,
      'claimed'::text,
      'moment'::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      null::uuid,
      null::text,
      null::text,
      null::uuid;

    return query
    select
      delivery.moment_id,
      'web'::text,
      'moment'::text,
      delivery.endpoint,
      delivery.p256dh,
      delivery.auth,
      delivery.actor_name,
      delivery.moment_kind,
      delivery.visible_circle_id,
      delivery.circle_name,
      null::text,
      null::uuid
      from private.list_web_push_deliveries(
        'moment',
        candidate.moment_id
      ) as delivery;

    return query
    select
      delivery.moment_id,
      'expo'::text,
      'moment'::text,
      delivery.token,
      null::text,
      null::text,
      delivery.actor_name,
      delivery.moment_kind,
      null::uuid,
      null::text,
      delivery.snippet,
      delivery.note_id
      from private.list_expo_push_deliveries(
        'moment',
        candidate.moment_id,
        null
      ) as delivery;

    return query
    select
      delivery.moment_id,
      'expo'::text,
      'mention'::text,
      delivery.token,
      null::text,
      null::text,
      delivery.actor_name,
      delivery.moment_kind,
      null::uuid,
      null::text,
      delivery.snippet,
      delivery.note_id
      from private.list_expo_push_deliveries(
        'mention',
        candidate.moment_id,
        null
      ) as delivery;

    return query
    select
      delivery.moment_id,
      'web'::text,
      'mention'::text,
      delivery.endpoint,
      delivery.p256dh,
      delivery.auth,
      delivery.actor_name,
      delivery.moment_kind,
      delivery.visible_circle_id,
      delivery.circle_name,
      delivery.snippet,
      delivery.note_id
      from private.claim_mention_push_deliveries(
        candidate.moment_id,
        null
      ) as delivery;
  end loop;

  perform pg_catalog.set_config('request.jwt.claim.sub', '', true);
  perform pg_catalog.set_config('request.jwt.claims', '', true);
end;
$$;

-- Hobby Vercel Cron is daily only, which is too slow for the four-minute
-- media fallback. pg_cron calls the app route every two minutes. Until an
-- operator stores the Production origin, the job returns without calling out.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create function private.invoke_moment_push_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target text;
  secret text;
begin
  select credential.target_url, credential.presented_secret
    into target, secret
    from private.moment_push_sweep_credential as credential
   where credential.id;

  if target is null or secret is null or char_length(secret) < 16 then
    return;
  end if;

  perform net.http_get(
    url => target,
    headers => pg_catalog.jsonb_build_object(
      'Authorization', 'Bearer ' || secret
    ),
    timeout_milliseconds => 20000
  );
end;
$$;

select cron.schedule(
  'moment-push-sweep',
  '*/2 * * * *',
  'select private.invoke_moment_push_sweep()'
);

revoke all on function private.replace_moment_push_sweep_secret(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.invoke_moment_push_sweep()
  from public, anon, authenticated, service_role;
revoke all on function public.sweep_due_moment_pushes(text, timestamptz, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.sweep_due_moment_pushes(text, timestamptz, integer)
  to anon;
