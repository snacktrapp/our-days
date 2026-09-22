-- Permit an atomic removal of the three mutually-referencing identity rows.
-- NO ACTION remains enforced at commit; nothing is cascaded or disabled.
alter table public.circles drop constraint circles_created_by_fkey,
  add constraint circles_created_by_fkey foreign key (id, created_by_membership_id)
  references public.circle_memberships(circle_id, id) on delete no action deferrable initially deferred;
alter table public.people drop constraint people_circle_id_fkey,
  add constraint people_circle_id_fkey foreign key (circle_id)
  references public.circles(id) on delete no action deferrable initially deferred;
alter table public.people drop constraint people_created_by_fkey,
  add constraint people_created_by_fkey foreign key (circle_id, created_by_membership_id)
  references public.circle_memberships(circle_id, id) on delete no action deferrable initially deferred;
alter table public.circle_memberships drop constraint circle_memberships_circle_id_fkey,
  add constraint circle_memberships_circle_id_fkey foreign key (circle_id)
  references public.circles(id) on delete no action deferrable initially deferred;
alter table public.circle_memberships drop constraint circle_memberships_person_fkey,
  add constraint circle_memberships_person_fkey foreign key (circle_id, person_id)
  references public.people(circle_id, id) on delete no action deferrable initially deferred;

-- Preserve the existing closure/identity checks verbatim. Only allow removal of
-- an actor's membership AFTER its circle has been removed in this transaction.
-- Authenticated users have no direct DELETE privilege on either table.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.enforce_membership_integrity()'::regprocedure);
  if position('Memberships are retained as history' in definition) = 0 then
    raise exception 'Unexpected membership integrity definition';
  end if;
  definition := replace(definition,
    'if tg_op = ''DELETE'' then',
    'if tg_op = ''DELETE'' then
      if old.user_id = (select auth.uid())
        and not exists (select 1 from public.circles where id = old.circle_id) then
        return old;
      end if;');
  execute definition;
end;
$$;

create function private.delete_empty_circle(target_circle_id uuid, expected_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor uuid := (select auth.uid()); creator uuid;
begin
  if actor is null or private.account_closure_is_blocking(actor) then
    raise exception using errcode = '42501', message = 'Circle could not be deleted';
  end if;
  -- Serialize this actor's deletes so two requests cannot delete their last circles.
  perform pg_advisory_xact_lock(hashtextextended(actor::text, 741));
  select c.created_by_membership_id into creator from public.circles c
    where c.id = target_circle_id and c.name = expected_name for update;
  if creator is null or not exists (
    select 1 from public.circle_memberships m where m.id = creator
      and m.circle_id = target_circle_id and m.user_id = actor
      and m.role = 'organizer' and m.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Circle could not be deleted';
  end if;
  if not exists (select 1 from public.circle_memberships where user_id = actor
    and status = 'active' and circle_id <> target_circle_id) then
    raise exception using errcode = '23514', message = 'Keep at least one circle for your journal';
  end if;
  if (select count(*) from public.circle_memberships where circle_id = target_circle_id) <> 1
    or (select count(*) from public.people where circle_id = target_circle_id) <> 1
    or exists (select 1 from public.moments where circle_id = target_circle_id)
    or exists (select 1 from public.moment_circles where circle_id = target_circle_id)
  then
    raise exception using errcode = '23514', message = 'Only an unused circle with no other people can be deleted';
  end if;
  -- Other history, invitations, uploads and drafts retain their existing FK
  -- restrictions. Any reference aborts the entire operation without data loss.
  delete from public.circles where id = target_circle_id;
  delete from public.people where circle_id = target_circle_id;
  delete from public.circle_memberships where circle_id = target_circle_id;
end;
$$;
create function public.delete_empty_circle(target_circle_id uuid, expected_name text)
returns void language sql security invoker set search_path = '' as $$
  select private.delete_empty_circle(target_circle_id, expected_name);
$$;
revoke all on function private.delete_empty_circle(uuid, text) from public, anon, authenticated;
revoke all on function public.delete_empty_circle(uuid, text) from public, anon, authenticated;
grant execute on function private.delete_empty_circle(uuid, text) to authenticated;
grant execute on function public.delete_empty_circle(uuid, text) to authenticated;
