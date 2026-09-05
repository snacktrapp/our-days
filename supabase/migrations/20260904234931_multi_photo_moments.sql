-- Multi-photo moments: one photo entry can hold up to six photos that share
-- caption, date, people, place, and audience. Publication still stages one
-- intake per photo and reuses the existing reserve → claim → acknowledge →
-- derivative → publish path.

-- ---------------------------------------------------------------------------
-- moment_photos: many rows per moment
-- ---------------------------------------------------------------------------

alter table public.moment_photos
  add column id uuid,
  add column sort_order integer;

update public.moment_photos
   set id = extensions.gen_random_uuid(),
       sort_order = 0
 where id is null;

alter table public.moment_photos
  alter column id set default extensions.gen_random_uuid(),
  alter column id set not null,
  alter column sort_order set not null,
  alter column sort_order set default 0;

alter table public.moment_photos
  drop constraint moment_photos_pkey,
  drop constraint moment_photos_moment_unique;

alter table public.moment_photos
  add constraint moment_photos_pkey primary key (id),
  add constraint moment_photos_circle_id_id_key unique (circle_id, id),
  add constraint moment_photos_moment_sort_unique unique (moment_id, sort_order)
    deferrable initially immediate,
  add constraint moment_photos_sort_order_valid check (
    sort_order between 0 and 5
  );

-- ---------------------------------------------------------------------------
-- photo_moment_requests: multiple intakes may share one moment_id
-- ---------------------------------------------------------------------------

alter table private.photo_moment_requests
  add column sort_order integer not null default 0;

alter table private.photo_moment_requests
  drop constraint photo_moment_requests_moment_id_key,
  drop constraint photo_moment_requests_circle_moment_key;

alter table private.photo_moment_requests
  add constraint photo_moment_requests_moment_sort_unique
    unique (moment_id, sort_order) deferrable initially immediate,
  add constraint photo_moment_requests_sort_order_valid check (
    sort_order between 0 and 5
  );

-- ---------------------------------------------------------------------------
-- Integrity: identity stays immutable; sort_order and privileged delete
-- ---------------------------------------------------------------------------

create or replace function private.enforce_moment_photo_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.circle_id is distinct from old.circle_id
      or new.moment_id is distinct from old.moment_id
      or new.original_id is distinct from old.original_id
      or new.display_derivative_id is distinct from old.display_derivative_id
      or new.display_width is distinct from old.display_width
      or new.display_height is distinct from old.display_height
      or new.created_at is distinct from old.created_at
    then
      raise exception using errcode = '42501',
        message = 'Photo moment identity is immutable';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if current_setting('our_days.allow_moment_photo_delete', true)
      is distinct from 'on'
    then
      raise exception using errcode = '42501',
        message = 'Photo moment identity is immutable';
    end if;
    return old;
  end if;

  return new;
end;
$$;

create function private.enforce_moment_photo_count()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*)
      from public.moment_photos as photo
     where photo.moment_id = new.moment_id
  ) >= 6 then
    raise exception using errcode = '22023',
      message = 'A photo entry can hold at most 6 photos';
  end if;
  return new;
end;
$$;

create trigger moment_photos_count_limit
before insert on public.moment_photos
for each row execute function private.enforce_moment_photo_count();

-- ---------------------------------------------------------------------------
-- Audience: one moment may have several request rows
-- ---------------------------------------------------------------------------

create or replace function private.apply_media_request_audience()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  requested_audience text;
begin
  if new.kind = 'photo' then
    select request.audience into requested_audience
      from private.photo_moment_requests as request
     where request.circle_id = new.circle_id
       and request.moment_id = new.id
     order by request.sort_order, request.requested_at
     limit 1;
  elsif new.kind = 'video' then
    select request.audience into requested_audience
      from private.video_upload_requests as request
     where request.circle_id = new.circle_id
       and request.moment_id = new.id;
  end if;
  if requested_audience is not null then
    new.audience := requested_audience;
  end if;
  return new;
end;
$$;

drop policy moment_photos_select_live_active_circle on public.moment_photos;

create policy moment_photos_select_live_active_circle
on public.moment_photos for select to authenticated
using (
  (select private.current_family_session_is_live())
  and (select private.is_active_circle_member(circle_id))
  and exists (
    select 1
      from public.moments as moment
     where moment.circle_id = moment_photos.circle_id
       and moment.id = moment_photos.moment_id
       and moment.kind = 'photo'
       and moment.trashed_at is null
       and (select private.can_read_moment_audience(
         moment.circle_id, moment.audience, moment.recorded_by_membership_id
       ))
  )
);

-- ---------------------------------------------------------------------------
-- Publication: add a photo row when the moment already exists
-- ---------------------------------------------------------------------------

create or replace function private.publish_photo_moment_if_ready(
  requested_intake_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_request private.photo_moment_requests%rowtype;
  target_original private.photo_originals%rowtype;
  target_derivative private.photo_display_derivatives%rowtype;
  requester_user_id uuid;
  existing_photo_id uuid;
  existing_moment_id uuid;
begin
  if requested_intake_id is null
    or not (select private.photo_capability_is_enabled(
      'photo_publication'
    )) then
    return null;
  end if;

  select request.* into target_request
    from private.photo_moment_requests as request
   where request.intake_id = requested_intake_id;
  if target_request.id is null then return null; end if;

  perform 1 from public.circles as circle
   where circle.id = target_request.circle_id for update;

  select request.* into target_request
    from private.photo_moment_requests as request
   where request.intake_id = requested_intake_id
     and request.circle_id = target_request.circle_id
   for update;
  if target_request.id is null then return null; end if;

  select photo.id into existing_photo_id
    from public.moment_photos as photo
    join private.photo_originals as original
      on original.id = photo.original_id
   where original.intake_id = requested_intake_id;
  if existing_photo_id is not null then
    return target_request.moment_id;
  end if;

  select membership.user_id into requester_user_id
    from public.circle_memberships as membership
   where membership.circle_id = target_request.circle_id
     and membership.id = target_request.requested_by_membership_id
     and membership.status = 'active'
   for update;

  select original.* into target_original
    from private.photo_originals as original
   where original.intake_id = requested_intake_id
   for update;
  if target_original.id is null then return null; end if;

  select derivative.* into target_derivative
    from private.photo_display_derivatives as derivative
    join private.photo_derivative_jobs as job
      on job.circle_id = derivative.circle_id
     and job.id = derivative.derivative_job_id
     and job.state = 'verified'
   where derivative.original_id = target_original.id
   for update of derivative;
  if target_derivative.id is null then return null; end if;

  if requester_user_id is null
    or target_original.circle_id <> target_request.circle_id
    or target_original.journal_person_id <>
      target_request.journal_person_id
    or target_original.recorded_by_membership_id <>
      target_request.requested_by_membership_id
    or not (select private.photo_intake_requester_is_authorized(
      requested_intake_id
    ))
    or not exists (
      select 1 from storage.objects as object
       where object.bucket_id = target_derivative.bucket_id
         and object.name = target_derivative.object_path
         and object.id = target_derivative.storage_object_id
         and coalesce(object.version, '') =
           target_derivative.storage_object_version
         and object.metadata ->> 'mimetype' =
           target_derivative.output_mime_type
         and object.metadata ->> 'size' =
           target_derivative.output_size_bytes::text
    ) then
    return null;
  end if;

  select moment.id into existing_moment_id
    from public.moments as moment
   where moment.id = target_request.moment_id
     and moment.circle_id = target_request.circle_id
   for update;

  if existing_moment_id is null then
    insert into public.moments (
      id, circle_id, journal_person_id, recorded_by_membership_id, kind, title,
      body, place_name, occurred_on, occurred_at, occurred_timezone,
      time_precision
    ) values (
      target_request.moment_id, target_request.circle_id,
      target_request.journal_person_id,
      target_request.requested_by_membership_id, 'photo', null,
      target_request.body, target_request.place_name,
      target_request.occurred_on, target_request.occurred_at,
      target_request.occurred_timezone, target_request.time_precision
    );

    insert into public.moment_people (
      circle_id, moment_id, person_id, tagged_by_membership_id
    )
    select target_request.circle_id, target_request.moment_id,
      tagged.person_id, target_request.requested_by_membership_id
      from private.photo_moment_request_people as tagged
     where tagged.circle_id = target_request.circle_id
       and tagged.request_id = target_request.id;

    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      target_request.circle_id, target_request.requested_by_membership_id,
      'moment_created', 'moment', target_request.moment_id
    );
  end if;

  insert into public.moment_photos (
    circle_id, moment_id, original_id, display_derivative_id,
    display_width, display_height, sort_order
  ) values (
    target_request.circle_id, target_request.moment_id, target_original.id,
    target_derivative.id, target_derivative.output_width,
    target_derivative.output_height, target_request.sort_order
  );

  return target_request.moment_id;
exception
  when unique_violation then
    select photo.id into existing_photo_id
      from public.moment_photos as photo
      join private.photo_originals as original
        on original.id = photo.original_id
     where original.intake_id = requested_intake_id;
    if existing_photo_id is not null then
      return target_request.moment_id;
    end if;
    select moment.id into existing_moment_id
      from public.moments as moment
     where moment.id = target_request.moment_id;
    if existing_moment_id is not null then
      return existing_moment_id;
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- Status / listing: published means THIS intake's original is linked
-- ---------------------------------------------------------------------------

create or replace function private.get_photo_moment_status(
  requested_intake_id uuid
)
returns table (status text, moment_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select case
      when photo.id is not null then 'published'
      when intake.state = 'invalidated'
        and intake.invalidation_reason = 'requester_cancelled'
        then 'cancelled'
      when intake.state in ('rejected', 'operator_review', 'invalidated')
        or validation.state in ('rejected', 'operator_review', 'invalidated')
        or job.state in ('rejected', 'operator_review', 'invalidated')
        then 'needs_attention'
      when intake.state in ('reserved', 'upload_claimed') then 'uploading'
      else 'processing'
    end,
    coalesce(photo.moment_id, request.moment_id)
  from private.photo_moment_requests as request
  join private.photo_intakes as intake on intake.id = request.intake_id
  left join private.photo_validation_jobs as validation
    on validation.intake_id = intake.id
  left join private.photo_originals as original on original.intake_id = intake.id
  left join private.photo_derivative_jobs as job
    on job.original_id = original.id
  left join public.moment_photos as photo
    on photo.original_id = original.id
  where request.intake_id = requested_intake_id
    and request.requested_by_membership_id =
      private.current_membership_id(request.circle_id)
    and (select private.current_family_session_is_live());
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
      )
    )
  order by intake.requested_at desc, intake.id;
$$;

-- ---------------------------------------------------------------------------
-- Delivery: every photo, ordered, with stable photo id
-- ---------------------------------------------------------------------------

drop function public.get_photo_moment_delivery(uuid);
drop function private.get_photo_moment_delivery(uuid);

create function private.get_photo_moment_delivery(requested_moment_id uuid)
returns table (
  photo_id uuid, sort_order integer,
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select photo.id, photo.sort_order,
    derivative.bucket_id, derivative.object_path,
    derivative.output_mime_type, derivative.output_size_bytes,
    encode(derivative.output_sha256, 'hex'), derivative.output_width,
    derivative.output_height
  from public.moment_photos as photo
  join public.moments as moment
    on moment.circle_id = photo.circle_id and moment.id = photo.moment_id
  join private.photo_display_derivatives as derivative
    on derivative.circle_id = photo.circle_id
   and derivative.id = photo.display_derivative_id
   and derivative.original_id = photo.original_id
  where photo.moment_id = requested_moment_id
    and moment.kind = 'photo' and moment.trashed_at is null
    and (select private.photo_capability_is_enabled(
      'family_derivative_delivery'
    ))
    and (select private.current_family_session_is_live())
    and (select private.is_active_circle_member(photo.circle_id))
    and (select private.can_read_moment_audience(
      moment.circle_id, moment.audience, moment.recorded_by_membership_id
    ))
  order by photo.sort_order, photo.id;
$$;

create function public.get_photo_moment_delivery(moment_id uuid)
returns table (
  photo_id uuid, sort_order integer,
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql stable security invoker set search_path = '' as $$
  select * from private.get_photo_moment_delivery(moment_id);
$$;

-- ---------------------------------------------------------------------------
-- Attach another intake to an existing photo moment
-- ---------------------------------------------------------------------------

create function private.attach_photo_to_moment(
  requested_moment_id uuid,
  requested_request_key uuid
)
returns table (
  intake_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  existing_request private.photo_moment_requests%rowtype;
  published_moment public.moments%rowtype;
  reserved record;
  published_count integer;
  in_flight_count integer;
  next_sort_order integer;
  resulting_request_id uuid;
begin
  if current_user_id is null or requested_moment_id is null
    or requested_request_key is null
    or not (select private.photo_capability_is_enabled(
      'photo_publication'
    )) then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  select request.* into existing_request
    from private.photo_moment_requests as request
   where request.moment_id = requested_moment_id
   order by request.sort_order, request.requested_at
   limit 1;

  select moment.* into published_moment
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.kind = 'photo'
     and moment.trashed_at is null;

  if existing_request.id is null and published_moment.id is null then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  perform 1 from public.circles as circle
   where circle.id = coalesce(
     existing_request.circle_id, published_moment.circle_id
   ) for update;

  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = coalesce(
       existing_request.circle_id, published_moment.circle_id
     )
     and membership.user_id = current_user_id
     and membership.status = 'active' for update;

  if actor_membership_id is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      coalesce(existing_request.circle_id, published_moment.circle_id),
      coalesce(
        existing_request.journal_person_id,
        published_moment.journal_person_id
      )
    )) then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  if existing_request.id is not null
    and existing_request.requested_by_membership_id is distinct from
      actor_membership_id
    and published_moment.id is null then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  select count(*)::integer into published_count
    from public.moment_photos as photo
   where photo.moment_id = requested_moment_id;
  select count(*)::integer into in_flight_count
    from private.photo_moment_requests as request
    left join private.photo_originals as original
      on original.intake_id = request.intake_id
    left join public.moment_photos as photo
      on photo.original_id = original.id
   where request.moment_id = requested_moment_id
     and photo.id is null;
  if published_count + in_flight_count >= 6 then
    raise exception using errcode = '22023',
      message = 'A photo entry can hold at most 6 photos';
  end if;

  select greatest(
    coalesce((
      select max(request.sort_order)
        from private.photo_moment_requests as request
       where request.moment_id = requested_moment_id
    ), -1),
    coalesce((
      select max(photo.sort_order)
        from public.moment_photos as photo
       where photo.moment_id = requested_moment_id
    ), -1)
  ) + 1 into next_sort_order;

  select * into reserved from private.reserve_photo_intake(
    coalesce(existing_request.circle_id, published_moment.circle_id),
    coalesce(
      existing_request.journal_person_id,
      published_moment.journal_person_id
    ),
    requested_request_key
  );

  if exists (
    select 1 from private.photo_moment_requests as request
     where request.intake_id = reserved.intake_id
  ) then
    perform private.publish_photo_moment_if_ready(reserved.intake_id);
    return query select reserved.intake_id, requested_moment_id,
      reserved.bucket_id, reserved.object_path, reserved.state,
      reserved.expires_at;
    return;
  end if;

  insert into private.photo_moment_requests (
    circle_id, intake_id, moment_id, journal_person_id,
    requested_by_membership_id, request_key, body, place_name, occurred_on,
    occurred_at, occurred_timezone, time_precision, request_payload_hash,
    audience, sort_order
  ) values (
    coalesce(existing_request.circle_id, published_moment.circle_id),
    reserved.intake_id,
    requested_moment_id,
    coalesce(
      existing_request.journal_person_id,
      published_moment.journal_person_id
    ),
    actor_membership_id,
    requested_request_key,
    coalesce(existing_request.body, published_moment.body),
    coalesce(existing_request.place_name, published_moment.place_name),
    coalesce(existing_request.occurred_on, published_moment.occurred_on),
    coalesce(existing_request.occurred_at, published_moment.occurred_at),
    coalesce(
      existing_request.occurred_timezone,
      published_moment.occurred_timezone
    ),
    coalesce(existing_request.time_precision, published_moment.time_precision),
    coalesce(
      existing_request.request_payload_hash,
      extensions.digest(jsonb_build_object(
        'circle_id', published_moment.circle_id,
        'journal_person_id', published_moment.journal_person_id,
        'body', published_moment.body,
        'place_name', published_moment.place_name,
        'occurred_on', published_moment.occurred_on,
        'occurred_at', published_moment.occurred_at,
        'occurred_timezone', published_moment.occurred_timezone,
        'audience', published_moment.audience
      )::text, 'sha256')
    ),
    coalesce(existing_request.audience, published_moment.audience, 'family'),
    next_sort_order
  ) returning id into resulting_request_id;

  if existing_request.id is not null then
    insert into private.photo_moment_request_people (
      circle_id, request_id, person_id
    )
    select existing_request.circle_id, resulting_request_id, tagged.person_id
      from private.photo_moment_request_people as tagged
     where tagged.circle_id = existing_request.circle_id
       and tagged.request_id = existing_request.id;
  else
    insert into private.photo_moment_request_people (
      circle_id, request_id, person_id
    )
    select published_moment.circle_id, resulting_request_id, tagged.person_id
      from public.moment_people as tagged
     where tagged.circle_id = published_moment.circle_id
       and tagged.moment_id = published_moment.id
       and tagged.removed_at is null;
  end if;

  perform private.publish_photo_moment_if_ready(reserved.intake_id);
  return query select reserved.intake_id, requested_moment_id,
    reserved.bucket_id, reserved.object_path, reserved.state,
    reserved.expires_at;
end;
$$;

create function public.attach_photo_to_moment(
  existing_moment_id uuid,
  request_key uuid
)
returns table (
  intake_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, expires_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.attach_photo_to_moment(
    existing_moment_id, request_key
  );
$$;

-- ---------------------------------------------------------------------------
-- Reorder and remove published photos
-- ---------------------------------------------------------------------------

create function private.reorder_moment_photos(
  requested_moment_id uuid,
  requested_photo_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_moment public.moments%rowtype;
  expected_ids uuid[];
begin
  if current_user_id is null or requested_moment_id is null
    or requested_photo_ids is null
    or cardinality(requested_photo_ids) < 1
    or cardinality(requested_photo_ids) > 6 then
    raise exception using errcode = '22023',
      message = 'Photos could not be reordered';
  end if;

  select moment.* into target_moment
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.kind = 'photo'
     and moment.trashed_at is null
   for update;
  if target_moment.id is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      target_moment.circle_id, target_moment.journal_person_id
    )) then
    raise exception using errcode = '42501',
      message = 'Photos could not be reordered';
  end if;

  select coalesce(array_agg(photo.id order by photo.id), '{}'::uuid[])
    into expected_ids
    from public.moment_photos as photo
   where photo.moment_id = requested_moment_id;

  if (
    select array_agg(photo_id order by photo_id)
      from unnest(requested_photo_ids) as photo_id
  ) is distinct from expected_ids then
    raise exception using errcode = '22023',
      message = 'Photos could not be reordered';
  end if;

  set constraints public.moment_photos_moment_sort_unique deferred;
  update public.moment_photos as photo
     set sort_order = ordered.ordinality - 1
    from unnest(requested_photo_ids) with ordinality
      as ordered(photo_id, ordinality)
   where photo.id = ordered.photo_id
     and photo.moment_id = requested_moment_id;
end;
$$;

create function public.reorder_moment_photos(
  moment_id uuid,
  photo_ids uuid[]
)
returns void
language sql volatile security invoker set search_path = '' as $$
  select private.reorder_moment_photos(moment_id, photo_ids);
$$;

create function private.remove_moment_photo(
  requested_moment_id uuid,
  requested_photo_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_moment public.moments%rowtype;
  target_photo public.moment_photos%rowtype;
  remaining integer;
  target_original private.photo_originals%rowtype;
  target_derivative private.photo_display_derivatives%rowtype;
begin
  if current_user_id is null or requested_moment_id is null
    or requested_photo_id is null then
    raise exception using errcode = '22023',
      message = 'That photo could not be removed';
  end if;

  select moment.* into target_moment
    from public.moments as moment
   where moment.id = requested_moment_id
     and moment.kind = 'photo'
     and moment.trashed_at is null
   for update;
  if target_moment.id is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      target_moment.circle_id, target_moment.journal_person_id
    )) then
    raise exception using errcode = '42501',
      message = 'That photo could not be removed';
  end if;

  select photo.* into target_photo
    from public.moment_photos as photo
   where photo.id = requested_photo_id
     and photo.moment_id = requested_moment_id
   for update;
  if target_photo.id is null then
    raise exception using errcode = '22023',
      message = 'That photo could not be removed';
  end if;

  select count(*)::integer into remaining
    from public.moment_photos as photo
   where photo.moment_id = requested_moment_id;
  if remaining <= 1 then
    raise exception using errcode = '22023',
      message = 'A photo entry needs at least one photo';
  end if;

  select original.* into target_original
    from private.photo_originals as original
   where original.id = target_photo.original_id;
  select derivative.* into target_derivative
    from private.photo_display_derivatives as derivative
   where derivative.id = target_photo.display_derivative_id;

  perform set_config('our_days.allow_moment_photo_delete', 'on', true);
  delete from public.moment_photos
   where id = target_photo.id
     and moment_id = requested_moment_id;

  if target_derivative.storage_object_id is not null then
    delete from storage.objects as object
     where object.id = target_derivative.storage_object_id
        or (
          object.bucket_id = target_derivative.bucket_id
          and object.name = target_derivative.object_path
        );
  end if;
  if target_original.storage_object_id is not null then
    delete from storage.objects as object
     where object.id = target_original.storage_object_id
        or (
          object.bucket_id = target_original.bucket_id
          and object.name = target_original.object_path
        );
  end if;
end;
$$;

create function public.remove_moment_photo(
  moment_id uuid,
  photo_id uuid
)
returns void
language sql volatile security invoker set search_path = '' as $$
  select private.remove_moment_photo(moment_id, photo_id);
$$;

revoke all on function private.enforce_moment_photo_count(),
  private.attach_photo_to_moment(uuid, uuid),
  private.reorder_moment_photos(uuid, uuid[]),
  private.remove_moment_photo(uuid, uuid),
  private.get_photo_moment_delivery(uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.attach_photo_to_moment(uuid, uuid),
  private.reorder_moment_photos(uuid, uuid[]),
  private.remove_moment_photo(uuid, uuid),
  private.get_photo_moment_delivery(uuid)
  to authenticated;

revoke all on function public.attach_photo_to_moment(uuid, uuid),
  public.reorder_moment_photos(uuid, uuid[]),
  public.remove_moment_photo(uuid, uuid),
  public.get_photo_moment_delivery(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.attach_photo_to_moment(uuid, uuid),
  public.reorder_moment_photos(uuid, uuid[]),
  public.remove_moment_photo(uuid, uuid),
  public.get_photo_moment_delivery(uuid)
  to authenticated;
