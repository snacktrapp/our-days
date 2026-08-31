-- Phase 2C adds a local-only, target-Auth-bound materialization boundary.
-- It deliberately adds no provider, delivery, Send UI, or Auth provisioner.

alter table private.invitation_jobs
  add column expires_at timestamptz,
  add column delivery_version integer not null default 1,
  add column materialized_at timestamptz,
  add column invitation_id uuid,
  add column invalidation_reason text;

update private.invitation_jobs
   set expires_at = requested_at + interval '48 hours',
       invalidation_reason = case
         when state = 'invalidated' then
           case
             when invalidated_by_closure_request_id is not null
               then 'account_closure'
             else 'legacy_authority_loss'
           end
         else null
       end;

alter table private.invitation_jobs
  alter column expires_at set default (statement_timestamp() + interval '48 hours'),
  alter column expires_at set not null,
  add constraint invitation_jobs_circle_id_id_target_key unique (
    circle_id, id, target_auth_user_id
  ),
  add constraint invitation_jobs_expiry_valid check (
    expires_at > requested_at
  ),
  add constraint invitation_jobs_delivery_version_valid check (
    delivery_version between 1 and 2147483647
  ),
  add constraint invitation_jobs_invalidation_reason_valid check (
    invalidation_reason is null
    or invalidation_reason in (
      'legacy_authority_loss',
      'requester_authority_lost',
      'target_unavailable',
      'target_became_active',
      'target_identity_changed',
      'target_accepted',
      'account_closure',
      'expired',
      'organizer_withdrawn'
    )
  );

alter table private.invitations
  add column invitation_job_id uuid,
  add column target_auth_user_id uuid,
  add column target_email_confirmed_at timestamptz,
  add column recipient_binding bytea,
  add column revocation_reason text;

update private.invitations
   set revocation_reason = case
     when revoked_at is null then null
     when revoked_by_closure_request_id is not null then 'account_closure'
     else 'legacy_withdrawn'
   end;

alter table private.invitations
  add constraint invitations_recipient_binding_length check (
    recipient_binding is null or octet_length(recipient_binding) = 32
  ),
  add constraint invitations_target_binding_complete check (
    (
      invitation_job_id is null
      and target_auth_user_id is null
      and target_email_confirmed_at is null
      and recipient_binding is null
    )
    or (
      invitation_job_id is not null
      and target_auth_user_id is not null
      and target_email_confirmed_at is not null
      and recipient_binding is not null
    )
  ),
  add constraint invitations_revocation_reason_valid check (
    revocation_reason is null
    or revocation_reason in (
      'legacy_withdrawn',
      'requester_authority_lost',
      'target_unavailable',
      'target_became_active',
      'target_identity_changed',
      'account_closure',
      'expired',
      'organizer_withdrawn'
    )
  ),
  add constraint invitations_invitation_job_fkey foreign key (
    circle_id,
    invitation_job_id,
    target_auth_user_id
  ) references private.invitation_jobs (
    circle_id,
    id,
    target_auth_user_id
  ) on delete restrict,
  add constraint invitations_invitation_job_unique unique (invitation_job_id);

alter table private.invitation_jobs
  add constraint invitation_jobs_invitation_fkey foreign key (
    circle_id,
    invitation_id
  ) references private.invitations (circle_id, id) on delete restrict,
  add constraint invitation_jobs_invitation_unique unique (invitation_id);

alter table private.invitations
  add constraint invitations_circle_job_id_id_key unique (
    circle_id,
    invitation_job_id,
    id
  );

alter table private.invitation_jobs
  add constraint invitation_jobs_reciprocal_invitation_fkey foreign key (
    circle_id,
    id,
    invitation_id
  ) references private.invitations (
    circle_id,
    invitation_job_id,
    id
  ) on delete restrict;

create unique index invitations_one_pending_target_idx
  on private.invitations (circle_id, target_auth_user_id)
  where target_auth_user_id is not null
    and accepted_at is null
    and revoked_at is null;

create index invitation_jobs_expiry_idx
  on private.invitation_jobs (expires_at, id)
  where state in ('queued', 'materialized');

create unique index invitation_jobs_one_live_per_target_idx
  on private.invitation_jobs (circle_id, target_auth_user_id)
  where state in ('queued', 'materialized');

alter table private.invitation_jobs
  drop constraint invitation_jobs_state_valid,
  add constraint invitation_jobs_state_valid check (
    (
      state = 'queued'
      and materialized_at is null
      and invitation_id is null
      and invalidated_at is null
      and invalidated_by_membership_id is null
      and invalidated_by_closure_request_id is null
      and invalidation_reason is null
    )
    or (
      state = 'materialized'
      and materialized_at is not null
      and invitation_id is not null
      and invalidated_at is null
      and invalidated_by_membership_id is null
      and invalidated_by_closure_request_id is null
      and invalidation_reason is null
    )
    or (
      state = 'invalidated'
      and invalidated_at is not null
      and invalidation_reason is not null
      and (
        (invalidated_by_membership_id is not null)::integer
        + (invalidated_by_closure_request_id is not null)::integer
      ) <= 1
    )
  );

alter table private.invitations
  drop constraint invitations_terminal_state_valid,
  add constraint invitations_terminal_state_valid check (
    (
      accepted_at is null
      and accepted_membership_id is null
      and revoked_at is null
      and revoked_by_membership_id is null
      and revoked_by_closure_request_id is null
      and revocation_reason is null
    )
    or (
      accepted_at is not null
      and accepted_membership_id is not null
      and revoked_at is null
      and revoked_by_membership_id is null
      and revoked_by_closure_request_id is null
      and revocation_reason is null
    )
    or (
      accepted_at is null
      and accepted_membership_id is null
      and revoked_at is not null
      and revocation_reason is not null
      and (
        (revoked_by_membership_id is not null)::integer
        + (revoked_by_closure_request_id is not null)::integer
      ) <= 1
    )
  );

alter table private.audit_events
  alter column actor_membership_id drop not null,
  add constraint audit_events_nullable_actor_scope_valid check (
    actor_membership_id is not null
    or (
      event_type = 'invitation_job_invalidated'
      and subject_type = 'invitation_job'
    )
  );

create unique index audit_events_one_invitation_job_invalidation_idx
  on private.audit_events (subject_id)
  where event_type = 'invitation_job_invalidated'
    and subject_type = 'invitation_job';

create function private.enforce_invitation_job_audit_attribution()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  terminal_job private.invitation_jobs%rowtype;
begin
  if new.event_type <> 'invitation_job_invalidated'
    or new.subject_type <> 'invitation_job' then
    if new.actor_membership_id is null then
      raise exception using
        errcode = '23514',
        message = 'Audit events require an actor';
    end if;
    return new;
  end if;

  select job.* into terminal_job
    from private.invitation_jobs as job
   where job.circle_id = new.circle_id
     and job.id = new.subject_id;

  if terminal_job.id is null or terminal_job.state <> 'invalidated' then
    raise exception using
      errcode = '23514',
      message = 'Invitation job audit requires a terminal job';
  end if;

  new.actor_membership_id := terminal_job.invalidated_by_membership_id;

  if exists (
    select 1
      from private.audit_events as audit
     where audit.event_type = 'invitation_job_invalidated'
       and audit.subject_type = 'invitation_job'
       and audit.subject_id = terminal_job.id
  ) then
    return null;
  end if;

  return new;
end;
$$;

create trigger audit_events_invitation_job_attribution
before insert on private.audit_events
for each row execute function
  private.enforce_invitation_job_audit_attribution();

create function private.record_invitation_job_invalidation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    new.circle_id,
    new.invalidated_by_membership_id,
    'invitation_job_invalidated',
    'invitation_job',
    new.id
  );
  return new;
end;
$$;

create trigger invitation_jobs_record_invalidation
after update of state on private.invitation_jobs
for each row
when (old.state <> 'invalidated' and new.state = 'invalidated')
execute function private.record_invitation_job_invalidation();

create or replace function private.enforce_invitation_job_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  matching_closure_request_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Invitation jobs cannot be deleted';
  end if;

  if old.state <> 'invalidated' and new.state = 'invalidated' then
    if new.invalidated_by_closure_request_id is null then
      select closure_membership.closure_request_id
        into matching_closure_request_id
        from private.account_closure_memberships as closure_membership
        join private.account_closure_requests as closure
          on closure.id = closure_membership.closure_request_id
       where closure_membership.circle_id = new.circle_id
         and closure_membership.membership_id = new.requested_by_membership_id
         and closure.state in ('requested', 'prepared')
       order by closure.requested_at desc, closure.id
       limit 1;

      if matching_closure_request_id is not null then
        new.invalidated_by_membership_id := null;
        new.invalidated_by_closure_request_id := matching_closure_request_id;
        new.invalidation_reason := 'account_closure';
      end if;
    end if;

    if new.invalidation_reason is null then
      new.invalidation_reason := case
        when new.invalidated_by_closure_request_id is not null
          then 'account_closure'
        else 'legacy_authority_loss'
      end;
    end if;
  end if;

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.requested_by_membership_id is distinct from old.requested_by_membership_id
    or new.requester_authorization_version is distinct from old.requester_authorization_version
    or new.target_auth_user_id is distinct from old.target_auth_user_id
    or new.invited_display_name is distinct from old.invited_display_name
    or new.request_key is distinct from old.request_key
    or new.token_key_version is distinct from old.token_key_version
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or new.delivery_version is distinct from old.delivery_version
    or not (
      (
        new.state = old.state
        and new.materialized_at is not distinct from old.materialized_at
        and new.invitation_id is not distinct from old.invitation_id
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidated_by_membership_id is not distinct from old.invalidated_by_membership_id
        and new.invalidated_by_closure_request_id is not distinct from old.invalidated_by_closure_request_id
        and new.invalidation_reason is not distinct from old.invalidation_reason
      )
      or (
        old.state = 'queued'
        and new.state = 'materialized'
        and old.materialized_at is null
        and old.invitation_id is null
        and new.materialized_at is not null
        and new.invitation_id is not null
        and new.invalidated_at is null
        and new.invalidation_reason is null
      )
      or (
        old.state in ('queued', 'materialized')
        and new.state = 'invalidated'
        and new.materialized_at is not distinct from old.materialized_at
        and new.invitation_id is not distinct from old.invitation_id
        and new.invalidated_at is not null
        and new.invalidation_reason is not null
      )
    ) then
    raise exception using errcode = '42501', message = 'Invitation job identity is immutable';
  end if;

  return new;
end;
$$;

create function private.revoke_target_bound_invitation_after_job_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invitation_id is not null and new.invalidation_reason <> 'target_accepted' then
    update private.invitations as invitation
       set revoked_at = statement_timestamp(),
           revoked_by_membership_id = new.invalidated_by_membership_id,
           revoked_by_closure_request_id = new.invalidated_by_closure_request_id,
           revocation_reason = case new.invalidation_reason
             when 'legacy_authority_loss' then 'requester_authority_lost'
             else new.invalidation_reason
           end
     where invitation.id = new.invitation_id
       and invitation.accepted_at is null
       and invitation.revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger invitation_jobs_revoke_target_bound_invitation
after update of state on private.invitation_jobs
for each row
when (old.state <> 'invalidated' and new.state = 'invalidated')
execute function private.revoke_target_bound_invitation_after_job_invalidation();

create or replace function private.invalidate_invitation_jobs_after_authority_loss()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_membership_id uuid;
  target_became_active boolean := false;
  accepting_job_text text := nullif(
    current_setting('our_days.accepting_invitation_job_id', true), ''
  );
  accepting_job_id uuid := case
    when accepting_job_text ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then accepting_job_text::uuid
    else null
  end;
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
               invalidated_by_membership_id = actor_membership_id,
               invalidation_reason = 'requester_authority_lost'
         where job.circle_id = old.circle_id
           and job.requested_by_membership_id = old.id
           and job.state in ('queued', 'materialized')
        returning job.id
      )
      insert into private.audit_events (
        circle_id, actor_membership_id, event_type, subject_type, subject_id
      )
      select old.circle_id, actor_membership_id,
             'invitation_job_invalidated', 'invitation_job', invalidated.id
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
             invalidated_by_membership_id = actor_membership_id,
             invalidation_reason = 'target_became_active'
       where job.circle_id = new.circle_id
         and job.target_auth_user_id = new.user_id
         and job.state in ('queued', 'materialized')
         and job.id is distinct from accepting_job_id
      returning job.id
    )
    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    )
    select new.circle_id, actor_membership_id,
           'invitation_job_invalidated', 'invitation_job', invalidated.id
      from invalidated;
  end if;

  return new;
end;
$$;

create or replace function private.enforce_invitation_integrity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501', message = 'Invitations cannot be deleted';
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
      raise exception using errcode = '42501', message = 'Invitation could not be created';
    end if;
    return new;
  end if;

  if old.revoked_at is null and new.revoked_at is not null
    and new.revocation_reason is null then
    new.revocation_reason := case
      when new.revoked_by_closure_request_id is not null then 'account_closure'
      when old.expires_at <= statement_timestamp() then 'expired'
      when new.invitation_job_id is not null then 'organizer_withdrawn'
      else 'legacy_withdrawn'
    end;

    if new.revocation_reason = 'expired' then
      new.revoked_by_membership_id := null;
      new.revoked_by_closure_request_id := null;
    end if;
  end if;

  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.person_id is distinct from old.person_id
    or new.created_by_membership_id is distinct from old.created_by_membership_id
    or new.token_hash is distinct from old.token_hash
    or new.email_salt is distinct from old.email_salt
    or new.email_hash is distinct from old.email_hash
    or new.created_at is distinct from old.created_at
    or new.expires_at is distinct from old.expires_at
    or new.invitation_job_id is distinct from old.invitation_job_id
    or new.target_auth_user_id is distinct from old.target_auth_user_id
    or new.target_email_confirmed_at is distinct from old.target_email_confirmed_at
    or new.recipient_binding is distinct from old.recipient_binding
    or not (
      (
        new.accepted_at is not distinct from old.accepted_at
        and new.accepted_membership_id is not distinct from old.accepted_membership_id
        and new.revoked_at is not distinct from old.revoked_at
        and new.revoked_by_membership_id is not distinct from old.revoked_by_membership_id
        and new.revoked_by_closure_request_id is not distinct from old.revoked_by_closure_request_id
        and new.revocation_reason is not distinct from old.revocation_reason
      )
      or (
        old.accepted_at is null and old.revoked_at is null
        and (
          (new.accepted_at is not null and new.accepted_membership_id is not null and new.revoked_at is null)
          or (new.accepted_at is null and new.revoked_at is not null and new.revocation_reason is not null)
        )
      )
    ) then
    raise exception using errcode = '42501', message = 'Invitation state is immutable';
  end if;

  return new;
end;
$$;

create function private.invalidate_target_bound_job_after_invitation_revocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  terminal_reason text;
begin
  if new.invitation_job_id is null
    or old.revoked_at is not null
    or new.revoked_at is null then
    return new;
  end if;

  terminal_reason := case new.revocation_reason
    when 'legacy_withdrawn' then 'organizer_withdrawn'
    else new.revocation_reason
  end;

  perform private.invalidate_target_bound_invitation_job(
    new.invitation_job_id,
    terminal_reason,
    new.revoked_by_membership_id,
    new.revoked_by_closure_request_id
  );

  return new;
end;
$$;

create trigger invitations_invalidate_target_bound_job
after update of revoked_at on private.invitations
for each row
when (old.revoked_at is null and new.revoked_at is not null)
execute function
  private.invalidate_target_bound_job_after_invitation_revocation();

create function private.invitation_recipient_binding(
  target_auth_user_id uuid,
  normalized_email text,
  confirmed_at timestamptz
)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.uuid_send(target_auth_user_id)
      || pg_catalog.convert_to(lower(btrim(normalized_email)), 'UTF8')
      || pg_catalog.timestamptz_send(confirmed_at),
    'sha256'
  );
$$;

create function private.invalidate_target_bound_invitation_job(
  requested_job_id uuid,
  requested_reason text,
  requested_invalidator_membership_id uuid default null,
  requested_invalidator_closure_request_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target private.invitation_jobs%rowtype;
begin
  if requested_job_id is null
    or requested_reason not in (
      'requester_authority_lost', 'target_unavailable',
      'target_became_active', 'target_identity_changed', 'target_accepted',
      'account_closure', 'expired', 'organizer_withdrawn'
    )
    or (
      (requested_invalidator_membership_id is not null)::integer
      + (requested_invalidator_closure_request_id is not null)::integer
    ) > 1 then
    return false;
  end if;

  select job.* into target
    from private.invitation_jobs as job
   where job.id = requested_job_id
   for update;

  if target.id is null then return false; end if;
  if target.state = 'invalidated' then return true; end if;

  update private.invitation_jobs as job
     set state = 'invalidated',
         invalidated_at = statement_timestamp(),
         invalidated_by_membership_id = requested_invalidator_membership_id,
         invalidated_by_closure_request_id = requested_invalidator_closure_request_id,
         invalidation_reason = requested_reason
   where job.id = target.id;

  if target.invitation_id is not null then
    update private.invitations as invitation
       set revoked_at = statement_timestamp(),
           revoked_by_membership_id = requested_invalidator_membership_id,
           revoked_by_closure_request_id = requested_invalidator_closure_request_id,
           revocation_reason = case requested_reason
             when 'target_accepted' then null
             else requested_reason
           end
     where invitation.id = target.invitation_id
       and invitation.accepted_at is null
       and invitation.revoked_at is null
       and requested_reason <> 'target_accepted';
  end if;

  return true;
end;
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
  target_closure_request_id uuid;
  requester_closure_request_id uuid;
  live_job private.invitation_jobs%rowtype;
  live_requester public.circle_memberships%rowtype;
  existing_job private.invitation_jobs%rowtype;
  resulting_job_id uuid;
  target_is_active boolean;
  terminalized_job boolean := false;
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

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into target_email, target_email_confirmed_at
    from auth.users as auth_user
   where auth_user.id = requested_target_auth_user_id;

  select closure.id into target_closure_request_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = requested_target_auth_user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id
   limit 1;

  if not exists (select 1 from auth.users where id = current_user_id)
    or (select private.account_closure_is_blocking(current_user_id)) then
    raise exception using
      errcode = '42501',
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
     and membership.role = 'organizer'
   for update;

  if actor_membership_id is null then
    raise exception using
      errcode = '42501',
      message = 'Invitation delivery could not be requested';
  end if;

  select exists (
    select 1
      from public.circle_memberships as target_membership
     where target_membership.circle_id = requested_circle_id
       and target_membership.user_id = requested_target_auth_user_id
       and target_membership.status = 'active'
  ) into target_is_active;

  for live_job in
    select job.*
      from private.invitation_jobs as job
     where job.circle_id = requested_circle_id
       and job.target_auth_user_id = requested_target_auth_user_id
       and job.state in ('queued', 'materialized')
     order by job.id
     for update
  loop
    select membership.* into live_requester
      from public.circle_memberships as membership
     where membership.circle_id = live_job.circle_id
       and membership.id = live_job.requested_by_membership_id
     for update;

    requester_closure_request_id := null;
    select closure.id into requester_closure_request_id
      from private.account_closure_requests as closure
     where closure.auth_user_id = live_requester.user_id
       and closure.state in ('requested', 'prepared')
     order by closure.requested_at desc, closure.id
     limit 1;

    if live_job.expires_at <= statement_timestamp() then
      perform private.invalidate_target_bound_invitation_job(
        live_job.id, 'expired', null, null
      );
      terminalized_job := true;
    elsif requester_closure_request_id is not null then
      perform private.invalidate_target_bound_invitation_job(
        live_job.id, 'account_closure', null,
        requester_closure_request_id
      );
      terminalized_job := true;
    elsif live_requester.id is null
      or live_requester.user_id is null
      or live_requester.status <> 'active'
      or live_requester.role <> 'organizer'
      or live_requester.updated_at <> live_job.requester_authorization_version then
      perform private.invalidate_target_bound_invitation_job(
        live_job.id, 'requester_authority_lost', null, null
      );
      terminalized_job := true;
    elsif target_closure_request_id is not null then
      perform private.invalidate_target_bound_invitation_job(
        live_job.id, 'account_closure', null, target_closure_request_id
      );
      terminalized_job := true;
    elsif target_email is null or target_email_confirmed_at is null then
      perform private.invalidate_target_bound_invitation_job(
        live_job.id, 'target_unavailable', null, null
      );
      terminalized_job := true;
    elsif target_is_active then
      perform private.invalidate_target_bound_invitation_job(
        live_job.id, 'target_became_active', null, null
      );
      terminalized_job := true;
    end if;
  end loop;

  if target_email is null
    or target_email_confirmed_at is null
    or target_closure_request_id is not null
    or target_is_active then
    if terminalized_job then return null; end if;
    raise exception using
      errcode = '42501',
      message = 'Invitation delivery could not be requested';
  end if;

  select job.* into existing_job
    from private.invitation_jobs as job
   where job.circle_id = requested_circle_id
     and job.requested_by_membership_id = actor_membership_id
     and job.request_key = requested_request_key
   for update;

  if existing_job.id is not null then
    if existing_job.state in ('queued', 'materialized')
      and existing_job.requester_authorization_version = actor_authorization_version
      and existing_job.target_auth_user_id = requested_target_auth_user_id
      and existing_job.invited_display_name = normalized_display_name then
      return existing_job.id;
    end if;
    if terminalized_job then return null; end if;
    raise exception using
      errcode = '22023',
      message = 'Invitation delivery could not be requested';
  end if;

  select job.* into existing_job
    from private.invitation_jobs as job
   where job.circle_id = requested_circle_id
     and job.target_auth_user_id = requested_target_auth_user_id
     and job.state in ('queued', 'materialized')
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
    circle_id, requested_by_membership_id,
    requester_authorization_version, target_auth_user_id,
    invited_display_name, request_key
  ) values (
    requested_circle_id, actor_membership_id,
    actor_authorization_version, requested_target_auth_user_id,
    normalized_display_name, requested_request_key
  ) returning id into resulting_job_id;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    requested_circle_id, actor_membership_id,
    'invitation_job_requested', 'invitation_job', resulting_job_id
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
      join public.circle_memberships as requester
        on requester.circle_id = job.circle_id
       and requester.id = job.requested_by_membership_id
      join auth.users as target_user
        on target_user.id = job.target_auth_user_id
     where job.id = target_invitation_job_id
       and job.state in ('queued', 'materialized')
       and job.expires_at > statement_timestamp()
       and requester.user_id is not null
       and requester.status = 'active'
       and requester.role = 'organizer'
       and requester.updated_at = job.requester_authorization_version
       and not (select private.account_closure_is_blocking(requester.user_id))
       and not (select private.account_closure_is_blocking(job.target_auth_user_id))
       and target_user.email is not null
       and target_user.email_confirmed_at is not null
       and not exists (
         select 1
           from public.circle_memberships as target_membership
          where target_membership.circle_id = job.circle_id
            and target_membership.user_id = job.target_auth_user_id
            and target_membership.status = 'active'
       )
       and (
         job.state = 'queued'
         or exists (
           select 1
             from private.invitations as invitation
            where invitation.circle_id = job.circle_id
              and invitation.id = job.invitation_id
              and invitation.invitation_job_id = job.id
              and invitation.target_auth_user_id = job.target_auth_user_id
              and invitation.accepted_at is null
              and invitation.revoked_at is null
              and invitation.expires_at > statement_timestamp()
              and invitation.target_email_confirmed_at = target_user.email_confirmed_at
              and invitation.recipient_binding =
                private.invitation_recipient_binding(
                  job.target_auth_user_id,
                  lower(btrim(target_user.email)),
                  target_user.email_confirmed_at
                )
         )
       )
  );
$$;

create function private.load_target_bound_invitation_job(requested_job_id uuid)
returns table (
  job_id uuid,
  circle_id uuid,
  requester_membership_id uuid,
  requester_authorization_version timestamptz,
  target_auth_user_id uuid,
  invited_display_name text,
  state text,
  token_key_version smallint,
  delivery_version integer,
  requested_at timestamptz,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  discovered_circle_id uuid;
  discovered_target_auth_user_id uuid;
  discovered_requester_auth_user_id uuid;
  job private.invitation_jobs%rowtype;
  requester public.circle_memberships%rowtype;
  invitation private.invitations%rowtype;
  target_email text;
  target_confirmed_at timestamptz;
  target_binding bytea;
  requester_closure_request_id uuid;
  target_closure_request_id uuid;
begin
  select job_row.circle_id,
         job_row.target_auth_user_id,
         membership.user_id
    into discovered_circle_id,
         discovered_target_auth_user_id,
         discovered_requester_auth_user_id
    from private.invitation_jobs as job_row
    left join public.circle_memberships as membership
      on membership.circle_id = job_row.circle_id
     and membership.id = job_row.requested_by_membership_id
   where job_row.id = requested_job_id;

  if discovered_circle_id is null then return; end if;

  perform auth_user.id
    from auth.users as auth_user
   where auth_user.id in (
     discovered_requester_auth_user_id,
     discovered_target_auth_user_id
   )
   order by auth_user.id
   for update;

  perform 1 from public.circles as circle
   where circle.id = discovered_circle_id
   for update;

  select job_row.* into job
    from private.invitation_jobs as job_row
   where job_row.circle_id = discovered_circle_id
     and job_row.id = requested_job_id
   for update;

  if job.id is null or job.state = 'invalidated' then return; end if;

  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.id = job.requested_by_membership_id
   for update;

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into target_email, target_confirmed_at
    from auth.users as auth_user
   where auth_user.id = job.target_auth_user_id;

  select closure.id into requester_closure_request_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = requester.user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id
   limit 1;

  select closure.id into target_closure_request_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = job.target_auth_user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id
   limit 1;

  if job.expires_at <= statement_timestamp() then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'expired', null, null
    );
    return;
  elsif requester_closure_request_id is not null then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'account_closure', null, requester_closure_request_id
    );
    return;
  elsif requester.id is null
    or requester.user_id is null
    or requester.status <> 'active'
    or requester.role <> 'organizer'
    or requester.updated_at <> job.requester_authorization_version then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'requester_authority_lost', null, null
    );
    return;
  elsif target_closure_request_id is not null then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'account_closure', null, target_closure_request_id
    );
    return;
  elsif target_email is null or target_confirmed_at is null then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'target_unavailable', null, null
    );
    return;
  elsif exists (
    select 1 from public.circle_memberships as target_membership
     where target_membership.circle_id = job.circle_id
       and target_membership.user_id = job.target_auth_user_id
       and target_membership.status = 'active'
  ) then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'target_became_active', null, null
    );
    return;
  end if;

  if job.state = 'materialized' then
    select target_invitation.* into invitation
      from private.invitations as target_invitation
     where target_invitation.circle_id = job.circle_id
       and target_invitation.id = job.invitation_id
     for update;

    if invitation.id is null then return; end if;

    if invitation.accepted_at is not null then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_accepted', invitation.accepted_membership_id, null
      );
      return;
    elsif invitation.revoked_at is not null then
      perform private.invalidate_target_bound_invitation_job(
        job.id,
        case invitation.revocation_reason
          when 'legacy_withdrawn' then 'organizer_withdrawn'
          else invitation.revocation_reason
        end,
        invitation.revoked_by_membership_id,
        invitation.revoked_by_closure_request_id
      );
      return;
    elsif exists (
      select 1 from public.circle_memberships as detached_membership
       where detached_membership.circle_id = invitation.circle_id
         and detached_membership.person_id = invitation.person_id
         and detached_membership.user_id is null
    ) then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_unavailable', null, null
      );
      return;
    end if;

    target_binding := private.invitation_recipient_binding(
      job.target_auth_user_id, target_email, target_confirmed_at
    );

    if invitation.target_auth_user_id is distinct from job.target_auth_user_id
      or invitation.target_email_confirmed_at is distinct from target_confirmed_at
      or invitation.recipient_binding is distinct from target_binding then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_identity_changed', null, null
      );
      return;
    end if;
  end if;

  return query select
    job.id,
    job.circle_id,
    job.requested_by_membership_id,
    job.requester_authorization_version,
    job.target_auth_user_id,
    job.invited_display_name,
    job.state,
    job.token_key_version,
    job.delivery_version,
    job.requested_at,
    job.expires_at;
end;
$$;

create function private.materialize_target_bound_invitation_job(
  requested_job_id uuid,
  requested_delivery_version integer,
  requested_token_sha256_hex text
)
returns table (
  job_id uuid,
  invitation_id uuid,
  state text,
  delivery_version integer,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  discovered_circle_id uuid;
  discovered_target_auth_user_id uuid;
  discovered_requester_auth_user_id uuid;
  job private.invitation_jobs%rowtype;
  requester public.circle_memberships%rowtype;
  existing_target_membership public.circle_memberships%rowtype;
  target_email text;
  target_confirmed_at timestamptz;
  binding bytea;
  existing_invitation private.invitations%rowtype;
  requester_closure_request_id uuid;
  target_closure_request_id uuid;
  generated_person_id uuid;
  generated_invitation_id uuid;
  invitation_salt bytea;
begin
  if requested_job_id is null
    or requested_delivery_version is null
    or requested_delivery_version < 1
    or requested_token_sha256_hex is null
    or requested_token_sha256_hex !~ '^[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'Invitation could not be materialized';
  end if;

  select job_row.circle_id,
         job_row.target_auth_user_id,
         membership.user_id
    into discovered_circle_id,
         discovered_target_auth_user_id,
         discovered_requester_auth_user_id
    from private.invitation_jobs as job_row
    left join public.circle_memberships as membership
      on membership.circle_id = job_row.circle_id
     and membership.id = job_row.requested_by_membership_id
   where job_row.id = requested_job_id;

  if discovered_circle_id is null then return; end if;

  perform auth_user.id
    from auth.users as auth_user
   where auth_user.id in (
     discovered_requester_auth_user_id,
     discovered_target_auth_user_id
   )
   order by auth_user.id
   for update;

  perform 1 from public.circles as circle
   where circle.id = discovered_circle_id
   for update;

  select job_row.* into job
    from private.invitation_jobs as job_row
   where job_row.circle_id = discovered_circle_id
     and job_row.id = requested_job_id
   for update;

  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.id = job.requested_by_membership_id
   for update;

  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into target_email, target_confirmed_at
    from auth.users as auth_user
   where auth_user.id = job.target_auth_user_id;

  select closure.id into requester_closure_request_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = requester.user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id
   limit 1;

  select closure.id into target_closure_request_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = job.target_auth_user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id
   limit 1;

  if job.state = 'invalidated' then return; end if;

  if requester_closure_request_id is not null then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'account_closure', null, requester_closure_request_id
    );
    return;
  end if;

  if requester.id is null
    or requester.user_id is null
    or requester.status <> 'active'
    or requester.role <> 'organizer'
    or requester.updated_at <> job.requester_authorization_version then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'requester_authority_lost', null, null
    );
    return;
  end if;

  if job.expires_at <= statement_timestamp() then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'expired', null, null
    );
    return;
  end if;

  if target_closure_request_id is not null then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'account_closure', null, target_closure_request_id
    );
    return;
  end if;

  if target_email is null or target_confirmed_at is null then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'target_unavailable', null, null
    );
    return;
  end if;

  if exists (
    select 1 from public.circle_memberships as target_membership
     where target_membership.circle_id = job.circle_id
       and target_membership.user_id = job.target_auth_user_id
       and target_membership.status = 'active'
  ) then
    perform private.invalidate_target_bound_invitation_job(
      job.id, 'target_became_active', null, null
    );
    return;
  end if;

  binding := private.invitation_recipient_binding(
    job.target_auth_user_id, target_email, target_confirmed_at
  );

  if job.state = 'materialized' then
    select invitation.* into existing_invitation
      from private.invitations as invitation
     where invitation.circle_id = job.circle_id
       and invitation.id = job.invitation_id
     for update;

    if existing_invitation.id is not null
      and job.delivery_version = requested_delivery_version
      and existing_invitation.token_hash = decode(requested_token_sha256_hex, 'hex')
      and existing_invitation.target_auth_user_id = job.target_auth_user_id
      and existing_invitation.target_email_confirmed_at = target_confirmed_at
      and existing_invitation.recipient_binding = binding
      and existing_invitation.accepted_at is null
      and existing_invitation.revoked_at is null then
      return query select
        job.id, existing_invitation.id, job.state,
        job.delivery_version, job.expires_at;
    elsif existing_invitation.id is not null
      and existing_invitation.recipient_binding is distinct from binding then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_identity_changed', null, null
      );
    end if;
    return;
  end if;

  if job.state <> 'queued'
    or job.delivery_version <> requested_delivery_version then
    return;
  end if;

  select membership.* into existing_target_membership
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.user_id = job.target_auth_user_id
   for update;

  if existing_target_membership.id is not null then
    if existing_target_membership.status <> 'revoked' then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_became_active', null, null
      );
      return;
    end if;
    generated_person_id := existing_target_membership.person_id;
  else
    insert into public.people (
      circle_id, display_name, profile_kind, created_by_membership_id
    ) values (
      job.circle_id, job.invited_display_name, 'account', job.requested_by_membership_id
    ) returning id into generated_person_id;
  end if;

  generated_invitation_id := extensions.gen_random_uuid();
  invitation_salt := extensions.gen_random_bytes(16);

  insert into private.invitations (
    id, circle_id, person_id, created_by_membership_id,
    token_hash, email_salt, email_hash, expires_at,
    invitation_job_id, target_auth_user_id,
    target_email_confirmed_at, recipient_binding
  ) values (
    generated_invitation_id,
    job.circle_id,
    generated_person_id,
    job.requested_by_membership_id,
    decode(requested_token_sha256_hex, 'hex'),
    invitation_salt,
    extensions.digest(
      pg_catalog.convert_to(target_email, 'UTF8') || invitation_salt,
      'sha256'
    ),
    job.expires_at,
    job.id,
    job.target_auth_user_id,
    target_confirmed_at,
    binding
  );

  update private.invitation_jobs as job_row
     set state = 'materialized',
         materialized_at = statement_timestamp(),
         invitation_id = generated_invitation_id
   where job_row.id = job.id
   returning * into job;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    job.circle_id,
    job.requested_by_membership_id,
    'invitation_created',
    'invitation',
    generated_invitation_id
  );

  return query select
    job.id, generated_invitation_id, job.state,
    job.delivery_version, job.expires_at;
end;
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
  job private.invitation_jobs%rowtype;
  requester public.circle_memberships%rowtype;
  existing_membership public.circle_memberships%rowtype;
  resulting_membership_id uuid;
  binding bytea;
  requester_closure_request_id uuid;
  target_closure_request_id uuid;
begin
  if current_user_id is null
    or invitation_token is null
    or char_length(invitation_token) not between 40 and 64 then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  requested_token_hash := extensions.digest(invitation_token, 'sha256');

  select invitation.* into invitation_row
    from private.invitations as invitation
   where invitation.token_hash = requested_token_hash;

  if invitation_row.id is null then
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  -- Preserve the legacy local-only email-bound branch until its ACL is retired.
  if invitation_row.invitation_job_id is null then
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

    perform 1 from public.circles
     where id = invitation_row.circle_id
     for update;

    select invitation.* into invitation_row
      from private.invitations as invitation
     where invitation.id = invitation_row.id
     for update;

    if invitation_row.accepted_at is not null
      or invitation_row.revoked_at is not null
      or invitation_row.expires_at <= statement_timestamp()
      or extensions.digest(
        pg_catalog.convert_to(current_email, 'UTF8') || invitation_row.email_salt,
        'sha256'
      ) <> invitation_row.email_hash
      or exists (
        select 1 from public.circle_memberships as detached_membership
         where detached_membership.circle_id = invitation_row.circle_id
           and detached_membership.person_id = invitation_row.person_id
           and detached_membership.user_id is null
      ) then
      raise exception using errcode = '22023', message = 'Invitation is not available';
    end if;
  else
    select job_row.* into job
      from private.invitation_jobs as job_row
     where job_row.id = invitation_row.invitation_job_id;

    select membership.* into requester
      from public.circle_memberships as membership
     where membership.circle_id = job.circle_id
       and membership.id = job.requested_by_membership_id;

    perform auth_user.id
      from auth.users as auth_user
     where auth_user.id in (
       current_user_id,
       invitation_row.target_auth_user_id,
       requester.user_id
     )
     order by auth_user.id
     for update;

    select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
      into current_email, current_email_confirmed_at
      from auth.users as auth_user
     where auth_user.id = current_user_id;

    perform 1 from public.circles
     where id = invitation_row.circle_id
     for update;

    select job_row.* into job
      from private.invitation_jobs as job_row
     where job_row.id = invitation_row.invitation_job_id
     for update;

    select membership.* into requester
      from public.circle_memberships as membership
     where membership.circle_id = job.circle_id
       and membership.id = job.requested_by_membership_id
     for update;

    select invitation.* into invitation_row
      from private.invitations as invitation
     where invitation.id = invitation_row.id
     for update;

    select closure.id into requester_closure_request_id
      from private.account_closure_requests as closure
     where closure.auth_user_id = requester.user_id
       and closure.state in ('requested', 'prepared')
     order by closure.requested_at desc, closure.id
     limit 1;

    select closure.id into target_closure_request_id
      from private.account_closure_requests as closure
     where closure.auth_user_id = current_user_id
       and closure.state in ('requested', 'prepared')
     order by closure.requested_at desc, closure.id
     limit 1;

    if current_user_id is distinct from invitation_row.target_auth_user_id then
      return null;
    end if;

    if job.state <> 'materialized'
      or job.invitation_id is distinct from invitation_row.id
      or invitation_row.accepted_at is not null
      or invitation_row.revoked_at is not null then
      return null;
    end if;

    if requester_closure_request_id is not null then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'account_closure', null, requester_closure_request_id
      );
      return null;
    end if;

    if requester.id is null
      or requester.user_id is null
      or requester.status <> 'active'
      or requester.role <> 'organizer'
      or requester.updated_at <> job.requester_authorization_version then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'requester_authority_lost', null, null
      );
      return null;
    end if;

    if job.expires_at <= statement_timestamp()
      or invitation_row.expires_at <= statement_timestamp() then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'expired', null, null
      );
      return null;
    end if;

    if exists (
      select 1 from public.circle_memberships as detached_membership
       where detached_membership.circle_id = invitation_row.circle_id
         and detached_membership.person_id = invitation_row.person_id
         and detached_membership.user_id is null
    ) then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_unavailable', null, null
      );
      return null;
    end if;

    if target_closure_request_id is not null then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'account_closure', null, target_closure_request_id
      );
      return null;
    end if;

    if current_email is null or current_email_confirmed_at is null then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_unavailable', null, null
      );
      return null;
    end if;

    binding := private.invitation_recipient_binding(
      current_user_id, current_email, current_email_confirmed_at
    );

    if invitation_row.target_email_confirmed_at <> current_email_confirmed_at
      or invitation_row.recipient_binding <> binding
      or extensions.digest(
        pg_catalog.convert_to(current_email, 'UTF8') || invitation_row.email_salt,
        'sha256'
      ) <> invitation_row.email_hash then
      perform private.invalidate_target_bound_invitation_job(
        job.id, 'target_identity_changed', null, null
      );
      return null;
    end if;
  end if;

  select membership.* into existing_membership
    from public.circle_memberships as membership
   where membership.circle_id = invitation_row.circle_id
     and membership.user_id = current_user_id
   for update;

  if existing_membership.id is null then
    select membership.* into existing_membership
      from public.circle_memberships as membership
     where membership.circle_id = invitation_row.circle_id
       and membership.person_id = invitation_row.person_id
     for update;
  end if;

  if invitation_row.invitation_job_id is not null then
    perform set_config(
      'our_days.accepting_invitation_job_id',
      invitation_row.invitation_job_id::text,
      true
    );
  end if;

  if existing_membership.id is null then
    insert into public.circle_memberships (
      circle_id, user_id, person_id, role, status
    ) values (
      invitation_row.circle_id, current_user_id,
      invitation_row.person_id, 'member', 'active'
    ) returning id into resulting_membership_id;
  elsif existing_membership.user_id = current_user_id
    and existing_membership.person_id = invitation_row.person_id
    and existing_membership.status = 'revoked' then
    update public.circle_memberships
       set status = 'active', role = 'member',
           revoked_at = null, revoked_by_membership_id = null
     where id = existing_membership.id
    returning id into resulting_membership_id;
  else
    if invitation_row.invitation_job_id is not null then return null; end if;
    raise exception using errcode = '22023', message = 'Invitation is not available';
  end if;

  update private.invitations
     set accepted_at = statement_timestamp(),
         accepted_membership_id = resulting_membership_id
   where id = invitation_row.id;

  if invitation_row.invitation_job_id is not null then
    perform private.invalidate_target_bound_invitation_job(
      invitation_row.invitation_job_id,
      'target_accepted',
      resulting_membership_id,
      null
    );
  end if;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    invitation_row.circle_id, resulting_membership_id,
    'invitation_accepted', 'invitation', invitation_row.id
  );

  return resulting_membership_id;
exception
  when unique_violation or check_violation or foreign_key_violation
    or too_many_rows then
    raise exception using errcode = '22023', message = 'Invitation is not available';
end;
$$;

revoke all on function private.invitation_recipient_binding(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_target_bound_invitation_job(
  uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.load_target_bound_invitation_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.materialize_target_bound_invitation_job(
  uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function private.revoke_target_bound_invitation_after_job_invalidation()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_target_bound_job_after_invitation_revocation()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_job_audit_attribution()
  from public, anon, authenticated, service_role;
revoke all on function private.record_invitation_job_invalidation()
  from public, anon, authenticated, service_role;

-- The legacy public create/preflight/accept ACLs remain unchanged for local
-- regression flows. The target-bound load/materialize/invalidate seams above
-- are intentionally ungranted until a separate worker/provisioner phase.
