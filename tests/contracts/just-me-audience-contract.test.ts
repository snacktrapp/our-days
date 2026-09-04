import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260904183534_just_me_audience.sql",
  ),
  "utf8",
);

describe("Just Me audience database contract", () => {
  it("stores audience on moments with a locked family default", () => {
    expect(migration).toContain(
      "add column audience text not null default 'family'",
    );
    expect(migration).toContain("audience in ('family', 'just_me')");
    expect(migration).toContain("kind <> 'insight' or audience = 'family'");
  });

  it("keeps Just Me off the family feed and other journals", () => {
    expect(migration).toContain("moment.audience = 'family'");
    expect(migration).toContain("moment.audience = 'just_me'");
    expect(migration).toContain(
      "recorder_membership.user_id = (select auth.uid())",
    );
    expect(migration).toContain("private.can_read_moment_audience(");
    expect(migration).toContain("private.just_me_journal_is_recorder(");
  });

  it("does not grant organizers a Just Me read path", () => {
    expect(migration).not.toMatch(
      /grant\s+(?:insert|update|delete|all)\s+on\s+table\s+public\.moments\s+to\s+(?:anon|authenticated)/iu,
    );
    expect(migration).toContain(
      "drop policy moments_select_live_active_circle on public.moments",
    );
  });
});
