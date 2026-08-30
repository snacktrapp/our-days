create table private.export_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  requested_by_membership_id uuid not null,
  requester_authorization_version timestamptz not null,
  request_key uuid not null,
  state text not null default 'queued',
  requested_at timestamptz not null default statement_timestamp(),
  invalidated_at timestamptz,
  invalidated_by_membership_id uuid,
  constraint export_jobs_circle_id_id_key unique (circle_id, id),
  constraint export_jobs_requester_fkey foreign key (
    circle_id,
    requested_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint export_jobs_invalidator_fkey foreign key (
    circle_id,
    invalidated_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint export_jobs_request_key_unique unique (
    circle_id,
    requested_by_membership_id,
    request_key
  ),
  constraint export_jobs_state_valid check (
    (
      state = 'queued'
      and invalidated_at is null
      and invalidated_by_membership_id is null
    )
    or
    (
      state = 'invalidated'
      and invalidated_at is not null
      and invalidated_by_membership_id is not null
    )
  )
);

create index export_jobs_circle_requested_idx
  on private.export_jobs (circle_id, requested_at desc, id desc);

create index export_jobs_requester_idx
  on private.export_jobs (circle_id, requested_by_membership_id, requested_at desc);

create index export_jobs_invalidator_idx
  on private.export_jobs (circle_id, invalidated_by_membership_id)
  where invalidated_by_membership_id is not null;

create unique index export_jobs_one_queued_per_requester_idx
  on private.export_jobs (circle_id, requested_by_membership_id)
  where state = 'queued';

create function private.enforce_export_job_request_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'Family export requests cannot be deleted';
  end if;

  if new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.requested_by_membership_id <> old.requested_by_membership_id
    or new.requester_authorization_version <>
      old.requester_authorization_version
    or new.request_key <> old.request_key
    or new.requested_at <> old.requested_at
    or not (
      (
        new.state = old.state
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidated_by_membership_id is not distinct from
          old.invalidated_by_membership_id
      )
      or (
        old.state = 'queued'
        and new.state = 'invalidated'
        and old.invalidated_at is null
        and old.invalidated_by_membership_id is null
        and new.invalidated_at is not null
        and new.invalidated_by_membership_id is not null
      )
    ) then
    raise exception using
      errcode = '42501',
      message = 'Family export request identity is immutable';
  end if;

  return new;
end;
$$;

create trigger export_jobs_request_integrity
before update or delete on private.export_jobs
for each row execute function private.enforce_export_job_request_integrity();

alter table private.export_jobs enable row level security;
alter table private.export_jobs force row level security;

alter table private.audit_events
  drop constraint audit_events_event_type_valid,
  add constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created', 'invitation_accepted', 'invitation_revoked',
      'membership_revoked', 'membership_role_changed',
      'membership_promoted', 'membership_demoted',
      'managed_person_created', 'guardian_added', 'guardian_removed',
      'moment_created', 'moment_updated', 'moment_trashed', 'moment_restored',
      'moment_note_created', 'moment_note_updated', 'moment_note_trashed',
      'moment_reaction_set', 'moment_reaction_removed',
      'export_requested', 'export_invalidated'
    )
  ),
  drop constraint audit_events_subject_type_valid,
  add constraint audit_events_subject_type_valid check (
    subject_type in (
      'invitation', 'membership', 'person', 'guardian', 'moment',
      'moment_note', 'moment_reaction', 'export_job'
    )
  );

create function private.request_family_export(
  requested_circle_id uuid,
  requested_request_key uuid
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
  actor_authorization_version timestamptz;
  existing_job_id uuid;
  resulting_job_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_request_key is null then
    raise exception using
      errcode = '22023',
      message = 'Family export could not be requested';
  end if;

  perform 1
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Family export could not be requested';
  end if;

  select membership.id, membership.updated_at
    into actor_membership_id, actor_authorization_version
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null then
    raise exception using
      errcode = '42501',
      message = 'Family export could not be requested';
  end if;

  with invalidated as (
    update private.export_jobs as job
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidated_by_membership_id = actor_membership_id
     where job.circle_id = requested_circle_id
       and job.requested_by_membership_id = actor_membership_id
       and job.state = 'queued'
       and job.requester_authorization_version <>
         actor_authorization_version
    returning job.id
  )
  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  select
    requested_circle_id,
    actor_membership_id,
    'export_invalidated',
    'export_job',
    invalidated.id
  from invalidated;

  select job.id
    into existing_job_id
    from private.export_jobs as job
     where job.circle_id = requested_circle_id
     and job.requested_by_membership_id = actor_membership_id
     and job.requester_authorization_version = actor_authorization_version
     and job.state = 'queued'
   for update;

  if existing_job_id is not null then
    return existing_job_id;
  end if;

  insert into private.export_jobs (
    circle_id,
    requested_by_membership_id,
    requester_authorization_version,
    request_key
  )
  values (
    requested_circle_id,
    actor_membership_id,
    actor_authorization_version,
    requested_request_key
  )
  returning id into resulting_job_id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    requested_circle_id,
    actor_membership_id,
    'export_requested',
    'export_job',
    resulting_job_id
  );

  return resulting_job_id;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using
      errcode = '22023',
      message = 'Family export could not be requested';
end;
$$;

create function private.export_job_requester_is_authorized(
  target_export_job_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from private.export_jobs as job
      join public.circle_memberships as membership
        on membership.circle_id = job.circle_id
       and membership.id = job.requested_by_membership_id
     where job.id = target_export_job_id
       and job.state = 'queued'
       and membership.status = 'active'
       and membership.role = 'organizer'
       and membership.updated_at = job.requester_authorization_version
  );
$$;

create function public.request_family_export(
  circle_id uuid,
  request_key uuid
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.request_family_export(circle_id, request_key);
$$;

create or replace function private.set_membership_role(
  target_membership_id uuid,
  requested_role text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.circle_memberships%rowtype;
  actor_membership_id uuid;
begin
  if requested_role is null
    or requested_role not in ('member', 'organizer') then
    raise exception using errcode = '22023', message = 'Role could not be changed';
  end if;

  select membership.circle_id
    into target.circle_id
    from public.circle_memberships as membership
   where membership.id = target_membership_id;

  if target.circle_id is null then
    raise exception using errcode = '22023', message = 'Role could not be changed';
  end if;

  perform 1 from public.circles where id = target.circle_id for update;

  select membership.*
    into target
    from public.circle_memberships as membership
   where membership.id = target_membership_id
   for update;

  if not (select private.is_circle_organizer(target.circle_id))
    or target.status <> 'active' then
    raise exception using errcode = '22023', message = 'Role could not be changed';
  end if;

  actor_membership_id := private.current_membership_id(target.circle_id);

  if target.role = requested_role then
    return;
  end if;

  update public.circle_memberships
     set role = requested_role
   where id = target.id;

  if requested_role = 'member' then
    with invalidated as (
      update private.export_jobs as job
         set state = 'invalidated',
             invalidated_at = statement_timestamp(),
             invalidated_by_membership_id = actor_membership_id
       where job.circle_id = target.circle_id
         and job.requested_by_membership_id = target.id
         and job.state = 'queued'
      returning job.id
    )
    insert into private.audit_events (
      circle_id,
      actor_membership_id,
      event_type,
      subject_type,
      subject_id
    )
    select
      target.circle_id,
      actor_membership_id,
      'export_invalidated',
      'export_job',
      invalidated.id
    from invalidated;
  end if;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    target.circle_id,
    actor_membership_id,
    case
      when requested_role = 'organizer' then 'membership_promoted'
      else 'membership_demoted'
    end,
    'membership',
    target.id
  );
end;
$$;

create or replace function private.revoke_membership(target_membership_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target public.circle_memberships%rowtype;
  actor_membership_id uuid;
begin
  select membership.circle_id
    into target.circle_id
    from public.circle_memberships as membership
   where membership.id = target_membership_id;

  if target.circle_id is null then
    raise exception using errcode = '22023', message = 'Access could not be changed';
  end if;

  perform 1 from public.circles where id = target.circle_id for update;

  select membership.*
    into target
    from public.circle_memberships as membership
   where membership.id = target_membership_id
   for update;

  select membership.id
    into actor_membership_id
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null then
    raise exception using errcode = '22023', message = 'Access could not be changed';
  end if;

  if target.status = 'revoked' then
    return;
  end if;

  with invalidated as (
    update private.export_jobs as job
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidated_by_membership_id = actor_membership_id
     where job.circle_id = target.circle_id
       and job.requested_by_membership_id = target.id
       and job.state = 'queued'
    returning job.id
  )
  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  select
    target.circle_id,
    actor_membership_id,
    'export_invalidated',
    'export_job',
    invalidated.id
  from invalidated;

  update public.person_guardians
     set revoked_at = statement_timestamp(),
         revoked_by_membership_id = actor_membership_id
   where circle_id = target.circle_id
     and guardian_membership_id = target.id
     and revoked_at is null;

  update public.circle_memberships
     set status = 'revoked',
         revoked_at = statement_timestamp(),
         revoked_by_membership_id = actor_membership_id
   where id = target.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  values (
    target.circle_id,
    actor_membership_id,
    'membership_revoked',
    'membership',
    target.id
  );
end;
$$;

revoke all on table private.export_jobs from public, anon, authenticated;
revoke all on function private.enforce_export_job_request_integrity()
  from public, anon, authenticated;
revoke all on function private.request_family_export(uuid, uuid)
  from public, anon;
revoke all on function private.export_job_requester_is_authorized(uuid)
  from public, anon, authenticated;
grant execute on function private.request_family_export(uuid, uuid)
  to authenticated;

revoke all on function public.request_family_export(uuid, uuid)
  from public, anon;
grant execute on function public.request_family_export(uuid, uuid)
  to authenticated;
