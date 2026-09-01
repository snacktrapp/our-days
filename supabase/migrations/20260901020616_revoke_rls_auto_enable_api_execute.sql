-- Supabase's automatic-RLS event-trigger helper belongs in the public schema,
-- but it is not an application RPC. Keep it owner-executable for the event
-- trigger while preventing Data API roles from invoking it directly.
do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute
      'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$migration$;
