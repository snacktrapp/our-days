import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260830233000_phase_7_export_request_foundation.sql",
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

describe("private family export request foundation", () => {
  it("keeps the append-only job ledger private and browser inaccessible", () => {
    expect(migration).toContain("create table private.export_jobs");
    expect(migration).not.toContain("create table public.export_jobs");
    expect(migration).toContain(
      "alter table private.export_jobs enable row level security;",
    );
    expect(migration).toContain(
      "alter table private.export_jobs force row level security;",
    );
    expect(migration).toContain(
      "revoke all on table private.export_jobs from public, anon, authenticated;",
    );
    expect(migration).not.toMatch(
      /grant\s+\w+(?:\s*,\s*\w+)*\s+on\s+(?:table\s+)?private\.export_jobs/iu,
    );
  });

  it("binds the immutable requester and idempotency key to one circle", () => {
    expect(migration).toContain(
      "constraint export_jobs_requester_fkey foreign key (\n    circle_id,\n    requested_by_membership_id\n  ) references public.circle_memberships (circle_id, id)",
    );
    expect(migration).toContain(
      "constraint export_jobs_request_key_unique unique (\n    circle_id,\n    requested_by_membership_id,\n    request_key\n  )",
    );
    expect(migration).toMatch(
      /new\.id <> old\.id[\s\S]*new\.circle_id <> old\.circle_id[\s\S]*new\.requested_by_membership_id <> old\.requested_by_membership_id[\s\S]*new\.request_key <> old\.request_key/iu,
    );
  });

  it("derives a fresh same-circle organizer under the shared circle lock", () => {
    const publicWrapper = between(
      "create function public.request_family_export(",
      "create or replace function private.set_membership_role(",
    );

    expect(migration).toContain("where circle.id = requested_circle_id");
    expect(migration).toContain("for update;");
    expect(migration).toContain("membership.user_id = current_user_id");
    expect(migration).toContain("membership.status = 'active'");
    expect(migration).toContain("membership.role = 'organizer'");
    expect(migration).toContain(
      "requested_by_membership_id,\n    requester_authorization_version,\n    request_key",
    );
    expect(publicWrapper).not.toContain("requested_by_membership_id");
  });

  it("makes lost-response retries audit idempotent", () => {
    const lookup = migration.indexOf("select job.id");
    const insert = migration.indexOf("insert into private.export_jobs");
    const audit = migration.indexOf("insert into private.audit_events", insert);
    expect(lookup).toBeGreaterThan(0);
    expect(insert).toBeGreaterThan(lookup);
    expect(audit).toBeGreaterThan(insert);
    expect(migration).toContain(
      "if existing_job_id is not null then\n    return existing_job_id;",
    );
  });

  it("keeps privileged mutation fixed-path and exposes only a narrow wrapper", () => {
    expect(migration).toMatch(
      /create function private\.request_family_export\([\s\S]*security definer\s+set search_path = ''/iu,
    );
    expect(migration).toMatch(
      /create function public\.request_family_export\([\s\S]*security invoker\s+set search_path = ''/iu,
    );
    expect(migration).toContain(
      "grant execute on function public.request_family_export(uuid, uuid)\n  to authenticated;",
    );
    expect(migration).toContain(
      "revoke all on function private.export_job_requester_is_authorized(uuid)\n  from public, anon, authenticated;",
    );
  });

  it("requires future processing to recheck the recorded membership", () => {
    const authorizationHelper = between(
      "create function private.export_job_requester_is_authorized(",
      "create function public.request_family_export(",
    );

    expect(authorizationHelper).toMatch(
      /from private\.export_jobs as job[\s\S]*join public\.circle_memberships as membership[\s\S]*membership\.status = 'active'[\s\S]*membership\.role = 'organizer'/iu,
    );
    expect(authorizationHelper).toContain("job.state = 'queued'");
    expect(authorizationHelper).toContain(
      "membership.updated_at = job.requester_authorization_version",
    );
    expect(authorizationHelper).not.toContain("auth.uid()");
  });

  it("coalesces queued work and makes authorization invalidation terminal", () => {
    expect(migration).toContain(
      "create unique index export_jobs_one_queued_per_requester_idx",
    );
    expect(migration).toContain("where state = 'queued';");
    expect(migration).toContain(
      "old.state = 'queued'\n        and new.state = 'invalidated'",
    );
    expect(migration).not.toMatch(
      /old\.state = 'invalidated'[\s\S]{0,160}new\.state = 'queued'/iu,
    );
    expect(migration).toMatch(
      /requested_role = 'member'[\s\S]*update private\.export_jobs as job[\s\S]*job\.state = 'queued'/iu,
    );
    expect(migration).toMatch(
      /create or replace function private\.revoke_membership[\s\S]*update private\.export_jobs as job[\s\S]*job\.state = 'queued'/iu,
    );
  });

  it("does not smuggle artifact, retention, media, or worker policy into the request seam", () => {
    expect(migration).not.toMatch(
      /storage\.objects|create bucket|output_path|artifact_path|signed_url|expires_at|interval\s+'30 days'|purge|service_role|media_asset|video/iu,
    );
    expect(migration).not.toMatch(
      /insert into private\.audit_events\s*\([^)]*(?:request_key|body|title|place_name|filename|path|url)/iu,
    );
  });
});
