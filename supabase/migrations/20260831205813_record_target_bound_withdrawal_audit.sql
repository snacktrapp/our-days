-- A Phase 2D organizer withdrawal invalidates the target-bound job first. Its
-- AFTER trigger, rather than the coordinator function's later idempotent
-- update, performs the materialized invitation transition. Record the same
-- human-action audit event as the legacy invitation-first path at that exact
-- seam. The affected-row guard prevents replay or recursive job invalidation
-- from creating a duplicate event.

create or replace function
  private.revoke_target_bound_invitation_after_job_invalidation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_invitation_count integer := 0;
begin
  if new.invitation_id is not null
    and new.invalidation_reason <> 'target_accepted' then
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
    get diagnostics revoked_invitation_count = row_count;
  end if;

  if revoked_invitation_count = 1
    and new.invalidation_reason = 'organizer_withdrawn' then
    insert into private.audit_events (
      circle_id, actor_membership_id, event_type, subject_type, subject_id
    ) values (
      new.circle_id, new.invalidated_by_membership_id,
      'invitation_revoked', 'invitation', new.invitation_id
    );
  end if;

  return new;
end;
$$;
