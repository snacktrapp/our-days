import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const config = readFileSync(resolve(root, "supabase/config.toml"), "utf8");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260830105244_phase_2_identity_authorization.sql",
  ),
  "utf8",
);
const seed = readFileSync(resolve(root, "supabase/seed.sql"), "utf8");

describe("Supabase Phase 2 foundation contracts", () => {
  it("fails Auth and Data API defaults closed", () => {
    expect(config).toMatch(/\[api\][\s\S]*auto_expose_new_tables = false/u);
    expect(config).toMatch(/\[auth\][\s\S]*enable_signup = false/u);
    expect(config).toMatch(/\[auth\.email\][\s\S]*enable_signup = true/u);
    expect(config).toMatch(
      /\[auth\.email\][\s\S]*enable_confirmations = true/u,
    );
    expect(config).toContain(
      'additional_redirect_urls = ["http://127.0.0.1:3000"]',
    );
    expect(config).not.toContain("https://127.0.0.1:3000");
  });

  it("keeps browser roles read-only and every exposed family table under RLS", () => {
    for (const table of [
      "circles",
      "people",
      "circle_memberships",
      "person_guardians",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
      expect(migration).toContain(
        `revoke all on table public.${table} from public, anon, authenticated;`,
      );
      expect(migration).toContain(
        `grant select on table public.${table} to authenticated;`,
      );
    }
    expect(migration).toContain(
      "revoke create on schema public from public, anon, authenticated;",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[\s\S]{0,100}\s+to\s+(?:anon|authenticated)/iu,
    );
  });

  it("uses current database membership instead of editable or stale JWT roles", () => {
    expect(migration).toMatch(
      /membership\.user_id = \(select auth\.uid\(\)\)[\s\S]*membership\.status = 'active'/u,
    );
    expect(migration).not.toMatch(/raw_(?:user|app)_meta_data/u);
    expect(migration).not.toMatch(/auth\.jwt\(\)/u);
  });

  it("makes invitation secrets one-use, salted, hashed, and non-public", () => {
    expect(migration).toContain("create table private.invitations");
    expect(migration).toContain("token_hash bytea not null unique");
    expect(migration).toContain("email_salt bytea not null");
    expect(migration).toContain("email_hash bytea not null");
    const invitationTable = migration.slice(
      migration.indexOf("create table private.invitations"),
      migration.indexOf("create table private.audit_events"),
    );
    expect(invitationTable).not.toMatch(/invited_email\s+text/u);
    expect(migration).toMatch(
      /select candidate\.\*[\s\S]*for update;[\s\S]*accepted_at = statement_timestamp\(\)/u,
    );
    expect(migration).toContain("auth_user.email_confirmed_at");
    expect(migration).toContain("'Invitation is not available'");
  });

  it("keeps every definer implementation private with an empty search path", () => {
    expect(migration).not.toMatch(
      /create function public\.[\s\S]{0,500}security definer/iu,
    );
    const definerFunctions = migration.matchAll(
      /create function private\.[\s\S]*?security definer\s+set search_path = ''/gu,
    );
    expect([...definerFunctions].length).toBeGreaterThanOrEqual(10);
    expect(migration).toContain(
      "revoke all on schema private from public, anon, authenticated;",
    );
  });

  it("locks a circle before invitation, role, membership, and guardian mutation", () => {
    for (const functionName of [
      "create_invitation",
      "accept_invitation",
      "revoke_invitation",
      "revoke_membership",
      "set_membership_role",
      "create_managed_person",
      "set_person_guardian",
    ]) {
      const start = migration.indexOf(
        `create function private.${functionName}`,
      );
      expect(start).toBeGreaterThanOrEqual(0);
      const end = migration.indexOf("$$;", start);
      const body = migration.slice(start, end);
      expect(body).toMatch(/from public\.circles[\s\S]*for update/u);
    }
  });

  it("preserves circle attribution structurally and revokes guardian authority", () => {
    expect(migration).toContain(
      "foreign key (circle_id, person_id)\n    references public.people (circle_id, id)",
    );
    expect(migration).toContain(
      "foreign key (circle_id, actor_membership_id)\n    references public.circle_memberships (circle_id, id)",
    );
    expect(migration).toMatch(
      /update public\.person_guardians[\s\S]*guardian_membership_id = target\.id[\s\S]*update public\.circle_memberships/u,
    );
    expect(migration).toMatch(/guardian\.revoked_at is null/u);
  });

  it("ships deterministic two-circle and revoked/no-circle fixtures without personal data", () => {
    expect(seed).toContain("Cedar Circle");
    expect(seed).toContain("Harbor Circle");
    expect(seed).toContain("dual-circle@example.test");
    expect(seed).toContain("no-circle@example.test");
    expect(seed).toContain("'revoked'");
    expect(seed).not.toMatch(/brian|molly/iu);
  });

  it("keeps both media buckets private and closed before the media phase", () => {
    expect(migration).toContain(
      "('our-days-originals', 'our-days-originals', false, 52428800)",
    );
    expect(migration).toContain(
      "create policy our_days_storage_objects_closed_until_media_phase",
    );
    expect(migration).toContain("as restrictive");
  });
});
