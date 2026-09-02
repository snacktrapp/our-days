-- Cleanup is maintenance work, not an end-user upload gate. The previous
-- liability check counted every cancelled or rejected intake until its object
-- cleanup job completed. Because cleanup is intentionally delayed until the
-- resumable-upload URL expires, three ordinary failures could lock a member out
-- of photo posting for more than a day.
--
-- Keep the simultaneous open-work limits that bound active reservations and
-- transfers. Do not make a new transfer depend on delayed cleanup of an older,
-- already-terminal intake.
create or replace function private.enforce_photo_intake_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_user_id uuid;
  account_open_count integer;
  circle_open_count integer;
begin
  if not (
    tg_op = 'INSERT'
    or (
      tg_op = 'UPDATE'
      and old.state = 'reserved'
      and new.state = 'upload_claimed'
    )
  ) then
    return new;
  end if;

  select membership.user_id into requester_user_id
    from public.circle_memberships as membership
   where membership.circle_id = new.circle_id
     and membership.id = new.requested_by_membership_id;
  if requester_user_id is null then
    raise exception using errcode = '42501',
      message = 'PHOTO_REQUESTER_UNAVAILABLE';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = requester_user_id for update;
  perform 1 from public.circles as circle
   where circle.id = new.circle_id for update;

  if tg_op = 'INSERT' then
    select count(*)::integer into account_open_count
      from private.photo_intakes as intake
      join public.circle_memberships as membership
        on membership.circle_id = intake.circle_id
       and membership.id = intake.requested_by_membership_id
     where membership.user_id = requester_user_id
       and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified');
    if account_open_count >= 3 then
      raise exception using errcode = 'P0001',
        message = 'PHOTO_ACCOUNT_OPEN_QUOTA';
    end if;

    select count(*)::integer into circle_open_count
      from private.photo_intakes as intake
     where intake.circle_id = new.circle_id
       and intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified');
    if circle_open_count >= 10 then
      raise exception using errcode = 'P0001',
        message = 'PHOTO_CIRCLE_OPEN_QUOTA';
    end if;
  end if;

  return new;
end;
$$;
