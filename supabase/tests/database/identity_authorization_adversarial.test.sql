begin;

select plan(42);

insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000011', 'valid-invite@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000012', 'wrong-recipient@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000013', 'expired-invite@example.test', statement_timestamp(), '{}'),
  ('10000000-0000-4000-8000-000000000014', 'revoked-invite@example.test', statement_timestamp(), '{}');

select is(
  (
    select array_agg(
      format('%s:%s', relation.relname, relation.relkind)
      order by relation.relname, relation.relkind
    )
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relkind in ('r', 'p', 'v', 'm', 'f')
  ),
  array[
    'circle_memberships:r',
    'circles:r',
    'moment_notes:r',
    'moment_people:r',
    'moment_photos:r',
    'moment_reactions:r',
    'moments:r',
    'people:r',
    'person_guardians:r'
  ]::text[],
  'the exposed family relation catalog exactly matches the reviewed allowlist'
);

select is(
  (
    select array_agg(
      format('%s:%s:%s', table_name, grantee, privilege_type)
      order by table_name, grantee, privilege_type
    )
      from information_schema.role_table_grants
     where table_schema = 'public'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  array[
    'circle_memberships:authenticated:SELECT',
    'circles:authenticated:SELECT',
    'moment_notes:authenticated:SELECT',
    'moment_people:authenticated:SELECT',
    'moment_photos:authenticated:SELECT',
    'moment_reactions:authenticated:SELECT',
    'moments:authenticated:SELECT',
    'people:authenticated:SELECT',
    'person_guardians:authenticated:SELECT'
  ]::text[],
  'browser-facing public table ACLs exactly match authenticated read access'
);

select is(
  (
    select array_agg(
      format(
        '%s(%s)',
        procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      )
      order by procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    )
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'public'
       and procedure.prokind = 'f'
  ),
  array[
    'accept_invitation(token text)',
    'acknowledge_photo_intake(intake_id uuid)',
    'claim_photo_display_derivative(original_id uuid, lease_key uuid)',
    'claim_photo_intake_upload(intake_id uuid, upload_request_key uuid, expected_mime_type text, expected_size_bytes bigint, expected_sha256_hex text)',
    'claim_photo_validation(intake_id uuid, lease_key uuid)',
    'complete_invitation_delivery(invitation_job_id uuid, invitation_id uuid, delivery_version integer, token_sha256_hex text, recipient_binding_hex text, provider text, provider_message_id text, provider_idempotency_key text, payload_sha256_hex text, provider_accepted_at timestamp with time zone)',
    'complete_invitation_email_provisioning(email_request_id uuid, target_auth_user_id uuid)',
    'complete_photo_display_derivative(derivative_job_id uuid, lease_key uuid, storage_object_id uuid, storage_object_version text, output_size_bytes bigint, output_sha256_hex text, output_width integer, output_height integer, output_channels integer, output_pages integer)',
    'complete_photo_validation(validation_job_id uuid, lease_key uuid, storage_object_id uuid, storage_object_version text, verified_mime_type text, verified_size_bytes bigint, verified_sha256_hex text, verified_width integer, verified_height integer, verified_channels integer, verified_pages integer)',
    'create_family_moment(circle_id uuid, journal_person_id uuid, moment_kind text, moment_title text, moment_body text, place_name text, tagged_person_ids uuid[], occurred_on date, occurred_at timestamp with time zone, occurred_timezone text)',
    'create_invitation(circle_id uuid, display_name text, email text, reinvite_membership_id uuid)',
    'create_managed_person(circle_id uuid, display_name text, accent_token text)',
    'create_moment_note(moment_id uuid, body text)',
    'create_written_moment(circle_id uuid, journal_person_id uuid, body text, occurred_on date, occurred_at timestamp with time zone, occurred_timezone text)',
    'flag_photo_display_derivative_for_review(derivative_job_id uuid, lease_key uuid, review_reason text)',
    'flag_photo_validation_for_review(validation_job_id uuid, lease_key uuid, review_reason text)',
    'get_moment_conversation(moment_id uuid)',
    'get_photo_moment_delivery(moment_id uuid)',
    'get_photo_moment_status(intake_id uuid)',
    'list_manageable_trashed_written_moments(circle_id uuid)',
    'list_memory_moments(circle_id uuid, memory_year integer, anniversary_month integer, anniversary_day integer, cursor_occurred_on date, cursor_has_precise_time boolean, cursor_occurred_at timestamp with time zone, cursor_moment_id uuid, page_size integer, snapshot_at timestamp with time zone)',
    'list_memory_years(circle_id uuid, before_year integer, page_size integer)',
    'list_milestone_memories(circle_id uuid, cursor_occurred_on date, cursor_has_precise_time boolean, cursor_occurred_at timestamp with time zone, cursor_moment_id uuid, page_size integer, snapshot_at timestamp with time zone)',
    'list_pending_invitation_email_requests(circle_id uuid)',
    'list_pending_invitations(circle_id uuid)',
    'list_timeline_moments(circle_id uuid, journal_person_id uuid, cursor_occurred_on date, cursor_has_precise_time boolean, cursor_occurred_at timestamp with time zone, cursor_moment_id uuid, page_size integer, snapshot_at timestamp with time zone)',
    'load_invitation_delivery_job(invitation_job_id uuid)',
    'load_invitation_email_request(email_request_id uuid)',
    'materialize_invitation_delivery_job(invitation_job_id uuid, delivery_version integer, token_sha256_hex text)',
    'preflight_invitation(token text, email text)',
    'read_delivered_invitation(invitation_job_id uuid)',
    'read_invitation_delivery_auth(invitation_job_id uuid)',
    'reject_photo_display_derivative(derivative_job_id uuid, lease_key uuid, rejection_reason text)',
    'reject_photo_validation(validation_job_id uuid, lease_key uuid, rejection_reason text)',
    'request_account_closure(request_key uuid)',
    'request_family_export(circle_id uuid, request_key uuid)',
    'request_invitation_email(circle_id uuid, email text, display_name text, request_key uuid)',
    'request_invitation_job(circle_id uuid, target_auth_user_id uuid, display_name text, request_key uuid)',
    'reserve_photo_intake(circle_id uuid, journal_person_id uuid, request_key uuid)',
    'reserve_photo_moment(circle_id uuid, journal_person_id uuid, body text, place_name text, tagged_person_ids uuid[], occurred_on date, occurred_at timestamp with time zone, occurred_timezone text, request_key uuid)',
    'revoke_invitation(invitation_id uuid)',
    'revoke_membership(membership_id uuid)',
    'set_membership_role(membership_id uuid, role text)',
    'set_moment_reaction(moment_id uuid, reaction_type text)',
    'set_person_guardian(managed_person_id uuid, guardian_membership_id uuid, grant_access boolean)',
    'set_written_moment_trashed(moment_id uuid, expected_revision bigint, trashed boolean)',
    'sweep_expired_invitation_email_requests(batch_limit integer)',
    'trash_moment_note(note_id uuid, expected_revision bigint)',
    'update_family_moment(moment_id uuid, expected_revision bigint, moment_title text, moment_body text, place_name text, tagged_person_ids uuid[], occurred_on date, occurred_at timestamp with time zone, occurred_timezone text)',
    'update_moment_note(note_id uuid, expected_revision bigint, body text)',
    'update_written_moment(moment_id uuid, expected_revision bigint, body text, occurred_on date, occurred_at timestamp with time zone, occurred_timezone text)',
    'withdraw_invitation_email_request(email_request_id uuid)'
  ]::text[],
  'the public RPC catalog exactly matches the reviewed signatures'
);

select is(
  (
    select array_agg(
      format('%s:%s:%s', routine_name, grantee, privilege_type)
      order by routine_name, grantee, privilege_type
    )
      from information_schema.routine_privileges
     where routine_schema = 'public'
       and grantee in ('anon', 'authenticated', 'PUBLIC')
  ),
  array[
    'accept_invitation:authenticated:EXECUTE',
    'acknowledge_photo_intake:authenticated:EXECUTE',
    'claim_photo_display_derivative:authenticated:EXECUTE',
    'claim_photo_intake_upload:authenticated:EXECUTE',
    'claim_photo_validation:authenticated:EXECUTE',
    'complete_invitation_delivery:authenticated:EXECUTE',
    'complete_invitation_email_provisioning:authenticated:EXECUTE',
    'complete_photo_display_derivative:authenticated:EXECUTE',
    'complete_photo_validation:authenticated:EXECUTE',
    'create_family_moment:authenticated:EXECUTE',
    'create_managed_person:authenticated:EXECUTE',
    'create_moment_note:authenticated:EXECUTE',
    'create_written_moment:authenticated:EXECUTE',
    'flag_photo_display_derivative_for_review:authenticated:EXECUTE',
    'flag_photo_validation_for_review:authenticated:EXECUTE',
    'get_moment_conversation:authenticated:EXECUTE',
    'get_photo_moment_delivery:authenticated:EXECUTE',
    'get_photo_moment_status:authenticated:EXECUTE',
    'list_manageable_trashed_written_moments:authenticated:EXECUTE',
    'list_memory_moments:authenticated:EXECUTE',
    'list_memory_years:authenticated:EXECUTE',
    'list_milestone_memories:authenticated:EXECUTE',
    'list_pending_invitation_email_requests:authenticated:EXECUTE',
    'list_pending_invitations:authenticated:EXECUTE',
    'list_timeline_moments:authenticated:EXECUTE',
    'load_invitation_delivery_job:authenticated:EXECUTE',
    'load_invitation_email_request:authenticated:EXECUTE',
    'materialize_invitation_delivery_job:authenticated:EXECUTE',
    'read_delivered_invitation:authenticated:EXECUTE',
    'read_invitation_delivery_auth:authenticated:EXECUTE',
    'reject_photo_display_derivative:authenticated:EXECUTE',
    'reject_photo_validation:authenticated:EXECUTE',
    'request_account_closure:authenticated:EXECUTE',
    'request_family_export:authenticated:EXECUTE',
    'request_invitation_email:authenticated:EXECUTE',
    'reserve_photo_moment:authenticated:EXECUTE',
    'revoke_invitation:authenticated:EXECUTE',
    'revoke_membership:authenticated:EXECUTE',
    'set_membership_role:authenticated:EXECUTE',
    'set_moment_reaction:authenticated:EXECUTE',
    'set_person_guardian:authenticated:EXECUTE',
    'set_written_moment_trashed:authenticated:EXECUTE',
    'sweep_expired_invitation_email_requests:authenticated:EXECUTE',
    'trash_moment_note:authenticated:EXECUTE',
    'update_family_moment:authenticated:EXECUTE',
    'update_moment_note:authenticated:EXECUTE',
    'update_written_moment:authenticated:EXECUTE',
    'withdraw_invitation_email_request:authenticated:EXECUTE'
  ]::text[],
  'browser-facing public RPC ACLs exactly match the reviewed allowlist'
);

select ok(
  not has_schema_privilege('anon', 'public', 'CREATE')
  and not has_schema_privilege('authenticated', 'public', 'CREATE')
  and not exists (
    select 1
      from pg_catalog.pg_namespace as namespace
      cross join lateral pg_catalog.aclexplode(namespace.nspacl) as acl
     where namespace.nspname = 'public'
       and acl.grantee = 0
       and acl.privilege_type = 'CREATE'
  ),
  'browser roles and PUBLIC cannot expand the public catalog'
);

select is(
  (
    select array_agg(
      format(
        '%s(%s)',
        procedure.proname,
        pg_catalog.pg_get_function_identity_arguments(procedure.oid)
      )
      order by procedure.proname, pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    )
      from pg_catalog.pg_proc as procedure
      join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
     where namespace.nspname = 'private'
       and procedure.prosecdef
  ),
  array[
    'accept_invitation(invitation_token text)',
    'accept_invitation_dispatch(invitation_token text)',
    'accept_phase_2d_invitation(invitation_token text)',
    'account_closure_is_blocking(target_auth_user_id uuid)',
    'acknowledge_photo_intake(requested_intake_id uuid)',
    'can_manage_person(requested_circle_id uuid, requested_person_id uuid)',
    'can_view_person(requested_circle_id uuid, requested_person_id uuid)',
    'claim_photo_display_derivative(requested_original_id uuid, requested_lease_key uuid)',
    'claim_photo_intake_upload(requested_intake_id uuid, requested_upload_request_key uuid, requested_expected_mime_type text, requested_expected_size_bytes bigint, requested_expected_sha256_hex text)',
    'claim_photo_validation(requested_intake_id uuid, requested_lease_key uuid)',
    'complete_invitation_delivery(requested_invitation_job_id uuid, requested_invitation_id uuid, requested_delivery_version integer, requested_token_sha256_hex text, requested_recipient_binding_hex text, requested_provider text, requested_provider_message_id text, requested_provider_idempotency_key text, requested_payload_sha256_hex text, requested_provider_accepted_at timestamp with time zone)',
    'complete_invitation_email_provisioning(requested_email_request_id uuid, requested_target_auth_user_id uuid)',
    'complete_photo_display_derivative(requested_derivative_job_id uuid, requested_lease_key uuid, requested_storage_object_id uuid, requested_storage_object_version text, requested_output_size_bytes bigint, requested_output_sha256_hex text, requested_output_width integer, requested_output_height integer, requested_output_channels integer, requested_output_pages integer)',
    'complete_photo_validation(requested_validation_job_id uuid, requested_lease_key uuid, requested_storage_object_id uuid, requested_storage_object_version text, requested_verified_mime_type text, requested_verified_size_bytes bigint, requested_verified_sha256_hex text, requested_verified_width integer, requested_verified_height integer, requested_verified_channels integer, requested_verified_pages integer)',
    'create_family_moment(requested_circle_id uuid, requested_journal_person_id uuid, requested_kind text, requested_title text, requested_body text, requested_place_name text, requested_tagged_person_ids uuid[], requested_occurred_on date, requested_occurred_at timestamp with time zone, requested_occurred_timezone text)',
    'create_invitation(requested_circle_id uuid, invited_display_name text, invited_email text, reinvite_membership_id uuid)',
    'create_managed_person(requested_circle_id uuid, requested_display_name text, requested_accent_token text)',
    'create_moment_note(target_moment_id uuid, requested_body text)',
    'create_written_moment(requested_circle_id uuid, requested_journal_person_id uuid, requested_body text, requested_occurred_on date, requested_occurred_at timestamp with time zone, requested_occurred_timezone text)',
    'current_family_session_is_live()',
    'current_membership_id(requested_circle_id uuid)',
    'enforce_guardian_integrity()',
    'enforce_invitation_integrity()',
    'enforce_invitation_worker_identity_separation()',
    'enforce_membership_integrity()',
    'enforce_photo_validator_family_separation()',
    'enforce_verified_photo_derivative_consistency()',
    'enforce_verified_photo_promotion_consistency()',
    'enqueue_photo_display_derivative()',
    'enqueue_photo_validation_job()',
    'flag_photo_display_derivative_for_review(requested_derivative_job_id uuid, requested_lease_key uuid, requested_review_reason text)',
    'flag_photo_validation_for_review(requested_validation_job_id uuid, requested_lease_key uuid, requested_review_reason text)',
    'get_photo_moment_delivery(requested_moment_id uuid)',
    'get_photo_moment_status(requested_intake_id uuid)',
    'invalidate_email_requests_after_account_closure()',
    'invalidate_email_requests_after_membership_change()',
    'invalidate_email_requests_after_worker_revocation()',
    'invalidate_invitation_email_request(requested_email_request_id uuid, requested_reason text, requested_invalidator_membership_id uuid, requested_invalidator_closure_request_id uuid)',
    'invalidate_invitation_jobs_after_authority_loss()',
    'invalidate_photo_derivatives_after_authority_change()',
    'invalidate_photo_intakes_after_guardian_revocation()',
    'invalidate_photo_intakes_after_membership_change()',
    'invalidate_photo_work_after_closure_request()',
    'invalidate_target_bound_invitation_job(requested_job_id uuid, requested_reason text, requested_invalidator_membership_id uuid, requested_invalidator_closure_request_id uuid)',
    'is_active_circle_member(requested_circle_id uuid)',
    'is_circle_organizer(requested_circle_id uuid)',
    'list_manageable_trashed_written_moments(requested_circle_id uuid)',
    'list_pending_invitation_email_requests(requested_circle_id uuid)',
    'list_pending_invitations(requested_circle_id uuid)',
    'load_invitation_delivery_job(requested_invitation_job_id uuid)',
    'load_invitation_email_request(requested_email_request_id uuid)',
    'load_target_bound_invitation_job(requested_job_id uuid)',
    'lock_invitation_delivery_worker_if_allowed(requested_auth_user_id uuid)',
    'lock_invitation_provisioner_if_allowed(requested_auth_user_id uuid)',
    'lock_photo_validator_if_allowed(requested_auth_user_id uuid)',
    'materialize_invitation_delivery_job(requested_invitation_job_id uuid, requested_delivery_version integer, requested_token_sha256_hex text)',
    'materialize_target_bound_invitation_job(requested_job_id uuid, requested_delivery_version integer, requested_token_sha256_hex text)',
    'photo_capability_is_enabled(requested_capability text)',
    'photo_derivative_source_is_readable(requested_object_path text, requested_storage_object_id uuid, requested_storage_object_version text)',
    'photo_display_path_is_readable(requested_object_path text)',
    'photo_display_path_is_uploadable(requested_object_path text, requested_owner_id text, requested_user_metadata jsonb)',
    'photo_intake_path_is_uploadable(requested_object_path text, requested_owner_id text, requested_user_metadata jsonb)',
    'photo_intake_requester_is_authorized(requested_intake_id uuid)',
    'photo_original_path_is_readable(requested_object_path text)',
    'photo_original_path_is_uploadable(requested_object_path text, requested_owner_id text, requested_user_metadata jsonb)',
    'photo_validation_source_is_readable(requested_object_path text, requested_storage_object_id uuid, requested_storage_object_version text)',
    'photo_validator_is_allowed(requested_auth_user_id uuid)',
    'preflight_invitation(invitation_token text, invited_email text)',
    'prepare_account_closure(closure_request_id uuid)',
    'publish_photo_moment_after_derivative()',
    'publish_photo_moment_if_ready(requested_intake_id uuid)',
    'read_delivered_invitation(requested_invitation_job_id uuid)',
    'read_invitation_delivery_auth(requested_invitation_job_id uuid)',
    'record_invitation_coordination_audit(requested_circle_id uuid, requested_email_request_id uuid, requested_invitation_job_id uuid, requested_actor_membership_id uuid, requested_worker_auth_user_id uuid, requested_event_type text)',
    'refresh_phase_2d_invitation_job(requested_invitation_job_id uuid)',
    'reject_photo_display_derivative(requested_derivative_job_id uuid, requested_lease_key uuid, requested_rejection_reason text)',
    'reject_photo_validation(requested_validation_job_id uuid, requested_lease_key uuid, requested_rejection_reason text)',
    'request_family_export(requested_circle_id uuid, requested_request_key uuid)',
    'request_invitation_email(requested_circle_id uuid, requested_email text, invited_display_name text, requested_request_key uuid)',
    'request_invitation_job(requested_circle_id uuid, requested_target_auth_user_id uuid, invited_display_name text, requested_request_key uuid)',
    'require_photo_upload_session(error_message text)',
    'reserve_photo_intake(requested_circle_id uuid, requested_journal_person_id uuid, requested_request_key uuid)',
    'reserve_photo_moment(requested_circle_id uuid, requested_journal_person_id uuid, requested_body text, requested_place_name text, requested_tagged_person_ids uuid[], requested_occurred_on date, requested_occurred_at timestamp with time zone, requested_occurred_timezone text, requested_request_key uuid)',
    'revoke_invitation(target_invitation_id uuid)',
    'revoke_membership(target_membership_id uuid)',
    'revoke_target_bound_invitation_after_job_invalidation()',
    'set_membership_role(target_membership_id uuid, requested_role text)',
    'set_moment_reaction(target_moment_id uuid, requested_reaction_type text)',
    'set_person_guardian(requested_managed_person_id uuid, requested_guardian_membership_id uuid, grant_access boolean)',
    'set_written_moment_trashed(target_moment_id uuid, expected_revision bigint, requested_trashed boolean)',
    'sweep_expired_invitation_email_requests(requested_limit integer)',
    'sync_invitation_email_request_after_job_invalidation()',
    'tags_are_valid(requested_circle_id uuid, requested_journal_person_id uuid, requested_tagged_person_ids uuid[])',
    'trash_moment_note(target_note_id uuid, expected_revision bigint)',
    'update_family_moment(target_moment_id uuid, expected_revision bigint, requested_title text, requested_body text, requested_place_name text, requested_tagged_person_ids uuid[], requested_occurred_on date, requested_occurred_at timestamp with time zone, requested_occurred_timezone text)',
    'update_moment_note(target_note_id uuid, expected_revision bigint, requested_body text)',
    'update_written_moment(target_moment_id uuid, expected_revision bigint, requested_body text, requested_occurred_on date, requested_occurred_at timestamp with time zone, requested_occurred_timezone text)',
    'withdraw_invitation_email_request(requested_email_request_id uuid)'
  ]::text[],
  'the private security-definer catalog exactly matches the reviewed signatures'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);

select throws_ok(
  $$select * from public.create_invitation(
    '20000000-0000-4000-8000-000000000001',
    'Forbidden Invite',
    'forbidden@example.test'
  )$$,
  '42501',
  'permission denied for function create_invitation',
  'the retired legacy creation RPC is unreachable to ordinary members'
);

select throws_ok(
  $$select public.revoke_membership('40000000-0000-4000-8000-000000000006')$$,
  '22023',
  'Access could not be changed',
  'a member cannot revoke a membership in another circle'
);

select throws_ok(
  $$select public.set_person_guardian(
    '30000000-0000-4000-8000-000000000008',
    '40000000-0000-4000-8000-000000000006',
    true
  )$$,
  '22023',
  'Guardian access could not be changed',
  'guardian grants cannot cross circle boundaries'
);

select throws_ok(
  $$insert into public.people (
    circle_id, display_name, profile_kind, accent_token, created_by_membership_id
  ) values (
    '20000000-0000-4000-8000-000000000001',
    'Direct Insert',
    'managed',
    'clay',
    '40000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'permission denied for table people',
  'authenticated clients cannot bypass managed-person RPCs with direct inserts'
);

reset role;

select throws_ok(
  $$update public.circles
       set id = '20000000-0000-4000-8000-000000000099'
     where id = '20000000-0000-4000-8000-000000000001'$$,
  '42501',
  'Circle identity is immutable',
  'circle identity fields are immutable'
);

select throws_ok(
  $$update public.people
       set profile_kind = 'managed'
     where id = '30000000-0000-4000-8000-000000000003'$$,
  '42501',
  'Person identity is immutable',
  'account profiles cannot be converted into managed profiles'
);

select throws_ok(
  $$update public.circle_memberships
       set user_id = '10000000-0000-4000-8000-000000000007'
     where id = '40000000-0000-4000-8000-000000000003'$$,
  '42501',
  'Membership identity is immutable',
  'membership identities cannot be reassigned'
);

select throws_ok(
  $$delete from public.circle_memberships
     where id = '40000000-0000-4000-8000-000000000003'$$,
  '42501',
  'Memberships are retained as history',
  'membership history cannot be deleted'
);

select throws_ok(
  $$insert into public.person_guardians (
      circle_id,
      managed_person_id,
      guardian_membership_id,
      created_by_membership_id
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000008',
      '40000000-0000-4000-8000-000000000006',
      '40000000-0000-4000-8000-000000000001'
    )$$,
  '23503',
  'insert or update on table "person_guardians" violates foreign key constraint "person_guardians_guardian_fkey"',
  'the guardian composite foreign key rejects a membership from another circle'
);

select throws_ok(
  $$insert into private.invitations (
      circle_id,
      person_id,
      created_by_membership_id,
      token_hash,
      email_salt,
      email_hash,
      expires_at
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000009',
      '40000000-0000-4000-8000-000000000001',
      extensions.digest('mixed-circle-invitation', 'sha256'),
      extensions.gen_random_bytes(16),
      extensions.digest('mixed-circle@example.test', 'sha256'),
      statement_timestamp() + interval '1 hour'
    )$$,
  '23503',
  'insert or update on table "invitations" violates foreign key constraint "invitations_person_fkey"',
  'the invitation composite foreign key rejects a person from another circle'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);

select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000003',
    'organizer'
  )$$,
  '22023',
  'Role could not be changed',
  'an organizer in circle B cannot use the real RPC to change a circle A membership'
);

select public.create_managed_person(
  '20000000-0000-4000-8000-000000000002',
  'B Dual Organizer Child',
  'sky'
) as person_id \gset dual_circle_

reset role;

select ok(
  exists (
    select 1
      from public.people as person
     where person.id = :'dual_circle_person_id'
       and person.circle_id = '20000000-0000-4000-8000-000000000002'
       and person.profile_kind = 'managed'
       and person.created_by_membership_id = '40000000-0000-4000-8000-000000000007'
  )
  and exists (
    select 1
      from private.audit_events as audit
     where audit.circle_id = '20000000-0000-4000-8000-000000000002'
       and audit.actor_membership_id = '40000000-0000-4000-8000-000000000007'
       and audit.event_type = 'managed_person_created'
       and audit.subject_id = :'dual_circle_person_id'
  ),
  'the same dual-circle identity can use the real organizer RPC inside circle B with correct attribution'
);

-- The remaining historical invitation scenarios use transaction-local grants
-- so their data-integrity coverage survives while production stays v2-only.
grant execute on function public.create_invitation(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.preflight_invitation(text, text)
  to anon, authenticated;
grant execute on function private.create_invitation(uuid, text, text, uuid)
  to authenticated;
grant execute on function private.preflight_invitation(text, text)
  to anon, authenticated;
grant execute on function private.accept_invitation(text)
  to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);

select * from public.create_invitation(
  '20000000-0000-4000-8000-000000000001',
  'Valid Invite',
  ' VALID-INVITE@example.test '
) \gset valid_

select ok(
  char_length(:'valid_raw_token') between 40 and 64,
  'invitation creation returns one URL-safe secret with the expected length'
);

select is(
  (
    select count(*)::bigint
      from public.list_pending_invitations(
        '20000000-0000-4000-8000-000000000001'
      )
     where invitation_id = :'valid_invitation_id'
       and display_name = 'Valid Invite'
  ),
  1::bigint,
  'an organizer can list minimal pending invitation metadata in their circle'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  (
    select count(*)::bigint
      from public.list_pending_invitations(
        '20000000-0000-4000-8000-000000000001'
      )
  ),
  0::bigint,
  'an ordinary member cannot list pending invitation metadata'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select is(
  (
    select count(*)::bigint
      from public.list_pending_invitations(
        '20000000-0000-4000-8000-000000000001'
      )
  ),
  0::bigint,
  'a revoked member cannot list pending invitation metadata'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000006', true);
select is(
  (
    select count(*)::bigint
      from public.list_pending_invitations(
        '20000000-0000-4000-8000-000000000001'
      )
  ),
  0::bigint,
  'an organizer from another circle cannot list pending invitation metadata'
);

reset role;

select ok(
  exists (
    select 1
      from private.invitations
     where id = :'valid_invitation_id'
       and token_hash = extensions.digest(:'valid_raw_token', 'sha256')
       and email_hash is not null
       and email_salt is not null
  ),
  'only hashed invitation credentials are persisted'
);

set local role anon;

select is(
  public.preflight_invitation(:'valid_raw_token', ' VALID-INVITE@example.test '),
  true,
  'anonymous preflight recognizes a pending token bound to the normalized invited email'
);

select is(
  array[
    public.preflight_invitation(:'valid_raw_token', 'wrong-recipient@example.test'),
    public.preflight_invitation('too-short', 'valid-invite@example.test'),
    public.preflight_invitation(:'valid_raw_token', repeat('a', 255) || '@example.test')
  ],
  array[false, false, false],
  'preflight fails closed for a wrong email and malformed token or email without exposing details'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', true);
select private.accept_invitation(:'valid_raw_token') as membership_id \gset accepted_

select is(
  (select status from public.circle_memberships where id = :'accepted_membership_id'),
  'active',
  'a valid invite activates a membership for the confirmed recipient'
);

select is(
  (select role from public.circle_memberships where id = :'accepted_membership_id'),
  'member',
  'new invitees always enter as members'
);

reset role;
set local role anon;
select is(
  public.preflight_invitation(:'valid_raw_token', 'valid-invite@example.test'),
  false,
  'preflight fails closed after an invitation has been consumed'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000011', true);
select throws_ok(
  format('select private.accept_invitation(%L)', :'valid_raw_token'),
  '22023',
  'Invitation is not available',
  'an accepted invitation cannot be reused'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select * from public.create_invitation(
  '20000000-0000-4000-8000-000000000001',
  'Wrong Recipient',
  'valid-invite@example.test'
) \gset wrong_

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000012', true);
select throws_ok(
  format('select private.accept_invitation(%L)', :'wrong_raw_token'),
  '22023',
  'Invitation is not available',
  'a confirmed user with the wrong email cannot accept an invite'
);

reset role;
select ok(
  (select accepted_at is null and revoked_at is null from private.invitations where id = :'wrong_invitation_id'),
  'a wrong-recipient attempt does not consume the invitation'
);

-- Build this legacy fixture with terminal timestamps from birth. Invitation
-- identity is now intentionally immutable, so an expiry test must not weaken
-- that production invariant by rewriting created_at or expires_at afterward.
select 'expired-' || repeat('x', 40) as raw_token \gset expired_

insert into public.people (
  circle_id, display_name, profile_kind, created_by_membership_id
) values (
  '20000000-0000-4000-8000-000000000001',
  'Expired Invite',
  'account',
  '40000000-0000-4000-8000-000000000001'
) returning id as person_id \gset expired_person_

with material as (
  select extensions.gen_random_bytes(16) as email_salt
)
insert into private.invitations (
  circle_id,
  person_id,
  created_by_membership_id,
  token_hash,
  email_salt,
  email_hash,
  created_at,
  expires_at
)
select
  '20000000-0000-4000-8000-000000000001',
  :'expired_person_person_id'::uuid,
  '40000000-0000-4000-8000-000000000001',
  extensions.digest(:'expired_raw_token', 'sha256'),
  material.email_salt,
  extensions.digest(
    pg_catalog.convert_to('expired-invite@example.test', 'UTF8')
      || material.email_salt,
    'sha256'
  ),
  statement_timestamp() - interval '2 minutes',
  statement_timestamp() - interval '1 minute'
from material
returning id as invitation_id \gset expired_

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000013', true);
select throws_ok(
  format('select private.accept_invitation(%L)', :'expired_raw_token'),
  '22023',
  'Invitation is not available',
  'expired invitations cannot be accepted'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select * from public.create_invitation(
  '20000000-0000-4000-8000-000000000001',
  'Revoked Invite',
  'revoked-invite@example.test'
) \gset revoked_
select public.revoke_invitation(:'revoked_invitation_id');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000014', true);
select throws_ok(
  format('select private.accept_invitation(%L)', :'revoked_raw_token'),
  '22023',
  'Invitation is not available',
  'revoked invitations cannot be accepted'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select * from public.create_invitation(
  '20000000-0000-4000-8000-000000000001',
  'A Revoked Member',
  'revoked-a@example.test',
  '40000000-0000-4000-8000-000000000004'
) \gset reinvite_

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000004', true);
select private.accept_invitation(:'reinvite_raw_token') as membership_id \gset reaccepted_

select is(
  :'reaccepted_membership_id'::uuid,
  '40000000-0000-4000-8000-000000000004'::uuid,
  'reinvitation reactivates the retained membership instead of creating another identity'
);

select is(
  (select role from public.circle_memberships where id = :'reaccepted_membership_id'),
  'member',
  'reinvitation cannot silently restore organizer authority'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select public.revoke_membership('40000000-0000-4000-8000-000000000003');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
select is(
  (select count(*)::bigint from public.circles),
  0::bigint,
  'revocation takes effect immediately even when the JWT identity is unchanged'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000005', true);
select public.revoke_membership('40000000-0000-4000-8000-000000000006');

select throws_ok(
  $$select public.set_membership_role(
    '40000000-0000-4000-8000-000000000007',
    'member'
  )$$,
  '23514',
  'A circle must retain an active organizer',
  'the last active organizer cannot demote themselves'
);

select throws_ok(
  $$select public.revoke_membership('40000000-0000-4000-8000-000000000007')$$,
  '23514',
  'A circle must retain an active organizer',
  'the last active organizer cannot revoke themselves'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
select public.revoke_membership('40000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select ok(
  not private.can_manage_person(
    '20000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000008'
  ),
  'revoking a member also removes their active guardian authority'
);

reset role;

select ok(
  exists (
    select 1
      from private.audit_events
     where event_type = 'membership_revoked'
       and subject_id = '40000000-0000-4000-8000-000000000001'
  ),
  'sensitive membership changes retain durable audit attribution'
);

select ok(
  exists (
    select 1
      from public.people
     where id = '30000000-0000-4000-8000-000000000001'
  ),
  'revocation retains the person record needed for historic authorship'
);

select * from finish();
rollback;
