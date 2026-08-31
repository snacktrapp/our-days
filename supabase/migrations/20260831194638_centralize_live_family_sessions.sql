-- Reject a signed-out or closing account before PostgREST reaches any exposed
-- family table or RPC. Storage is a separate Supabase product and remains
-- protected by the explicit current_family_session_is_live() predicates added
-- to its upload and delivery policies in Phase 4D.

create function private.enforce_live_data_api_session()
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  -- PostgREST invokes this hook after switching from authenticator to the
  -- request's database role. Keep the function security-invoker so
  -- current_user is that authoritative role rather than a function owner.
  if current_user is distinct from 'authenticated' then
    return;
  end if;

  if not (select private.current_family_session_is_live()) then
    raise exception using errcode = '42501',
      message = 'Family session is unavailable';
  end if;
end;
$$;

revoke all on function private.enforce_live_data_api_session()
  from public, anon, authenticated, service_role;
grant execute on function private.enforce_live_data_api_session()
  to anon, authenticated, service_role;

-- Keep the hook database-scoped so a reviewed logical-recovery sidecar can
-- reproduce it on a fresh cluster without changing every project that shares
-- the authenticator role.
do $$
begin
  execute format(
    'alter role authenticator in database %I set pgrst.db_pre_request = %L',
    current_database(),
    'private.enforce_live_data_api_session'
  );
end;
$$;
notify pgrst, 'reload config';

-- The app stages complete moment metadata through reserve_photo_moment. The
-- earlier raw reservation seam could create orphan intakes and is no longer an
-- authenticated API capability.
revoke all on function public.reserve_photo_intake(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
