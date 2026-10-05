-- Daily Found search cap. The table stores a counter only: no query text.

create table private.found_search_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  count integer not null,
  primary key (user_id, usage_date),
  constraint found_search_usage_count_check check ((count >= 0) and (count <= 10))
);

alter table private.found_search_usage enable row level security;
alter table private.found_search_usage force row level security;

revoke all on table private.found_search_usage
  from public, anon, authenticated, service_role;

create function private.claim_found_search()
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
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Sign in to continue';
  end if;

  insert into private.found_search_usage as usage (user_id, usage_date, count)
  values (current_user_id, usage_day, 1)
  on conflict (user_id, usage_date) do update
    set count = usage.count + 1
    where usage.count < 10
  returning count into next_count;

  if next_count is null then
    return 'capped';
  end if;
  return 'claimed';
end;
$$;

create function public.claim_found_search()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.claim_found_search();
$$;

revoke all on function private.claim_found_search()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_found_search()
  from public, anon, authenticated, service_role;
grant execute on function private.claim_found_search() to authenticated;
grant execute on function public.claim_found_search() to authenticated;
