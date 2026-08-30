import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260830125653_phase_3_written_moments.sql",
  ),
  "utf8",
);
const attributionMigration = readFileSync(
  resolve(
    root,
    "supabase/migrations/20260831000000_phase_7b_membership_attribution_foundation.sql",
  ),
  "utf8",
);

describe("written moments database contract", () => {
  it("keeps the browser read-only and the live feed RLS-backed", () => {
    expect(migration).toContain(
      "alter table public.moments enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.moments from public, anon, authenticated;",
    );
    expect(migration).toContain(
      "grant select on table public.moments to authenticated;",
    );
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.moments\s+to\s+(?:anon|authenticated)/iu,
    );
  });

  it("binds journal, recorder, and trash actor to the same circle", () => {
    expect(migration).toContain(
      "foreign key (circle_id, journal_person_id)\n    references public.people (circle_id, id)",
    );
    expect(attributionMigration).toMatch(
      /foreign key \(\s*circle_id,\s*recorded_by_membership_id\s*\) references public\.circle_memberships \(circle_id, id\)/u,
    );
    expect(attributionMigration).toMatch(
      /foreign key \(\s*circle_id,\s*trashed_by_membership_id\s*\) references public\.circle_memberships \(circle_id, id\)/u,
    );
  });

  it("makes journal, recorder, kind, and creation identity immutable", () => {
    expect(attributionMigration).toMatch(
      /new\.journal_person_id <> old\.journal_person_id[\s\S]*new\.recorded_by_membership_id <> old\.recorded_by_membership_id[\s\S]*new\.kind <> old\.kind[\s\S]*new\.created_at <> old\.created_at/u,
    );
  });

  it("backfills both attribution columns before validating membership foreign keys", () => {
    const recorderBackfill = attributionMigration.indexOf(
      "set recorded_by_membership_id = membership.id",
    );
    const trashBackfill = attributionMigration.indexOf(
      "set trashed_by_membership_id = membership.id",
    );
    const recorderValidation = attributionMigration.indexOf(
      "validate constraint moments_recorded_by_membership_fkey",
    );
    const trashValidation = attributionMigration.indexOf(
      "validate constraint moments_trashed_by_membership_fkey",
    );

    expect(recorderBackfill).toBeGreaterThan(-1);
    expect(trashBackfill).toBeGreaterThan(-1);
    expect(recorderValidation).toBeGreaterThan(recorderBackfill);
    expect(trashValidation).toBeGreaterThan(trashBackfill);
  });

  it("derives recorder and trash attribution from the active caller membership", () => {
    expect(attributionMigration).toMatch(
      /select membership\.id\s+into actor_membership_id[\s\S]*membership\.user_id = current_user_id[\s\S]*membership\.status = 'active'/u,
    );
    expect(attributionMigration).toMatch(
      /insert into public\.moments \([\s\S]*recorded_by_membership_id[\s\S]*\) values \([\s\S]*actor_membership_id/u,
    );
    expect(attributionMigration).toContain(
      "trashed_by_membership_id = actor_membership_id",
    );
  });

  it("rewrites stable readers narrowly and fails if their reviewed join drifts", () => {
    expect(attributionMigration).toContain(
      "recorder_membership.user_id = moment.recorded_by_user_id",
    );
    expect(attributionMigration).toContain(
      "recorder_membership.id = moment.recorded_by_membership_id",
    );
    expect(attributionMigration).toContain(
      "if legacy_occurrences <> expected_occurrences then",
    );
    expect(attributionMigration).toContain(
      "or membership_occurrences <> expected_occurrences then",
    );
    expect(attributionMigration).toContain(
      "Recorder attribution reader could not be migrated",
    );
  });

  it("does not yet weaken the Auth-user deletion boundary", () => {
    expect(attributionMigration).not.toMatch(
      /alter table public\.circle_memberships[\s\S]*(?:drop constraint circle_memberships_user_id_fkey|alter column user_id drop not null|on delete set null)/iu,
    );
  });

  it("ships reversible trash without deciding retention or hard purge", () => {
    expect(migration).toContain("set_written_moment_trashed");
    expect(migration).toContain(
      "Moments must use the reviewed deletion workflow",
    );
    expect(migration).not.toMatch(
      /create function public\.(?:delete|purge)|interval '30 days'|cron/iu,
    );
  });

  it("uses complete stable cursor fields and a traversal snapshot", () => {
    expect(migration).toContain("cursor_has_precise_time boolean default null");
    expect(migration).toContain("cursor_moment_id uuid default null");
    expect(migration).toContain("snapshot_at timestamptz default null");
    expect(migration).toContain("moment.created_at <= effective_snapshot_at");
    expect(migration).toContain(
      "or not (cursor_is_empty or cursor_is_complete)",
    );
  });

  it("prevents silent concurrent overwrites", () => {
    expect(migration).toContain("revision bigint not null default 1");
    expect(migration).toContain("new.revision := old.revision + 1");
    expect(migration).toContain("Moment changed elsewhere");
  });

  it("keeps date-only history authoritative and precise time internally consistent", () => {
    expect(migration).toContain("time_precision = 'date'");
    expect(migration).toContain("time_precision = 'minute'");
    expect(migration).toContain(
      "pg_catalog.date_trunc('minute', occurred_at) = occurred_at",
    );
    expect(migration).toContain(
      "pg_catalog.timezone(occurred_timezone, occurred_at)::date = occurred_on",
    );
  });

  it("writes content-free audit events rather than moment bodies", () => {
    const auditWrites = [
      ...migration.matchAll(/insert into private\.audit_events/gu),
    ];
    expect(auditWrites.length).toBeGreaterThanOrEqual(4);
    expect(migration).not.toMatch(
      /insert into private\.audit_events\s*\([^)]*body/iu,
    );
  });
});
