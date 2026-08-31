-- Phase 2D establishes the database boundary for email-first invitation
-- provisioning and provider delivery. It creates no Send UI, provider client,
-- action URL, raw invitation token, or Auth-account mutation path.

create table private.invitation_delivery_capabilities (
  capability text primary key,
  enabled boolean not null default false,
  updated_at timestamptz not null default statement_timestamp(),
  constraint invitation_delivery_capabilities_name_valid check (
    capability = 'email_delivery'
  )
);

insert into private.invitation_delivery_capabilities (capability, enabled)
values ('email_delivery', false);

comment on table private.invitation_delivery_capabilities is
  'Database-owner capability boundary for invitation delivery. It is disabled by default and has no Data API or service-role access.';

create table private.invitation_provisioner_allowlist (
  auth_user_id uuid primary key references auth.users (id) on delete restrict,
  coordination_profile_version integer not null default 1,
  allowed_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  constraint invitation_provisioner_profile_valid check (
    coordination_profile_version = 1
  ),
  constraint invitation_provisioner_revocation_valid check (
    revoked_at is null or revoked_at >= allowed_at
  )
);

create table private.invitation_delivery_worker_allowlist (
  auth_user_id uuid primary key references auth.users (id) on delete restrict,
  coordination_profile_version integer not null default 1,
  allowed_at timestamptz not null default statement_timestamp(),
  revoked_at timestamptz,
  constraint invitation_delivery_worker_profile_valid check (
    coordination_profile_version = 1
  ),
  constraint invitation_delivery_worker_revocation_valid check (
    revoked_at is null or revoked_at >= allowed_at
  )
);

comment on table private.invitation_provisioner_allowlist is
  'Durable dedicated-worker history. Revoke access in place; hard deletion of a worker Auth account is intentionally unsupported.';
comment on table private.invitation_delivery_worker_allowlist is
  'Durable dedicated-worker history. Revoke access in place; hard deletion of a worker Auth account is intentionally unsupported.';

create table private.invitation_email_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null references public.circles (id) on delete restrict,
  requested_by_membership_id uuid not null,
  requester_authorization_version timestamptz not null,
  normalized_email text,
  email_salt bytea not null,
  email_hash bytea not null,
  invited_display_name text not null,
  request_key uuid not null,
  state text not null default 'queued',
  requested_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (
    statement_timestamp() + interval '48 hours'
  ),
  provisioned_at timestamptz,
  provisioned_by_auth_user_id uuid,
  target_auth_user_id uuid,
  invitation_job_id uuid,
  delivered_at timestamptz,
  accepted_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text,
  constraint invitation_email_requests_circle_id_id_key unique (circle_id, id),
  constraint invitation_email_requests_circle_id_id_target_key unique (
    circle_id, id, target_auth_user_id
  ),
  constraint invitation_email_requests_requester_fkey foreign key (
    circle_id, requested_by_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitation_email_requests_provisioner_fkey foreign key (
    provisioned_by_auth_user_id
  ) references auth.users (id) on delete restrict,
  constraint invitation_email_requests_request_key_unique unique (
    circle_id, requested_by_membership_id, request_key
  ),
  constraint invitation_email_requests_email_valid check (
    normalized_email is null or (
      normalized_email = lower(btrim(normalized_email))
      and char_length(normalized_email) between 3 and 254
      and normalized_email ~
        '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+$'
    )
  ),
  constraint invitation_email_requests_salt_valid check (
    octet_length(email_salt) >= 16
  ),
  constraint invitation_email_requests_hash_valid check (
    octet_length(email_hash) = 32
  ),
  constraint invitation_email_requests_display_name_valid check (
    invited_display_name = btrim(invited_display_name)
    and char_length(invited_display_name) between 1 and 80
  ),
  constraint invitation_email_requests_expiry_valid check (
    expires_at = requested_at + interval '48 hours'
  ),
  constraint invitation_email_requests_reason_valid check (
    invalidation_reason is null
    or invalidation_reason in (
      'requester_authority_lost', 'requester_account_closure',
      'target_became_active', 'target_identity_changed',
      'target_account_closure', 'provisioner_revoked',
      'delivery_worker_revoked', 'expired', 'organizer_withdrawn'
    )
  ),
  constraint invitation_email_requests_state_valid check (
    (
      state = 'queued'
      and normalized_email is not null
      and provisioned_at is null
      and provisioned_by_auth_user_id is null
      and target_auth_user_id is null
      and invitation_job_id is null
      and delivered_at is null
      and accepted_at is null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'provisioned'
      and normalized_email is not null
      and provisioned_at is not null
      and provisioned_by_auth_user_id is not null
      and target_auth_user_id is not null
      and invitation_job_id is not null
      and delivered_at is null
      and accepted_at is null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'delivered'
      and normalized_email is not null
      and provisioned_at is not null
      and provisioned_by_auth_user_id is not null
      and target_auth_user_id is not null
      and invitation_job_id is not null
      and delivered_at is not null
      and accepted_at is null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'accepted'
      and normalized_email is null
      and provisioned_at is not null
      and provisioned_by_auth_user_id is not null
      and target_auth_user_id is not null
      and invitation_job_id is not null
      and delivered_at is not null
      and accepted_at is not null
      and invalidated_at is null
      and invalidation_reason is null
    ) or (
      state = 'invalidated'
      and normalized_email is null
      and accepted_at is null
      and invalidated_at is not null
      and invalidation_reason is not null
      and (
        (
          provisioned_at is null
          and provisioned_by_auth_user_id is null
          and target_auth_user_id is null
          and invitation_job_id is null
          and delivered_at is null
        ) or (
          provisioned_at is not null
          and provisioned_by_auth_user_id is not null
          and target_auth_user_id is not null
          and invitation_job_id is not null
        )
      )
    )
  )
);

create index invitation_email_requests_requester_idx
  on private.invitation_email_requests (
    requested_by_membership_id, requested_at desc, id desc
  );
create index invitation_email_requests_expiry_idx
  on private.invitation_email_requests (expires_at, id)
  where state in ('queued', 'provisioned', 'delivered');
create index invitation_email_requests_target_idx
  on private.invitation_email_requests (target_auth_user_id, state)
  where target_auth_user_id is not null;
create index invitation_email_requests_provisioner_idx
  on private.invitation_email_requests (provisioned_by_auth_user_id, state)
  where provisioned_by_auth_user_id is not null;
create unique index invitation_email_requests_one_live_email_idx
  on private.invitation_email_requests (circle_id, normalized_email)
  where state in ('queued', 'provisioned', 'delivered');

alter table private.invitation_jobs
  add column email_request_id uuid,
  add column provisioned_by_auth_user_id uuid,
  add column materialized_by_delivery_worker_auth_user_id uuid,
  add constraint invitation_jobs_email_request_target_fkey foreign key (
    circle_id, email_request_id, target_auth_user_id
  ) references private.invitation_email_requests (
    circle_id, id, target_auth_user_id
  ) on delete restrict deferrable initially deferred,
  add constraint invitation_jobs_email_request_unique unique (email_request_id),
  add constraint invitation_jobs_provisioner_fkey foreign key (
    provisioned_by_auth_user_id
  ) references auth.users (id) on delete restrict,
  add constraint invitation_jobs_delivery_worker_fkey foreign key (
    materialized_by_delivery_worker_auth_user_id
  ) references auth.users (id) on delete restrict,
  add constraint invitation_jobs_phase_2d_identity_complete check (
    (
      email_request_id is null
      and provisioned_by_auth_user_id is null
      and materialized_by_delivery_worker_auth_user_id is null
    ) or (
      email_request_id is not null
      and provisioned_by_auth_user_id is not null
      and (
        (state = 'queued'
          and materialized_by_delivery_worker_auth_user_id is null)
        or (state in ('materialized', 'invalidated'))
      )
    )
  );

alter table private.invitation_email_requests
  add constraint invitation_email_requests_job_fkey foreign key (
    circle_id, invitation_job_id, target_auth_user_id
  ) references private.invitation_jobs (
    circle_id, id, target_auth_user_id
  ) on delete restrict deferrable initially deferred,
  add constraint invitation_email_requests_job_unique unique (invitation_job_id);

alter table private.invitations
  add column recipient_binding_version smallint;

update private.invitations
   set recipient_binding_version = 1
 where invitation_job_id is not null;

alter table private.invitations
  add constraint invitations_recipient_binding_version_valid check (
    recipient_binding_version is null
    or recipient_binding_version in (1, 2)
  ),
  drop constraint invitations_target_binding_complete,
  add constraint invitations_target_binding_complete check (
    (
      invitation_job_id is null
      and target_auth_user_id is null
      and target_email_confirmed_at is null
      and recipient_binding is null
      and recipient_binding_version is null
    ) or (
      invitation_job_id is not null
      and target_auth_user_id is not null
      and recipient_binding is not null
      and (
        (recipient_binding_version = 1
          and target_email_confirmed_at is not null)
        or recipient_binding_version = 2
      )
    )
  );

alter table private.invitation_jobs
  drop constraint invitation_jobs_invalidation_reason_valid,
  add constraint invitation_jobs_invalidation_reason_valid check (
    invalidation_reason is null
    or invalidation_reason in (
      'legacy_authority_loss', 'requester_authority_lost',
      'target_unavailable', 'target_became_active',
      'target_identity_changed', 'target_accepted', 'account_closure',
      'expired', 'organizer_withdrawn', 'provisioner_revoked',
      'delivery_worker_revoked'
    )
  );

alter table private.invitations
  drop constraint invitations_revocation_reason_valid,
  add constraint invitations_revocation_reason_valid check (
    revocation_reason is null
    or revocation_reason in (
      'legacy_withdrawn', 'requester_authority_lost',
      'target_unavailable', 'target_became_active',
      'target_identity_changed', 'account_closure', 'expired',
      'organizer_withdrawn', 'provisioner_revoked',
      'delivery_worker_revoked'
    )
  );

create table private.invitation_delivery_receipts (
  id uuid primary key default extensions.gen_random_uuid(),
  circle_id uuid not null,
  email_request_id uuid not null unique,
  invitation_job_id uuid not null unique,
  invitation_id uuid not null unique,
  delivery_version integer not null,
  delivery_worker_auth_user_id uuid not null references auth.users (id)
    on delete restrict,
  provider text not null,
  provider_message_id text not null,
  provider_idempotency_key text not null,
  token_sha256 bytea not null,
  payload_sha256 bytea not null,
  recipient_binding bytea not null,
  provider_accepted_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  constraint invitation_delivery_receipts_request_fkey foreign key (
    circle_id, email_request_id
  ) references private.invitation_email_requests (circle_id, id)
    on delete restrict,
  constraint invitation_delivery_receipts_job_fkey foreign key (
    circle_id, invitation_job_id
  ) references private.invitation_jobs (circle_id, id) on delete restrict,
  constraint invitation_delivery_receipts_invitation_fkey foreign key (
    circle_id, invitation_id
  ) references private.invitations (circle_id, id) on delete restrict,
  constraint invitation_delivery_receipts_version_valid check (
    delivery_version between 1 and 2147483647
  ),
  constraint invitation_delivery_receipts_provider_valid check (
    provider = lower(btrim(provider))
    and provider ~ '^[a-z0-9][a-z0-9._-]{0,31}$'
  ),
  constraint invitation_delivery_receipts_provider_message_valid check (
    provider_message_id = btrim(provider_message_id)
    and char_length(provider_message_id) between 1 and 200
    and provider_message_id !~ '[[:cntrl:]]'
  ),
  constraint invitation_delivery_receipts_idempotency_valid check (
    provider_idempotency_key = btrim(provider_idempotency_key)
    and char_length(provider_idempotency_key) between 1 and 200
    and provider_idempotency_key !~ '[[:cntrl:]]'
  ),
  constraint invitation_delivery_receipts_payload_hash_valid check (
    octet_length(payload_sha256) = 32
  ),
  constraint invitation_delivery_receipts_token_hash_valid check (
    octet_length(token_sha256) = 32
  ),
  constraint invitation_delivery_receipts_recipient_binding_valid check (
    octet_length(recipient_binding) = 32
  ),
  constraint invitation_delivery_receipts_accepted_time_valid check (
    provider_accepted_at <= recorded_at + interval '5 minutes'
  ),
  constraint invitation_delivery_receipts_provider_idempotency_unique unique (
    provider, provider_idempotency_key
  ),
  constraint invitation_delivery_receipts_provider_message_unique unique (
    provider, provider_message_id
  )
);

create index invitation_delivery_receipts_worker_idx
  on private.invitation_delivery_receipts (
    delivery_worker_auth_user_id, recorded_at desc, id desc
  );

create table private.invitation_coordination_audit_events (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.circles (id) on delete restrict,
  email_request_id uuid not null,
  invitation_job_id uuid,
  actor_membership_id uuid,
  worker_auth_user_id uuid,
  event_type text not null,
  occurred_at timestamptz not null default statement_timestamp(),
  constraint invitation_coordination_audit_request_fkey foreign key (
    circle_id, email_request_id
  ) references private.invitation_email_requests (circle_id, id)
    on delete restrict,
  constraint invitation_coordination_audit_job_fkey foreign key (
    circle_id, invitation_job_id
  ) references private.invitation_jobs (circle_id, id) on delete restrict,
  constraint invitation_coordination_audit_actor_fkey foreign key (
    circle_id, actor_membership_id
  ) references public.circle_memberships (circle_id, id) on delete restrict,
  constraint invitation_coordination_audit_worker_fkey foreign key (
    worker_auth_user_id
  ) references auth.users (id) on delete restrict,
  constraint invitation_coordination_audit_actor_scope check (
    ((actor_membership_id is not null)::integer
      + (worker_auth_user_id is not null)::integer) <= 1
  ),
  constraint invitation_coordination_audit_event_valid check (
    event_type in (
      'email_request_created', 'auth_target_bound',
      'invitation_materialized', 'provider_delivery_recorded',
      'email_request_accepted', 'email_request_invalidated'
    )
  )
);

create index invitation_coordination_audit_request_idx
  on private.invitation_coordination_audit_events (
    email_request_id, occurred_at, id
  );

alter table private.invitation_provisioner_allowlist enable row level security;
alter table private.invitation_provisioner_allowlist force row level security;
alter table private.invitation_delivery_capabilities enable row level security;
alter table private.invitation_delivery_capabilities force row level security;
alter table private.invitation_delivery_worker_allowlist enable row level security;
alter table private.invitation_delivery_worker_allowlist force row level security;
alter table private.invitation_email_requests enable row level security;
alter table private.invitation_email_requests force row level security;
alter table private.invitation_delivery_receipts enable row level security;
alter table private.invitation_delivery_receipts force row level security;
alter table private.invitation_coordination_audit_events enable row level security;
alter table private.invitation_coordination_audit_events force row level security;

create function private.invitation_recipient_binding_v2(
  target_auth_user_id uuid,
  normalized_email text
)
returns bytea
language sql
immutable
security invoker
set search_path = ''
as $$
  select extensions.digest(
    pg_catalog.uuid_send(target_auth_user_id)
      || pg_catalog.convert_to(lower(btrim(normalized_email)), 'UTF8'),
    'sha256'
  );
$$;

create function private.enforce_invitation_worker_allowlist_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Invitation worker history cannot be deleted';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id
    or new.coordination_profile_version is distinct from
      old.coordination_profile_version
    or new.allowed_at is distinct from old.allowed_at
    or old.revoked_at is not null
    or new.revoked_at is null then
    raise exception using errcode = '42501',
      message = 'Invitation worker history is immutable';
  end if;
  return new;
end;
$$;

create trigger invitation_provisioner_allowlist_integrity
before update or delete on private.invitation_provisioner_allowlist
for each row execute function
  private.enforce_invitation_worker_allowlist_integrity();
create trigger invitation_delivery_worker_allowlist_integrity
before update or delete on private.invitation_delivery_worker_allowlist
for each row execute function
  private.enforce_invitation_worker_allowlist_integrity();

create function private.enforce_invitation_worker_identity_separation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_auth_user_id uuid;
begin
  if tg_table_schema = 'private' then
    if tg_op = 'UPDATE' and new.revoked_at is not null then return new; end if;
    target_auth_user_id := new.auth_user_id;
  else
    target_auth_user_id := new.user_id;
  end if;
  if target_auth_user_id is null then return new; end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = target_auth_user_id
     and auth_user.deleted_at is null
   for update;
  if not found or (select private.account_closure_is_blocking(
    target_auth_user_id
  )) then
    raise exception using errcode = '42501',
      message = 'Invitation worker identity separation failed';
  end if;

  if tg_table_schema = 'private' then
    if exists (
      select 1 from public.circle_memberships as membership
       where membership.user_id = target_auth_user_id
    ) or (
      tg_table_name <> 'photo_validator_allowlist'
      and exists (
        select 1 from private.photo_validator_allowlist as worker
         where worker.auth_user_id = target_auth_user_id
           and worker.revoked_at is null
      )
    ) or (
      tg_table_name = 'photo_validator_allowlist'
      and exists (
        select 1 from private.invitation_provisioner_allowlist as worker
         where worker.auth_user_id = target_auth_user_id
           and worker.revoked_at is null
        union all
        select 1 from private.invitation_delivery_worker_allowlist as worker
         where worker.auth_user_id = target_auth_user_id
           and worker.revoked_at is null
      )
    ) or (
      tg_table_name = 'invitation_provisioner_allowlist'
      and exists (
        select 1 from private.invitation_delivery_worker_allowlist as worker
         where worker.auth_user_id = target_auth_user_id
           and worker.revoked_at is null
      )
    ) or (
      tg_table_name = 'invitation_delivery_worker_allowlist'
      and exists (
        select 1 from private.invitation_provisioner_allowlist as worker
         where worker.auth_user_id = target_auth_user_id
           and worker.revoked_at is null
      )
    ) then
      raise exception using errcode = '42501',
        message = 'Invitation worker identity separation failed';
    end if;
  elsif exists (
    select 1 from private.invitation_provisioner_allowlist as worker
     where worker.auth_user_id = target_auth_user_id
       and worker.revoked_at is null
    union all
    select 1 from private.invitation_delivery_worker_allowlist as worker
     where worker.auth_user_id = target_auth_user_id
       and worker.revoked_at is null
  ) then
    raise exception using errcode = '42501',
      message = 'Invitation worker identity separation failed';
  end if;
  return new;
end;
$$;

create trigger invitation_provisioner_family_identity_separation
before insert or update on private.invitation_provisioner_allowlist
for each row execute function
  private.enforce_invitation_worker_identity_separation();
create trigger invitation_delivery_worker_family_identity_separation
before insert or update on private.invitation_delivery_worker_allowlist
for each row execute function
  private.enforce_invitation_worker_identity_separation();
create trigger photo_validator_invitation_worker_identity_separation
before insert or update on private.photo_validator_allowlist
for each row execute function
  private.enforce_invitation_worker_identity_separation();
create trigger circle_membership_invitation_worker_identity_separation
before insert or update of user_id on public.circle_memberships
for each row execute function
  private.enforce_invitation_worker_identity_separation();

create function private.lock_invitation_provisioner_if_allowed(
  requested_auth_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed_session_id text := (select auth.jwt() ->> 'session_id');
begin
  if requested_auth_user_id is null
    or claimed_session_id is null
    or claimed_session_id !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return false;
  end if;
  perform 1 from auth.users as auth_user
   where auth_user.id = requested_auth_user_id
     and auth_user.deleted_at is null
   for update;
  if not found or (select private.account_closure_is_blocking(
    requested_auth_user_id
  )) then return false; end if;
  perform 1 from auth.sessions as session
   where session.id = claimed_session_id::uuid
     and session.user_id = requested_auth_user_id
     and (session.not_after is null
       or session.not_after > statement_timestamp())
   for update;
  if not found then return false; end if;
  perform 1 from private.invitation_provisioner_allowlist as worker
   where worker.auth_user_id = requested_auth_user_id
     and worker.revoked_at is null
     and worker.coordination_profile_version = 1
   for update;
  if not found then return false; end if;
  return not exists (
    select 1 from public.circle_memberships as membership
     where membership.user_id = requested_auth_user_id
  ) and not exists (
    select 1 from private.invitation_delivery_worker_allowlist as worker
     where worker.auth_user_id = requested_auth_user_id
       and worker.revoked_at is null
  ) and not exists (
    select 1 from private.photo_validator_allowlist as worker
     where worker.auth_user_id = requested_auth_user_id
       and worker.revoked_at is null
  );
end;
$$;

create function private.lock_invitation_delivery_worker_if_allowed(
  requested_auth_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  claimed_session_id text := (select auth.jwt() ->> 'session_id');
begin
  if requested_auth_user_id is null
    or claimed_session_id is null
    or claimed_session_id !~
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return false;
  end if;
  perform 1 from auth.users as auth_user
   where auth_user.id = requested_auth_user_id
     and auth_user.deleted_at is null
   for update;
  if not found or (select private.account_closure_is_blocking(
    requested_auth_user_id
  )) then return false; end if;
  perform 1 from auth.sessions as session
   where session.id = claimed_session_id::uuid
     and session.user_id = requested_auth_user_id
     and (session.not_after is null
       or session.not_after > statement_timestamp())
   for update;
  if not found then return false; end if;
  perform 1 from private.invitation_delivery_worker_allowlist as worker
   where worker.auth_user_id = requested_auth_user_id
     and worker.revoked_at is null
     and worker.coordination_profile_version = 1
   for update;
  if not found then return false; end if;
  return not exists (
    select 1 from public.circle_memberships as membership
     where membership.user_id = requested_auth_user_id
  ) and not exists (
    select 1 from private.invitation_provisioner_allowlist as worker
     where worker.auth_user_id = requested_auth_user_id
       and worker.revoked_at is null
  ) and not exists (
    select 1 from private.photo_validator_allowlist as worker
     where worker.auth_user_id = requested_auth_user_id
       and worker.revoked_at is null
  );
end;
$$;

create function private.enforce_invitation_email_request_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Invitation email request history cannot be deleted';
  end if;
  if new.id is distinct from old.id
    or new.circle_id is distinct from old.circle_id
    or new.requested_by_membership_id is distinct from
      old.requested_by_membership_id
    or new.requester_authorization_version is distinct from
      old.requester_authorization_version
    or (
      new.normalized_email is distinct from old.normalized_email
      and not (
        old.state in ('queued', 'provisioned', 'delivered')
        and new.state in ('accepted', 'invalidated')
        and old.normalized_email is not null
        and new.normalized_email is null
      )
    )
    or new.email_salt is distinct from old.email_salt
    or new.email_hash is distinct from old.email_hash
    or new.invited_display_name is distinct from old.invited_display_name
    or new.request_key is distinct from old.request_key
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or old.state in ('accepted', 'invalidated')
    or not (
      (
        new.state = old.state
        and new.provisioned_at is not distinct from old.provisioned_at
        and new.provisioned_by_auth_user_id is not distinct from
          old.provisioned_by_auth_user_id
        and new.target_auth_user_id is not distinct from old.target_auth_user_id
        and new.invitation_job_id is not distinct from old.invitation_job_id
        and new.delivered_at is not distinct from old.delivered_at
        and new.accepted_at is not distinct from old.accepted_at
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidation_reason is not distinct from old.invalidation_reason
      ) or (
        old.state = 'queued' and new.state = 'provisioned'
        and new.provisioned_at is not null
        and new.provisioned_by_auth_user_id is not null
        and new.target_auth_user_id is not null
        and new.invitation_job_id is not null
        and new.delivered_at is null and new.accepted_at is null
        and new.invalidated_at is null and new.invalidation_reason is null
      ) or (
        old.state = 'provisioned' and new.state = 'delivered'
        and new.provisioned_at is not distinct from old.provisioned_at
        and new.provisioned_by_auth_user_id is not distinct from
          old.provisioned_by_auth_user_id
        and new.target_auth_user_id is not distinct from old.target_auth_user_id
        and new.invitation_job_id is not distinct from old.invitation_job_id
        and new.delivered_at is not null and new.accepted_at is null
        and new.invalidated_at is null and new.invalidation_reason is null
      ) or (
        old.state in ('provisioned', 'delivered')
        and new.state = 'accepted'
        and new.normalized_email is null
        and new.provisioned_at is not distinct from old.provisioned_at
        and new.provisioned_by_auth_user_id is not distinct from
          old.provisioned_by_auth_user_id
        and new.target_auth_user_id is not distinct from old.target_auth_user_id
        and new.invitation_job_id is not distinct from old.invitation_job_id
        and new.delivered_at is not null
        and new.accepted_at is not null
        and new.invalidated_at is null and new.invalidation_reason is null
      ) or (
        old.state in ('queued', 'provisioned', 'delivered')
        and new.state = 'invalidated'
        and new.normalized_email is null
        and new.provisioned_at is not distinct from old.provisioned_at
        and new.provisioned_by_auth_user_id is not distinct from
          old.provisioned_by_auth_user_id
        and new.target_auth_user_id is not distinct from old.target_auth_user_id
        and new.invitation_job_id is not distinct from old.invitation_job_id
        and new.delivered_at is not distinct from old.delivered_at
        and new.accepted_at is null
        and new.invalidated_at is not null
        and new.invalidation_reason is not null
      )
    ) then
    raise exception using errcode = '42501',
      message = 'Invitation email request identity is immutable';
  end if;
  return new;
end;
$$;

create trigger invitation_email_requests_integrity
before update or delete on private.invitation_email_requests
for each row execute function
  private.enforce_invitation_email_request_integrity();

create function private.enforce_invitation_delivery_receipt_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Invitation delivery receipts are immutable';
end;
$$;
create trigger invitation_delivery_receipts_integrity
before update or delete on private.invitation_delivery_receipts
for each row execute function
  private.enforce_invitation_delivery_receipt_integrity();

create function private.enforce_invitation_coordination_audit_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '42501',
    message = 'Invitation coordination audit is immutable';
end;
$$;
create trigger invitation_coordination_audit_integrity
before update or delete on private.invitation_coordination_audit_events
for each row execute function
  private.enforce_invitation_coordination_audit_integrity();

create or replace function private.enforce_invitation_job_integrity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  matching_closure_request_id uuid;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '42501',
      message = 'Invitation jobs cannot be deleted';
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
    or new.requested_by_membership_id is distinct from
      old.requested_by_membership_id
    or new.requester_authorization_version is distinct from
      old.requester_authorization_version
    or new.target_auth_user_id is distinct from old.target_auth_user_id
    or new.invited_display_name is distinct from old.invited_display_name
    or new.request_key is distinct from old.request_key
    or new.token_key_version is distinct from old.token_key_version
    or new.requested_at is distinct from old.requested_at
    or new.expires_at is distinct from old.expires_at
    or new.delivery_version is distinct from old.delivery_version
    or new.email_request_id is distinct from old.email_request_id
    or new.provisioned_by_auth_user_id is distinct from
      old.provisioned_by_auth_user_id
    or old.state in ('invalidated')
    or not (
      (
        new.state = old.state
        and new.materialized_at is not distinct from old.materialized_at
        and new.invitation_id is not distinct from old.invitation_id
        and new.materialized_by_delivery_worker_auth_user_id is not distinct
          from old.materialized_by_delivery_worker_auth_user_id
        and new.invalidated_at is not distinct from old.invalidated_at
        and new.invalidated_by_membership_id is not distinct from
          old.invalidated_by_membership_id
        and new.invalidated_by_closure_request_id is not distinct from
          old.invalidated_by_closure_request_id
        and new.invalidation_reason is not distinct from old.invalidation_reason
      ) or (
        old.state = 'queued' and new.state = 'materialized'
        and old.materialized_at is null and old.invitation_id is null
        and new.materialized_at is not null and new.invitation_id is not null
        and new.invalidated_at is null and new.invalidation_reason is null
        and (
          (new.email_request_id is null
            and new.materialized_by_delivery_worker_auth_user_id is null)
          or (new.email_request_id is not null
            and old.materialized_by_delivery_worker_auth_user_id is null
            and new.materialized_by_delivery_worker_auth_user_id is not null)
        )
      ) or (
        old.state in ('queued', 'materialized')
        and new.state = 'invalidated'
        and new.materialized_at is not distinct from old.materialized_at
        and new.invitation_id is not distinct from old.invitation_id
        and new.materialized_by_delivery_worker_auth_user_id is not distinct
          from old.materialized_by_delivery_worker_auth_user_id
        and new.invalidated_at is not null
        and new.invalidation_reason is not null
      )
    ) then
    raise exception using errcode = '42501',
      message = 'Invitation job identity is immutable';
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
    raise exception using errcode = '42501',
      message = 'Invitations cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if exists (
      select 1 from public.circle_memberships as creator
      join private.account_closure_requests as closure
        on closure.auth_user_id = creator.user_id
      where creator.circle_id = new.circle_id
        and creator.id = new.created_by_membership_id
        and closure.state in ('requested', 'prepared')
    ) then
      raise exception using errcode = '42501',
        message = 'Invitation could not be created';
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
    or new.target_email_confirmed_at is distinct from
      old.target_email_confirmed_at
    or new.recipient_binding is distinct from old.recipient_binding
    or new.recipient_binding_version is distinct from
      old.recipient_binding_version
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
        and new.revocation_reason is not distinct from old.revocation_reason
      ) or (
        old.accepted_at is null and old.revoked_at is null and (
          (new.accepted_at is not null
            and new.accepted_membership_id is not null
            and new.revoked_at is null)
          or (new.accepted_at is null and new.revoked_at is not null
            and new.revocation_reason is not null)
        )
      )
    ) then
    raise exception using errcode = '42501',
      message = 'Invitation state is immutable';
  end if;
  return new;
end;
$$;

create or replace function private.invalidate_target_bound_invitation_job(
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
      'account_closure', 'expired', 'organizer_withdrawn',
      'provisioner_revoked', 'delivery_worker_revoked'
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
         invalidated_by_closure_request_id =
           requested_invalidator_closure_request_id,
         invalidation_reason = requested_reason
   where job.id = target.id;

  if target.invitation_id is not null
    and requested_reason <> 'target_accepted' then
    update private.invitations as invitation
       set revoked_at = statement_timestamp(),
           revoked_by_membership_id = requested_invalidator_membership_id,
           revoked_by_closure_request_id =
             requested_invalidator_closure_request_id,
           revocation_reason = requested_reason
     where invitation.id = target.invitation_id
       and invitation.accepted_at is null
       and invitation.revoked_at is null;
  end if;
  return true;
end;
$$;

create function private.record_invitation_coordination_audit(
  requested_circle_id uuid,
  requested_email_request_id uuid,
  requested_invitation_job_id uuid,
  requested_actor_membership_id uuid,
  requested_worker_auth_user_id uuid,
  requested_event_type text
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into private.invitation_coordination_audit_events (
    circle_id, email_request_id, invitation_job_id,
    actor_membership_id, worker_auth_user_id, event_type
  ) values (
    requested_circle_id, requested_email_request_id,
    requested_invitation_job_id, requested_actor_membership_id,
    requested_worker_auth_user_id, requested_event_type
  );
$$;

create function private.invalidate_invitation_email_request(
  requested_email_request_id uuid,
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
  target private.invitation_email_requests%rowtype;
  job_reason text;
begin
  if requested_email_request_id is null
    or requested_reason not in (
      'requester_authority_lost', 'requester_account_closure',
      'target_became_active', 'target_identity_changed',
      'target_account_closure', 'provisioner_revoked',
      'delivery_worker_revoked', 'expired', 'organizer_withdrawn'
    ) then return false; end if;

  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id
   for update;
  if target.id is null then return false; end if;
  if target.state in ('accepted', 'invalidated') then return true; end if;

  if target.invitation_job_id is not null then
    job_reason := case requested_reason
      when 'requester_account_closure' then 'account_closure'
      when 'target_account_closure' then 'account_closure'
      else requested_reason
    end;
    return private.invalidate_target_bound_invitation_job(
      target.invitation_job_id,
      job_reason,
      requested_invalidator_membership_id,
      requested_invalidator_closure_request_id
    );
  end if;

  update private.invitation_email_requests as request
     set state = 'invalidated',
         normalized_email = null,
         invalidated_at = statement_timestamp(),
         invalidation_reason = requested_reason
   where request.id = target.id;
  perform private.record_invitation_coordination_audit(
    target.circle_id, target.id, null, requested_invalidator_membership_id,
    null, 'email_request_invalidated'
  );
  return true;
end;
$$;

create function private.sync_invitation_email_request_after_job_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.invitation_email_requests%rowtype;
  request_reason text;
begin
  if new.email_request_id is null then return new; end if;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = new.email_request_id
   for update;
  if request_row.id is null or request_row.state in ('accepted', 'invalidated')
    then return new;
  end if;

  if new.invalidation_reason = 'target_accepted' then
    update private.invitation_email_requests
       set state = 'accepted',
           normalized_email = null,
           delivered_at = coalesce(delivered_at, statement_timestamp()),
           accepted_at = statement_timestamp()
     where id = request_row.id;
    perform private.record_invitation_coordination_audit(
      request_row.circle_id, request_row.id, new.id,
      new.invalidated_by_membership_id, null, 'email_request_accepted'
    );
  else
    request_reason := case new.invalidation_reason
      when 'account_closure' then case
        when new.invalidated_by_closure_request_id is not null
          and exists (
            select 1 from private.account_closure_requests as closure
             where closure.id = new.invalidated_by_closure_request_id
               and closure.auth_user_id = request_row.target_auth_user_id
          ) then 'target_account_closure'
        else 'requester_account_closure'
      end
      else new.invalidation_reason
    end;
    update private.invitation_email_requests
       set state = 'invalidated',
           normalized_email = null,
           invalidated_at = statement_timestamp(),
           invalidation_reason = request_reason
     where id = request_row.id;
    perform private.record_invitation_coordination_audit(
      request_row.circle_id, request_row.id, new.id,
      new.invalidated_by_membership_id, null, 'email_request_invalidated'
    );
  end if;
  return new;
end;
$$;

create trigger invitation_jobs_sync_email_request_invalidation
after update of state on private.invitation_jobs
for each row
when (old.state <> 'invalidated' and new.state = 'invalidated')
execute function
  private.sync_invitation_email_request_after_job_invalidation();

create function private.request_invitation_email(
  requested_circle_id uuid,
  requested_email text,
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
  normalized_email text := lower(btrim(requested_email));
  normalized_display_name text := btrim(invited_display_name);
  actor public.circle_memberships%rowtype;
  existing private.invitation_email_requests%rowtype;
  stale private.invitation_email_requests%rowtype;
  resulting_request_id uuid;
begin
  if current_user_id is null or requested_circle_id is null
    or requested_request_key is null
    or normalized_email is null
    or char_length(normalized_email) not between 3 and 254
    or normalized_email !~
      '^[^[:space:][:cntrl:]@]+@[^[:space:][:cntrl:]@]+$'
    or normalized_display_name is null
    or char_length(normalized_display_name) not between 1 and 80 then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
  end if;

  if not coalesce((
    select capability.enabled
      from private.invitation_delivery_capabilities as capability
     where capability.capability = 'email_delivery'
  ), false) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;

  perform 1 from auth.users as auth_user
   where auth_user.id = current_user_id
     and auth_user.deleted_at is null
   for update;
  if not found or (select private.account_closure_is_blocking(
    current_user_id
  )) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;
  perform 1 from public.circles as circle
   where circle.id = requested_circle_id
   for update;
  if not found then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;
  select membership.* into actor
    from public.circle_memberships as membership
   where membership.circle_id = requested_circle_id
     and membership.user_id = current_user_id
   for update;
  if actor.id is null or actor.status <> 'active'
    or actor.role <> 'organizer' then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;

  select request.* into existing
    from private.invitation_email_requests as request
   where request.circle_id = requested_circle_id
     and request.requested_by_membership_id = actor.id
     and request.request_key = requested_request_key
   for update;
  if existing.id is not null then
    if extensions.digest(
      pg_catalog.convert_to(normalized_email, 'UTF8') || existing.email_salt,
      'sha256'
    ) = existing.email_hash
      and existing.invited_display_name = normalized_display_name then
      return existing.id;
    end if;
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
  end if;

  for stale in
    select request.* from private.invitation_email_requests as request
     where request.circle_id = requested_circle_id
       and request.state in ('queued', 'provisioned', 'delivered')
       and request.expires_at <= statement_timestamp()
     order by request.id
     for update
  loop
    perform private.invalidate_invitation_email_request(
      stale.id, 'expired', null, null
    );
  end loop;

  if exists (
    select 1 from auth.users as target_user
    join public.circle_memberships as target_membership
      on target_membership.user_id = target_user.id
     and target_membership.circle_id = requested_circle_id
     and target_membership.status = 'active'
    where lower(btrim(target_user.email)) = normalized_email
      and target_user.deleted_at is null
  ) or (
    select count(*) >= 5
      from private.invitation_email_requests as request
     where request.requested_by_membership_id = actor.id
       and request.requested_at > statement_timestamp() - interval '15 minutes'
  ) or (
    select count(*) >= 20
      from private.invitation_email_requests as request
     where request.circle_id = requested_circle_id
       and request.state in ('queued', 'provisioned', 'delivered')
  ) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be requested';
  end if;

  insert into private.invitation_email_requests (
    circle_id, requested_by_membership_id,
    requester_authorization_version, normalized_email, email_salt, email_hash,
    invited_display_name, request_key
  ) select
    requested_circle_id, actor.id, actor.updated_at, normalized_email,
    generated_salt,
    extensions.digest(
      pg_catalog.convert_to(normalized_email, 'UTF8') || generated_salt,
      'sha256'
    ),
    normalized_display_name, requested_request_key
  from (select extensions.gen_random_bytes(16) as generated_salt) as salt
  returning id into resulting_request_id;

  perform private.record_invitation_coordination_audit(
    requested_circle_id, resulting_request_id, null, actor.id, null,
    'email_request_created'
  );
  return resulting_request_id;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be requested';
end;
$$;

create function private.withdraw_invitation_email_request(
  requested_email_request_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target private.invitation_email_requests%rowtype;
  actor public.circle_memberships%rowtype;
begin
  if current_user_id is null or requested_email_request_id is null then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be withdrawn';
  end if;
  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id;
  if target.id is null then
    raise exception using errcode = '22023',
      message = 'Invitation email could not be withdrawn';
  end if;
  perform 1 from auth.users where id = current_user_id for update;
  perform 1 from public.circles where id = target.circle_id for update;
  select membership.* into actor
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.user_id = current_user_id
   for update;
  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id
   for update;
  if actor.id is null or actor.status <> 'active' or actor.role <> 'organizer'
    or (select private.account_closure_is_blocking(current_user_id)) then
    raise exception using errcode = '42501',
      message = 'Invitation email could not be withdrawn';
  end if;
  perform private.invalidate_invitation_email_request(
    target.id, 'organizer_withdrawn', actor.id, null
  );
end;
$$;

create function private.load_invitation_email_request(
  requested_email_request_id uuid
)
returns table (
  email_request_id uuid,
  circle_id uuid,
  requester_membership_id uuid,
  requester_authorization_version timestamptz,
  normalized_email text,
  invited_display_name text,
  state text,
  invitation_job_id uuid,
  requested_at timestamptz,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target private.invitation_email_requests%rowtype;
  requester public.circle_memberships%rowtype;
begin
  if current_user_id is null or requested_email_request_id is null
    or not (select private.lock_invitation_provisioner_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation provisioning request is unavailable';
  end if;

  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id;
  if target.id is null then return; end if;

  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id;
  perform auth_user.id from auth.users as auth_user
   where auth_user.id = requester.user_id for update;
  perform 1 from public.circles where id = target.circle_id for update;
  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id
   for update;
  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;

  if target.state in ('accepted', 'invalidated') then return; end if;
  if target.expires_at <= statement_timestamp() then
    perform private.invalidate_invitation_email_request(
      target.id, 'expired', null, null
    );
    return;
  elsif requester.id is null or requester.user_id is null
    or requester.status <> 'active' or requester.role <> 'organizer'
    or requester.updated_at <> target.requester_authorization_version then
    perform private.invalidate_invitation_email_request(
      target.id, 'requester_authority_lost', null, null
    );
    return;
  elsif (select private.account_closure_is_blocking(requester.user_id)) then
    perform private.invalidate_invitation_email_request(
      target.id, 'requester_account_closure', null, null
    );
    return;
  elsif target.state <> 'queued'
    and target.provisioned_by_auth_user_id is distinct from current_user_id then
    return;
  end if;

  return query select
    target.id, target.circle_id, target.requested_by_membership_id,
    target.requester_authorization_version, target.normalized_email,
    target.invited_display_name, target.state, target.invitation_job_id,
    target.requested_at, target.expires_at;
end;
$$;

create function private.complete_invitation_email_provisioning(
  requested_email_request_id uuid,
  requested_target_auth_user_id uuid
)
returns table (
  email_request_id uuid,
  invitation_job_id uuid,
  target_auth_user_id uuid,
  target_email_confirmed boolean,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  target private.invitation_email_requests%rowtype;
  requester public.circle_memberships%rowtype;
  target_email text;
  target_confirmed_at timestamptz;
  generated_job_id uuid;
begin
  if current_user_id is null or requested_email_request_id is null
    or requested_target_auth_user_id is null
    or not (select private.lock_invitation_provisioner_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation provisioning could not be completed';
  end if;

  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id;
  if target.id is null then return; end if;
  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id;

  perform auth_user.id from auth.users as auth_user
   where auth_user.id in (requester.user_id, requested_target_auth_user_id)
   order by auth_user.id for update;
  perform 1 from public.circles where id = target.circle_id for update;
  select request.* into target
    from private.invitation_email_requests as request
   where request.id = requested_email_request_id
   for update;
  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = target.circle_id
     and membership.id = target.requested_by_membership_id
   for update;
  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into target_email, target_confirmed_at
    from auth.users as auth_user
   where auth_user.id = requested_target_auth_user_id
     and auth_user.deleted_at is null;

  if target.state in ('provisioned', 'delivered') then
    if target.provisioned_by_auth_user_id = current_user_id
      and target.target_auth_user_id = requested_target_auth_user_id
      and target.invitation_job_id is not null then
      return query select target.id, target.invitation_job_id,
        target.target_auth_user_id, target_confirmed_at is not null,
        target.expires_at;
      return;
    end if;
    raise exception using errcode = '22023',
      message = 'Invitation provisioning could not be completed';
  elsif target.state in ('accepted', 'invalidated') then
    return;
  end if;

  if target.expires_at <= statement_timestamp() then
    perform private.invalidate_invitation_email_request(
      target.id, 'expired', null, null
    );
    return;
  elsif requester.id is null or requester.user_id is null
    or requester.status <> 'active' or requester.role <> 'organizer'
    or requester.updated_at <> target.requester_authorization_version then
    perform private.invalidate_invitation_email_request(
      target.id, 'requester_authority_lost', null, null
    );
    return;
  elsif (select private.account_closure_is_blocking(requester.user_id)) then
    perform private.invalidate_invitation_email_request(
      target.id, 'requester_account_closure', null, null
    );
    return;
  elsif target_email is distinct from target.normalized_email then
    raise exception using errcode = '22023',
      message = 'Invitation provisioning could not be completed';
  elsif exists (
    select 1 from private.invitation_provisioner_allowlist as worker
     where worker.auth_user_id = requested_target_auth_user_id
       and worker.revoked_at is null
    union all
    select 1 from private.invitation_delivery_worker_allowlist as worker
     where worker.auth_user_id = requested_target_auth_user_id
       and worker.revoked_at is null
    union all
    select 1 from private.photo_validator_allowlist as worker
     where worker.auth_user_id = requested_target_auth_user_id
       and worker.revoked_at is null
  ) then
    perform private.invalidate_invitation_email_request(
      target.id, 'target_identity_changed', null, null
    );
    return;
  elsif (select private.account_closure_is_blocking(
    requested_target_auth_user_id
  )) then
    perform private.invalidate_invitation_email_request(
      target.id, 'target_account_closure', null, null
    );
    return;
  elsif exists (
    select 1 from public.circle_memberships as membership
     where membership.circle_id = target.circle_id
       and membership.user_id = requested_target_auth_user_id
       and membership.status = 'active'
  ) then
    perform private.invalidate_invitation_email_request(
      target.id, 'target_became_active', null, null
    );
    return;
  end if;

  generated_job_id := extensions.gen_random_uuid();
  insert into private.invitation_jobs (
    id, circle_id, requested_by_membership_id,
    requester_authorization_version, target_auth_user_id,
    invited_display_name, request_key, requested_at, expires_at,
    email_request_id, provisioned_by_auth_user_id
  ) values (
    generated_job_id, target.circle_id, target.requested_by_membership_id,
    target.requester_authorization_version, requested_target_auth_user_id,
    target.invited_display_name, target.request_key,
    target.requested_at, target.expires_at, target.id, current_user_id
  );

  update private.invitation_email_requests
     set state = 'provisioned',
         provisioned_at = statement_timestamp(),
         provisioned_by_auth_user_id = current_user_id,
         target_auth_user_id = requested_target_auth_user_id,
         invitation_job_id = generated_job_id
   where id = target.id;

  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    target.circle_id, target.requested_by_membership_id,
    'invitation_job_requested', 'invitation_job', generated_job_id
  );
  perform private.record_invitation_coordination_audit(
    target.circle_id, target.id, generated_job_id, null, current_user_id,
    'auth_target_bound'
  );
  return query select target.id, generated_job_id,
    requested_target_auth_user_id, target_confirmed_at is not null,
    target.expires_at;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using errcode = '22023',
      message = 'Invitation provisioning could not be completed';
end;
$$;

create function private.refresh_phase_2d_invitation_job(
  requested_invitation_job_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  job private.invitation_jobs%rowtype;
  request_row private.invitation_email_requests%rowtype;
  requester public.circle_memberships%rowtype;
  invitation private.invitations%rowtype;
  target_email text;
  target_deleted_at timestamptz;
  requester_closure_id uuid;
  target_closure_id uuid;
  reason text;
begin
  select job_row.* into job
    from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id;
  if job.id is null or job.email_request_id is null then return false; end if;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id;
  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.id = job.requested_by_membership_id;

  perform auth_user.id from auth.users as auth_user
   where auth_user.id in (
     requester.user_id, job.target_auth_user_id,
     job.provisioned_by_auth_user_id,
     job.materialized_by_delivery_worker_auth_user_id
   ) order by auth_user.id for update;
  perform 1 from private.invitation_provisioner_allowlist as worker
   where worker.auth_user_id = job.provisioned_by_auth_user_id
   for update;
  if job.materialized_by_delivery_worker_auth_user_id is not null then
    perform 1 from private.invitation_delivery_worker_allowlist as worker
     where worker.auth_user_id =
       job.materialized_by_delivery_worker_auth_user_id
     for update;
  end if;
  perform 1 from public.circles where id = job.circle_id for update;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id
   for update;
  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.id = job.requested_by_membership_id
   for update;
  select job_row.* into job
    from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id
   for update;
  select lower(btrim(auth_user.email)), auth_user.deleted_at
    into target_email, target_deleted_at
    from auth.users as auth_user
   where auth_user.id = job.target_auth_user_id;

  if request_row.state in ('accepted', 'invalidated')
    or job.state = 'invalidated' then return false; end if;

  select closure.id into requester_closure_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = requester.user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id limit 1;
  select closure.id into target_closure_id
    from private.account_closure_requests as closure
   where closure.auth_user_id = job.target_auth_user_id
     and closure.state in ('requested', 'prepared')
   order by closure.requested_at desc, closure.id limit 1;

  if request_row.circle_id is distinct from job.circle_id
    or request_row.invitation_job_id is distinct from job.id
    or request_row.target_auth_user_id is distinct from job.target_auth_user_id
    or request_row.requested_by_membership_id is distinct from
      job.requested_by_membership_id
    or request_row.requester_authorization_version is distinct from
      job.requester_authorization_version then
    reason := 'target_identity_changed';
  elsif request_row.expires_at <= statement_timestamp()
    or job.expires_at <= statement_timestamp() then
    reason := 'expired';
  elsif requester_closure_id is not null then
    reason := 'requester_account_closure';
  elsif requester.id is null or requester.user_id is null
    or requester.status <> 'active' or requester.role <> 'organizer'
    or requester.updated_at <> job.requester_authorization_version then
    reason := 'requester_authority_lost';
  elsif not exists (
    select 1 from private.invitation_provisioner_allowlist as worker
    join auth.users as auth_user on auth_user.id = worker.auth_user_id
    where worker.auth_user_id = job.provisioned_by_auth_user_id
      and worker.revoked_at is null
      and worker.coordination_profile_version = 1
      and auth_user.deleted_at is null
      and not (select private.account_closure_is_blocking(auth_user.id))
      and not exists (
        select 1 from public.circle_memberships as membership
         where membership.user_id = auth_user.id
      )
  ) then
    reason := 'provisioner_revoked';
  elsif target_closure_id is not null then
    reason := 'target_account_closure';
  elsif target_deleted_at is not null or target_email is null
    or target_email is distinct from request_row.normalized_email then
    reason := 'target_identity_changed';
  elsif exists (
    select 1 from private.invitation_provisioner_allowlist as worker
     where worker.auth_user_id = job.target_auth_user_id
       and worker.revoked_at is null
    union all
    select 1 from private.invitation_delivery_worker_allowlist as worker
     where worker.auth_user_id = job.target_auth_user_id
       and worker.revoked_at is null
    union all
    select 1 from private.photo_validator_allowlist as worker
     where worker.auth_user_id = job.target_auth_user_id
       and worker.revoked_at is null
  ) then
    reason := 'target_identity_changed';
  elsif exists (
    select 1 from public.circle_memberships as membership
     where membership.circle_id = job.circle_id
       and membership.user_id = job.target_auth_user_id
       and membership.status = 'active'
  ) then
    reason := 'target_became_active';
  elsif job.state not in ('queued', 'materialized')
    or request_row.state not in ('provisioned', 'delivered') then
    reason := 'target_identity_changed';
  end if;

  if reason is null and job.state = 'materialized' then
    if job.materialized_by_delivery_worker_auth_user_id is null
      or not exists (
        select 1 from private.invitation_delivery_worker_allowlist as worker
        join auth.users as auth_user on auth_user.id = worker.auth_user_id
        where worker.auth_user_id =
            job.materialized_by_delivery_worker_auth_user_id
          and worker.revoked_at is null
          and worker.coordination_profile_version = 1
          and auth_user.deleted_at is null
          and not (select private.account_closure_is_blocking(auth_user.id))
          and not exists (
            select 1 from public.circle_memberships as membership
             where membership.user_id = auth_user.id
          )
      ) then
      reason := 'delivery_worker_revoked';
    else
      select target_invitation.* into invitation
        from private.invitations as target_invitation
       where target_invitation.id = job.invitation_id
       for update;
      if invitation.id is null
        or invitation.invitation_job_id is distinct from job.id
        or invitation.target_auth_user_id is distinct from job.target_auth_user_id
        or invitation.recipient_binding_version is distinct from 2
        or invitation.recipient_binding is distinct from
          private.invitation_recipient_binding_v2(
            job.target_auth_user_id, request_row.normalized_email
          )
        or invitation.email_hash is distinct from extensions.digest(
          pg_catalog.convert_to(request_row.normalized_email, 'UTF8')
            || invitation.email_salt,
          'sha256'
        )
        or invitation.accepted_at is not null
        or invitation.revoked_at is not null then
        reason := 'target_identity_changed';
      end if;
    end if;
  end if;

  if reason is not null then
    perform private.invalidate_invitation_email_request(
      request_row.id, reason,
      null,
      case reason
        when 'requester_account_closure' then requester_closure_id
        when 'target_account_closure' then target_closure_id
        else null
      end
    );
    return false;
  end if;
  return true;
end;
$$;

create function private.load_invitation_delivery_job(
  requested_invitation_job_id uuid
)
returns table (
  invitation_job_id uuid,
  email_request_id uuid,
  circle_id uuid,
  requester_membership_id uuid,
  requester_authorization_version timestamptz,
  target_auth_user_id uuid,
  invited_display_name text,
  request_key uuid,
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
  current_user_id uuid := (select auth.uid());
  job private.invitation_jobs%rowtype;
begin
  if current_user_id is null or requested_invitation_job_id is null
    or not (select private.lock_invitation_delivery_worker_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation delivery job is unavailable';
  end if;
  if not private.refresh_phase_2d_invitation_job(
    requested_invitation_job_id
  ) then return; end if;
  select job_row.* into job
    from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id
   for update;
  if job.state = 'materialized'
    and job.materialized_by_delivery_worker_auth_user_id is distinct from
      current_user_id then return; end if;
  return query select
    job.id, job.email_request_id, job.circle_id,
    job.requested_by_membership_id, job.requester_authorization_version,
    job.target_auth_user_id, job.invited_display_name, job.request_key,
    job.state, job.token_key_version, job.delivery_version,
    job.requested_at, job.expires_at;
end;
$$;

create function private.materialize_invitation_delivery_job(
  requested_invitation_job_id uuid,
  requested_delivery_version integer,
  requested_token_sha256_hex text
)
returns table (
  invitation_job_id uuid,
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
  current_user_id uuid := (select auth.uid());
  job private.invitation_jobs%rowtype;
  request_row private.invitation_email_requests%rowtype;
  existing_invitation private.invitations%rowtype;
  existing_target_membership public.circle_memberships%rowtype;
  generated_person_id uuid;
  generated_invitation_id uuid;
  invitation_salt bytea;
  binding bytea;
  target_confirmed_at timestamptz;
begin
  if current_user_id is null or requested_invitation_job_id is null
    or requested_delivery_version is null or requested_delivery_version < 1
    or requested_token_sha256_hex is null
    or requested_token_sha256_hex !~ '^[0-9a-f]{64}$'
    or not (select private.lock_invitation_delivery_worker_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation delivery could not be materialized';
  end if;
  if not private.refresh_phase_2d_invitation_job(
    requested_invitation_job_id
  ) then return; end if;

  select job_row.* into job
    from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id
   for update;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id
   for update;
  select auth_user.email_confirmed_at into target_confirmed_at
    from auth.users as auth_user
   where auth_user.id = job.target_auth_user_id;
  binding := private.invitation_recipient_binding_v2(
    job.target_auth_user_id, request_row.normalized_email
  );

  if job.state = 'materialized' then
    select invitation.* into existing_invitation
      from private.invitations as invitation
     where invitation.id = job.invitation_id
     for update;
    if job.materialized_by_delivery_worker_auth_user_id = current_user_id
      and job.delivery_version = requested_delivery_version
      and existing_invitation.token_hash =
        decode(requested_token_sha256_hex, 'hex')
      and existing_invitation.recipient_binding = binding
      and existing_invitation.recipient_binding_version = 2
      and existing_invitation.accepted_at is null
      and existing_invitation.revoked_at is null then
      return query select job.id, existing_invitation.id, job.state,
        job.delivery_version, job.expires_at;
      return;
    end if;
    raise exception using errcode = '22023',
      message = 'Invitation delivery could not be materialized';
  end if;
  if job.state <> 'queued'
    or request_row.state <> 'provisioned'
    or job.delivery_version <> requested_delivery_version then return; end if;

  select membership.* into existing_target_membership
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.user_id = job.target_auth_user_id
   for update;
  if existing_target_membership.id is not null then
    if existing_target_membership.status <> 'revoked' then
      perform private.invalidate_invitation_email_request(
        request_row.id, 'target_became_active', null, null
      );
      return;
    end if;
    generated_person_id := existing_target_membership.person_id;
  else
    insert into public.people (
      circle_id, display_name, profile_kind, created_by_membership_id
    ) values (
      job.circle_id, job.invited_display_name, 'account',
      job.requested_by_membership_id
    ) returning id into generated_person_id;
  end if;

  generated_invitation_id := extensions.gen_random_uuid();
  invitation_salt := extensions.gen_random_bytes(16);
  insert into private.invitations (
    id, circle_id, person_id, created_by_membership_id,
    token_hash, email_salt, email_hash, expires_at,
    invitation_job_id, target_auth_user_id,
    target_email_confirmed_at, recipient_binding,
    recipient_binding_version
  ) values (
    generated_invitation_id, job.circle_id, generated_person_id,
    job.requested_by_membership_id,
    decode(requested_token_sha256_hex, 'hex'), invitation_salt,
    extensions.digest(
      pg_catalog.convert_to(request_row.normalized_email, 'UTF8')
        || invitation_salt,
      'sha256'
    ),
    job.expires_at, job.id, job.target_auth_user_id,
    target_confirmed_at, binding, 2
  );

  update private.invitation_jobs
     set state = 'materialized',
         materialized_at = statement_timestamp(),
         invitation_id = generated_invitation_id,
         materialized_by_delivery_worker_auth_user_id = current_user_id
   where id = job.id
   returning * into job;
  insert into private.audit_events (
    circle_id, actor_membership_id, event_type, subject_type, subject_id
  ) values (
    job.circle_id, job.requested_by_membership_id,
    'invitation_created', 'invitation', generated_invitation_id
  );
  perform private.record_invitation_coordination_audit(
    job.circle_id, job.email_request_id, job.id, null, current_user_id,
    'invitation_materialized'
  );
  return query select job.id, generated_invitation_id, job.state,
    job.delivery_version, job.expires_at;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using errcode = '22023',
      message = 'Invitation delivery could not be materialized';
end;
$$;

create function private.read_invitation_delivery_auth(
  requested_invitation_job_id uuid
)
returns table (
  invitation_job_id uuid,
  invitation_id uuid,
  delivery_version integer,
  token_sha256_hex text,
  target_auth_user_id uuid,
  normalized_email text,
  email_confirmed_at timestamptz,
  recipient_binding_hex text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  job private.invitation_jobs%rowtype;
  request_row private.invitation_email_requests%rowtype;
  invitation private.invitations%rowtype;
  confirmed_at timestamptz;
begin
  if current_user_id is null or requested_invitation_job_id is null
    or not (select private.lock_invitation_delivery_worker_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation delivery authorization is unavailable';
  end if;
  if not private.refresh_phase_2d_invitation_job(
    requested_invitation_job_id
  ) then return; end if;
  select job_row.* into job from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id for update;
  if job.state <> 'materialized'
    or job.materialized_by_delivery_worker_auth_user_id is distinct from
      current_user_id then return; end if;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id for update;
  select target_invitation.* into invitation
    from private.invitations as target_invitation
   where target_invitation.id = job.invitation_id for update;
  select auth_user.email_confirmed_at into confirmed_at
    from auth.users as auth_user
   where auth_user.id = job.target_auth_user_id for update;
  return query select job.id, invitation.id, job.delivery_version,
    encode(invitation.token_hash, 'hex'), job.target_auth_user_id,
    request_row.normalized_email, confirmed_at,
    encode(invitation.recipient_binding, 'hex');
end;
$$;

create function private.complete_invitation_delivery(
  requested_invitation_job_id uuid,
  requested_invitation_id uuid,
  requested_delivery_version integer,
  requested_token_sha256_hex text,
  requested_recipient_binding_hex text,
  requested_provider text,
  requested_provider_message_id text,
  requested_provider_idempotency_key text,
  requested_payload_sha256_hex text,
  requested_provider_accepted_at timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_provider text := lower(btrim(requested_provider));
  normalized_message_id text := btrim(requested_provider_message_id);
  normalized_idempotency_key text := btrim(
    requested_provider_idempotency_key
  );
  job private.invitation_jobs%rowtype;
  request_row private.invitation_email_requests%rowtype;
  invitation private.invitations%rowtype;
  existing private.invitation_delivery_receipts%rowtype;
  generated_receipt_id uuid;
begin
  if current_user_id is null or requested_invitation_job_id is null
    or requested_invitation_id is null or requested_delivery_version is null
    or requested_delivery_version < 1
    or requested_token_sha256_hex !~ '^[0-9a-f]{64}$'
    or requested_recipient_binding_hex !~ '^[0-9a-f]{64}$'
    or requested_payload_sha256_hex !~ '^[0-9a-f]{64}$'
    or normalized_provider !~ '^[a-z0-9][a-z0-9._-]{0,31}$'
    or char_length(normalized_message_id) not between 1 and 200
    or normalized_message_id ~ '[[:cntrl:]]'
    or char_length(normalized_idempotency_key) not between 1 and 200
    or normalized_idempotency_key ~ '[[:cntrl:]]'
    or requested_provider_accepted_at is null
    or requested_provider_accepted_at >
      statement_timestamp() + interval '5 minutes'
    or not (select private.lock_invitation_delivery_worker_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation delivery could not be completed';
  end if;
  select job_row.* into job from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id for update;
  if job.id is null or job.email_request_id is null then return null; end if;
  select receipt.* into existing
    from private.invitation_delivery_receipts as receipt
   where receipt.invitation_job_id = job.id
   for update;

  -- A provider may have accepted a send immediately before the request was
  -- accepted, withdrawn, or expired. Preserve exactly-once acknowledgement of
  -- that already-recorded side effect, but never re-authorize a fresh send.
  if existing.id is not null then
    if existing.circle_id = job.circle_id
      and existing.email_request_id = job.email_request_id
      and existing.invitation_id = requested_invitation_id
      and existing.delivery_version = requested_delivery_version
      and existing.delivery_worker_auth_user_id = current_user_id
      and existing.provider = normalized_provider
      and existing.provider_message_id = normalized_message_id
      and existing.provider_idempotency_key = normalized_idempotency_key
      and existing.token_sha256 = decode(requested_token_sha256_hex, 'hex')
      and existing.payload_sha256 = decode(requested_payload_sha256_hex, 'hex')
      and existing.recipient_binding =
        decode(requested_recipient_binding_hex, 'hex')
      and existing.provider_accepted_at = requested_provider_accepted_at then
      return existing.id;
    end if;
    raise exception using errcode = '22023',
      message = 'Invitation delivery receipt did not match';
  end if;

  if not private.refresh_phase_2d_invitation_job(
    requested_invitation_job_id
  ) then return null; end if;

  select job_row.* into job from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id for update;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id for update;
  select target_invitation.* into invitation
    from private.invitations as target_invitation
   where target_invitation.id = job.invitation_id for update;

  if job.state <> 'materialized'
    or job.materialized_by_delivery_worker_auth_user_id is distinct from
      current_user_id
    or job.invitation_id is distinct from requested_invitation_id
    or job.delivery_version is distinct from requested_delivery_version
    or invitation.token_hash is distinct from
      decode(requested_token_sha256_hex, 'hex')
    or invitation.recipient_binding is distinct from
      decode(requested_recipient_binding_hex, 'hex') then
    raise exception using errcode = '22023',
      message = 'Invitation delivery could not be completed';
  end if;

  if request_row.state <> 'provisioned' then
    raise exception using errcode = '22023',
      message = 'Invitation delivery could not be completed';
  end if;

  generated_receipt_id := extensions.gen_random_uuid();
  insert into private.invitation_delivery_receipts (
    id, circle_id, email_request_id, invitation_job_id, invitation_id,
    delivery_version, delivery_worker_auth_user_id, provider,
    provider_message_id, provider_idempotency_key, token_sha256,
    payload_sha256, recipient_binding, provider_accepted_at
  ) values (
    generated_receipt_id, job.circle_id, job.email_request_id, job.id,
    requested_invitation_id, requested_delivery_version, current_user_id,
    normalized_provider, normalized_message_id, normalized_idempotency_key,
    decode(requested_token_sha256_hex, 'hex'),
    decode(requested_payload_sha256_hex, 'hex'),
    decode(requested_recipient_binding_hex, 'hex'),
    requested_provider_accepted_at
  );
  update private.invitation_email_requests
     set state = 'delivered', delivered_at = statement_timestamp()
   where id = request_row.id;
  perform private.record_invitation_coordination_audit(
    job.circle_id, job.email_request_id, job.id, null, current_user_id,
    'provider_delivery_recorded'
  );
  return generated_receipt_id;
exception
  when check_violation or foreign_key_violation or unique_violation then
    raise exception using errcode = '22023',
      message = 'Invitation delivery receipt did not match';
end;
$$;

create function private.read_delivered_invitation(
  requested_invitation_job_id uuid
)
returns table (
  receipt_id uuid,
  circle_id uuid,
  email_request_id uuid,
  invitation_job_id uuid,
  invitation_id uuid,
  delivery_version integer,
  delivery_worker_auth_user_id uuid,
  provider text,
  provider_message_id text,
  provider_idempotency_key text,
  token_sha256_hex text,
  payload_sha256_hex text,
  recipient_binding_hex text,
  provider_accepted_at timestamptz,
  recorded_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  job private.invitation_jobs%rowtype;
  receipt private.invitation_delivery_receipts%rowtype;
begin
  if current_user_id is null or requested_invitation_job_id is null
    or not (select private.lock_invitation_delivery_worker_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Delivered invitation is unavailable';
  end if;
  select job_row.* into job from private.invitation_jobs as job_row
   where job_row.id = requested_invitation_job_id for update;
  if job.id is null
    or job.email_request_id is null
    or job.materialized_by_delivery_worker_auth_user_id is distinct from
    current_user_id then return; end if;
  select receipt_row.* into receipt
    from private.invitation_delivery_receipts as receipt_row
   where receipt_row.invitation_job_id = job.id
   for update;
  if receipt.id is null then return; end if;
  return query select receipt.id, receipt.circle_id,
    receipt.email_request_id, receipt.invitation_job_id,
    receipt.invitation_id, receipt.delivery_version,
    receipt.delivery_worker_auth_user_id, receipt.provider,
    receipt.provider_message_id, receipt.provider_idempotency_key,
    encode(receipt.token_sha256, 'hex'),
    encode(receipt.payload_sha256, 'hex'),
    encode(receipt.recipient_binding, 'hex'),
    receipt.provider_accepted_at, receipt.recorded_at;
end;
$$;

create function private.accept_phase_2d_invitation(invitation_token text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  requested_token_hash bytea;
  invitation_row private.invitations%rowtype;
  job private.invitation_jobs%rowtype;
  request_row private.invitation_email_requests%rowtype;
  requester public.circle_memberships%rowtype;
  receipt private.invitation_delivery_receipts%rowtype;
  existing_membership public.circle_memberships%rowtype;
  current_email text;
  current_confirmed_at timestamptz;
  resulting_membership_id uuid;
begin
  if current_user_id is null or invitation_token is null
    or char_length(invitation_token) not between 40 and 64 then
    raise exception using errcode = '22023',
      message = 'Invitation is not available';
  end if;
  requested_token_hash := extensions.digest(invitation_token, 'sha256');
  select invitation.* into invitation_row
    from private.invitations as invitation
   where invitation.token_hash = requested_token_hash
     and invitation.recipient_binding_version = 2;
  if invitation_row.id is null then
    raise exception using errcode = '22023',
      message = 'Invitation is not available';
  end if;
  select job_row.* into job from private.invitation_jobs as job_row
   where job_row.id = invitation_row.invitation_job_id;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id;
  select membership.* into requester
    from public.circle_memberships as membership
   where membership.circle_id = job.circle_id
     and membership.id = job.requested_by_membership_id;

  perform auth_user.id from auth.users as auth_user
   where auth_user.id in (
     current_user_id, requester.user_id, job.provisioned_by_auth_user_id,
     job.materialized_by_delivery_worker_auth_user_id
   ) order by auth_user.id for update;
  perform 1 from public.circles where id = job.circle_id for update;
  if not private.refresh_phase_2d_invitation_job(job.id) then return null; end if;

  select job_row.* into job from private.invitation_jobs as job_row
   where job_row.id = job.id for update;
  select request.* into request_row
    from private.invitation_email_requests as request
   where request.id = job.email_request_id for update;
  select target_invitation.* into invitation_row
    from private.invitations as target_invitation
   where target_invitation.id = invitation_row.id for update;
  select lower(btrim(auth_user.email)), auth_user.email_confirmed_at
    into current_email, current_confirmed_at
    from auth.users as auth_user
   where auth_user.id = current_user_id
     and auth_user.deleted_at is null
   for update;
  select receipt_row.* into receipt
    from private.invitation_delivery_receipts as receipt_row
   where receipt_row.invitation_job_id = job.id
   for update;

  if current_user_id is distinct from job.target_auth_user_id then return null; end if;
  if current_email is distinct from request_row.normalized_email then
    perform private.invalidate_invitation_email_request(
      request_row.id, 'target_identity_changed', null, null
    );
    return null;
  end if;
  -- An unconfirmed provisioned Auth account remains pending. The database never
  -- confirms it; acceptance becomes possible only after Auth records confirmation.
  if current_confirmed_at is null then return null; end if;
  if (select private.account_closure_is_blocking(current_user_id)) then
    perform private.invalidate_invitation_email_request(
      request_row.id, 'target_account_closure', null, null
    );
    return null;
  end if;
  if request_row.state <> 'delivered'
    or job.state <> 'materialized'
    or job.invitation_id is distinct from invitation_row.id
    or invitation_row.accepted_at is not null
    or invitation_row.revoked_at is not null
    or invitation_row.token_hash is distinct from requested_token_hash
    or invitation_row.recipient_binding is distinct from
      private.invitation_recipient_binding_v2(
        current_user_id, request_row.normalized_email
      )
    or invitation_row.email_hash is distinct from extensions.digest(
      pg_catalog.convert_to(request_row.normalized_email, 'UTF8')
        || invitation_row.email_salt,
      'sha256'
    )
    or receipt.id is null
    or receipt.invitation_id is distinct from invitation_row.id
    or receipt.delivery_version is distinct from job.delivery_version
    or receipt.token_sha256 is distinct from invitation_row.token_hash
    or receipt.recipient_binding is distinct from invitation_row.recipient_binding
    or receipt.delivery_worker_auth_user_id is distinct from
      job.materialized_by_delivery_worker_auth_user_id then
    return null;
  end if;
  if exists (
    select 1 from public.circle_memberships as detached_membership
     where detached_membership.circle_id = invitation_row.circle_id
       and detached_membership.person_id = invitation_row.person_id
       and detached_membership.user_id is null
  ) then
    perform private.invalidate_invitation_email_request(
      request_row.id, 'target_identity_changed', null, null
    );
    return null;
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
  perform set_config(
    'our_days.accepting_invitation_job_id', job.id::text, true
  );
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
    perform private.invalidate_invitation_email_request(
      request_row.id, 'target_became_active', null, null
    );
    return null;
  end if;

  update private.invitations
     set accepted_at = statement_timestamp(),
         accepted_membership_id = resulting_membership_id
   where id = invitation_row.id;
  perform private.invalidate_target_bound_invitation_job(
    job.id, 'target_accepted', resulting_membership_id, null
  );
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
    raise exception using errcode = '22023',
      message = 'Invitation is not available';
end;
$$;

create function private.accept_invitation_dispatch(invitation_token text)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.accept_phase_2d_invitation(invitation_token);
$$;

create or replace function public.accept_invitation(token text)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.accept_invitation_dispatch(token);
$$;

create function private.invalidate_email_requests_after_membership_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.invitation_email_requests%rowtype;
begin
  if old.status = 'active' and old.role = 'organizer'
    and not (new.status = 'active' and new.role = 'organizer') then
    for request_row in
      select request.* from private.invitation_email_requests as request
       where request.requested_by_membership_id = old.id
         and request.state = 'queued'
       order by request.id for update
    loop
      perform private.invalidate_invitation_email_request(
        request_row.id, 'requester_authority_lost',
        coalesce(new.revoked_by_membership_id,
          private.current_membership_id(old.circle_id)), null
      );
    end loop;
  end if;
  return new;
end;
$$;
create trigger circle_memberships_invalidate_queued_email_requests
after update of role, status on public.circle_memberships
for each row execute function
  private.invalidate_email_requests_after_membership_change();

create function private.invalidate_email_requests_after_worker_revocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.invitation_email_requests%rowtype;
begin
  if old.revoked_at is null and new.revoked_at is not null then
    if tg_table_name = 'invitation_provisioner_allowlist' then
      for request_row in
        select request.* from private.invitation_email_requests as request
         where request.provisioned_by_auth_user_id = new.auth_user_id
           and request.state in ('provisioned', 'delivered')
         order by request.id for update
      loop
        perform private.invalidate_invitation_email_request(
          request_row.id, 'provisioner_revoked', null, null
        );
      end loop;
    else
      for request_row in
        select request.* from private.invitation_email_requests as request
        join private.invitation_jobs as job
          on job.id = request.invitation_job_id
         where job.materialized_by_delivery_worker_auth_user_id =
             new.auth_user_id
           and request.state in ('provisioned', 'delivered')
         order by request.id for update of request
      loop
        perform private.invalidate_invitation_email_request(
          request_row.id, 'delivery_worker_revoked', null, null
        );
      end loop;
    end if;
  end if;
  return new;
end;
$$;
create trigger invitation_provisioner_revoke_work
after update of revoked_at on private.invitation_provisioner_allowlist
for each row execute function
  private.invalidate_email_requests_after_worker_revocation();
create trigger invitation_delivery_worker_revoke_work
after update of revoked_at on private.invitation_delivery_worker_allowlist
for each row execute function
  private.invalidate_email_requests_after_worker_revocation();

create function private.invalidate_email_requests_after_account_closure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.invitation_email_requests%rowtype;
  reason text;
begin
  for request_row in
    select request.*
      from private.invitation_email_requests as request
      join public.circle_memberships as requester
        on requester.id = request.requested_by_membership_id
      left join private.invitation_jobs as job
        on job.id = request.invitation_job_id
     where request.state in ('queued', 'provisioned', 'delivered')
       and new.auth_user_id in (
         requester.user_id, request.target_auth_user_id,
         request.provisioned_by_auth_user_id,
         job.materialized_by_delivery_worker_auth_user_id
       )
     order by request.id
     for update of request
  loop
    reason := case
      when new.auth_user_id = request_row.target_auth_user_id
        then 'target_account_closure'
      when new.auth_user_id = request_row.provisioned_by_auth_user_id
        then 'provisioner_revoked'
      when exists (
        select 1 from private.invitation_jobs as job
         where job.id = request_row.invitation_job_id
           and job.materialized_by_delivery_worker_auth_user_id =
             new.auth_user_id
      ) then 'delivery_worker_revoked'
      else 'requester_account_closure'
    end;
    perform private.invalidate_invitation_email_request(
      request_row.id, reason, null,
      case when reason in (
        'target_account_closure', 'requester_account_closure'
      ) then new.id else null end
    );
  end loop;
  return new;
end;
$$;
create trigger account_closure_invalidate_invitation_email_requests
after insert on private.account_closure_requests
for each row execute function
  private.invalidate_email_requests_after_account_closure();

create function private.sweep_expired_invitation_email_requests(
  requested_limit integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  expired_request record;
  invalidated_count integer := 0;
begin
  if current_user_id is null
    or requested_limit is null
    or requested_limit not between 1 and 100
    or not (select private.lock_invitation_delivery_worker_if_allowed(
      current_user_id
    )) then
    raise exception using errcode = '42501',
      message = 'Invitation expiry sweep is unavailable';
  end if;

  for expired_request in
    select request.id
      from private.invitation_email_requests as request
     where request.state in ('queued', 'provisioned', 'delivered')
       and request.expires_at <= statement_timestamp()
     order by request.expires_at, request.id
     limit requested_limit
     for update skip locked
  loop
    if private.invalidate_invitation_email_request(
      expired_request.id, 'expired', null, null
    ) then
      invalidated_count := invalidated_count + 1;
    end if;
  end loop;

  return invalidated_count;
end;
$$;

create function private.list_pending_invitation_email_requests(
  requested_circle_id uuid
)
returns table (
  email_request_id uuid,
  invited_display_name text,
  state text,
  requested_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select request.id, request.invited_display_name, request.state,
         request.requested_at, request.expires_at
    from private.invitation_email_requests as request
    join public.circle_memberships as membership
      on membership.circle_id = request.circle_id
     and membership.user_id = (select auth.uid())
   where request.circle_id = requested_circle_id
     and request.state in ('queued', 'provisioned', 'delivered')
     and request.expires_at > statement_timestamp()
     and membership.status = 'active'
     and membership.role = 'organizer'
     and not (select private.account_closure_is_blocking(membership.user_id))
   order by request.requested_at desc, request.id desc;
$$;

create function public.request_invitation_email(
  circle_id uuid,
  email text,
  display_name text,
  request_key uuid
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.request_invitation_email($1, $2, $3, $4);
$$;

create function public.withdraw_invitation_email_request(
  email_request_id uuid
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.withdraw_invitation_email_request($1);
$$;

create function public.list_pending_invitation_email_requests(
  circle_id uuid
)
returns table (
  email_request_id uuid,
  invited_display_name text,
  state text,
  requested_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.list_pending_invitation_email_requests($1);
$$;

create function public.sweep_expired_invitation_email_requests(
  batch_limit integer
)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select private.sweep_expired_invitation_email_requests($1);
$$;

create function public.load_invitation_email_request(
  email_request_id uuid
)
returns table (
  email_request_id uuid,
  circle_id uuid,
  requester_membership_id uuid,
  requester_authorization_version timestamptz,
  normalized_email text,
  invited_display_name text,
  state text,
  invitation_job_id uuid,
  requested_at timestamptz,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.load_invitation_email_request($1);
$$;

create function public.complete_invitation_email_provisioning(
  email_request_id uuid,
  target_auth_user_id uuid
)
returns table (
  email_request_id uuid,
  invitation_job_id uuid,
  target_auth_user_id uuid,
  target_email_confirmed boolean,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.complete_invitation_email_provisioning($1, $2);
$$;

create function public.load_invitation_delivery_job(
  invitation_job_id uuid
)
returns table (
  invitation_job_id uuid,
  email_request_id uuid,
  circle_id uuid,
  requester_membership_id uuid,
  requester_authorization_version timestamptz,
  target_auth_user_id uuid,
  invited_display_name text,
  request_key uuid,
  state text,
  token_key_version smallint,
  delivery_version integer,
  requested_at timestamptz,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.load_invitation_delivery_job($1);
$$;

create function public.materialize_invitation_delivery_job(
  invitation_job_id uuid,
  delivery_version integer,
  token_sha256_hex text
)
returns table (
  invitation_job_id uuid,
  invitation_id uuid,
  state text,
  delivery_version integer,
  expires_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.materialize_invitation_delivery_job($1, $2, $3);
$$;

create function public.read_invitation_delivery_auth(
  invitation_job_id uuid
)
returns table (
  invitation_job_id uuid,
  invitation_id uuid,
  delivery_version integer,
  token_sha256_hex text,
  target_auth_user_id uuid,
  normalized_email text,
  email_confirmed_at timestamptz,
  recipient_binding_hex text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.read_invitation_delivery_auth($1);
$$;

create function public.complete_invitation_delivery(
  invitation_job_id uuid,
  invitation_id uuid,
  delivery_version integer,
  token_sha256_hex text,
  recipient_binding_hex text,
  provider text,
  provider_message_id text,
  provider_idempotency_key text,
  payload_sha256_hex text,
  provider_accepted_at timestamptz
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.complete_invitation_delivery(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
  );
$$;

create function public.read_delivered_invitation(
  invitation_job_id uuid
)
returns table (
  receipt_id uuid,
  circle_id uuid,
  email_request_id uuid,
  invitation_job_id uuid,
  invitation_id uuid,
  delivery_version integer,
  delivery_worker_auth_user_id uuid,
  provider text,
  provider_message_id text,
  provider_idempotency_key text,
  token_sha256_hex text,
  payload_sha256_hex text,
  recipient_binding_hex text,
  provider_accepted_at timestamptz,
  recorded_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.read_delivered_invitation($1);
$$;

revoke all on table private.invitation_provisioner_allowlist
  from public, anon, authenticated, service_role;
revoke all on table private.invitation_delivery_capabilities
  from public, anon, authenticated, service_role;
revoke all on table private.invitation_delivery_worker_allowlist
  from public, anon, authenticated, service_role;
revoke all on table private.invitation_email_requests
  from public, anon, authenticated, service_role;
revoke all on table private.invitation_delivery_receipts
  from public, anon, authenticated, service_role;
revoke all on table private.invitation_coordination_audit_events
  from public, anon, authenticated, service_role;

revoke all on function private.invitation_recipient_binding_v2(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_worker_allowlist_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_worker_identity_separation()
  from public, anon, authenticated, service_role;
revoke all on function private.lock_invitation_provisioner_if_allowed(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.lock_invitation_delivery_worker_if_allowed(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_email_request_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_delivery_receipt_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.enforce_invitation_coordination_audit_integrity()
  from public, anon, authenticated, service_role;
revoke all on function private.record_invitation_coordination_audit(
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.invalidate_invitation_email_request(
  uuid, text, uuid, uuid
) from public, anon, authenticated, service_role;
revoke all on function private.sync_invitation_email_request_after_job_invalidation()
  from public, anon, authenticated, service_role;
revoke all on function private.request_invitation_email(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.withdraw_invitation_email_request(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.load_invitation_email_request(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_invitation_email_provisioning(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.refresh_phase_2d_invitation_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.load_invitation_delivery_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.materialize_invitation_delivery_job(
  uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function private.read_invitation_delivery_auth(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_invitation_delivery(
  uuid, uuid, integer, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function private.read_delivered_invitation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.accept_phase_2d_invitation(text)
  from public, anon, authenticated, service_role;
revoke all on function private.accept_invitation_dispatch(text)
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_email_requests_after_membership_change()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_email_requests_after_worker_revocation()
  from public, anon, authenticated, service_role;
revoke all on function private.invalidate_email_requests_after_account_closure()
  from public, anon, authenticated, service_role;
revoke all on function private.sweep_expired_invitation_email_requests(integer)
  from public, anon, authenticated, service_role;
revoke all on function private.list_pending_invitation_email_requests(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.create_invitation(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.preflight_invitation(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.request_invitation_job(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.accept_invitation(text)
  from public, anon, authenticated, service_role;

revoke all on function public.request_invitation_email(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.withdraw_invitation_email_request(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_pending_invitation_email_requests(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.sweep_expired_invitation_email_requests(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.load_invitation_email_request(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_invitation_email_provisioning(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.load_invitation_delivery_job(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.materialize_invitation_delivery_job(
  uuid, integer, text
) from public, anon, authenticated, service_role;
revoke all on function public.read_invitation_delivery_auth(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_invitation_delivery(
  uuid, uuid, integer, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.read_delivered_invitation(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.accept_invitation(text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_invitation(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.preflight_invitation(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.request_invitation_job(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.request_invitation_email(
  uuid, text, text, uuid
) to authenticated;
grant execute on function public.withdraw_invitation_email_request(uuid)
  to authenticated;
grant execute on function public.list_pending_invitation_email_requests(uuid)
  to authenticated;
grant execute on function public.sweep_expired_invitation_email_requests(integer)
  to authenticated;
grant execute on function public.load_invitation_email_request(uuid)
  to authenticated;
grant execute on function public.complete_invitation_email_provisioning(uuid, uuid)
  to authenticated;
grant execute on function public.load_invitation_delivery_job(uuid)
  to authenticated;
grant execute on function public.materialize_invitation_delivery_job(
  uuid, integer, text
) to authenticated;
grant execute on function public.read_invitation_delivery_auth(uuid)
  to authenticated;
grant execute on function public.complete_invitation_delivery(
  uuid, uuid, integer, text, text, text, text, text, text, timestamptz
) to authenticated;
grant execute on function public.read_delivered_invitation(uuid)
  to authenticated;
grant execute on function public.accept_invitation(text)
  to authenticated;

-- Legacy private definitions remain only for historical fixture setup. Their
-- public wrappers have no execution grants, and acceptance is Phase 2D-only.
