-- Delay new-post moment pushes until all attached media is ready, with a
-- fallback window so stalled uploads still notify once.

alter table public.moments
  add column moment_push_scheduled_at timestamptz,
  add column moment_push_notified_at timestamptz;

create function private.moment_media_push_is_ready(requested_moment_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select case
        when moment.kind in ('thought', 'location', 'milestone') then true
        when moment.kind = 'video' then exists (
          select 1
            from public.moment_videos as video
           where video.moment_id = requested_moment_id
        )
        when moment.kind = 'photo' then not exists (
          select 1
            from private.photo_moment_requests as request
            join private.photo_intakes as intake
              on intake.id = request.intake_id
            left join private.photo_originals as original
              on original.intake_id = intake.id
            left join public.moment_photos as photo
              on photo.original_id = original.id
           where request.moment_id = requested_moment_id
             and not (
               intake.state = 'invalidated'
               and intake.invalidation_reason = 'requester_cancelled'
             )
             and photo.id is null
             and intake.state not in (
               'rejected', 'operator_review', 'invalidated'
             )
             and not exists (
               select 1
                 from private.photo_validation_jobs as validation
                where validation.intake_id = intake.id
                  and validation.state in (
                    'rejected', 'operator_review', 'invalidated'
                  )
             )
             and not exists (
               select 1
                 from private.photo_originals as failed_original
                 join private.photo_derivative_jobs as derivative
                   on derivative.original_id = failed_original.id
                where failed_original.intake_id = intake.id
                  and derivative.state in (
                    'rejected', 'operator_review', 'invalidated'
                  )
             )
        )
        else true
      end
      from public.moments as moment
     where moment.id = requested_moment_id
       and moment.trashed_at is null
    ),
    false
  );
$$;

create function private.moment_push_delivery_status(requested_moment_id uuid)
returns table (
  already_notified boolean,
  media_ready boolean,
  fallback_elapsed boolean,
  should_send boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  actor_membership_id uuid;
  scheduled_at timestamptz;
  fallback_interval interval := interval '4 minutes';
  ready boolean;
  notified timestamptz;
begin
  if current_user_id is null or requested_moment_id is null then
    return;
  end if;

  select
    moment.circle_id,
    moment.recorded_by_membership_id,
    moment.moment_push_scheduled_at,
    moment.moment_push_notified_at
    into target_circle_id, actor_membership_id, scheduled_at, notified
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.trashed_at is null
     and moment.kind <> 'insight'
     and moment.audience = 'family';

  if target_circle_id is null then
    return;
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.id = actor_membership_id
       and membership.circle_id = target_circle_id
       and membership.user_id = current_user_id
       and membership.status = 'active'
  ) and not (select private.photo_validator_is_allowed(current_user_id)) then
    return;
  end if;

  if scheduled_at is null then
    update public.moments as moment
       set moment_push_scheduled_at = statement_timestamp()
     where moment.id = requested_moment_id
       and moment.moment_push_scheduled_at is null
    returning moment.moment_push_scheduled_at into scheduled_at;
  end if;

  ready := (select private.moment_media_push_is_ready(requested_moment_id));

  return query
  select
    notified is not null,
    ready,
    statement_timestamp() >= coalesce(scheduled_at, statement_timestamp())
      + fallback_interval,
    notified is null
      and (
        ready
        or statement_timestamp() >= coalesce(scheduled_at, statement_timestamp())
          + fallback_interval
      );
end;
$$;

create function private.claim_moment_push_delivery(requested_moment_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  actor_membership_id uuid;
  scheduled_at timestamptz;
  fallback_interval interval := interval '4 minutes';
  ready boolean;
  claimed boolean := false;
begin
  if current_user_id is null or requested_moment_id is null then
    return false;
  end if;

  select
    moment.circle_id,
    moment.recorded_by_membership_id,
    moment.moment_push_scheduled_at
    into target_circle_id, actor_membership_id, scheduled_at
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.trashed_at is null
     and moment.kind <> 'insight'
     and moment.audience = 'family'
     and moment.moment_push_notified_at is null;

  if target_circle_id is null then
    return false;
  end if;

  if not exists (
    select 1
      from public.circle_memberships as membership
     where membership.id = actor_membership_id
       and membership.circle_id = target_circle_id
       and membership.user_id = current_user_id
       and membership.status = 'active'
  ) and not (select private.photo_validator_is_allowed(current_user_id)) then
    return false;
  end if;

  if scheduled_at is null then
    update public.moments as moment
       set moment_push_scheduled_at = statement_timestamp()
     where moment.id = requested_moment_id
       and moment.moment_push_scheduled_at is null
    returning moment.moment_push_scheduled_at into scheduled_at;
  end if;

  ready := (select private.moment_media_push_is_ready(requested_moment_id));

  if not ready
    and statement_timestamp()
      < coalesce(scheduled_at, statement_timestamp()) + fallback_interval then
    return false;
  end if;

  update public.moments as moment
     set moment_push_notified_at = statement_timestamp()
   where moment.id = requested_moment_id
     and moment.moment_push_notified_at is null;

  get diagnostics claimed = row_count;
  return claimed > 0;
end;
$$;

create function public.moment_push_delivery_status(requested_moment_id uuid)
returns table (
  already_notified boolean,
  media_ready boolean,
  fallback_elapsed boolean,
  should_send boolean
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select * from private.moment_push_delivery_status(requested_moment_id);
$$;

create function public.claim_moment_push_delivery(requested_moment_id uuid)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.claim_moment_push_delivery(requested_moment_id);
$$;

revoke all on function private.moment_media_push_is_ready(uuid)
  from public, anon;
revoke all on function private.moment_push_delivery_status(uuid)
  from public, anon;
revoke all on function private.claim_moment_push_delivery(uuid)
  from public, anon;
revoke all on function public.moment_push_delivery_status(uuid)
  from public, anon;
revoke all on function public.claim_moment_push_delivery(uuid)
  from public, anon;

grant execute on function private.moment_media_push_is_ready(uuid) to authenticated;
grant execute on function private.moment_push_delivery_status(uuid) to authenticated;
grant execute on function private.claim_moment_push_delivery(uuid) to authenticated;
grant execute on function public.moment_push_delivery_status(uuid) to authenticated;
grant execute on function public.claim_moment_push_delivery(uuid) to authenticated;
