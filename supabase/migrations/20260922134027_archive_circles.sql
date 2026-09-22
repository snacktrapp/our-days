-- Archive is reversible and leaves identity, subscriptions and history intact.
alter table public.circles add column archived_at timestamptz;

create function private.set_circle_archived(target_circle_id uuid, archive boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.account_closure_is_blocking(auth.uid()) or archive is null or not exists (
    select 1 from public.circle_memberships m
    where m.circle_id = target_circle_id and m.user_id = auth.uid()
      and m.status = 'active' and m.role = 'organizer'
  ) then
    raise exception using errcode = '42501', message = 'Circle could not be updated';
  end if;
  update public.circles set archived_at = case when archive then coalesce(archived_at, now()) else null end
    where id = target_circle_id;
end;
$$;
revoke all on function private.set_circle_archived(uuid, boolean) from public, anon;
grant execute on function private.set_circle_archived(uuid, boolean) to authenticated;
create function public.set_circle_archived(target_circle_id uuid, archive boolean)
returns void language sql security invoker set search_path = '' as $$
  select private.set_circle_archived(target_circle_id, archive);
$$;
revoke all on function public.set_circle_archived(uuid, boolean) from public, anon;
grant execute on function public.set_circle_archived(uuid, boolean) to authenticated;

-- An already-open composer must not be able to share into an archived circle.
-- Private journal entries retain their storage circle and are unaffected.
create function private.reject_archived_circle_sharing()
returns trigger language plpgsql security definer set search_path = '' as $$
declare archived timestamptz;
begin
  select archived_at into archived from public.circles where id = new.circle_id for share;
  if archived is not null then
    raise exception using errcode = '23514', message = 'This circle is archived. Choose another circle.';
  end if;
  return new;
end;
$$;
revoke all on function private.reject_archived_circle_sharing() from public, anon, authenticated;
create trigger reject_archived_circle_sharing before insert or update of circle_id
  on public.moment_circles for each row execute function private.reject_archived_circle_sharing();
