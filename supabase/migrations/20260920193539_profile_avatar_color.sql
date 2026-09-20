-- Keep existing colors valid; new choices use the same person accent field.
alter table public.people drop constraint people_accent_token_valid;
alter table public.people add constraint people_accent_token_valid check (
  accent_token in ('clay', 'sage', 'gold', 'sky', 'plum', 'rose', 'slate',
    'turquoise', 'violet', 'cyan', 'emerald', 'lime', 'coral', 'orange', 'indigo')
);

-- People intentionally have no direct UPDATE grant. This narrow mutation only
-- changes the caller's own active account profiles, never managed/other people.
create function private.set_my_profile_color(color text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Sign in to change your color';
  end if;
  if color is null or color not in ('sky', 'turquoise', 'violet', 'clay', 'gold',
    'slate', 'cyan', 'emerald', 'lime', 'coral', 'orange', 'indigo') then
    raise exception using errcode = '22023', message = 'Choose a profile color';
  end if;
  update public.people p set accent_token = color
  where p.profile_kind = 'account' and exists (
    select 1 from public.circle_memberships m
    where m.person_id = p.id and m.circle_id = p.circle_id
      and m.user_id = auth.uid() and m.status = 'active'
  );
  return found;
end;
$$;
revoke all on function private.set_my_profile_color(text) from public, anon;
grant execute on function private.set_my_profile_color(text) to authenticated;

create function public.set_my_profile_color(color text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.set_my_profile_color(color);
$$;
revoke all on function public.set_my_profile_color(text) from public, anon;
grant execute on function public.set_my_profile_color(text) to authenticated;

-- When joining another circle, inherit the account's current color rather than
-- resetting to the invitation default. Also covers membership reactivation.
create function private.inherit_profile_color()
returns trigger language plpgsql security definer set search_path = '' as $$
declare inherited text;
begin
  if new.status <> 'active' then return new; end if;
  select p.accent_token into inherited
  from public.circle_memberships m join public.people p on p.id = m.person_id
  where m.user_id = new.user_id and m.status = 'active' and m.id <> new.id
  order by p.updated_at desc, p.id limit 1;
  if inherited is not null then
    update public.people set accent_token = inherited
    where id = new.person_id and circle_id = new.circle_id and profile_kind = 'account';
  end if;
  return new;
end;
$$;
revoke all on function private.inherit_profile_color() from public, anon, authenticated;
create trigger membership_inherit_profile_color
after insert or update of status on public.circle_memberships
for each row execute function private.inherit_profile_color();
