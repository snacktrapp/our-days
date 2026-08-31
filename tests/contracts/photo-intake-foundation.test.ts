import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260831020000_phase_4a_photo_intake_foundation.sql",
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

describe("quarantined photo-intake foundation", () => {
  it("keeps the immutable intake ledger private and forced through RLS", () => {
    expect(migration).toContain("create table private.photo_intakes");
    expect(migration).toContain(
      "alter table private.photo_intakes enable row level security;",
    );
    expect(migration).toContain(
      "alter table private.photo_intakes force row level security;",
    );
    expect(migration).toContain(
      "revoke all on table private.photo_intakes\n  from public, anon, authenticated, service_role;",
    );
    expect(migration).toContain("Photo intake history cannot be deleted");
    expect(migration).toContain("Photo intake history is immutable");
  });

  it("creates one private, bounded, declared-photo quarantine bucket", () => {
    expect(migration).toMatch(
      /values \(\s*'our-days-intake',\s*'our-days-intake',\s*false,\s*52428800,/u,
    );
    for (const mime of [
      "image/heic",
      "image/heif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]) {
      expect(migration).toContain(`'${mime}'`);
    }
    expect(migration).not.toMatch(
      /update\s+storage\.buckets[\s\S]*(?:our-days-originals|our-days-display)/iu,
    );
  });

  it("mints only a server-generated opaque path and exposes no caller path", () => {
    const reservation = between(
      "create function private.reserve_photo_intake(",
      "create function private.acknowledge_photo_intake(",
    );
    const publicReservation = between(
      "create function public.reserve_photo_intake(",
      "create function public.acknowledge_photo_intake(",
    );

    expect(reservation).toContain(
      "generated_intake_id := extensions.gen_random_uuid()",
    );
    expect(reservation).toContain("'intake/' || generated_intake_id::text");
    expect(
      publicReservation.slice(0, publicReservation.indexOf("returns table")),
    ).not.toMatch(/path|filename|file_name/iu);
  });

  it("permits only authenticated TUS create and part at the claimed path", () => {
    const policy = between(
      "create policy our_days_intake_insert_exact_live_tus_claim",
      "create function public.reserve_photo_intake(",
    );

    expect(policy).toContain("for insert");
    expect(policy).toContain("to authenticated");
    expect(policy).toContain("storage.allow_any_operation(array[");
    expect(policy).toContain("'storage.tus.upload.create'");
    expect(policy).toContain("'storage.tus.upload.part'");
    expect(policy).toContain("owner_id = (select auth.uid()::text)");
    expect(policy).toMatch(
      /private\.photo_intake_path_is_uploadable\(\s*name,\s*owner_id,\s*user_metadata\s*\)/u,
    );
    for (const forbiddenOperation of [
      "storage.object.upload",
      "storage.object.upload_sign",
      "storage.object.update",
      "storage.object.remove",
      "storage.object.get",
      "storage.object.list",
      "storage.s3",
    ]) {
      expect(policy).not.toContain(forbiddenOperation);
    }
    expect(migration).not.toMatch(
      /create policy our_days_intake_[\s\S]{0,160}for (?:select|update|delete)/iu,
    );
  });

  it("holds the Auth then circle authority barrier through Storage INSERT", () => {
    const uploadGuard = between(
      "create function private.photo_intake_path_is_uploadable(",
      "create function private.reserve_photo_intake(",
    );
    const authLock = uploadGuard.indexOf("from auth.users as auth_user");
    const circleLock = uploadGuard.indexOf("from public.circles as circle");

    expect(uploadGuard).toContain("language plpgsql");
    expect(uploadGuard).toContain("volatile");
    expect(authLock).toBeGreaterThanOrEqual(0);
    expect(circleLock).toBeGreaterThan(authLock);
    expect(uploadGuard).toContain("for update;");
    expect(uploadGuard).toContain("target.state = 'upload_claimed'");
    expect(uploadGuard).toContain(
      "target.upload_expires_at > statement_timestamp()",
    );
    expect(uploadGuard).toContain(
      "requested_user_metadata = jsonb_build_object(",
    );
    expect(uploadGuard).toContain(
      "'expected_sha256', encode(target.expected_sha256, 'hex')",
    );
    expect(uploadGuard).toContain(
      "private.photo_intake_requester_is_authorized(target.id)",
    );
  });

  it("uses the accepted self, organizer-managed, or explicit-guardian authority", () => {
    const authorization = between(
      "create function private.photo_intake_requester_is_authorized(",
      "create function private.photo_intake_path_is_uploadable(",
    );

    expect(authorization).toContain(
      "membership.person_id = intake.journal_person_id",
    );
    expect(authorization).toContain("journal_person.profile_kind = 'managed'");
    expect(authorization).toContain("membership.role = 'organizer'");
    expect(authorization).toContain("from public.person_guardians as guardian");
    expect(authorization).toContain("guardian.revoked_at is null");
    expect(authorization).not.toContain(
      "membership.updated_at = intake.requester_authorization_version",
    );
  });

  it("commits one validated fingerprint and a bounded upload window", () => {
    const claim = between(
      "create function private.claim_photo_intake_upload(",
      "create function private.acknowledge_photo_intake(",
    );
    const publicClaim = between(
      "create function public.claim_photo_intake_upload(",
      "create function public.acknowledge_photo_intake(",
    );

    expect(claim).toContain("requested_upload_request_key uuid");
    expect(claim).toContain("requested_expected_mime_type text");
    expect(claim).toContain("requested_expected_size_bytes bigint");
    expect(claim).toContain("requested_expected_sha256_hex text");
    expect(claim).toContain(
      "requested_expected_sha256_hex !~ '^[0-9a-f]{64}$'",
    );
    expect(claim).toContain(
      "requested_expected_size_bytes not between 1 and 52428800",
    );
    expect(claim).toContain("decode(requested_expected_sha256_hex, 'hex')");
    expect(claim).toContain("state = 'upload_claimed'");
    expect(claim).toContain("interval '2 hours'");
    expect(claim).toContain(
      "target.upload_request_key is distinct from requested_upload_request_key",
    );
    expect(publicClaim).toContain("upload_request_key uuid");
    expect(publicClaim).toContain("expected_mime_type text");
    expect(publicClaim).toContain("expected_size_bytes bigint");
    expect(publicClaim).toContain("expected_sha256_hex text");
    expect(publicClaim).toContain("upload_expires_at timestamptz");
  });

  it("acknowledges only claimed bytes as uploaded and explicitly unverified", () => {
    const acknowledgement = between(
      "create function private.acknowledge_photo_intake(",
      "create function private.invalidate_photo_intakes_after_membership_change(",
    );

    expect(acknowledgement).toContain("target.state = 'upload_claimed'");
    expect(acknowledgement).toContain(
      "if target.state = 'upload_claimed' then",
    );
    expect(acknowledgement).toContain("set state = 'uploaded_unverified'");
    expect(acknowledgement).toContain(
      "stored_owner_id is distinct from current_user_id::text",
    );
    expect(acknowledgement).toContain("observed_mime_type_unverified");
    expect(acknowledgement).toContain("observed_size_bytes_unverified");
  });

  it("terminalizes membership and guardian authority loss with attribution", () => {
    expect(migration).toContain(
      "invalidation_reason in (\n        'membership_authority_changed',\n        'guardian_authority_revoked'",
    );
    expect(migration).toContain(
      "invalidation_reason = 'membership_authority_changed'",
    );
    expect(migration).toContain(
      "invalidation_reason = 'guardian_authority_revoked'",
    );
    expect(migration).toContain(
      "create trigger photo_intakes_invalidate_after_membership_change",
    );
    expect(migration).toContain(
      "create trigger photo_intakes_invalidate_after_guardian_revocation",
    );
  });

  it("exposes only reservation, claim, and acknowledgement RPCs", () => {
    expect(migration).toContain(
      "grant execute on function public.reserve_photo_intake(uuid, uuid, uuid)\n  to authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.claim_photo_intake_upload(\n  uuid, uuid, text, bigint, text\n) to authenticated;",
    );
    expect(migration).toContain(
      "grant execute on function public.acknowledge_photo_intake(uuid)\n  to authenticated;",
    );
    expect(migration).not.toMatch(
      /create function public\.(?:read|download|sign|publish|accept|verify)_photo/iu,
    );
    expect(migration).not.toMatch(/insert into public\.moments/iu);
  });

  it("documents quarantine as unverified rather than physically single-write", () => {
    expect(migration).toContain("state = 'uploaded_unverified'");
    expect(migration).not.toMatch(/state\s*=\s*'verified'/iu);
    expect(migration).not.toMatch(/insert into storage\.objects/iu);
    expect(migration).not.toMatch(/our-days-originals[\s\S]{0,120}insert/iu);
  });
});
