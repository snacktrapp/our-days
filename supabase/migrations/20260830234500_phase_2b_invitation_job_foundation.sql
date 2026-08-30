create table private.invitation_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  requested_by_membership_id uuid not null,
  requester_authorization_version timestamptz not null,
  target_auth_user_id uuid not null,
  invited_display_name text not null,
  request_key uuid not null,
  token_key_version smallint not null default 1,
  state text not null default 'queued',
  requested_at timestamptz not null default statement_timestamp(),
  invalidated_at timestamptz,
  invalidated_by_membership_id uuid,
  constraint invitation_jobs_circle_id_id_key unique (circle_id, id),
  constraint invitation_jobs_requester_fkey foreign key (
    circle_id,
    requested_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitation_jobs_invalidator_fkey foreign key (
    circle_id,
    invalidated_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitation_jobs_request_key_unique unique (
    circle_id,
    requested_by_membership_id,
    request_key
  ),
  constraint invitation_jobs_display_name_valid check (
    invited_display_name = btrim(invited_display_name)
    and char_length(invited_display_name) between 1 and 80
  ),
  constraint invitation_jobs_token_key_version_valid check (
    token_key_version between 1 and 32767
  ),
  constraint invitation_jobs_state_valid check (
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

create index invitation_jobs_circle_requested_idx
  on private.invitation_jobs (circle_id, requested_at desc, id desc);

create index invitation_jobs_requester_idx
  on private.invitation_jobs (
    circle_id,
    requested_by_membership_id,
    requested_at desc
  );

create index invitation_jobs_target_idx
  on private.invitation_jobs (circle_id, target_auth_user_id, requested_at desc);

create index invitation_jobs_invalidator_idx
  on private.invitation_jobs (circle_id, invalidated_by_membership_id)
  where invalidated_by_membership_id is not null;

create unique index invitation_jobs_one_queued_per_target_idx
  on private.invitation_jobs (circle_id, target_auth_user_id)
  where state = 'queued';

create function private.enforce_invitation_job_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'Invitation jobs cannot be deleted';
  end if;

  if new.id <> old.id
    or new.circle_id <> old.circle_id
    or new.requested_by_membership_id <> old.requested_by_membership_id
    or new.requester_authorization_version <>
      old.requester_authorization_version
    or new.target_auth_user_id <> old.target_auth_user_id
    or new.invited_display_name <> old.invited_display_name
    or new.request_key <> old.request_key
    or new.token_key_version <> old.token_key_version
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
      message = 'Invitation job identity is immutable';
  end if;

  return new;
end;
$$;

create trigger invitation_jobs_integrity
before update or delete on private.invitation_jobs
for each row execute function private.enforce_invitation_job_integrity();

alter table private.invitation_jobs enable row level security;
alter table private.invitation_jobs force row level security;

alter table private.audit_events
  drop constraint audit_events_event_type_valid,
  add constraint audit_events_event_type_valid check (
    event_type in (
      'invitation_created', 'invitation_accepted', 'invitation_revoked',
      'invitation_job_requested', 'invitation_job_invalidated',
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
      'invitation', 'invitation_job', 'membership', 'person', 'guardian',
      'moment', 'moment_note', 'moment_reaction', 'export_job'
    )
  );

create function private.request_invitation_job(
  requested_circle_id uuid,
  requested_target_auth_user_id uuid,
  invited_display_name text,
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
  normalized_display_name text := btrim(invited_display_name);
  actor_membership_id uuid;
  actor_authorization_version timestamptz;
  existing_job private.invitation_jobs%rowtype;
  resulting_job_id uuid;
begin
  if current_user_id is null
    or requested_circle_id is null
    or requested_target_auth_user_id is null
    or requested_request_key is null
    or normalized_display_name is null
    or char_length(normalized_display_name) not between 1 and 80 then
    raise exception using
      errcode = '22023',
      message = 'Invitation delivery could not be requested';
  end if;

  perform 1
    from public.circles as circle
   where circle.id = requested_circle_id
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Invitation delivery could not be requested';
  end if;

  select membership.id, membership.updated_at
    into actor_membership_id, actor_authorization_version
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
     and membership.status = 'active'
     and membership.role = 'organizer';

  if actor_membership_id is null
    or not exists (
      select 1
        from auth.users as target_user
       where target_user.id = requested_target_auth_user_id
         and target_user.email is not null
         and target_user.email_confirmed_at is not null
    )
    or exists (
      select 1
        from public.circle_memberships as target_membership
       where target_membership.circle_id = requested_circle_id
         and target_membership.user_id = requested_target_auth_user_id
         and target_membership.status = 'active'
    ) then
    raise exception using
      errcode = '42501',
      message = 'Invitation delivery could not be requested';
  end if;

  with invalidated as (
    update private.invitation_jobs as job
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidated_by_membership_id = actor_membership_id
     where job.circle_id = requested_circle_id
       and job.state = 'queued'
       and not exists (
         select 1
           from public.circle_memberships as requester
          where requester.circle_id = job.circle_id
            and requester.id = job.requested_by_membership_id
            and requester.status = 'active'
            and requester.role = 'organizer'
            and requester.updated_at = job.requester_authorization_version
       )
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
    'invitation_job_invalidated',
    'invitation_job',
    invalidated.id
  from invalidated;

  select job.*
    into existing_job
    from private.invitation_jobs as job
   where job.circle_id = requested_circle_id
     and job.requested_by_membership_id = actor_membership_id
     and job.request_key = requested_request_key
   for update;

  if existing_job.id is not null then
    if existing_job.state = 'queued'
      and existing_job.requester_authorization_version =
        actor_authorization_version
      and existing_job.target_auth_user_id = requested_target_auth_user_id
      and existing_job.invited_display_name = normalized_display_name then
      return existing_job.id;
    end if;

    raise exception using
      errcode = '22023',
      message = 'Invitation delivery could not be requested';
  end if;

  select job.*
    into existing_job
    from private.invitation_jobs as job
   where job.circle_id = requested_circle_id
     and job.target_auth_user_id = requested_target_auth_user_id
     and job.state = 'queued'
   for update;

  if existing_job.id is not null then
    if existing_job.invited_display_name = normalized_display_name then
      return existing_job.id;
    end if;

    raise exception using
      errcode = '22023',
      message = 'Invitation delivery could not be requested';
  end if;

  insert into private.invitation_jobs (
    circle_id,
    requested_by_membership_id,
    requester_authorization_version,
    target_auth_user_id,
    invited_display_name,
    request_key
  )
  values (
    requested_circle_id,
    actor_membership_id,
    actor_authorization_version,
    requested_target_auth_user_id,
    normalized_display_name,
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
    'invitation_job_requested',
    'invitation_job',
    resulting_job_id
  );

  return resulting_job_id;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using
      errcode = '22023',
      message = 'Invitation delivery could not be requested';
end;
$$;

create function private.invitation_job_requester_is_authorized(
  target_invitation_job_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
      from private.invitation_jobs as job
      join public.circle_memberships as membership
        on membership.circle_id = job.circle_id
       and membership.id = job.requested_by_membership_id
      join auth.users as target_user
        on target_user.id = job.target_auth_user_id
     where job.id = target_invitation_job_id
       and job.state = 'queued'
       and membership.status = 'active'
       and membership.role = 'organizer'
       and membership.updated_at = job.requester_authorization_version
       and target_user.email is not null
       and target_user.email_confirmed_at is not null
       and not exists (
         select 1
           from public.circle_memberships as target_membership
          where target_membership.circle_id = job.circle_id
            and target_membership.user_id = job.target_auth_user_id
            and target_membership.status = 'active'
       )
  );
$$;

create function private.invalidate_invitation_jobs_after_authority_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  target_became_active boolean := false;
begin
  if tg_op = 'INSERT' then
    target_became_active := new.status = 'active';
  else
    target_became_active := new.status = 'active' and old.status <> 'active';
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'active'
    and old.role = 'organizer'
    and not (new.status = 'active' and new.role = 'organizer') then
    actor_membership_id := coalesce(
      new.revoked_by_membership_id,
      private.current_membership_id(old.circle_id)
    );

    if actor_membership_id is not null then
      with invalidated as (
        update private.invitation_jobs as job
           set state = 'invalidated',
               invalidated_at = statement_timestamp(),
               invalidated_by_membership_id = actor_membership_id
         where job.circle_id = old.circle_id
           and job.requested_by_membership_id = old.id
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
        old.circle_id,
        actor_membership_id,
        'invitation_job_invalidated',
        'invitation_job',
        invalidated.id
      from invalidated;
    end if;
  end if;

  if target_became_active then
    actor_membership_id := coalesce(
      private.current_membership_id(new.circle_id),
      new.id
    );

    with invalidated as (
      update private.invitation_jobs as job
         set state = 'invalidated',
             invalidated_at = statement_timestamp(),
             invalidated_by_membership_id = actor_membership_id
       where job.circle_id = new.circle_id
         and job.target_auth_user_id = new.user_id
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
      new.circle_id,
      actor_membership_id,
      'invitation_job_invalidated',
      'invitation_job',
      invalidated.id
    from invalidated;
  end if;

  return new;
end;
$$;

create trigger circle_memberships_invitation_job_invalidation
after update of role, status on public.circle_memberships
for each row execute function
  private.invalidate_invitation_jobs_after_authority_loss();

create trigger circle_memberships_invitation_job_target_invalidation
after insert on public.circle_memberships
for each row execute function
  private.invalidate_invitation_jobs_after_authority_loss();

create function public.request_invitation_job(
  circle_id uuid,
  target_auth_user_id uuid,
  display_name text,
  request_key uuid
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.request_invitation_job(
    circle_id,
    target_auth_user_id,
    display_name,
    request_key
  );
$$;

revoke all on table private.invitation_jobs
  from public, anon, authenticated;
revoke all on function private.enforce_invitation_job_integrity()
  from public, anon, authenticated;
revoke all on function private.request_invitation_job(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function private.invitation_job_requester_is_authorized(uuid)
  from public, anon, authenticated;
revoke all on function private.invalidate_invitation_jobs_after_authority_loss()
  from public, anon, authenticated;
revoke all on function public.request_invitation_job(uuid, uuid, text, uuid)
  from public, anon;
grant execute on function public.request_invitation_job(uuid, uuid, text, uuid)
  to authenticated;
