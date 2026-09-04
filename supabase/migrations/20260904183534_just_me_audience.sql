-- Just Me audience: a member can keep a moment on their own personal journal
-- only. Family remains the default. Organizers, Operations, and other members
-- never read someone else's Just Me rows through RLS, timeline, memories,
-- media delivery, or trash listing.

alter table public.moments
  add column audience text not null default 'family';

alter table public.moments
  add constraint moments_audience_valid check (
    audience in ('family', 'just_me')
  ),
  add constraint moments_audience_insight_valid check (
    kind <> 'insight' or audience = 'family'
  );

alter table private.photo_moment_requests
  add column audience text not null default 'family';

alter table private.photo_moment_requests
  add constraint photo_moment_requests_audience_valid check (
    audience in ('family', 'just_me')
  );

alter table private.video_upload_requests
  add column audience text not null default 'family';

alter table private.video_upload_requests
  add constraint video_upload_requests_audience_valid check (
    audience in ('family', 'just_me')
  );

create function private.can_read_moment_audience(
  requested_circle_id uuid,
  requested_audience text,
  requested_recorded_by_membership_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_audience = 'family'
    or exists (
      select 1
        from public.circle_memberships as membership
       where membership.circle_id = requested_circle_id
         and membership.id = requested_recorded_by_membership_id
         and membership.user_id = (select auth.uid())
         and membership.status = 'active'
    );
$$;

create function private.just_me_journal_is_recorder(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_audience text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select requested_audience is distinct from 'just_me'
    or exists (
      select 1
        from public.circle_memberships as membership
       where membership.circle_id = requested_circle_id
         and membership.person_id = requested_journal_person_id
         and membership.user_id = (select auth.uid())
         and membership.status = 'active'
    );
$$;

create function private.apply_media_request_audience()
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
       and request.moment_id = new.id;
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

create trigger moments_apply_media_request_audience
before insert on public.moments
for each row
when (new.kind in ('photo', 'video'))
execute function private.apply_media_request_audience();

drop policy moments_select_live_active_circle on public.moments;

create policy moments_select_live_active_circle
on public.moments for select to authenticated
using (
  trashed_at is null
  and (select private.is_active_circle_member(circle_id))
  and (select private.can_read_moment_audience(
    circle_id, audience, recorded_by_membership_id
  ))
);

revoke all on function private.can_read_moment_audience(uuid, text, uuid)
  from public, anon;
revoke all on function private.just_me_journal_is_recorder(uuid, uuid, text)
  from public, anon;
revoke all on function private.apply_media_request_audience()
  from public, anon, authenticated;
grant execute on function private.can_read_moment_audience(uuid, text, uuid)
  to authenticated;
grant execute on function private.just_me_journal_is_recorder(uuid, uuid, text)
  to authenticated;

drop function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
);

create function public.list_timeline_moments(
  circle_id uuid,
  journal_person_id uuid default null,
  cursor_occurred_on date default null,
  cursor_has_precise_time boolean default null,
  cursor_occurred_at timestamptz default null,
  cursor_moment_id uuid default null,
  page_size integer default 20,
  snapshot_at timestamptz default null
)
returns table (
  moment_id uuid,
  moment_circle_id uuid,
  moment_journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  journal_person_kind text,
  recorder_person_id uuid,
  recorder_person_name text,
  moment_kind text,
  moment_title text,
  body text,
  place_name text,
  tagged_people jsonb,
  occurred_on date,
  occurred_at timestamptz,
  occurred_timezone text,
  time_precision text,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz,
  can_change boolean,
  feed_snapshot_at timestamptz,
  latitude double precision,
  longitude double precision,
  source_url text,
  moment_audience text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  effective_snapshot_at timestamptz := coalesce(
    list_timeline_moments.snapshot_at, statement_timestamp()
  );
  cursor_is_empty boolean :=
    list_timeline_moments.cursor_occurred_on is null
    and list_timeline_moments.cursor_has_precise_time is null
    and list_timeline_moments.cursor_occurred_at is null
    and list_timeline_moments.cursor_moment_id is null;
  cursor_is_complete boolean :=
    list_timeline_moments.cursor_occurred_on is not null
    and list_timeline_moments.cursor_has_precise_time is not null
    and list_timeline_moments.cursor_moment_id is not null
    and (
      (list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is not null)
      or (not list_timeline_moments.cursor_has_precise_time
        and list_timeline_moments.cursor_occurred_at is null)
    );
begin
  if list_timeline_moments.circle_id is null
    or list_timeline_moments.page_size is null
    or list_timeline_moments.page_size not between 1 and 50
    or list_timeline_moments.snapshot_at > statement_timestamp()
    or not (cursor_is_empty or cursor_is_complete) then
    raise exception using errcode = '22023', message = 'Timeline could not be listed';
  end if;

  return query
  select
    moment.id,
    moment.circle_id,
    moment.journal_person_id,
    journal_person.display_name,
    journal_person.accent_token,
    journal_person.profile_kind,
    recorder_membership.person_id,
    recorder_person.display_name,
    moment.kind,
    moment.title,
    moment.body,
    moment.place_name,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tagged_person.id,
        'name', tagged_person.display_name
      ) order by tagged_person.display_name, tagged_person.id)
      from public.moment_people as tag
      join public.people as tagged_person
        on tagged_person.circle_id = tag.circle_id
       and tagged_person.id = tag.person_id
      where tag.circle_id = moment.circle_id and tag.moment_id = moment.id
        and tag.removed_at is null
    ), '[]'::jsonb),
    moment.occurred_on,
    moment.occurred_at,
    moment.occurred_timezone,
    moment.time_precision,
    moment.revision,
    moment.created_at,
    moment.updated_at,
    case
      when moment.kind = 'insight' then
        (select private.is_circle_organizer(moment.circle_id))
      else
        (select private.can_manage_person(moment.circle_id, moment.journal_person_id))
    end,
    effective_snapshot_at,
    moment.latitude,
    moment.longitude,
    moment.source_url,
    moment.audience
  from public.moments as moment
  left join public.people as journal_person
    on journal_person.circle_id = moment.circle_id
   and journal_person.id = moment.journal_person_id
  join public.circle_memberships as recorder_membership
    on recorder_membership.circle_id = moment.circle_id
   and recorder_membership.id = moment.recorded_by_membership_id
  join public.people as recorder_person
    on recorder_person.circle_id = recorder_membership.circle_id
   and recorder_person.id = recorder_membership.person_id
  where moment.circle_id = list_timeline_moments.circle_id
    and moment.trashed_at is null
    and moment.created_at <= effective_snapshot_at
    and moment.updated_at <= effective_snapshot_at
    and (
      case
        when list_timeline_moments.journal_person_id is null then
          moment.audience = 'family'
        else
          moment.journal_person_id = list_timeline_moments.journal_person_id
          and (
            moment.audience = 'family'
            or (
              moment.audience = 'just_me'
              and recorder_membership.user_id = (select auth.uid())
            )
          )
      end
    )
    and (
      cursor_is_empty
      or (
        moment.occurred_on,
        moment.occurred_at is not null,
        coalesce(moment.occurred_at, '-infinity'::timestamptz),
        moment.id
      ) < (
        list_timeline_moments.cursor_occurred_on,
        list_timeline_moments.cursor_has_precise_time,
        coalesce(list_timeline_moments.cursor_occurred_at, '-infinity'::timestamptz),
        list_timeline_moments.cursor_moment_id
      )
    )
  order by moment.occurred_on desc, moment.occurred_at desc nulls last,
    moment.id desc
  limit list_timeline_moments.page_size;
end;
$$;

revoke all on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) from public, anon;
grant execute on function public.list_timeline_moments(
  uuid, uuid, date, boolean, timestamptz, uuid, integer, timestamptz
) to authenticated;

do $migration$
declare
  target_function regprocedure;
  target_name name;
  existing_definition text;
  updated_definition text;
  legacy constant text := 'and moment.trashed_at is null';
  replacement constant text :=
    'and moment.trashed_at is null' || chr(10)
    || '    and moment.audience = ''family''';
  expected_occurrences integer;
  legacy_occurrences integer;
begin
  foreach target_function in array array[
    'public.list_memory_moments(uuid,integer,integer,integer,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure,
    'public.list_milestone_memories(uuid,date,boolean,timestamp with time zone,uuid,integer,timestamp with time zone)'::regprocedure,
    'public.list_memory_years(uuid,integer,integer)'::regprocedure
  ]
  loop
    select pg_catalog.pg_get_functiondef(target_function::oid)
      into existing_definition;
    select procedure.proname
      into target_name
      from pg_catalog.pg_proc as procedure
     where procedure.oid = target_function::oid;
    expected_occurrences := case target_name
      when 'list_memory_moments' then 2
      when 'list_milestone_memories' then 1
      when 'list_memory_years' then 1
      else 0
    end;
    legacy_occurrences := (
      pg_catalog.char_length(existing_definition)
      - pg_catalog.char_length(
        pg_catalog.replace(existing_definition, legacy, '')
      )
    ) / pg_catalog.char_length(legacy);
    if legacy_occurrences <> expected_occurrences then
      raise exception using
        errcode = '55000',
        message = 'Memory audience filter occurrence count drifted';
    end if;
    updated_definition := pg_catalog.replace(
      existing_definition, legacy, replacement
    );
    execute updated_definition;
  end loop;
end;
$migration$;

create or replace function private.list_manageable_trashed_written_moments(
  requested_circle_id uuid
)
returns table (
  moment_id uuid,
  journal_person_id uuid,
  journal_person_name text,
  journal_person_accent text,
  moment_kind text,
  moment_title text,
  body text,
  place_name text,
  occurred_on date,
  revision bigint,
  trashed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    moment.id,
    moment.journal_person_id,
    person.display_name,
    person.accent_token,
    moment.kind,
    moment.title,
    moment.body,
    moment.place_name,
    moment.occurred_on,
    moment.revision,
    moment.trashed_at
  from public.moments as moment
  left join public.people as person
    on person.circle_id = moment.circle_id
   and person.id = moment.journal_person_id
  where moment.circle_id = requested_circle_id
    and moment.trashed_at is not null
    and (select private.is_active_circle_member(requested_circle_id))
    and (
      moment.audience = 'family'
      or (select private.can_read_moment_audience(
        moment.circle_id, moment.audience, moment.recorded_by_membership_id
      ))
    )
    and (
      (
        moment.kind = 'insight'
        and (select private.is_circle_organizer(requested_circle_id))
      )
      or (
        moment.kind <> 'insight'
        and (select private.can_manage_person(
          moment.circle_id, moment.journal_person_id
        ))
      )
    )
  order by moment.trashed_at desc, moment.id desc;
$$;

create or replace function private.get_photo_moment_delivery(requested_moment_id uuid)
returns table (
  bucket_id text, object_path text, output_mime_type text,
  output_size_bytes bigint, output_sha256_hex text,
  output_width integer, output_height integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select derivative.bucket_id, derivative.object_path,
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
    ));
$$;

create or replace function private.photo_display_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.photo_derivative_jobs as job
    join private.photo_originals as original on original.id = job.original_id
    where job.display_object_path = requested_object_path
      and job.state = 'leased'
      and job.validator_auth_user_id = (select auth.uid())
      and job.lease_expires_at > statement_timestamp()
      and (select private.photo_validator_is_allowed((select auth.uid())))
      and (select private.photo_intake_requester_is_authorized(
        original.intake_id
      ))
  ) or exists (
    select 1 from public.moment_photos as photo
    join public.moments as moment
      on moment.circle_id = photo.circle_id and moment.id = photo.moment_id
    join private.photo_display_derivatives as derivative
      on derivative.circle_id = photo.circle_id
     and derivative.id = photo.display_derivative_id
     and derivative.original_id = photo.original_id
    where derivative.object_path = requested_object_path
      and moment.kind = 'photo' and moment.trashed_at is null
      and (select private.photo_capability_is_enabled(
        'family_derivative_delivery'
      ))
      and (select private.current_family_session_is_live())
      and (select private.is_active_circle_member(photo.circle_id))
      and (select private.can_read_moment_audience(
        moment.circle_id, moment.audience, moment.recorded_by_membership_id
      ))
  );
$$;

create or replace function private.get_video_moment_delivery(requested_moment_id uuid)
returns table (
  bucket_id text, object_path text, mime_type text, size_bytes bigint,
  duration_ms integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select video.bucket_id, video.object_path, video.mime_type,
    video.size_bytes, video.duration_ms
  from public.moment_videos as video
  join public.moments as moment
    on moment.circle_id = video.circle_id and moment.id = video.moment_id
  join storage.objects as object
    on object.bucket_id = video.bucket_id
   and object.name = video.object_path
   and object.id = video.storage_object_id
   and coalesce(object.version, '') = video.storage_object_version
  where video.moment_id = requested_moment_id
    and moment.kind = 'video' and moment.trashed_at is null
    and (select private.current_family_session_is_live())
    and (select private.is_active_circle_member(video.circle_id))
    and (select private.can_read_moment_audience(
      moment.circle_id, moment.audience, moment.recorded_by_membership_id
    ))
    and object.metadata ->> 'mimetype' = video.mime_type
    and object.metadata ->> 'size' = video.size_bytes::text;
$$;

create or replace function private.video_object_path_is_readable(
  requested_object_path text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.moment_videos as video
      join public.moments as moment
        on moment.circle_id = video.circle_id
       and moment.id = video.moment_id
     where video.object_path = requested_object_path
       and moment.kind = 'video' and moment.trashed_at is null
       and (select private.current_family_session_is_live())
       and (select private.is_active_circle_member(video.circle_id))
       and (select private.can_read_moment_audience(
         moment.circle_id, moment.audience, moment.recorded_by_membership_id
       ))
  );
$$;

create or replace function private.create_moment_note(
  target_moment_id uuid,
  requested_body text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_audience text;
  target_recorded_by_membership_id uuid;
  actor_membership_id uuid;
  normalized_body text := btrim(requested_body);
  resulting_note_id uuid;
begin
  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select moment.audience, moment.recorded_by_membership_id
    into target_audience, target_recorded_by_membership_id
    from public.moments as moment
   where moment.id = target_moment_id and moment.circle_id = target_circle_id
     and moment.trashed_at is null
   for key share;
  if not found then
    raise exception using errcode = '42501', message = 'Note could not be saved';
  end if;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null or normalized_body is null
    or char_length(normalized_body) not between 1 and 1000
    or normalized_body !~ '[^[:space:]]'
    or (
      target_audience = 'just_me'
      and target_recorded_by_membership_id is distinct from actor_membership_id
    ) then
    raise exception using errcode = '42501', message = 'Note could not be saved';
  end if;
  insert into public.moment_notes (
    circle_id, moment_id, author_membership_id, body
  ) values (
    target_circle_id, target_moment_id, actor_membership_id, normalized_body
  ) returning id into resulting_note_id;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_note_created', 'moment_note',
    resulting_note_id
  );
  return resulting_note_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value then
    raise exception using errcode = '22023', message = 'Note could not be saved';
end;
$$;

create or replace function private.set_moment_reaction(
  target_moment_id uuid,
  requested_reaction_type text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_audience text;
  target_recorded_by_membership_id uuid;
  actor_membership_id uuid;
  resulting_revision bigint;
  reaction_subject_id uuid;
  existing_removed_at timestamptz;
begin
  if requested_reaction_type is not null
    and requested_reaction_type not in (
      'held-close', 'made-me-smile', 'remember-this'
    ) then
    raise exception using errcode = '22023', message = 'Response could not be saved';
  end if;
  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;
  perform 1 from public.circles where id = target_circle_id for update;
  select moment.audience, moment.recorded_by_membership_id
    into target_audience, target_recorded_by_membership_id
    from public.moments as moment
   where moment.id = target_moment_id and moment.circle_id = target_circle_id
     and moment.trashed_at is null
   for key share;
  if not found then
    raise exception using errcode = '42501', message = 'Response could not be saved';
  end if;
  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';
  if actor_membership_id is null
    or (
      target_audience = 'just_me'
      and target_recorded_by_membership_id is distinct from actor_membership_id
    ) then
    raise exception using errcode = '42501', message = 'Response could not be saved';
  end if;
  if requested_reaction_type is null then
    select reaction.id, reaction.revision, reaction.removed_at
      into reaction_subject_id, resulting_revision, existing_removed_at
      from public.moment_reactions as reaction
     where reaction.circle_id = target_circle_id
       and reaction.moment_id = target_moment_id
       and reaction.author_membership_id = actor_membership_id
     for update;
    if reaction_subject_id is null or existing_removed_at is not null then
      return coalesce(resulting_revision, 0);
    end if;
    update public.moment_reactions
       set removed_at = statement_timestamp()
     where id = reaction_subject_id
    returning revision into resulting_revision;
  else
    insert into public.moment_reactions (
      circle_id, moment_id, author_membership_id, reaction_type, removed_at
    ) values (
      target_circle_id, target_moment_id, actor_membership_id,
      requested_reaction_type, null
    )
    on conflict (circle_id, moment_id, author_membership_id) do update
    set reaction_type = requested_reaction_type,
        removed_at = null
    returning id, revision into reaction_subject_id, resulting_revision;
  end if;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id,
    case when requested_reaction_type is null
      then 'moment_reaction_removed' else 'moment_reaction_set' end,
    'moment_reaction', reaction_subject_id
  );
  return resulting_revision;
end;
$$;

drop function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
);
drop function private.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
);
drop function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
);
drop function private.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision
);
drop function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text
);
drop function private.create_written_moment(
  uuid, uuid, text, date, timestamptz, text
);
drop function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid
);
drop function private.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid
);
drop function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid
);
drop function private.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid
);

create function private.create_family_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_kind text,
  requested_title text,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_audience text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_title text := nullif(btrim(requested_title), '');
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[] := coalesce(requested_tagged_person_ids, '{}'::uuid[]);
  normalized_audience text := coalesce(requested_audience, 'family');
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_journal_person_id is null
    or requested_occurred_on is null
    or requested_kind in ('photo', 'video', 'insight')
    or normalized_audience not in ('family', 'just_me')
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.family_moment_payload_is_valid(
      requested_kind, normalized_title, normalized_body, normalized_place_name
    ))
    or not (select private.coordinates_are_valid(
      requested_latitude, requested_longitude
    )) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  select circle.time_zone
    into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active';

  if actor_membership_id is null
    or circle_time_zone is null
    or not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be created';
  end if;

  if normalized_audience = 'just_me' then
    normalized_tags := '{}'::uuid[];
  end if;

  if not (select private.tags_are_valid(
      requested_circle_id, requested_journal_person_id, normalized_tags
    ))
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  insert into public.moments (
    circle_id, journal_person_id, recorded_by_membership_id, kind, title, body,
    place_name, latitude, longitude, occurred_on, occurred_at, occurred_timezone,
    time_precision, audience
  ) values (
    requested_circle_id, requested_journal_person_id, actor_membership_id,
    requested_kind, normalized_title, normalized_body, normalized_place_name,
    requested_latitude, requested_longitude, requested_occurred_on,
    requested_occurred_at, requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    normalized_audience
  ) returning id into resulting_moment_id;

  insert into public.moment_people (
    circle_id, moment_id, person_id, tagged_by_membership_id
  )
  select requested_circle_id, resulting_moment_id, tagged.person_id,
    actor_membership_id
  from unnest(normalized_tags) as tagged(person_id);

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    requested_circle_id, actor_membership_id, 'moment_created', 'moment',
    resulting_moment_id
  );
  return resulting_moment_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be created';
end;
$$;

create function private.update_family_moment(
  target_moment_id uuid,
  expected_revision bigint,
  requested_title text,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_latitude double precision default null,
  requested_longitude double precision default null,
  requested_audience text default null
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target_circle_id uuid;
  target_journal_person_id uuid;
  target_kind text;
  target_revision bigint;
  target_audience text;
  circle_time_zone text;
  actor_membership_id uuid;
  normalized_title text := nullif(btrim(requested_title), '');
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[] := coalesce(requested_tagged_person_ids, '{}'::uuid[]);
  normalized_audience text;
  resulting_revision bigint;
begin
  if current_user_id is null or target_moment_id is null
    or expected_revision is null or expected_revision < 1
    or requested_occurred_on is null
    or (
      requested_audience is not null
      and requested_audience not in ('family', 'just_me')
    )
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null))
    or not (select private.coordinates_are_valid(
      requested_latitude, requested_longitude
    )) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  select moment.circle_id into target_circle_id
  from public.moments as moment where moment.id = target_moment_id;

  select circle.time_zone into circle_time_zone
  from public.circles as circle where circle.id = target_circle_id for update;

  select moment.journal_person_id, moment.kind, moment.revision, moment.audience
    into target_journal_person_id, target_kind, target_revision, target_audience
  from public.moments as moment
  where moment.id = target_moment_id
    and moment.circle_id = target_circle_id
    and moment.trashed_at is null
  for update;

  normalized_audience := coalesce(requested_audience, target_audience, 'family');

  select membership.id into actor_membership_id
  from public.circle_memberships as membership
  where membership.circle_id = target_circle_id
    and membership.user_id = current_user_id
    and membership.status = 'active';

  if actor_membership_id is null or circle_time_zone is null
    or target_journal_person_id is null
    or target_kind = 'insight'
    or not (select private.can_manage_person(
      target_circle_id, target_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      target_circle_id, target_journal_person_id, normalized_audience
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be changed';
  end if;
  if target_revision <> expected_revision then
    raise exception using errcode = '40001', message = 'Moment changed elsewhere';
  end if;
  if normalized_audience = 'just_me' then
    normalized_tags := '{}'::uuid[];
  end if;
  if not (select private.family_moment_payload_is_valid(
      target_kind, normalized_title, normalized_body, normalized_place_name
    ))
    or not (select private.tags_are_valid(
      target_circle_id, target_journal_person_id, normalized_tags
    ))
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1 from pg_catalog.pg_timezone_names as zone
        where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
  end if;

  update public.moments
  set title = normalized_title,
      body = normalized_body,
      place_name = normalized_place_name,
      latitude = requested_latitude,
      longitude = requested_longitude,
      occurred_on = requested_occurred_on,
      occurred_at = requested_occurred_at,
      occurred_timezone = requested_occurred_timezone,
      time_precision = case when requested_occurred_at is null then 'date' else 'minute' end,
      audience = normalized_audience
  where id = target_moment_id
  returning revision into resulting_revision;

  update public.moment_people
  set removed_at = statement_timestamp()
  where moment_id = target_moment_id
    and removed_at is null
    and not (person_id = any(normalized_tags));
  insert into public.moment_people (
    circle_id, moment_id, person_id, tagged_by_membership_id
  )
  select target_circle_id, target_moment_id, tagged.person_id,
    actor_membership_id
  from unnest(normalized_tags) as tagged(person_id)
  on conflict (circle_id, moment_id, person_id) do update
    set removed_at = null;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target_circle_id, actor_membership_id, 'moment_updated', 'moment',
    target_moment_id
  );
  return resulting_revision;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be changed';
end;
$$;

create function private.create_written_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_audience text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_body text := btrim(requested_body);
  normalized_audience text := coalesce(requested_audience, 'family');
  resulting_moment_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_journal_person_id is null
    or requested_occurred_on is null
    or normalized_body is null
    or char_length(normalized_body) not between 1 and 4000
    or normalized_body !~ '[^[:space:]]'
    or normalized_audience not in ('family', 'just_me')
    or ((requested_occurred_at is null) <> (requested_occurred_timezone is null)) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  select circle.time_zone
    into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active';

  if actor_membership_id is null
    or circle_time_zone is null
    or not (select private.can_manage_person(
      requested_circle_id,
      requested_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
    )) then
    raise exception using errcode = '42501', message = 'Moment could not be created';
  end if;

  if requested_occurred_on > pg_catalog.timezone(
      circle_time_zone,
      statement_timestamp()
    )::date
    or (
      requested_occurred_timezone is not null
      and not exists (
        select 1
          from pg_catalog.pg_timezone_names as zone
         where zone.name = requested_occurred_timezone
      )
    ) then
    raise exception using errcode = '22023', message = 'Moment could not be created';
  end if;

  insert into public.moments (
    circle_id,
    journal_person_id,
    recorded_by_membership_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    time_precision,
    audience
  ) values (
    requested_circle_id,
    requested_journal_person_id,
    actor_membership_id,
    normalized_body,
    requested_occurred_on,
    requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    normalized_audience
  )
  returning id into resulting_moment_id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  ) values (
    requested_circle_id,
    actor_membership_id,
    'moment_created',
    'moment',
    resulting_moment_id
  );

  return resulting_moment_id;
exception
  when check_violation or foreign_key_violation or invalid_parameter_value
    or datetime_field_overflow then
    raise exception using errcode = '22023', message = 'Moment could not be created';
end;
$$;

create function private.reserve_photo_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_request_key uuid default null,
  requested_audience text default null
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
  circle_time_zone text;
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_tags uuid[];
  normalized_audience text := coalesce(requested_audience, 'family');
  payload_hash bytea;
  reserved record;
  existing_request private.photo_moment_requests%rowtype;
  resulting_request_id uuid;
  resulting_moment_id uuid;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_journal_person_id is null or requested_occurred_on is null
    or requested_request_key is null
    or normalized_audience not in ('family', 'just_me')
    or not (select private.photo_capability_is_enabled(
      'photo_publication'
    ))
    or ((requested_occurred_at is null) <>
      (requested_occurred_timezone is null)) then
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

  select coalesce(array_agg(tagged.person_id order by tagged.person_id),
      '{}'::uuid[])
    into normalized_tags
    from unnest(coalesce(
      requested_tagged_person_ids, '{}'::uuid[]
    )) as tagged(person_id);

  select circle.time_zone into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id for update;
  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active' for update;

  if normalized_audience = 'just_me' then
    normalized_tags := '{}'::uuid[];
  end if;

  if actor_membership_id is null or circle_time_zone is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
    ))
    or not (select private.tags_are_valid(
      requested_circle_id, requested_journal_person_id, normalized_tags
    ))
    or char_length(normalized_body) > 4000
    or (normalized_place_name is not null
      and char_length(normalized_place_name) not between 1 and 160)
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (requested_occurred_timezone is not null and not exists (
      select 1 from pg_catalog.pg_timezone_names as zone
       where zone.name = requested_occurred_timezone
    )) then
    raise exception using errcode = '42501',
      message = 'Photo moment could not be reserved';
  end if;

  payload_hash := extensions.digest(jsonb_build_object(
    'circle_id', requested_circle_id,
    'journal_person_id', requested_journal_person_id,
    'body', normalized_body,
    'place_name', normalized_place_name,
    'tagged_person_ids', to_jsonb(normalized_tags),
    'occurred_on', requested_occurred_on,
    'occurred_at', requested_occurred_at,
    'occurred_timezone', requested_occurred_timezone,
    'audience', normalized_audience
  )::text, 'sha256');

  select * into reserved from private.reserve_photo_intake(
    requested_circle_id, requested_journal_person_id, requested_request_key
  );

  select request.* into existing_request
    from private.photo_moment_requests as request
   where request.intake_id = reserved.intake_id;
  if existing_request.id is not null then
    if existing_request.request_payload_hash <> payload_hash
      or existing_request.requested_by_membership_id <>
        actor_membership_id then
      raise exception using errcode = '22023',
        message = 'Photo moment could not be reserved';
    end if;
    perform private.publish_photo_moment_if_ready(reserved.intake_id);
    return query select reserved.intake_id, existing_request.moment_id,
      reserved.bucket_id, reserved.object_path, reserved.state,
      reserved.expires_at;
    return;
  end if;

  insert into private.photo_moment_requests (
    circle_id, intake_id, journal_person_id, requested_by_membership_id,
    request_key, body, place_name, occurred_on, occurred_at,
    occurred_timezone, time_precision, request_payload_hash, audience
  ) values (
    requested_circle_id, reserved.intake_id, requested_journal_person_id,
    actor_membership_id, requested_request_key, normalized_body,
    normalized_place_name, requested_occurred_on, requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    payload_hash, normalized_audience
  ) returning id, photo_moment_requests.moment_id
      into resulting_request_id, resulting_moment_id;

  insert into private.photo_moment_request_people (
    circle_id, request_id, person_id
  )
  select requested_circle_id, resulting_request_id, tagged.person_id
    from unnest(normalized_tags) as tagged(person_id);

  perform private.publish_photo_moment_if_ready(reserved.intake_id);
  return query select reserved.intake_id, resulting_moment_id,
    reserved.bucket_id, reserved.object_path, reserved.state,
    reserved.expires_at;
end;
$$;

create function private.reserve_video_moment(
  requested_circle_id uuid,
  requested_journal_person_id uuid,
  requested_body text,
  requested_place_name text,
  requested_tagged_person_ids uuid[],
  requested_occurred_on date,
  requested_expected_mime_type text,
  requested_expected_size_bytes bigint,
  requested_duration_ms integer,
  requested_occurred_at timestamptz default null,
  requested_occurred_timezone text default null,
  requested_request_key uuid default null,
  requested_audience text default null
)
returns table (
  request_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, upload_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  actor_membership_id uuid;
  circle_time_zone text;
  normalized_body text := coalesce(btrim(requested_body), '');
  normalized_place_name text := nullif(btrim(requested_place_name), '');
  normalized_mime_type text := lower(btrim(requested_expected_mime_type));
  normalized_tags uuid[];
  normalized_audience text := coalesce(requested_audience, 'family');
  payload_hash bytea;
  existing private.video_upload_requests%rowtype;
  generated_request_id uuid;
  created private.video_upload_requests%rowtype;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_journal_person_id is null or requested_occurred_on is null
    or requested_request_key is null
    or normalized_audience not in ('family', 'just_me')
    or normalized_mime_type not in (
      'video/mp4', 'video/quicktime', 'video/x-m4v', 'video/webm'
    )
    or requested_expected_size_bytes is null
    or requested_expected_size_bytes not between 1 and 104857600
    or requested_duration_ms is null
    or requested_duration_ms not between 1 and 60500
    or ((requested_occurred_at is null) <>
      (requested_occurred_timezone is null)) then
    raise exception using errcode = '22023',
      message = 'Video moment could not be prepared';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Video moment could not be prepared';
  end if;

  select coalesce(array_agg(tagged.person_id order by tagged.person_id),
      '{}'::uuid[])
    into normalized_tags
    from unnest(coalesce(
      requested_tagged_person_ids, '{}'::uuid[]
    )) as tagged(person_id);

  select circle.time_zone into circle_time_zone
    from public.circles as circle
   where circle.id = requested_circle_id for update;
  select membership.id into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active' for update;

  if normalized_audience = 'just_me' then
    normalized_tags := '{}'::uuid[];
  end if;

  if actor_membership_id is null or circle_time_zone is null
    or not (select private.current_family_session_is_live())
    or not (select private.can_manage_person(
      requested_circle_id, requested_journal_person_id
    ))
    or not (select private.just_me_journal_is_recorder(
      requested_circle_id, requested_journal_person_id, normalized_audience
    ))
    or not (select private.tags_are_valid(
      requested_circle_id, requested_journal_person_id, normalized_tags
    ))
    or char_length(normalized_body) > 4000
    or (normalized_place_name is not null
      and char_length(normalized_place_name) not between 1 and 160)
    or requested_occurred_on > pg_catalog.timezone(
      circle_time_zone, statement_timestamp()
    )::date
    or (requested_occurred_timezone is not null and not exists (
      select 1 from pg_catalog.pg_timezone_names as zone
       where zone.name = requested_occurred_timezone
    )) then
    raise exception using errcode = '42501',
      message = 'Video moment could not be prepared';
  end if;

  payload_hash := extensions.digest(jsonb_build_object(
    'circle_id', requested_circle_id,
    'journal_person_id', requested_journal_person_id,
    'body', normalized_body,
    'place_name', normalized_place_name,
    'tagged_person_ids', to_jsonb(normalized_tags),
    'occurred_on', requested_occurred_on,
    'occurred_at', requested_occurred_at,
    'occurred_timezone', requested_occurred_timezone,
    'mime_type', normalized_mime_type,
    'size_bytes', requested_expected_size_bytes,
    'duration_ms', requested_duration_ms,
    'audience', normalized_audience
  )::text, 'sha256');

  select request.* into existing
    from private.video_upload_requests as request
   where request.requested_by_membership_id = actor_membership_id
     and request.request_key = requested_request_key
   for update;
  if existing.id is not null then
    if existing.request_payload_hash <> payload_hash then
      raise exception using errcode = '22023',
        message = 'Video upload request was reused';
    end if;
    return query select existing.id, existing.moment_id,
      'our-days-videos'::text, existing.object_path, existing.state,
      existing.upload_expires_at;
    return;
  end if;

  generated_request_id := extensions.gen_random_uuid();
  insert into private.video_upload_requests (
    id, circle_id, journal_person_id, requested_by_membership_id,
    request_key, object_path, expected_mime_type, expected_size_bytes,
    duration_ms, body, place_name, occurred_on, occurred_at,
    occurred_timezone, time_precision, request_payload_hash,
    upload_expires_at, audience
  ) values (
    generated_request_id, requested_circle_id, requested_journal_person_id,
    actor_membership_id, requested_request_key,
    'video/' || generated_request_id::text, normalized_mime_type,
    requested_expected_size_bytes, requested_duration_ms, normalized_body,
    normalized_place_name, requested_occurred_on, requested_occurred_at,
    requested_occurred_timezone,
    case when requested_occurred_at is null then 'date' else 'minute' end,
    payload_hash, statement_timestamp() + interval '2 hours',
    normalized_audience
  ) returning * into created;

  insert into private.video_upload_request_people (
    circle_id, request_id, person_id
  )
  select requested_circle_id, created.id, tagged.person_id
    from unnest(normalized_tags) as tagged(person_id);

  return query select created.id, created.moment_id,
    'our-days-videos'::text, created.object_path, created.state,
    created.upload_expires_at;
end;
$$;

create function public.create_family_moment(
  circle_id uuid, journal_person_id uuid, moment_kind text,
  moment_title text, moment_body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null, occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null,
  audience text default null
)
returns uuid language sql volatile security invoker set search_path = '' as $$
  select private.create_family_moment(
    circle_id, journal_person_id, moment_kind, moment_title, moment_body,
    place_name, tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, audience
  );
$$;

create function public.update_family_moment(
  moment_id uuid, expected_revision bigint, moment_title text,
  moment_body text, place_name text, tagged_person_ids uuid[],
  occurred_on date, occurred_at timestamptz default null,
  occurred_timezone text default null,
  latitude double precision default null, longitude double precision default null,
  audience text default null
)
returns bigint language sql volatile security invoker set search_path = '' as $$
  select private.update_family_moment(
    moment_id, expected_revision, moment_title, moment_body, place_name,
    tagged_person_ids, occurred_on, occurred_at, occurred_timezone,
    latitude, longitude, audience
  );
$$;

create function public.create_written_moment(
  circle_id uuid,
  journal_person_id uuid,
  body text,
  occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null,
  audience text default null
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.create_written_moment(
    circle_id,
    journal_person_id,
    body,
    occurred_on,
    occurred_at,
    occurred_timezone,
    audience
  );
$$;

create function public.reserve_photo_moment(
  circle_id uuid, journal_person_id uuid, body text, place_name text,
  tagged_person_ids uuid[], occurred_on date,
  occurred_at timestamptz default null,
  occurred_timezone text default null, request_key uuid default null,
  audience text default null
)
returns table (
  intake_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, expires_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.reserve_photo_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, occurred_at, occurred_timezone, request_key, audience
  );
$$;

create function public.reserve_video_moment(
  circle_id uuid, journal_person_id uuid, body text, place_name text,
  tagged_person_ids uuid[], occurred_on date, expected_mime_type text,
  expected_size_bytes bigint, duration_ms integer,
  occurred_at timestamptz default null, occurred_timezone text default null,
  request_key uuid default null, audience text default null
)
returns table (
  request_id uuid, moment_id uuid, bucket_id text, object_path text,
  state text, upload_expires_at timestamptz
)
language sql volatile security invoker set search_path = '' as $$
  select * from private.reserve_video_moment(
    circle_id, journal_person_id, body, place_name, tagged_person_ids,
    occurred_on, expected_mime_type, expected_size_bytes, duration_ms,
    occurred_at, occurred_timezone, request_key, audience
  );
$$;

revoke all on function private.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) from public, anon;
revoke all on function private.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) from public, anon;
revoke all on function private.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text
) from public, anon;
revoke all on function private.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text
) from public, anon, service_role;
revoke all on function private.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text
) from public, anon, service_role;
grant execute on function private.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) to authenticated;
grant execute on function private.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) to authenticated;
grant execute on function private.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text
) to authenticated;
grant execute on function private.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text
) to authenticated;
grant execute on function private.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text
) to authenticated;

revoke all on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) from public, anon;
revoke all on function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) from public, anon;
revoke all on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text
) from public, anon;
revoke all on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text
) from public, anon;
revoke all on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text
) from public, anon;
grant execute on function public.create_family_moment(
  uuid, uuid, text, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) to authenticated;
grant execute on function public.update_family_moment(
  uuid, bigint, text, text, text, uuid[], date, timestamptz, text,
  double precision, double precision, text
) to authenticated;
grant execute on function public.create_written_moment(
  uuid, uuid, text, date, timestamptz, text, text
) to authenticated;
grant execute on function public.reserve_photo_moment(
  uuid, uuid, text, text, uuid[], date, timestamptz, text, uuid, text
) to authenticated;
grant execute on function public.reserve_video_moment(
  uuid, uuid, text, text, uuid[], date, text, bigint, integer, timestamptz,
  text, uuid, text
) to authenticated;
