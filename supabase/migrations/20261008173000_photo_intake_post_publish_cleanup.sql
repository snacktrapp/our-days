-- Delete intake duplicates only after publication is fully verified and linked.
-- This keeps browser uploads write-only while allowing an authenticated
-- requester to trigger safe post-publish intake cleanup.

create or replace function private.cleanup_published_photo_intake(
  requested_intake_id uuid
)
returns table (
  intake_id uuid,
  safe_to_delete boolean,
  bucket_id text,
  object_path text,
  reason text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_intake private.photo_intakes%rowtype;
  target_request private.photo_moment_requests%rowtype;
  has_published_photo boolean := false;
begin
  if current_user_id is null
    or requested_intake_id is null
    or not (select private.current_family_session_is_live()) then
    raise exception using errcode = '42501',
      message = 'Photo intake cleanup is unavailable';
  end if;

  select request.circle_id into target_circle_id
    from private.photo_moment_requests as request
   where request.intake_id = requested_intake_id;

  if target_circle_id is null then
    raise exception using errcode = '42501',
      message = 'Photo intake cleanup is unavailable';
  end if;

  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
     and auth_user.deleted_at is null
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo intake cleanup is unavailable';
  end if;

  perform 1 from public.circles as circle
   where circle.id = target_circle_id
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo intake cleanup is unavailable';
  end if;

  select intake.* into target_intake
    from private.photo_intakes as intake
   where intake.id = requested_intake_id
   for update;

  select request.* into target_request
    from private.photo_moment_requests as request
   where request.circle_id = target_intake.circle_id
     and request.intake_id = target_intake.id
   for update;

  if target_intake.id is null
    or target_request.id is null
    or target_request.requested_by_membership_id is distinct from
      private.current_membership_id(target_request.circle_id)
    or not (select private.can_manage_person(
      target_intake.circle_id,
      target_intake.journal_person_id
    )) then
    raise exception using errcode = '42501',
      message = 'Photo intake cleanup is unavailable';
  end if;

  if target_intake.state <> 'verified' then
    return query select
      target_intake.id,
      false,
      null::text,
      null::text,
      'intake_not_verified'::text;
    return;
  end if;

  select exists (
    select 1
      from private.photo_originals as original
      join private.photo_display_derivatives as derivative
        on derivative.circle_id = original.circle_id
       and derivative.original_id = original.id
      join public.moment_photos as photo
        on photo.circle_id = original.circle_id
       and photo.original_id = original.id
       and photo.display_derivative_id = derivative.id
     where original.intake_id = target_intake.id
       and original.storage_object_id is not null
       and derivative.storage_object_id is not null
  ) into has_published_photo;

  if not has_published_photo then
    return query select
      target_intake.id,
      false,
      null::text,
      null::text,
      'not_published'::text;
    return;
  end if;

  return query select
    target_intake.id,
    true,
    'our-days-intake'::text,
    target_intake.object_path,
    'safe_to_delete'::text;
end;
$$;

create function public.cleanup_published_photo_intake(intake_id uuid)
returns table (
  intake_id uuid,
  safe_to_delete boolean,
  bucket_id text,
  object_path text,
  reason text
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.cleanup_published_photo_intake(intake_id);
$$;

create or replace function private.list_my_photo_intakes(
  requested_circle_id uuid
)
returns table (
  intake_id uuid,
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  occurred_on date,
  status text,
  can_cancel boolean,
  cleanup_state text,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select intake.id,
    request.moment_id,
    intake.journal_person_id,
    person.display_name,
    request.occurred_on,
    case
      when photo.id is not null then 'published_cleanup_pending'
      when intake.state = 'reserved' then 'reserved'
      when intake.state = 'upload_claimed' then 'uploading'
      when intake.state = 'invalidated'
        and intake.invalidation_reason = 'requester_cancelled'
        then 'cancelled_cleanup_pending'
      when intake.state in ('rejected', 'operator_review', 'invalidated')
        or validation.state in ('rejected', 'operator_review', 'invalidated')
        or derivative.state in ('rejected', 'operator_review', 'invalidated')
        then 'needs_attention'
      else 'processing'
    end,
    intake.state in ('reserved', 'upload_claimed')
      and photo.id is null,
    case
      when cleanup.id is not null then cleanup.state
      when intake.upload_claimed_at is null then 'not_required'
      when intake.state in ('verified', 'rejected', 'invalidated')
        then 'awaiting_cleanup_job'
      else 'not_requested'
    end,
    intake.requested_at
  from private.photo_intakes as intake
  join private.photo_moment_requests as request
    on request.circle_id = intake.circle_id
   and request.intake_id = intake.id
  join public.people as person
    on person.circle_id = intake.circle_id
   and person.id = intake.journal_person_id
  left join private.photo_object_cleanup_jobs as cleanup
    on cleanup.circle_id = intake.circle_id
   and cleanup.intake_id = intake.id
  left join private.photo_validation_jobs as validation
    on validation.circle_id = intake.circle_id
   and validation.intake_id = intake.id
  left join private.photo_originals as original
    on original.circle_id = intake.circle_id
   and original.intake_id = intake.id
  left join private.photo_derivative_jobs as derivative
    on derivative.circle_id = intake.circle_id
   and derivative.original_id = original.id
  left join public.moment_photos as photo
    on photo.original_id = original.id
  left join storage.objects as intake_object
    on intake_object.bucket_id = 'our-days-intake'
   and intake_object.name = intake.object_path
  where request.requested_by_membership_id =
      private.current_membership_id(request.circle_id)
    and request.circle_id = requested_circle_id
    and (select private.current_family_session_is_live())
    and (select private.can_manage_person(
      intake.circle_id,
      intake.journal_person_id
    ))
    and (
      intake.state in ('reserved', 'upload_claimed', 'uploaded_unverified')
      or (
        intake.upload_claimed_at is not null
        and coalesce(cleanup.state, '') <> 'completed'
        and (
          photo.id is null
          or intake_object.id is not null
        )
      )
    )
  order by intake.requested_at desc, intake.id;
$$;

revoke all on function private.cleanup_published_photo_intake(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_published_photo_intake(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.cleanup_published_photo_intake(uuid)
  to authenticated;
grant execute on function private.cleanup_published_photo_intake(uuid)
  to authenticated;
