-- Refund a Found search that produced no card. Claims store an id and a
-- timestamp only: no query text. A caller can refund only their own claim,
-- only once, and only within 10 minutes.

create table private.found_search_claims (
  claim_id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  claimed_at timestamp with time zone not null default pg_catalog.statement_timestamp(),
  refunded_at timestamp with time zone,
  constraint found_search_claims_refund_after_claim check (
    refunded_at is null or refunded_at >= claimed_at
  )
);

alter table private.found_search_claims enable row level security;
alter table private.found_search_claims force row level security;

revoke all on table private.found_search_claims
  from public, anon, authenticated, service_role;

-- The original usage table stopped at 10. Live claims now allow 50.
alter table private.found_search_usage
  drop constraint found_search_usage_count_check,
  add constraint found_search_usage_count_check
    check ((count >= 0) and (count <= 50));

create or replace function private.claim_found_search()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  usage_day date := (pg_catalog.timezone('utc', pg_catalog.statement_timestamp()))::date;
  next_count integer := null;
  new_claim_id uuid := null;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in to continue';
  end if;

  insert into private.found_search_usage as usage (user_id, usage_date, count)
  values (current_user_id, usage_day, 1)
  on conflict (user_id, usage_date) do update
    set count = usage.count + 1
    where usage.count < 50
  returning count into next_count;

  if next_count is null then
    return 'capped';
  end if;

  insert into private.found_search_claims (user_id, usage_date)
  values (current_user_id, usage_day)
  returning claim_id into new_claim_id;

  return new_claim_id::text;
end;
$$;

create function private.refund_found_search(claim_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  requested_claim_id uuid := null;
  claim_user_id uuid := null;
  claim_day date := null;
  claim_at timestamp with time zone := null;
  already_refunded timestamp with time zone := null;
  next_count integer := null;
begin
  requested_claim_id := refund_found_search.claim_id;

  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in to continue';
  end if;

  if requested_claim_id is null then
    return 'ignored';
  end if;

  select claims.user_id, claims.usage_date, claims.claimed_at, claims.refunded_at
    into claim_user_id, claim_day, claim_at, already_refunded
    from private.found_search_claims as claims
   where claims.claim_id = requested_claim_id
   for update;

  if claim_user_id is distinct from current_user_id
     or already_refunded is not null
     or claim_at is null
     or claim_at < pg_catalog.statement_timestamp() - interval '10 minutes' then
    return 'ignored';
  end if;

  update private.found_search_usage as usage
     set count = usage.count - 1
   where usage.user_id = current_user_id
     and usage.usage_date = claim_day
     and usage.count > 0
  returning usage.count into next_count;

  if next_count is null then
    return 'ignored';
  end if;

  update private.found_search_claims as claims
     set refunded_at = pg_catalog.statement_timestamp()
   where claims.claim_id = requested_claim_id
     and claims.refunded_at is null;

  return 'refunded';
end;
$$;

create function public.refund_found_search(claim_id uuid)
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.refund_found_search(claim_id);
$$;

revoke all on function private.refund_found_search(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.refund_found_search(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.refund_found_search(uuid) to authenticated;
grant execute on function public.refund_found_search(uuid) to authenticated;
