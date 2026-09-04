import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    import.meta.dirname,
    "../../supabase/migrations/20260904161258_operations_membership_role.sql",
  ),
  "utf8",
);

describe("operations membership database contract", () => {
  it("adds Operations without collapsing organizer or member", () => {
    expect(migration).toContain(
      "check (role in ('member', 'organizer', 'operations'))",
    );
    expect(migration).toContain("membership.role <> 'operations'");
    expect(migration).toContain(
      "membership.role in ('organizer', 'operations')",
    );
  });

  it("migrates TARS by Auth email, not display name", () => {
    expect(migration).toContain("tars-trapp@agentmail.to");
    expect(migration).not.toMatch(/display_name\s*=\s*'TARS'/iu);
    expect(migration).toContain("and other.role = 'organizer'");
  });

  it("lets Operations create Insights without organizer family-admin power", () => {
    expect(migration).toContain(
      "create or replace function private.create_insight_moment(",
    );
    expect(migration).toContain("actor_role = 'organizer'");
    expect(migration).toContain(
      "private.is_circle_organizer(requested_circle_id)",
    );
  });
});
