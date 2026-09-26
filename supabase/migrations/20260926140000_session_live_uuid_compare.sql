-- Recreate private.current_family_session_is_live() from
-- 20260831162840_phase_4d_photo_moment_publication.sql.
-- The indexed uuid primary key is compared to a uuid. A missing or
-- malformed session claim stays not-live, the same as the text compare.

create or replace function private.current_family_session_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from auth.sessions as session
     where session.id = (
       select case
         when pg_catalog.pg_input_is_valid(
           (select auth.jwt() ->> 'session_id'),
           'uuid'
         )
         then (select auth.jwt() ->> 'session_id')::uuid
         else null
       end
     )
       and session.user_id = (select auth.uid())
       and (session.not_after is null
         or session.not_after > statement_timestamp())
  ) and not (select private.account_closure_is_blocking((select auth.uid())));
$$;

revoke all on function private.current_family_session_is_live()
  from public, anon, authenticated, service_role;
grant execute on function private.current_family_session_is_live()
  to authenticated;
