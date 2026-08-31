import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260831030000_phase_2c_target_bound_invitation_materialization.sql",
  ),
  "utf8",
);

function between(start: string, end: string) {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("target-bound invitation materialization", () => {
  it("structurally binds an invitation to its exact job and Auth target", () => {
    expect(migration).toContain(
      "constraint invitation_jobs_circle_id_id_target_key unique (\n    circle_id, id, target_auth_user_id\n  )",
    );
    expect(migration).toMatch(
      /foreign key \(\s*circle_id,\s*invitation_job_id,\s*target_auth_user_id\s*\) references private\.invitation_jobs \(\s*circle_id,\s*id,\s*target_auth_user_id\s*\)/u,
    );
    expect(migration).toContain(
      "add constraint invitations_invitation_job_unique unique (invitation_job_id)",
    );
    expect(migration).toContain(
      "add constraint invitation_jobs_invitation_unique unique (invitation_id)",
    );
  });

  it("keeps job and invitation identity immutable and transitions monotonic", () => {
    const jobIntegrity = between(
      "create or replace function private.enforce_invitation_job_integrity()",
      "create function private.revoke_target_bound_invitation_after_job_invalidation()",
    );
    const invitationIntegrity = between(
      "create or replace function private.enforce_invitation_integrity()",
      "create function private.invitation_recipient_binding(",
    );

    expect(jobIntegrity).toContain(
      "new.target_auth_user_id is distinct from old.target_auth_user_id",
    );
    expect(jobIntegrity).toContain("old.state = 'queued'");
    expect(jobIntegrity).toContain("new.state = 'materialized'");
    expect(jobIntegrity).toContain("new.state = 'invalidated'");
    expect(jobIntegrity).toContain("Invitation jobs cannot be deleted");

    for (const field of [
      "invitation_job_id",
      "target_auth_user_id",
      "target_email_confirmed_at",
      "recipient_binding",
    ]) {
      expect(invitationIntegrity).toContain(
        `new.${field} is distinct from old.${field}`,
      );
    }
    expect(invitationIntegrity).toContain("Invitations cannot be deleted");
  });

  it("derives a timezone-independent recipient binding without storing email", () => {
    const binding = between(
      "create function private.invitation_recipient_binding(",
      "create function private.invalidate_target_bound_invitation_job(",
    );
    const materialization = between(
      "create function private.materialize_target_bound_invitation_job(",
      "create or replace function private.accept_invitation(",
    );

    expect(binding).toContain("pg_catalog.uuid_send(target_auth_user_id)");
    expect(binding).toContain("pg_catalog.timestamptz_send(confirmed_at)");
    expect(binding).toContain("lower(btrim(normalized_email))");
    expect(binding).not.toMatch(/jsonb_build_array|to_char\(/u);

    const signature = materialization.slice(
      0,
      materialization.indexOf("returns table"),
    );
    expect(signature).toContain("requested_job_id uuid");
    expect(signature).toContain("requested_delivery_version integer");
    expect(signature).toContain("requested_token_sha256_hex text");
    expect(signature).not.toMatch(/email|person|display_name|action_url/iu);
    expect(materialization).toContain(
      "requested_token_sha256_hex !~ '^[0-9a-f]{64}$'",
    );
  });

  it("requires the exact intended Auth UUID at acceptance", () => {
    const acceptance = between(
      "create or replace function private.accept_invitation(invitation_token text)",
      "revoke all on function private.invitation_recipient_binding",
    );

    expect(acceptance).toContain(
      "current_user_id is distinct from invitation_row.target_auth_user_id",
    );
    expect(acceptance).toContain(
      "invitation_row.target_email_confirmed_at <> current_email_confirmed_at",
    );
    expect(acceptance).toContain("invitation_row.recipient_binding <> binding");
    expect(acceptance).toContain("'target_identity_changed'");
    expect(acceptance).toContain("'target_accepted'");
  });

  it("pairs terminal job invalidation with pending-invitation revocation", () => {
    const audit = between(
      "create function private.enforce_invitation_job_audit_attribution()",
      "create or replace function private.enforce_invitation_job_integrity()",
    );
    const invalidation = between(
      "create function private.invalidate_target_bound_invitation_job(",
      "create function private.load_target_bound_invitation_job(",
    );
    const trigger = between(
      "create function private.revoke_target_bound_invitation_after_job_invalidation()",
      "create or replace function private.invalidate_invitation_jobs_after_authority_loss()",
    );

    expect(invalidation).toContain("state = 'invalidated'");
    expect(invalidation).toContain("invitation.accepted_at is null");
    expect(invalidation).toContain("invitation.revoked_at is null");
    expect(audit).toContain("'invitation_job_invalidated'");
    expect(audit).toContain("new.invalidated_by_membership_id");
    expect(migration).toContain(
      "create unique index audit_events_one_invitation_job_invalidation_idx",
    );
    expect(trigger).toContain("new.invalidation_reason <> 'target_accepted'");
    expect(trigger).toContain("set revoked_at = statement_timestamp()");
    expect(migration).toContain(
      "create trigger invitations_invalidate_target_bound_job",
    );
  });

  it("keeps every new coordinator seam unavailable to API roles", () => {
    const compactMigration = migration.replace(/\s+/gu, " ");

    for (const signature of [
      "private.invitation_recipient_binding(uuid, text, timestamptz)",
      "private.invalidate_target_bound_invitation_job( uuid, text, uuid, uuid )",
      "private.load_target_bound_invitation_job(uuid)",
      "private.materialize_target_bound_invitation_job( uuid, integer, text )",
      "private.revoke_target_bound_invitation_after_job_invalidation()",
    ]) {
      expect(compactMigration).toContain(
        `revoke all on function ${signature} from public, anon, authenticated, service_role;`,
      );
    }

    expect(migration).not.toMatch(
      /grant execute on function private\.(?:load|materialize|invalidate|invitation_recipient|revoke_target_bound)/iu,
    );
  });

  it("adds no provider, delivery credential, public Send seam, or raw-token return", () => {
    const addedPublicFunctions = [
      ...migration.matchAll(
        /create(?: or replace)? function public\.([a-z0-9_]+)/giu,
      ),
    ].map((match) => match[1]);

    expect(addedPublicFunctions).toEqual([]);
    expect(migration).not.toMatch(
      /provider_receipt|provider_message|smtp|resend_api|action_url|delivery_credential/iu,
    );
    expect(migration).not.toMatch(/returns table \([\s\S]{0,300}raw_token/iu);
  });
});
