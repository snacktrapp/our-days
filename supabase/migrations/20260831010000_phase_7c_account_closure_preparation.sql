-- Phase 7C account-closure preparation. Auth deletion remains an external,
-- later operation; this transaction only closes database authorization and
-- preserves family history.

create table private.account_closure_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  auth_user_id uuid not null,
  request_key uuid not null,
  state text not null default 'requested',
  requested_at timestamptz not null default statement_timestamp(),
  prepared_at timestamptz,
  constraint account_closure_requests_auth_user_unique unique (auth_user_id),
  constraint account_closure_requests_request_key_unique unique (
    auth_user_id,
    request_key
  ),
  constraint account_closure_requests_state_valid check (
    (
      state = 'requested'
      and prepared_at is null
    )
    or
    (
      state = 'prepared'
      and prepared_at is not null
      and prepared_at >= requested_at
    )
  )
);

create table private.account_closure_memberships (
  closure_request_id uuid not null references
    private.account_closure_requests (id) on delete restrict,
  circle_id uuid not null,
  membership_id uuid not null,
  recorded_at timestamptz not null default statement_timestamp(),
  primary key (closure_request_id, membership_id),
  constraint account_closure_memberships_membership_unique unique (
    membership_id
  ),
  constraint account_closure_memberships_membership_fkey foreign key (
    circle_id,
    membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict
);

create index account_closure_memberships_circle_idx
  on private.account_closure_memberships (circle_id, membership_id);

create function private.enforce_account_closure_request_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'Account closure requests cannot be deleted';
  end if;

  if new.id is distinct from old.id
    or new.auth_user_id is distinct from old.auth_user_id
    or new.request_key is distinct from old.request_key
    or new.requested_at is distinct from old.requested_at
    or not (
      (
        new.state = old.state
        and new.prepared_at is not distinct from old.prepared_at
      )
      or (
        old.state = 'requested'
        and old.prepared_at is null
        and new.state = 'prepared'
        and new.prepared_at is not null
      )
    ) then
    raise exception using
      errcode = '42501',
      message = 'Account closure request identity is immutable';
  end if;

  return new;
end;
$$;

create trigger account_closure_requests_integrity
before update or delete on private.account_closure_requests
for each row execute function
  private.enforce_account_closure_request_integrity();

create function private.enforce_account_closure_membership_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'Account closure membership history cannot be deleted';
  end if;

  if new.closure_request_id is distinct from old.closure_request_id
    or new.circle_id is distinct from old.circle_id
    or new.membership_id is distinct from old.membership_id
    or new.recorded_at is distinct from old.recorded_at then
    raise exception using
      errcode = '42501',
      message = 'Account closure membership history is immutable';
  end if;

  return new;
end;
$$;

create trigger account_closure_memberships_integrity
before update or delete on private.account_closure_memberships
for each row execute function
  private.enforce_account_closure_membership_integrity();

alter table private.account_closure_requests enable row level security;
alter table private.account_closure_requests force row level security;
alter table private.account_closure_memberships enable row level security;
alter table private.account_closure_memberships force row level security;

alter table public.circle_memberships
  alter column user_id drop not null,
  add constraint circle_memberships_active_auth_attachment_valid check (
    status <> 'active' or user_id is not null
  );

alter table private.invitation_jobs
  add column invalidated_by_closure_request_id uuid references
    private.account_closure_requests (id) on delete restrict;

create index invitation_jobs_closure_invalidator_idx
  on private.invitation_jobs (invalidated_by_closure_request_id)
  where invalidated_by_closure_request_id is not null;

alter table private.invitation_jobs
  drop constraint invitation_jobs_state_valid,
  add constraint invitation_jobs_state_valid check (
    (
      state = 'queued'
      and invalidated_at is null
      and invalidated_by_membership_id is null
      and invalidated_by_closure_request_id is null
    )
    or
    (
      state = 'invalidated'
      and invalidated_at is not null
      and (
        (invalidated_by_membership_id is not null)::integer
        + (invalidated_by_closure_request_id is not null)::integer
      ) = 1
    )
  );

alter table private.invitations
  add column revoked_by_closure_request_id uuid references
    private.account_closure_requests (id) on delete restrict;

create index invitations_closure_revoker_idx
  on private.invitations (revoked_by_closure_request_id)
  where revoked_by_closure_request_id is not null;

alter table private.invitations
  drop constraint invitations_terminal_state_valid,
  add constraint invitations_terminal_state_valid check (
    (
      accepted_at is null
      and accepted_membership_id is null
      and revoked_at is null
      and revoked_by_membership_id is null
      and revoked_by_closure_request_id is null
    )
    or
    (
      accepted_at is not null
      and accepted_membership_id is not null
      and revoked_at is null
      and revoked_by_membership_id is null
      and revoked_by_closure_request_id is null
    )
    or
    (
      accepted_at is null
      and accepted_membership_id is null
      and revoked_at is not null
      and (
        (revoked_by_membership_id is not null)::integer
        + (revoked_by_closure_request_id is not null)::integer
      ) = 1
    )
  );

create or replace function private.enforce_invitation_job_integrity()
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

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.requested_by_membership_id is distinct from
      old.requested_by_membership_id
    or new.requester_authorization_version is distinct from
      old.requester_authorization_version
    or new.target_auth_user_id is distinct from old.target_auth_user_id
    or new.invited_display_name is distinct from old.invited_display_name
    or new.request_key is distinct from old.request_key
    or new.token_key_version is distinct from old.token_key_version
    or new.requested_at is distinct from old.requested_at
    or not (
      (
        new.state = old.state
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidated_by_membership_id is not distinct from
          old.invalidated_by_membership_id
        and new.invalidated_by_closure_request_id is not distinct from
          old.invalidated_by_closure_request_id
      )
      or (
        old.state = 'queued'
        and new.state = 'invalidated'
        and old.invalidated_at is null
        and old.invalidated_by_membership_id is null
        and old.invalidated_by_closure_request_id is null
        and new.invalidated_at is not null
        and (
          (new.invalidated_by_membership_id is not null)::integer
          + (new.invalidated_by_closure_request_id is not null)::integer
        ) = 1
      )
    ) then
    raise exception using
      errcode = '42501',
      message = 'Invitation job identity is immutable';
  end if;

  return new;
end;
$$;

create function private.enforce_invitation_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '42501',
      message = 'Invitations cannot be deleted';
  end if;

  if tg_op = 'INSERT' then
    if exists (
      select 1
        from public.circle_memberships as creator
        join private.account_closure_requests as closure
          on closure.auth_user_id = creator.user_id
       where creator.circle_id = new.circle_id
         and creator.id = new.created_by_membership_id
         and closure.state in ('requested', 'prepared')
    ) then
      raise exception using
        errcode = '42501',
        message = 'Invitation could not be created';
    end if;
    return new;
  end if;

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.person_id is distinct from old.person_id
    or new.created_by_membership_id is distinct from
      old.created_by_membership_id
    or new.token_hash is distinct from old.token_hash
    or new.email_salt is distinct from old.email_salt
    or new.email_hash is distinct from old.email_hash
    or not (
      (
        new.accepted_at is not distinct from old.accepted_at
        and new.accepted_membership_id is not distinct from
          old.accepted_membership_id
        and new.revoked_at is not distinct from old.revoked_at
        and new.revoked_by_membership_id is not distinct from
          old.revoked_by_membership_id
        and new.revoked_by_closure_request_id is not distinct from
          old.revoked_by_closure_request_id
      )
      or (
        old.accepted_at is null
        and old.accepted_membership_id is null
        and old.revoked_at is null
        and old.revoked_by_membership_id is null
        and old.revoked_by_closure_request_id is null
        and (
          (
            new.accepted_at is not null
            and new.accepted_membership_id is not null
            and new.revoked_at is null
            and new.revoked_by_membership_id is null
            and new.revoked_by_closure_request_id is null
          )
          or (
            new.accepted_at is null
            and new.accepted_membership_id is null
            and new.revoked_at is not null
            and (
              (new.revoked_by_membership_id is not null)::integer
              + (new.revoked_by_closure_request_id is not null)::integer
            ) = 1
          )
        )
      )
    ) then
    raise exception using
      errcode = '42501',
      message = 'Invitation state is immutable';
  end if;

  return new;
end;
$$;

create trigger invitations_integrity
before insert or update or delete on private.invitations
for each row execute function private.enforce_invitation_integrity();

create function private.account_closure_is_blocking(target_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.account_closure_requests as closure
     where closure.auth_user_id = target_auth_user_id
       and closure.state in ('requested', 'prepared')
  );
$$;

create or replace function private.enforce_membership_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  linked_kind text;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Memberships are retained as history';
  end if;

  select person.profile_kind
    into linked_kind
    from public.people as person
   where person.circle_id = new.circle_id
     and person.id = new.person_id;

  if linked_kind is distinct from 'account' then
    raise exception using errcode = '23514', message = 'Memberships require an account profile';
  end if;

  if new.status = 'active' and new.user_id is null then
    raise exception using errcode = '23514', message = 'Active memberships require an Auth attachment';
  end if;

  if tg_op = 'UPDATE' then
    if new.circle_id is distinct from old.circle_id
      or new.person_id is distinct from old.person_id
      or new.joined_at is distinct from old.joined_at then
      raise exception using errcode = '42501', message = 'Membership identity is immutable';
    end if;

    if new.user_id is distinct from old.user_id then
      if old.user_id is not null and new.user_id is not null then
        raise exception using
          errcode = '42501',
          message = 'Membership identity is immutable';
      end if;

      if old.user_id is null
        or new.user_id is not null
        or new.status <> 'revoked'
        or not exists (
          select 1
            from private.account_closure_memberships as closure_membership
            join private.account_closure_requests as closure
              on closure.id = closure_membership.closure_request_id
           where closure_membership.circle_id = old.circle_id
             and closure_membership.membership_id = old.id
             and closure.auth_user_id = old.user_id
             and closure.state in ('requested', 'prepared')
        ) then
        raise exception using
          errcode = '42501',
          message = 'Membership Auth attachment is immutable';
      end if;
    end if;

    if old.status = 'active'
      and old.role = 'organizer'
      and not (new.status = 'active' and new.role = 'organizer') then
      perform 1 from public.circles where id = old.circle_id for update;

      if not exists (
        select 1
          from public.circle_memberships as other_membership
         where other_membership.circle_id = old.circle_id
           and other_membership.id <> old.id
           and other_membership.status = 'active'
           and other_membership.role = 'organizer'
           and other_membership.user_id is not null
           and not (select private.account_closure_is_blocking(
             other_membership.user_id
           ))
      ) then
        raise exception using errcode = '23514', message = 'A circle must retain an active organizer';
      end if;
    end if;
  end if;

  new.updated_at := statement_timestamp();
  return new;
end;
$$;

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
      'export_requested', 'export_invalidated',
      'account_closure_prepared'
    )
  );

create function public.request_account_closure(request_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_request private.account_closure_requests%rowtype;
  resulting_request_id uuid;
begin
  if current_user_id is null or request_key is null then
    raise exception using
      errcode = '22023',
      message = 'Account closure could not be requested';
  end if;

  perform 1
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Account closure could not be requested';
  end if;

  select closure.*
    into existing_request
    from private.account_closure_requests as closure
   where closure.auth_user_id = current_user_id
   for update;

  if existing_request.id is not null then
    if existing_request.request_key = request_key then
      return existing_request.id;
    end if;

    raise exception using
      errcode = '22023',
      message = 'Account closure could not be requested';
  end if;

  perform circle.id
    from public.circles as circle
   where exists (
     select 1
       from public.circle_memberships as membership
      where membership.circle_id = circle.id
        and membership.user_id = current_user_id
   )
   order by circle.id
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Account closure could not be requested';
  end if;

  if exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = current_user_id
       and membership.status = 'active'
       and membership.role = 'organizer'
       and not exists (
         select 1
           from public.circle_memberships as other_organizer
          where other_organizer.circle_id = membership.circle_id
            and other_organizer.id <> membership.id
            and other_organizer.status = 'active'
            and other_organizer.role = 'organizer'
            and other_organizer.user_id is not null
            and not (select private.account_closure_is_blocking(
              other_organizer.user_id
            ))
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every family must retain an active organizer';
  end if;

  insert into private.account_closure_requests (
    auth_user_id,
    request_key
  ) values (
    current_user_id,
    request_key
  )
  returning id into resulting_request_id;

  return resulting_request_id;
exception
  when unique_violation then
    raise exception using
      errcode = '22023',
      message = 'Account closure could not be requested';
end;
$$;

create function private.prepare_account_closure(closure_request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_request private.account_closure_requests%rowtype;
  normalized_confirmed_email text;
begin
  if closure_request_id is null then
    raise exception using
      errcode = '22023',
      message = 'Account closure could not be prepared';
  end if;

  select closure.*
    into target_request
    from private.account_closure_requests as closure
   where closure.id = closure_request_id;

  if target_request.id is null then
    raise exception using
      errcode = '22023',
      message = 'Account closure could not be prepared';
  end if;

  select
    case
      when auth_user.email_confirmed_at is not null
      then lower(btrim(auth_user.email))
      else null
    end
    into normalized_confirmed_email
    from auth.users as auth_user
   where auth_user.id = target_request.auth_user_id
   for update;

  if not found then
    select closure.*
      into target_request
      from private.account_closure_requests as closure
     where closure.id = closure_request_id
     for update;

    if target_request.state = 'prepared' then
      return target_request.id;
    end if;

    raise exception using
      errcode = '42501',
      message = 'Account closure could not be prepared';
  end if;

  select closure.*
    into target_request
    from private.account_closure_requests as closure
   where closure.id = closure_request_id
   for update;

  if target_request.state = 'prepared' then
    return target_request.id;
  end if;

  if target_request.state <> 'requested' then
    raise exception using
      errcode = '22023',
      message = 'Account closure could not be prepared';
  end if;

  perform circle.id
    from public.circles as circle
   where circle.id in (
     select membership.circle_id
       from public.circle_memberships as membership
      where membership.user_id = target_request.auth_user_id
     union
     select job.circle_id
       from private.invitation_jobs as job
      where job.target_auth_user_id = target_request.auth_user_id
        and job.state = 'queued'
     union
     select invitation.circle_id
       from private.invitations as invitation
      where invitation.accepted_at is null
        and invitation.revoked_at is null
        and normalized_confirmed_email is not null
        and extensions.digest(
          pg_catalog.convert_to(normalized_confirmed_email, 'UTF8')
            || invitation.email_salt,
          'sha256'
        ) = invitation.email_hash
   )
   order by circle.id
   for update;

  perform membership.id
    from public.circle_memberships as membership
   where membership.user_id = target_request.auth_user_id
   order by membership.circle_id, membership.id
   for update;

  if not found then
    raise exception using
      errcode = '42501',
      message = 'Account closure could not be prepared';
  end if;

  if exists (
    select 1
      from public.circle_memberships as membership
     where membership.user_id = target_request.auth_user_id
       and membership.status = 'active'
       and membership.role = 'organizer'
       and not exists (
         select 1
           from public.circle_memberships as other_organizer
          where other_organizer.circle_id = membership.circle_id
            and other_organizer.id <> membership.id
            and other_organizer.status = 'active'
            and other_organizer.role = 'organizer'
            and other_organizer.user_id is not null
            and not (select private.account_closure_is_blocking(
              other_organizer.user_id
            ))
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Every family must retain an active organizer';
  end if;

  insert into private.account_closure_memberships (
    closure_request_id,
    circle_id,
    membership_id
  )
  select
    target_request.id,
    membership.circle_id,
    membership.id
  from public.circle_memberships as membership
  where membership.user_id = target_request.auth_user_id
  order by membership.circle_id, membership.id;

  with invalidated as (
    update private.export_jobs as job
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidated_by_membership_id = job.requested_by_membership_id
      from private.account_closure_memberships as closure_membership
     where closure_membership.closure_request_id = target_request.id
       and closure_membership.circle_id = job.circle_id
       and closure_membership.membership_id = job.requested_by_membership_id
       and job.state = 'queued'
    returning job.id, job.circle_id, job.requested_by_membership_id
  )
  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  select
    invalidated.circle_id,
    invalidated.requested_by_membership_id,
    'export_invalidated',
    'export_job',
    invalidated.id
  from invalidated;

  with invalidated as (
    update private.invitation_jobs as job
       set state = 'invalidated',
           invalidated_at = statement_timestamp(),
           invalidated_by_membership_id = job.requested_by_membership_id
      from private.account_closure_memberships as closure_membership
     where closure_membership.closure_request_id = target_request.id
       and closure_membership.circle_id = job.circle_id
       and closure_membership.membership_id = job.requested_by_membership_id
       and job.state = 'queued'
    returning job.id, job.circle_id, job.requested_by_membership_id
  )
  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  select
    invalidated.circle_id,
    invalidated.requested_by_membership_id,
    'invitation_job_invalidated',
    'invitation_job',
    invalidated.id
  from invalidated;

  update private.invitation_jobs as job
     set state = 'invalidated',
         invalidated_at = statement_timestamp(),
         invalidated_by_closure_request_id = target_request.id
   where job.target_auth_user_id = target_request.auth_user_id
     and job.state = 'queued';

  update private.invitations as invitation
     set revoked_at = statement_timestamp(),
         revoked_by_closure_request_id = target_request.id
   where invitation.accepted_at is null
     and invitation.revoked_at is null
     and (
       exists (
         select 1
           from private.account_closure_memberships as closure_membership
           join public.circle_memberships as membership
             on membership.circle_id = closure_membership.circle_id
            and membership.id = closure_membership.membership_id
          where closure_membership.closure_request_id = target_request.id
            and membership.circle_id = invitation.circle_id
            and membership.person_id = invitation.person_id
       )
       or (
         normalized_confirmed_email is not null
         and extensions.digest(
           pg_catalog.convert_to(normalized_confirmed_email, 'UTF8')
             || invitation.email_salt,
           'sha256'
         ) = invitation.email_hash
       )
     );

  update public.person_guardians as guardian
     set revoked_at = statement_timestamp(),
         revoked_by_membership_id = guardian.guardian_membership_id
    from private.account_closure_memberships as closure_membership
   where closure_membership.closure_request_id = target_request.id
     and closure_membership.circle_id = guardian.circle_id
     and closure_membership.membership_id = guardian.guardian_membership_id
     and guardian.revoked_at is null;

  update public.circle_memberships as membership
     set status = 'revoked',
         revoked_at = coalesce(membership.revoked_at, statement_timestamp()),
         revoked_by_membership_id = coalesce(
           membership.revoked_by_membership_id,
           membership.id
         ),
         user_id = null
    from private.account_closure_memberships as closure_membership
   where closure_membership.closure_request_id = target_request.id
     and closure_membership.circle_id = membership.circle_id
     and closure_membership.membership_id = membership.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  )
  select
    closure_membership.circle_id,
    closure_membership.membership_id,
    'account_closure_prepared',
    'membership',
    closure_membership.membership_id
  from private.account_closure_memberships as closure_membership
  where closure_membership.closure_request_id = target_request.id;

  update private.account_closure_requests
     set state = 'prepared',
         prepared_at = statement_timestamp()
   where id = target_request.id;

  return target_request.id;
exception
  when unique_violation or foreign_key_violation then
    raise exception using
      errcode = '22023',
      message = 'Account closure could not be prepared';
end;
$$;

create or replace function private.request_family_export(
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
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found
    or (select private.account_closure_is_blocking(current_user_id)) then
    raise exception using
      errcode = '42501',
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
  ) values (
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
  ) values (
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

create or replace function private.export_job_requester_is_authorized(
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
       and membership.user_id is not null
       and membership.status = 'active'
       and membership.role = 'organizer'
       and membership.updated_at = job.requester_authorization_version
       and not (select private.account_closure_is_blocking(membership.user_id))
  );
$$;

create or replace function public.request_family_export(
  circle_id uuid,
  request_key uuid
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.request_family_export(circle_id, request_key);
$$;

create or replace function private.request_invitation_job(
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
  target_email text;
  target_email_confirmed_at timestamptz;
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

  perform auth_user.id
    from auth.users as auth_user
   where auth_user.id in (current_user_id, requested_target_auth_user_id)
   order by auth_user.id
   for update;

  if not exists (
      select 1 from auth.users where id = current_user_id
    )
    or not exists (
      select 1 from auth.users where id = requested_target_auth_user_id
    )
    or (select private.account_closure_is_blocking(current_user_id))
    or (select private.account_closure_is_blocking(
      requested_target_auth_user_id
    )) then
    raise exception using
      errcode = '42501',
      message = 'Invitation delivery could not be requested';
  end if;

  select auth_user.email, auth_user.email_confirmed_at
    into target_email, target_email_confirmed_at
    from auth.users as auth_user
   where auth_user.id = requested_target_auth_user_id;

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
    or target_email is null
    or target_email_confirmed_at is null
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
            and requester.user_id is not null
            and requester.status = 'active'
            and requester.role = 'organizer'
            and requester.updated_at = job.requester_authorization_version
            and not (select private.account_closure_is_blocking(
              requester.user_id
            ))
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
  ) values (
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
  ) values (
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

create or replace function private.invitation_job_requester_is_authorized(
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
       and membership.user_id is not null
       and membership.status = 'active'
       and membership.role = 'organizer'
       and membership.updated_at = job.requester_authorization_version
       and not (select private.account_closure_is_blocking(membership.user_id))
       and not (select private.account_closure_is_blocking(
         job.target_auth_user_id
       ))
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

create or replace function private.accept_invitation(invitation_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text;
  current_email_confirmed_at timestamptz;
  requested_token_hash bytea;
  invitation_row private.invitations%rowtype;
  resulting_membership_id uuid;
  existing_membership public.circle_memberships%rowtype;
begin
  if current_user_id is null
    or invitation_token is null
    or char_length(invitation_token) not between 40 and 64 then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  requested_token_hash := extensions.digest(invitation_token, 'sha256');

  select candidate.*
    into invitation_row
    from private.invitations as candidate
   where candidate.token_hash = requested_token_hash;

  if invitation_row.id is null then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into current_email, current_email_confirmed_at
    from auth.users as auth_user
   where auth_user.id = current_user_id
   for update;

  if not found
    or current_email is null
    or current_email_confirmed_at is null
    or (select private.account_closure_is_blocking(current_user_id)) then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  perform 1
    from public.circles
   where id = invitation_row.circle_id
   for update;

  select candidate.*
    into invitation_row
    from private.invitations as candidate
   where candidate.id = invitation_row.id
   for update;

  if invitation_row.accepted_at is not null
    or invitation_row.revoked_at is not null
    or invitation_row.expires_at <= statement_timestamp()
    or extensions.digest(
      pg_catalog.convert_to(current_email, 'UTF8') || invitation_row.email_salt,
      'sha256'
    ) <> invitation_row.email_hash
    or exists (
      select 1
        from public.circle_memberships as detached_membership
       where detached_membership.circle_id = invitation_row.circle_id
         and detached_membership.person_id = invitation_row.person_id
         and detached_membership.user_id is null
    ) then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  select membership.*
    into existing_membership
    from public.circle_memberships as membership
   where membership.circle_id = invitation_row.circle_id
     and membership.user_id = current_user_id
   for update;

  if existing_membership.id is null then
    select membership.*
      into existing_membership
      from public.circle_memberships as membership
     where membership.circle_id = invitation_row.circle_id
       and membership.person_id = invitation_row.person_id
     for update;
  end if;

  if existing_membership.id is null then
    insert into public.circle_memberships (
      circle_id,
      user_id,
      person_id,
      role,
      status
    ) values (
      invitation_row.circle_id,
      current_user_id,
      invitation_row.person_id,
      'member',
      'active'
    )
    returning id into resulting_membership_id;
  elsif existing_membership.user_id = current_user_id
    and existing_membership.person_id = invitation_row.person_id
    and existing_membership.status = 'revoked' then
    update public.circle_memberships
       set status = 'active',
           role = 'member',
           revoked_at = null,
           revoked_by_membership_id = null
     where id = existing_membership.id
    returning id into resulting_membership_id;
  else
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  update private.invitations
     set accepted_at = statement_timestamp(),
         accepted_membership_id = resulting_membership_id
   where id = invitation_row.id;

  insert into private.audit_events (
    circle_id,
    actor_membership_id,
    event_type,
    subject_type,
    subject_id
  ) values (
    invitation_row.circle_id,
    resulting_membership_id,
    'invitation_accepted',
    'invitation',
    invitation_row.id
  );

  return resulting_membership_id;
exception
  when unique_violation or check_violation or foreign_key_violation
    or too_many_rows then
    raise exception using errcode = '22023', message = 'Invitation is not available';
end;
$$;

revoke all on table private.account_closure_requests
  from public, anon, authenticated, service_role;
revoke all on table private.account_closure_memberships
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_account_closure_request_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_account_closure_membership_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.account_closure_is_blocking(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.prepare_account_closure(uuid)
  from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.prepare_account_closure(uuid)
  to service_role;

revoke all on function public.request_account_closure(uuid)
  from public, anon;
grant execute on function public.request_account_closure(uuid)
  to authenticated;

revoke all on function private.request_family_export(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.request_family_export(uuid, uuid)
  from public, anon;
grant execute on function public.request_family_export(uuid, uuid)
  to authenticated;
